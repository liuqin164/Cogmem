import { expect, test } from 'bun:test';

import { createMemoryKernel } from '../src/public.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { compileAgentRecallQuery } from '../src/agent/AgentRecallQueryCompiler.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * A question that names a period and a question that names a subject want
 * opposite treatment from the temporal surface.
 *
 * Memoriy recorded in a week IS the answer to "这周说了什么", so widening to it
 * is the answer rather than dilution. A subject question is the other way round:
 * a bucket expands to every memory recorded in it, so a day bucket is everything
 * said that day, and a subject query may widen with that neighbourhood but must
 * not be answered from it.
 *
 * A gate keyed only on "does the query contain a word of two characters or more"
 * cannot tell them apart — every real query does — and it disabled the widening
 * for exactly the period questions the design preserves.
 */

async function seed(backend: KernelAgentMemoryBackend, now: number): Promise<void> {
  const DAY = 86_400_000;
  const turns = [
    'CI 从来不在 4.0 分支上跑，因为 workflow 只监听 main',
    '今天把缓存策略改了，顺便修了重试路径',
    '讨论了权限设计的三种方案，最后选了最小的一种',
  ];
  for (const [index, text] of turns.entries()) {
    await backend.rememberTurnWithResult({
      agentId: 'a',
      projectId: 'p',
      sessionId: `s-${index}`,
      userText: text,
      assistantText: `第 ${index} 条记下了`,
      timestamp: now - (index + 1) * DAY,
    });
  }
}

test('a question about a period is answered from that period', async () => {
  const now = Date.now();
  const kernel = createMemoryKernel({ dbPath: joinTemp(), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  await seed(backend, now);

  const plan = compileAgentRecallQuery({ query: '这周说了什么' });
  const windowed = kernel.navigateMemory(plan.primarySearchText, {
    projectId: 'p',
    limit: 8,
    startTime: now - 7 * 86_400_000,
    endTime: now,
  });
  const unwindowed = kernel.navigateMemory(plan.primarySearchText, { projectId: 'p', limit: 8 });

  // Assert the widening itself. Asserting that the result is non-empty proves
  // nothing: the recency fallback fills it either way, so an earlier version of
  // this test passed with the gate that disables the widening still in place.
  const traversed = (result: typeof windowed) =>
    (result.navigation?.branchSearch?.temporalTraversal?.neuronIds ?? []).length;

  expect(traversed(windowed)).toBeGreaterThan(0);
  expect(traversed(unwindowed)).toBe(0);

  kernel.close();
});

test('a question about a subject is not answered from a coincidental window', async () => {
  const now = Date.now();
  const kernel = createMemoryKernel({ dbPath: joinTemp(), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  await seed(backend, now);

  const plan = compileAgentRecallQuery({ query: '缓存策略怎么改的' });
  const navigated = kernel.navigateMemory(plan.primarySearchText, { projectId: 'p', limit: 8 });

  // Nothing was asked about a period, so the answer must be about the subject.
  expect(JSON.stringify(navigated.rawEvidence)).toContain('缓存策略');

  kernel.close();
});

function joinTemp(): string {
  return `${makeTempDir('cogmem-period-')}/memory.db`;
}
