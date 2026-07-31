import { expect, test } from 'bun:test';
import { createMemoryKernel } from '../src/factory.js';
import { MemoryBindingStore } from '../src/store/MemoryBindingStore.js';

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
  kernel.memoryBindingStore.upsertEdge({ ...edge, evidenceEventIds: [events[0]!.eventId] });
  expect(kernel.memoryBindingStore.upsertEdge({ ...edge, evidenceEventIds: [events[1]!.eventId] }).evidenceEventIds)
    .toEqual(events.map((event) => event.eventId));
  kernel.close();
});
