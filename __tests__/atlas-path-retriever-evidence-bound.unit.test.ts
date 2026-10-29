import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(makeTempDir('cogmem-atlas-evidence-bound-'), 'memory.db') });
}

function seedEvidenceEvents(kernel: MemoryKernel, count: number, occurredAt: number): string[] {
  const eventIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const eventId = `evt-evidence-${index}`;
    kernel.eventStore.append({
      eventId,
      streamId: `s-evidence-${index}`,
      streamType: 'thread',
      eventType: 'MESSAGE',
      rawEventType: 'message',
      projectId: 'p',
      sessionId: `s-evidence-${index}`,
      threadId: `s-evidence-${index}`,
      role: 'user',
      occurredAt,
      payload: { text: `retry path policy note ${index}` },
    });
    eventIds.push(eventId);
  }
  return eventIds;
}

function seedFacetNode(kernel: MemoryKernel, evidenceEventIds: string[], occurredAt: number): void {
  kernel.memoryAtlasStore.upsertDocument({
    id: 'entity:retry-policy',
    projectId: 'p',
    nodeType: 'entity',
    sourceId: 'retry-policy',
    label: 'retry path policy',
    summary: 'retry path policy',
    confidence: 0.9,
    supportCount: 1,
    status: 'active',
    occurredAt,
    evidenceEventIds,
  });
}

function evidenceReturnedFor(kernel: MemoryKernel, query: string): number {
  const recall = kernel.searchEvidence(query, { projectId: 'p', limit: 10, includeRawEvidence: true });
  const node = (recall.atlas?.nodes ?? []).find((candidate) => candidate.id === 'entity:retry-policy');
  return node?.evidenceReturned ?? -1;
}

test('a recall without a time facet attaches the source anchor, not every evidence id', () => {
  const kernel = createKernel();
  try {
    const occurredAt = Date.UTC(2026, 5, 5, 12, 0, 0);
    seedFacetNode(kernel, seedEvidenceEvents(kernel, 20, occurredAt), occurredAt);

    expect(evidenceReturnedFor(kernel, 'retry path policy')).toBe(2);
    // A time-frame match reads the evidence dates, so that path still gets them.
    expect(evidenceReturnedFor(kernel, '2026-06-05 retry path policy')).toBe(20);
  } finally {
    kernel.close();
  }
});
