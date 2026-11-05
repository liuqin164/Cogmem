import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/public.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * A query that names words the memory does not contain must not be answered from
 * whatever the memory happens to hold.
 *
 * When the temporal surface found nothing, the search fell back to the first 24
 * neurons of the project's time branches — a fixed window unrelated to the query.
 * With a small ledger that window is the whole ledger, so every question returned
 * the same memories; with a large one the window is the first 24 memories ever
 * recorded, so an answer past them was unreachable no matter what was asked.
 */

const SUBJECTS = ['鲸鱼迁徙', '变压器检修', '珊瑚白化', '铁路调度', '疫苗冷链', '潮汐发电'];

async function seed(backend: KernelAgentMemoryBackend): Promise<void> {
  for (let index = 0; index < 60; index += 1) {
    await backend.rememberTurnWithResult({
      agentId: 'a',
      projectId: 'p',
      sessionId: `s-${Math.floor(index / 20)}`,
      userText: `${SUBJECTS[index % SUBJECTS.length]}的第 ${index} 号记录，涉及独立事项 ${index}。`,
      assistantText: `记下第 ${index} 号。`,
      timestamp: Date.now() - (60 - index) * 3_600_000,
    });
  }
}

test('a query the memory cannot answer is not answered from a fixed window', async () => {
  const kernel = createMemoryKernel({ dbPath: join(makeTempDir('cogmem-unanswerable-'), 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  await seed(backend);

  // A real question that names words appearing nowhere in the ledger. Falling back
  // to the newest memories is honest — the answer is "I have nothing on this, here
  // is what I do have". What must not happen is that same window being served as
  // the answer to an answerable question too: then every question returns one set
  // of memories, and a caller cannot tell an answer from a fallback.
  const unanswerable = backend.recall({
    query: '量子退相干与超导材料的能隙',
    projectId: 'p',
    agentId: 'a',
    limit: 5,
  });
  const answerable = backend.recall({ query: '鲸鱼迁徙', projectId: 'p', agentId: 'a', limit: 5 });

  const unanswerableIds = unanswerable.items.map((item) => item.id).sort().join(',');
  const answerableIds = answerable.items.map((item) => item.id).sort().join(',');
  expect(answerableIds.length).toBeGreaterThan(0);
  expect(unanswerableIds).not.toBe(answerableIds);

  kernel.close();
});

test('a query the memory can answer still finds it', async () => {
  const kernel = createMemoryKernel({ dbPath: join(makeTempDir('cogmem-answerable-'), 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  await seed(backend);

  const related = backend.recall({ query: '鲸鱼迁徙', projectId: 'p', agentId: 'a', limit: 5 });

  expect(related.items.length).toBeGreaterThan(0);
  expect(JSON.stringify(related.items)).toContain('鲸鱼迁徙');

  kernel.close();
});

test('two different questions do not return the same memories', async () => {
  const kernel = createMemoryKernel({ dbPath: join(makeTempDir('cogmem-distinct-'), 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  await seed(backend);

  const first = backend.recall({ query: '鲸鱼迁徙', projectId: 'p', agentId: 'a', limit: 5 });
  const second = backend.recall({ query: '疫苗冷链', projectId: 'p', agentId: 'a', limit: 5 });

  // Both are answerable, so both return something — and not the same something.
  expect(first.items.length).toBeGreaterThan(0);
  expect(second.items.length).toBeGreaterThan(0);
  const firstIds = first.items.map((item) => item.id).join(',');
  const secondIds = second.items.map((item) => item.id).join(',');
  expect(firstIds).not.toBe(secondIds);

  kernel.close();
});
