import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { memoryEdgeId } from '../src/binding/MemoryBindingIdentity.js';
import { MemoryBindingStore } from '../src/store/MemoryBindingStore.js';

test('independent writers atomically merge aliases and edge evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-binding-writers-'));
  const dbPath = join(directory, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  kernel.memoryBindingStore.upsertEntity({
    entityId: 'shared-entity', projectId: 'a', canonicalName: 'Shared', entityType: 'object', aliases: ['seed'],
  });
  kernel.memoryBindingStore.upsertTopic({ projectId: 'a', topicPath: 'shared', topicType: 'semantic' });
  const events = Array.from({ length: 8 }, (_, index) => kernel.eventStore.append({
    projectId: 'a', streamId: `writer-${index}`, streamType: 'thread', eventType: 'MESSAGE',
    occurredAt: index + 1, payload: { text: String(index) },
  }));
  kernel.close();

  const modulePath = join(import.meta.dir, '..', 'src', 'store', 'MemoryBindingStore.ts');
  const children = events.map((event, index) => {
    const script = `
      import Database from 'bun:sqlite';
      import { MemoryBindingStore } from ${JSON.stringify(modulePath)};
      const db = new Database(${JSON.stringify(dbPath)});
      db.exec('PRAGMA busy_timeout=10000');
      const store = new MemoryBindingStore(db);
      store.upsertEntity({entityId:'shared-entity',projectId:'a',canonicalName:'Shared',entityType:'object',aliases:[${JSON.stringify(`alias-${index}`)}]});
      store.upsertEdge({projectId:'a',sourceType:'entity',sourceId:'shared-entity',relationType:'belongs_to',targetType:'topic',targetId:'shared',confidence:1,evidenceEventIds:[${JSON.stringify(event.eventId)}]});
      db.close();
    `;
    return Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  });
  for (const child of children) {
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
  }

  const store = new MemoryBindingStore(dbPath);
  expect(store.upsertEntity({
    entityId: 'shared-entity', projectId: 'a', canonicalName: 'Shared', entityType: 'object',
  }).aliases.sort()).toEqual(['Shared', 'seed', ...events.map((_, index) => `alias-${index}`)].sort());
  const edgeId = memoryEdgeId({
    projectId: 'a', sourceType: 'entity', sourceId: 'shared-entity', relationType: 'belongs_to',
    targetType: 'topic', targetId: 'shared',
  });
  expect(store.listEdges({ projectId: 'a' }).find((edge) => edge.edgeId === edgeId)?.evidenceEventIds.sort())
    .toEqual(events.map((event) => event.eventId).sort());
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
