import { expect, test } from 'bun:test';

import { createMemoryKernel } from '../src/public.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * A memory does not become harder to reach as it ages.
 *
 * This is the property the architecture exists for: a conversation from a year
 * ago must come back as readily as one from yesterday, or the store is a recent
 * window with extra steps. Activation decay is supposed to decide how readily a
 * memory surfaces, never whether it can be reached (ADR-0001), and the recall
 * lanes are supposed to hold a path to cold nodes.
 *
 * The test plants one distinctive memory per age band inside a corpus of three
 * hundred unrelated ones spread across the same year, then asks for each. A
 * store that answered the newest band and drifted for the oldest would fail here
 * while passing a test that only checked "something came back".
 */

const DAY = 86_400_000;

const BANDS: Array<{ label: string; days: number; memory: string; ask: string }> = [
  { label: 'yesterday', days: 1, memory: '鲸鱼迁徙的窗口在十月第九天开启', ask: '鲸鱼迁徙' },
  { label: 'a month', days: 30, memory: '变压器检修要在雨季之前完成', ask: '变压器检修' },
  { label: 'half a year', days: 180, memory: '珊瑚白化的临界温度是三十一度', ask: '珊瑚白化' },
  { label: 'a year', days: 365, memory: '铁路调度在春节前后加开临客', ask: '铁路调度' },
];

const FILLER = ['讨论了部署流程', '改了重试路径', '看了缓存策略', '更新了日志格式', '改了权限模型', '调整了限流阈值'];

test('a year-old memory is as reachable as one from yesterday', async () => {
  const kernel = createMemoryKernel({ dbPath: `${makeTempDir('cogmem-age-')}/memory.db`, vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  const now = Date.now();

  for (const band of BANDS) {
    await backend.rememberTurnWithResult({
      agentId: 'a', projectId: 'p', sessionId: `band-${band.days}`,
      userText: band.memory, assistantText: '记下了。', timestamp: now - band.days * DAY,
    });
  }
  // Unrelated turns spread across the same year, so age is the only difference
  // between the bands and nothing is simply the newest row in the table.
  for (let index = 0; index < 320; index += 1) {
    await backend.rememberTurnWithResult({
      agentId: 'a', projectId: 'p', sessionId: `filler-${Math.floor(index / 10)}`,
      userText: `${FILLER[index % FILLER.length]}，第 ${index} 次。`,
      assistantText: `第 ${index} 条。`,
      timestamp: now - ((index * 37) % 365) * DAY,
    });
  }

  const ranks: Record<string, number> = {};
  for (const band of BANDS) {
    const recalled = backend.recall({ query: band.ask, projectId: 'p', agentId: 'a', limit: 5 });
    const rank = (recalled.items ?? []).findIndex((item) => JSON.stringify(item).includes(band.memory.slice(0, 8)));
    ranks[band.label] = rank;
    // Present at all, and near the top: an answer at the limit is inside the noise
    // a caller has to read past.
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThan(3);
  }

  // The oldest band must not be worse than the newest, which is the claim. The
  // bands are compared rather than each being asserted alone so a uniform drift
  // upwards is visible in the failure.
  expect(ranks['a year']).toBeLessThanOrEqual(ranks['yesterday']! + 1);

  kernel.close();
}, 120_000);
