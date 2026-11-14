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
  // The corpus is the owner's own turns; the occasion gate is not what this measures (#162).
  const backend = new KernelAgentMemoryBackend(kernel, {
    binding: kernel.occasionScope.register({ channelId: 'older-than-a-year', occasion: 'private' }),
  });

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
  // #173: a miss is judged across all rounds, the way the latency half is judged by its median (#140).
  // Collecting only round 0 made this a test of the coldest, noisiest run: measured on CI, the same SHA missed
  // `9003` in its push run and found it four rounds running in its pull-request run, and a re-run of the failed
  // job passed. A memory that is found in any of the five rounds was found.
  const answeredCodes = new Set<number>();

  // #140: warm up first, then measure five rounds and judge the median, with a disaster ceiling on any single run.
  // The old assertion took the slowest of one round, which on a busy runner is a measurement of the runner: it
  // failed at 546.9 / 553.6 / 529.8 ms on a load-average-2.0 machine while main reproduced the same numbers, so it
  // was measuring the machine and calling it a regression.
  const recallFor = (code: string) => {
    const started = performance.now();
    const recalled = backend.recall({ query: `单据号 ${code} 那件事是谁负责的`, projectId: 'p', agentId: 'a', limit: 5, now: NOW });
    return { ms: performance.now() - started, recalled };
  };
  recallFor(OLD[0]!.code); // warm-up: schema, statement caches, page cache
  const samples: number[] = [];
  const byAge: Array<{ days: number; ms: number }> = [];
  for (let round = 0; round < 5; round += 1) {
    for (const entry of OLD) {
      const { ms, recalled } = recallFor(entry.code);
      samples.push(ms);
      if (round === 0) byAge.push({ days: entry.days, ms });
      // On the item's own text: a substring over the whole serialised result passes
      // on a numeric coincidence in an id, an ordinal or a timestamp.
      const answered = (recalled.items ?? []).some((item) => String((item as { text?: string }).text ?? '').includes(String(entry.code)));
      if (answered) answeredCodes.add(entry.code);
    }
  }

  for (const entry of OLD) {
    if (!answeredCodes.has(entry.code)) misses.push(`${entry.code} (${entry.days} 天前, ${(entry.days / 365).toFixed(1)} 年)`);
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

  // The objective names a number: within 500 ms. Median, not slowest (#140): a single slow round is noise on a
  // shared runner, while a median that drifts is the regression this is for. The ceiling catches the other failure
  // mode — a hang — which a median would happily average away.
  const sorted = samples.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const worst = sorted[sorted.length - 1]!;
  expect(median).toBeLessThan(500);
  expect(worst).toBeLessThan(1500);

  // Self-proving red: the numbers the ticket reports from the failing machine must fail this predicate, or the
  // guard is a decoration. Judged with the same median the assertion above uses, so the two cannot drift apart.
  const reported = [546.9, 553.6, 529.8].sort((a, b) => a - b);
  expect(reported[Math.floor(reported.length / 2)]!).toBeGreaterThanOrEqual(500);

  kernel.close();
}, 300_000);
