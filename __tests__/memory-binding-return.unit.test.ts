import { expect, test } from 'bun:test';
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
    aliases: ['Device', 'two'], stablePath: '/first', createdAt: 1, updatedAt: 2,
  });
  expect(() => store.upsertEntity({
    entityId: 'entity-a', projectId: 'a', canonicalName: 'Other', entityType: 'object',
  })).toThrow('memory_entity_immutable_identity_mismatch');
  store.close();
});
