import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { createMemoryKernel } from '../src/factory.js';

function tempDbPath(): string {
  return join(tmpdir(), `memory-kernel-${randomUUID()}.sqlite`);
}

test('MemoryKernel.ingest runs the v1.9 write pipeline, not a minimal neuron insert', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath() });

  const seeded = await kernel.ingest({
    content: 'Memory vector retrieval belongs under the durable memory vector topic.',
    projectId: 'split-pipeline',
    topicPath: 'memory/vector',
  });
  const neuron = await kernel.ingest({
    content: 'This is important: memory vector retrieval indexing must stay deterministic.',
    projectId: 'split-pipeline',
  });

  expect(seeded.metadata.topicPath).toBe('memory/vector');
  expect(neuron.metadata.topicPath).toBe('memory/vector');
  expect(neuron.metadata.importanceLevel).toBe('important');
  expect(neuron.metadata.isPinned).toBe(true);
  expect(neuron.metadata.stability).toBeGreaterThan(1);
  expect(neuron.coordinates.V.length).toBe(384);
  expect(kernel.eventStore.getEventCount()).toBeGreaterThanOrEqual(6);
  expect(kernel.vectorStore.getStats().size).toBeGreaterThanOrEqual(2);
  expect(kernel.topologyStore.getMaterializedMembershipCount()).toBeGreaterThan(0);
  expect(kernel.cognitiveGraphStore.getNodeCount()).toBeGreaterThan(0);
});

test('MemoryKernel.consolidate executes offline consolidation instead of returning a noop marker', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath() });
  const startTime = Date.now() - 1_000;

  await kernel.ingest({
    content: 'This is important: I own a Framework Laptop for memory kernel testing.',
    projectId: 'split-consolidate',
    topicPath: 'devices/laptop',
  });

  const result = await kernel.consolidate({
    projectId: 'split-consolidate',
    startTime,
    endTime: Date.now() + 1_000,
  });

  expect(result).not.toEqual({ scheduled: false, queueReason: 'noop_standalone_kernel' });
  expect(Array.isArray(result.verifiedFacts)).toBe(true);
  expect(Array.isArray(result.verifiedEvents)).toBe(true);
  expect(kernel.pipelineMetrics.getLastRun()).toBeDefined();
});

test('MemoryKernel.consolidate cannot read or mutate another project records', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath() });
  const now = Date.now();
  const a = await kernel.ingest({ content: 'project a consolidation source', projectId: 'a', createdAt: now });
  const b = await kernel.ingest({ content: 'project b private consolidation source', projectId: 'b', createdAt: now + 1 });
  kernel.factStore.insertFacts([{
    neuronId: a.id, subject: 'a', predicateFamily: 'owns', object: 'alpha', validFrom: now,
    certaintyLevel: 'certain', confidence: 0.9, status: 'provisional', sourceText: 'a owns alpha',
  }]);
  const [bFact] = kernel.factStore.insertFacts([{
    neuronId: b.id, subject: 'b', predicateFamily: 'owns', object: 'private-beta', validFrom: now,
    certaintyLevel: 'certain', confidence: 0.9, status: 'provisional', sourceText: 'b owns private beta',
  }]);
  const [bEvent] = kernel.factStore.insertEvents([{
    neuronId: b.id, eventType: 'private-b-event', validFrom: now, confidence: 0.95, status: 'provisional',
  }]);
  const bEntity = kernel.entityStore.upsertEntity({
    canonicalName: 'Private B Entity', type: 'project', aliases: ['private-beta'],
    metadata: { projectId: 'b' }, instanceMode: 'new_instance', createdAt: now,
  });

  await kernel.consolidate({ projectId: 'a', startTime: 0, endTime: now + 10_000 });

  expect(kernel.factStore.getFactById(bFact.factId)?.status).toBe('provisional');
  expect(kernel.factStore.listEventsByTimeRange(0, now + 10_000, { projectId: 'b' }).find((event) => event.eventId === bEvent.eventId)?.status).toBe('provisional');
  expect(kernel.entityStore.findByEntityId(bEntity.entityId)?.status).toBe('active');
  kernel.close();
});

test('MemoryKernel.consolidate without a project partitions named and projectless scopes', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath() });
  const now = Date.now();
  const a = await kernel.ingest({ content: 'shared semantic claim', projectId: 'a', createdAt: now });
  const b = await kernel.ingest({ content: 'shared semantic claim', projectId: 'b', createdAt: now + 1 });
  const global = await kernel.ingest({ content: 'shared semantic claim', projectId: '', createdAt: now + 2 });
  const facts = [a, b, global].map((neuron) => kernel.factStore.insertFacts([{
    neuronId: neuron.id, subject: 'same', predicateFamily: 'owns', object: 'same', validFrom: now,
    certaintyLevel: 'certain', confidence: 0.9, status: 'provisional', sourceText: 'same owns same',
  }])[0]!);

  await kernel.consolidate({ startTime: 0, endTime: now + 10_000 });

  expect(facts.map((fact) => kernel.factStore.getFactById(fact.factId)?.status)).not.toContain('archived');
  expect(facts.map((fact) => kernel.factStore.getFactById(fact.factId)?.status)).not.toContain('rejected');
  kernel.close();
});

test('explicit consolidation leaves a legacy entity shared by two projects unchanged', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath() });
  const now = Date.now();
  await kernel.ingest({ content: 'project a maintenance seed', projectId: 'a', createdAt: now });
  const shared = kernel.entityStore.upsertEntity({
    canonicalName: 'Shared Legacy Device', type: 'device', aliases: ['private shared alias'],
    instanceMode: 'new_instance', createdAt: now,
  });
  kernel.entityStore.getDatabase().prepare(`INSERT INTO entity_mentions(
    mention_id,entity_id,neuron_id,project_id,mention_type,created_at
  ) VALUES(?,?,NULL,?,'referenced',?)`).run('legacy-a', shared.entityId, 'a', now);
  kernel.entityStore.getDatabase().prepare(`INSERT INTO entity_mentions(
    mention_id,entity_id,neuron_id,project_id,mention_type,created_at
  ) VALUES(?,?,NULL,?,'referenced',?)`).run('legacy-b', shared.entityId, 'b', now + 1);

  await kernel.consolidate({ projectId: 'a', startTime: 0, endTime: now + 10_000 });

  expect(kernel.entityStore.getByEntityId(shared.entityId)?.status).toBe('active');
  expect(kernel.entityStore.listProjectScopes(shared.entityId)).toEqual(['a', 'b']);
  kernel.close();
});

test('direct topology navigation validates caller supplied neuron ids against scope', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath() });
  const foreign = await kernel.ingest({ content: 'project b topology evidence', projectId: 'b' });
  expect(kernel.topologyStore.collectNavigationFromNeuronIds({ neuronIds: [foreign.id], projectId: 'a' })).toEqual({
    branchIds: [], taskIds: [], clusterIds: [], neuronIds: [],
  });
  kernel.close();
});
