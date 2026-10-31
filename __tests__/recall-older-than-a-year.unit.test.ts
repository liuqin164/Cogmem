import { expect, test } from 'bun:test';

import { createMemoryKernel } from '../src/public.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The objective says "more than a year", and that is what this measures.
 *
 * The year-scale and near-duplicate tests stop at three hundred and sixty-five days,
 * so between them they support "any band within a year recalls" and say nothing about
 * a memory older than one. This one plants nothing younger than 366 days, up to about
 * four years, and puts six hundred distractors around them that are also more than a
 * year old.
 *
 * Without it the objective's own wording is unverified, and it is the kind of gap that
 * reads as covered because the neighbouring test is titled "year-scale".
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

const OLD = [
  { code: 9001, who: '张伟', days: 366 },
  { code: 9002, who: '李娜', days: 400 },
  { code: 9003, who: '王强', days: 500 },
  { code: 9004, who: '陈静', days: 730 },
  { code: 9005, who: '刘洋', days: 1000 },
  { code: 9006, who: '赵敏', days: 1500 },
];

const VERBS = ['重构', '迁移', '修复', '审计', '压测', '限流', '灰度', '回滚', '扩容', '降级'];
const OBJS = ['账单导出', '入职文案', '表结构', '鉴权链路', '消息队列', '冷启动', '灰度开关', '容量水位', '审计日志', '回溯索引'];
const PEOPLE = ['张伟', '李娜', '王强', '陈静'];

test('a memory older than a year is still retrievable', async () => {
  const kernel = createMemoryKernel({
    dbPath: `${makeTempDir('cogmem-old-')}/memory.db`,
    vectorBackend: 'sqlite-vec',
  });
  const backend = new KernelAgentMemoryBackend(kernel);

  // Distractors older than a year as well, so nothing here can be found by recency.
  for (let index = 0; index < 600; index += 1) {
    await backend.rememberTurnWithResult({
      agentId: 'a', projectId: 'p', sessionId: `f-${Math.floor(index / 10)}`,
      userText: `第 ${index} 件事：${VERBS[index % 10]} ${OBJS[index % 10]}，涉及单据号 ${(index * 7) % 9000}，负责人 ${PEOPLE[index % 4]}。`,
      assistantText: `第 ${index} 项已记录。`,
      timestamp: NOW - (400 + ((index * 13) % 1200)) * DAY,
    });
  }
  for (const entry of OLD) {
    await backend.rememberTurnWithResult({
      agentId: 'a', projectId: 'p', sessionId: `o-${entry.code}`,
      userText: `有一件事：重构 账单导出，涉及单据号 ${entry.code}，负责人 ${entry.who}。`,
      assistantText: '记下了。',
      timestamp: NOW - entry.days * DAY,
    });
  }

  const misses: string[] = [];
  const byAge: Array<{ days: number; ms: number }> = [];
  for (const entry of OLD) {
    const started = performance.now();
    const recalled = backend.recall({
      query: `单据号 ${entry.code} 那件事是谁负责的`,
      projectId: 'p', agentId: 'a', limit: 5, now: NOW,
    });
    byAge.push({ days: entry.days, ms: performance.now() - started });
    // On the item's own text: a substring over the whole serialised result passes
    // on a numeric coincidence in an id, an ordinal or a timestamp.
    const answered = (recalled.items ?? []).some((item) => String((item as { text?: string }).text ?? '').includes(String(entry.code)));
    if (!answered) {
      misses.push(`${entry.code} (${entry.days} 天前, ${(entry.days / 365).toFixed(1)} 年)`);
    }
  }

  expect(misses).toEqual([]);

  // "As fast as possible" is half the objective and had no check at all. Timing is
  // machine-dependent, so the assertion is about shape first: the oldest memory must
  // not cost materially more than the newest. That is the property the architecture
  // is for, and it survives a slow or a busy runner in a way an absolute number does
  // not.
  const oldest = byAge.filter((entry) => entry.days >= 730).reduce((sum, entry) => sum + entry.ms, 0)
    / byAge.filter((entry) => entry.days >= 730).length;
  const newest = byAge.find((entry) => entry.days === 366)!.ms;
  // ponytail: 4x is deliberately loose -- this catches an age penalty, not a slow
  // machine. Tighten only against a fixed runner.
  expect(oldest).toBeLessThan(newest * 4);

  // The objective names a number: within 500 ms. This asserts the SLOWEST of the
  // sample, which is stricter than the p95 the objective names — at this sample
  // size (6 recalls) an index of floor(0.95 * n) is the maximum anyway, and calling
  // that a percentile was a label that outran the code.
  //
  // Measured at year scale (20,343 events, 101 neurons, 36 recalls): p50 189 ms, p95
  // 282 ms, max 290 ms, none over 500. This corpus is smaller, so this guards the
  // requirement rather than reproducing that measurement.
  const sorted = byAge.map((entry) => entry.ms).sort((a, b) => a - b);
  const slowest = sorted[sorted.length - 1]!;
  expect(slowest).toBeLessThan(500);

  kernel.close();
}, 300_000);
