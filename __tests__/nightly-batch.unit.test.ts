import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 5, 5, 12, 0, 0);

function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(makeTempDir('cogmem-nightly-batch-'), 'memory.db') });
}

function seedConversation(kernel: MemoryKernel, index: number): void {
  const sessionId = `session-${index}`;
  const occurredAt = T0 + index * 60_000;
  const event = kernel.eventStore.append({
    eventId: `evt-${index}`,
    streamId: sessionId,
    streamType: 'thread',
    eventType: 'MESSAGE',
    rawEventType: 'message',
    projectId: 'p',
    sessionId,
    threadId: sessionId,
    role: 'user',
    occurredAt,
    localDate: '2026-06-05',
    payload: { text: `请以后始终记住：第 ${index} 次部署流程的负责小组是青栎组。` },
  });
  kernel.appendRawEventToEpisode(event, { projectId: 'p', sessionId, sourceAgent: 'test', now: occurredAt });
}

test('one command seals, dreams and projects the night, and running it again is a no-op', async () => {
  const kernel = createKernel();
  try {
    seedConversation(kernel, 0);
    seedConversation(kernel, 1);
    const nextMorning = T0 + DAY;

    const first = await kernel.runNightlyBatch({ projectId: 'p', now: nextMorning });
    expect(first.tick.executed.episodeSealing.sealedEpisodes).toBe(2);
    expect(first.dream.processedEpisodeCount).toBe(2);
    expect(first.projected.episodes).toBe(2);

    // Yesterday's conversation is in the graph now — without a corpus rebuild.
    const episodeNodes = kernel.memoryAtlasStore.db
      .prepare(`SELECT node_id FROM memory_atlas_documents WHERE project_id='p' AND node_type='episode'`)
      .all() as Array<{ node_id: string }>;
    expect(episodeNodes.length).toBe(2);
    expect(first.projected.documents).toBeGreaterThanOrEqual(2);

    // Safe to re-run: nothing left to seal, dream or project.
    const second = await kernel.runNightlyBatch({ projectId: 'p', now: nextMorning + 60_000 });
    expect(second.tick.executed.episodeSealing.sealedEpisodes).toBe(0);
    expect(second.dream.processedEpisodeCount).toBe(0);
    expect(second.projected.episodes).toBe(0);
    expect(second.projected.documents).toBe(first.projected.documents);
  } finally {
    kernel.close();
  }
});

test('the batch is bounded: a backlog larger than the limit is caught up over later nights', async () => {
  const kernel = createKernel();
  try {
    for (let index = 0; index < 3; index += 1) seedConversation(kernel, index);
    const nextMorning = T0 + DAY;

    const first = await kernel.runNightlyBatch({ projectId: 'p', maxEpisodes: 2, now: nextMorning });
    expect(first.dream.processedEpisodeCount).toBe(2);
    expect(first.projected.episodes).toBe(2);

    const second = await kernel.runNightlyBatch({ projectId: 'p', maxEpisodes: 2, now: nextMorning + DAY });
    expect(second.dream.processedEpisodeCount).toBe(1);
    expect(second.projected.episodes).toBe(1);
  } finally {
    kernel.close();
  }
});
