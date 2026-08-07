import { expect, test } from 'bun:test';
import { createMemoryKernel } from '../src/factory.js';
import { MemoryBindingStore } from '../src/store/MemoryBindingStore.js';
import { invalidateMemoryEdgeSupportIds } from '../src/binding/MemoryEdgeMerge.js';

test('memory entity upsert returns the persisted row and rejects immutable identity drift', () => {
  const store = new MemoryBindingStore();
  const first = store.upsertEntity({
    entityId: 'entity-a', projectId: 'a', canonicalName: 'Device', entityType: 'object',
    aliases: ['one'], stablePath: '/first', now: 1,
  });
  const second = store.upsertEntity({
    entityId: 'entity-a', projectId: 'a', canonicalName: 'Device', entityType: 'object',
    aliases: ['two'], now: 2,
  });

  expect(first.createdAt).toBe(1);
  expect(second).toMatchObject({
    entityId: 'entity-a', projectId: 'a', canonicalName: 'Device', entityType: 'object',
    aliases: ['Device', 'one', 'two'], stablePath: '/first', createdAt: 1, updatedAt: 2,
  });
  expect(() => store.upsertEntity({
    entityId: 'entity-a', projectId: 'a', canonicalName: 'Other', entityType: 'object',
  })).toThrow('memory_entity_immutable_identity_mismatch');
  store.close();
});

test('memory edge upsert preserves all evidence', () => {
  const kernel = createMemoryKernel();
  const entity = kernel.memoryBindingStore.upsertEntity({
    projectId: 'a', canonicalName: 'Device', entityType: 'object', now: 1,
  });
  kernel.memoryBindingStore.upsertTopic({ projectId: 'a', topicPath: 'device', topicType: 'semantic', now: 1 });
  const events = [1, 2].map((occurredAt) => kernel.eventStore.append({
    projectId: 'a', streamId: 'edge-evidence', streamType: 'thread', eventType: 'MESSAGE',
    occurredAt, payload: { text: String(occurredAt) },
  }));
  const edge = {
    projectId: 'a', sourceType: 'entity' as const, sourceId: entity.entityId,
    relationType: 'belongs_to' as const, targetType: 'topic' as const, targetId: 'device', confidence: 1,
  };
  kernel.memoryBindingStore.upsertEdge({
    ...edge, evidenceEventIds: [events[0]!.eventId], sourceAuthority: 'raw_evidence', createdAt: 1,
  });
  const persisted = kernel.memoryBindingStore.upsertEdge({
    ...edge, evidenceEventIds: [events[1]!.eventId], sourceAuthority: 'model_candidate', createdAt: 2,
  });
  expect(persisted.evidenceEventIds).toEqual(events.map((event) => event.eventId));
  expect(persisted).toMatchObject({ sourceAuthority: 'raw_evidence', version: 2, createdAt: 1, updatedAt: 2 });
  const closed = kernel.memoryBindingStore.upsertEdge({
    ...edge, confidence: 0.4, evidenceEventIds: [events[1]!.eventId], sourceAuthority: 'raw_evidence',
    status: 'superseded', validFrom: 3, validTo: 4, createdAt: 3,
  });
  expect(closed).toMatchObject({ sourceAuthority: 'raw_evidence', confidence: 0.4, status: 'superseded', validFrom: 1, validTo: 4, version: 3 });
  kernel.close();
});

test('higher edge authority owns lifecycle fields and lower rebuilds cannot corrupt them', () => {
  const kernel = createMemoryKernel();
  const topic = kernel.memoryBindingStore.upsertTopic({ projectId: 'a', topicPath: 'authority', topicType: 'concept', now: 1 });
  const event = kernel.eventStore.append({
    projectId: 'a', streamId: 'authority', streamType: 'thread', eventType: 'MESSAGE',
    occurredAt: 1, payload: { text: 'authority' },
  });
  const base = {
    projectId: 'a', sourceType: 'event' as const, sourceId: event.eventId,
    relationType: 'ABOUT' as const, targetType: 'topic' as const, targetId: topic.topicPath,
    evidenceEventIds: [event.eventId],
  };
  kernel.memoryBindingStore.upsertEdge({ ...base, confidence: 0.76, sourceAuthority: 'atlas_curator', createdAt: 1 });
  const frame = kernel.memoryBindingStore.upsertEdge({ ...base, confidence: 0.97, sourceAuthority: 'memory_frame_projector', createdAt: 2 });
  const replayed = kernel.memoryBindingStore.upsertEdge({ ...base, confidence: 0.1, status: 'rejected', sourceAuthority: 'atlas_curator', createdAt: 3 });
  expect(frame).toMatchObject({ sourceAuthority: 'memory_frame_projector', confidence: 0.97 });
  expect(replayed).toMatchObject({ sourceAuthority: 'memory_frame_projector', confidence: 0.97, status: 'active' });
  kernel.close();
});

