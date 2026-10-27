import { expect, test } from 'bun:test';

import { createMemoryKernel } from '../src/public.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The hardest memory to reach is the one that reads like seven others.
 *
 * A year of conversation repeats itself: same phrasing, different name, different
 * reference number. Compiled memory cannot separate those — the deduplicator
 * compares whole-content vectors, so a small distinguishing detail does not make a
 * new memory — and that is by design rather than a defect, because the raw ledger is
 * the layer that holds every event and the recall path reads it.
 *
 * This is the objective stated as a test: a memory recorded a year ago, worded
 * almost identically to seven others, must still be retrievable by the only thing
 * that makes it itself.
 *
 * It is also the case that would break silently: if the raw-ledger lane regressed,
 * compiled memory would still answer for the recently-phrased memories and only
 * these would go missing.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

const PLANTED = [
  { code: 1111, who: '张伟', days: 350 },
  { code: 2222, who: '李娜', days: 300 },
  { code: 3333, who: '王强', days: 250 },
  { code: 4444, who: '陈静', days: 200 },
  { code: 5555, who: '刘洋', days: 150 },
  { code: 6666, who: '赵敏', days: 100 },
  { code: 7777, who: '孙磊', days: 50 },
  { code: 8888, who: '周涛', days: 5 },
];

const VERBS = ['重构', '迁移', '修复', '审计', '压测', '限流', '灰度', '回滚', '扩容', '降级'];
const OBJS = ['账单导出', '入职文案', '表结构', '鉴权链路', '消息队列', '冷启动', '灰度开关', '容量水位', '审计日志', '回溯索引'];
const PEOPLE = ['张伟', '李娜', '王强', '陈静'];

test('a year-old memory worded like seven others is still retrievable', async () => {
  const kernel = createMemoryKernel({
    dbPath: `${makeTempDir('cogmem-near-')}/memory.db`,
    vectorBackend: 'sqlite-vec',
  });
  const backend = new KernelAgentMemoryBackend(kernel);

  // Distractors on the same template, spread across the year.
  for (let index = 0; index < 300; index += 1) {
    await backend.rememberTurnWithResult({
      agentId: 'a', projectId: 'p', sessionId: `f-${Math.floor(index / 10)}`,
      userText: `第 ${index} 件事：${VERBS[index % 10]} ${OBJS[index % 10]}，涉及单据号 ${(index * 7) % 9000}，负责人 ${PEOPLE[index % 4]}。`,
      assistantText: `第 ${index} 项已记录。`,
      timestamp: NOW - ((index * 11) % 360) * DAY,
    });
  }
  for (const entry of PLANTED) {
    await backend.rememberTurnWithResult({
      agentId: 'a', projectId: 'p', sessionId: `p-${entry.code}`,
      userText: `有一件事：重构 账单导出，涉及单据号 ${entry.code}，负责人 ${entry.who}。`,
      assistantText: '记下了。',
      timestamp: NOW - entry.days * DAY,
    });
  }

  const misses: string[] = [];
  for (const entry of PLANTED) {
    const recalled = backend.recall({
      query: `单据号 ${entry.code} 那件事是谁负责的`,
      projectId: 'p', agentId: 'a', limit: 5, now: NOW,
    });
    if (!JSON.stringify(recalled.items ?? []).includes(String(entry.code))) {
      misses.push(`${entry.code} (${entry.days} 天前)`);
    }
  }

  // Named individually rather than counted, so a failure says which memory and how
  // old it was.
  expect(misses).toEqual([]);
  kernel.close();
}, 240_000);