test('edge supports keep the earliest validity and fall back without stale evidence', () => {
  const kernel = createMemoryKernel();
  const topic = kernel.memoryBindingStore.upsertTopic({ projectId: 'a', topicPath: 'support', topicType: 'concept', now: 1 });
  const events = [1_000, 2_000, 3_000].map((occurredAt) => kernel.eventStore.append({
    projectId: 'a', streamId: 'support', streamType: 'thread', eventType: 'MESSAGE',
    occurredAt, payload: { text: String(occurredAt) },
  }));
  const base = {
    projectId: 'a', sourceType: 'event' as const, sourceId: events[0]!.eventId,
    relationType: 'ABOUT' as const, targetType: 'topic' as const, targetId: topic.topicPath,
  };
  kernel.memoryBindingStore.upsertEdge({
    ...base, confidence: 0.9, evidenceEventIds: [events[0]!.eventId],
    sourceAuthority: 'raw_evidence', createdAt: 1_000,
  });
  const reinforced = kernel.memoryBindingStore.upsertEdge({
    ...base, confidence: 0.6, evidenceEventIds: [events[1]!.eventId],
    sourceAuthority: 'raw_evidence', createdAt: 2_000,
  });
  expect(reinforced).toMatchObject({ confidence: 0.9, validFrom: 1_000 });
  expect(reinforced.evidenceEventIds).toEqual(events.slice(0, 2).map((event) => event.eventId));

  kernel.memoryBindingStore.upsertEdge({
    ...base, confidence: 0.7, evidenceEventIds: [events[2]!.eventId],
    sourceAuthority: 'memory_frame_projector', supportSourceType: 'frame', supportSourceId: 'frame-a',
    createdAt: 2_000,
  });
  const db = kernel.factStore.getDatabase();
  const support = db.prepare(`SELECT support_id FROM memory_edge_supports WHERE support_source_id='frame-a'`).get() as { support_id: string };
  invalidateMemoryEdgeSupportIds(db, [support.support_id], 3_000);
  const fallback = kernel.memoryBindingStore.listEdges({ projectId: 'a', sourceId: events[0]!.eventId })[0]!;
  expect(fallback).toMatchObject({ sourceAuthority: 'raw_evidence', confidence: 0.9, validFrom: 1_000 });
  expect(fallback.evidenceEventIds).toEqual(events.slice(0, 2).map((event) => event.eventId));
  kernel.close();
});

test('topic and binding upserts return persisted rows and reject cross-scope cluster references', () => {
  const kernel = createMemoryKernel();
  const firstTopic = kernel.memoryBindingStore.upsertTopic({ projectId: 'a', topicPath: 'persisted', topicType: 'project', now: 1 });
  const secondTopic = kernel.memoryBindingStore.upsertTopic({ projectId: 'a', topicPath: 'persisted', topicType: 'concept', now: 2 });
  expect(firstTopic.createdAt).toBe(1);
  expect(secondTopic).toMatchObject({ topicType: 'project', createdAt: 1, updatedAt: 2 });
  const eventA = kernel.eventStore.append({ projectId: 'a', streamId: 'a', streamType: 'thread', eventType: 'MESSAGE', occurredAt: 1, payload: {} });
  const eventB = kernel.eventStore.append({ projectId: 'b', streamId: 'b', streamType: 'thread', eventType: 'MESSAGE', occurredAt: 1, payload: {} });
  kernel.memoryBindingStore.upsertTopic({ projectId: 'b', topicPath: 'persisted', topicType: 'project', now: 1 });
  const clusterB = kernel.memoryBindingStore.upsertCluster({ projectId: 'b', topicPath: 'persisted', clusterType: 'about', title: 'b', summary: 'b', claimKey: 'b', status: 'active', confidence: 1, eventId: eventB.eventId, now: 1 });
  kernel.memoryBindingStore.upsertTopic({ projectId: 'a', topicPath: 'other', topicType: 'concept', now: 1 });
  const clusterAOther = kernel.memoryBindingStore.upsertCluster({ projectId: 'a', topicPath: 'other', clusterType: 'about', title: 'other', summary: 'other', claimKey: 'other', status: 'active', confidence: 1, eventId: eventA.eventId, now: 1 });
  const input = { eventId: eventA.eventId, projectId: 'a', topicPath: 'persisted', bindingType: 'about' as const, confidence: 0.4, source: 'deterministic' as const, signal: 'a', claimKey: 'a', createdAt: 1 };
  const first = kernel.memoryBindingStore.insertBinding(input);
  const second = kernel.memoryBindingStore.insertBinding({ ...input, confidence: 0.9, createdAt: 2 });
  expect(second).toMatchObject({ bindingId: first.bindingId, confidence: 0.9, createdAt: 1 });
  expect(() => kernel.memoryBindingStore.insertBinding({ ...input, clusterId: clusterB.clusterId })).toThrow('memory_binding_endpoint_project_scope_mismatch');
  expect(() => kernel.memoryBindingStore.insertBinding({ ...input, clusterId: clusterAOther.clusterId })).toThrow('memory_binding_cluster_topic_mismatch');
  expect(() => kernel.memoryBindingStore.insertBinding({ ...input, relatedEventIds: [eventB.eventId] })).toThrow('memory_binding_event_project_scope_mismatch');
  expect(() => kernel.memoryBindingStore.upsertCluster({ projectId: 'a', topicPath: 'missing', clusterType: 'about', title: 'missing', summary: 'missing', claimKey: 'missing', status: 'active', confidence: 1, eventId: eventA.eventId, now: 1 })).toThrow('memory_binding_endpoint_project_scope_mismatch');
  expect(() => kernel.factStore.getDatabase().prepare(`INSERT INTO memory_bindings(binding_id,event_id,project_id,topic_path,binding_type,confidence,source,signal,claim_key,binding_action,related_event_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'scalar-related', eventA.eventId, 'a', 'persisted', 'about', 1, 'deterministic', 'scalar', 'scalar', 'create_new_cluster', JSON.stringify(eventA.eventId), 1,
  )).toThrow('project_scope_mismatch');
  kernel.close();
});
