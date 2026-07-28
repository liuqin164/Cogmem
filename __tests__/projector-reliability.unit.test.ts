import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventStore } from '../src/store/EventStore.js';
import { PlanRuntimeStore } from '../src/store/PlanRuntimeStore.js';
import { PolicyExecutionProjector } from '../src/store/PolicyExecutionProjector.js';
import { PolicyExecutionStore } from '../src/store/PolicyExecutionStore.js';
import { PolicyProjectionStore } from '../src/store/PolicyProjectionStore.js';
import { RuntimeProjectionStore } from '../src/store/RuntimeProjectionStore.js';
import { RuntimeProjector } from '../src/store/RuntimeProjector.js';
import { SqliteVecStore } from '../src/store/SqliteVecStore.js';
import { VectorStore } from '../src/store/VectorStore.js';

test('policy projector uses global sequence and never clears the authoritative execution ledger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-seq-'));
  const path = join(dir, 'memory.db');
  const events = new EventStore(path);
  const executions = new PolicyExecutionStore(path);
  const checkpoints = new PolicyProjectionStore(path);
  executions.upsert({
    executionId: 'live', projectId: 'p', idempotencyKey: 'live-key', policy: 'p', action: 'allow',
    status: 'executed', attemptCount: 1, createdAt: 10, updatedAt: 10,
  }, { emitEvent: false });
  const projector = new PolicyExecutionProjector(events, executions, checkpoints, 'p');
  await projector.fullRebuild('test');
  events.append({
    projectId: 'p', streamId: 'backdated', streamType: 'system',
    eventType: 'POLICY_EXECUTION_UPDATED', occurredAt: 1,
    payload: {
      executionId: 'backdated', idempotencyKey: 'live-key', policy: 'p', action: 'allow',
      status: 'executed', attemptCount: 1, createdAt: 1, updatedAt: 1,
    },
  });
  await projector.bootstrap();

  expect(executions.getByIdempotencyKey('p', 'live-key')?.executionId).toBe('live');
  expect(executions.getReadModelByIdempotencyKey('p', 'live-key')?.executionId).toBe('backdated');
  checkpoints.close();
  executions.close();
  events.close();
  rmSync(dir, { recursive: true, force: true });
});

test('runtime replay is read-model-only and consumes backdated events by global sequence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-runtime-seq-'));
  const path = join(dir, 'memory.db');
  const events = new EventStore(path);
  const runtime = new PlanRuntimeStore(path, events);
  const checkpoints = new RuntimeProjectionStore(path);
  runtime.upsertState({ runtimeId: 'r', entityType: 'step', entityKey: 'one', status: 'ready', updatedAt: 10 });
  const beforeEvents = events.getLatestGlobalSeq();
  const projector = new RuntimeProjector(events, runtime, checkpoints);
  await projector.fullRebuild('test');
  expect(runtime.getStateCount()).toBe(1);
  expect(events.getLatestGlobalSeq()).toBe(beforeEvents);

  events.append({
    streamId: 'r:step:two', streamType: 'system', eventType: 'RUNTIME_STATE_UPDATED', occurredAt: 1,
    payload: { runtimeId: 'r', entityType: 'step', entityKey: 'two', status: 'blocked' },
  });
  await projector.bootstrap();
  expect(runtime.getStateCount()).toBe(1);
  expect(runtime.getProjectionStateCount('runtime_projection_main')).toBe(2);

  checkpoints.close();
  runtime.close();
  events.close();
  rmSync(dir, { recursive: true, force: true });
});

test('runtime command and its event outbox commit together and recover after event-store failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-runtime-outbox-'));
  const path = join(dir, 'memory.db');
  const bootstrap = new EventStore(path);
  bootstrap.close();
  const unavailable = {
    getEvent() { return null; },
    append() { throw new Error('event store unavailable'); },
  } as unknown as EventStore;
  const first = new PlanRuntimeStore(path, unavailable);
  first.upsertState({ runtimeId: 'r', entityType: 'step', entityKey: 'one', status: 'ready', updatedAt: 1 });
  first.close();

  const db = new Database(path);
  expect(db.prepare(`SELECT COUNT(*) AS count FROM runtime_states`).get()).toEqual({ count: 1 });
  expect(db.prepare(`SELECT COUNT(*) AS count FROM runtime_event_outbox`).get()).toEqual({ count: 2 });
  db.close();

  const events = new EventStore(path);
  const recovered = new PlanRuntimeStore(path, events);
  expect(events.getEventsAfterGlobalSeq().filter((event) => event.eventType.startsWith('RUNTIME_'))).toHaveLength(2);
  const verify = new Database(path);
  expect(verify.prepare(`SELECT COUNT(*) AS count FROM runtime_event_outbox`).get()).toEqual({ count: 0 });
  verify.close();
  recovered.close();
  events.close();
  rmSync(dir, { recursive: true, force: true });
});

test('vector rebuild swaps atomically and preserves the live index when staging fails', async () => {
  const hnsw = new VectorStore(2, 10);
  hnsw.addVector('old', [1, 0]);
  await expect(hnsw.rebuildIndex([
    { id: 'new', vector: [0, 1] },
    { id: 'invalid', vector: [1] },
  ])).rejects.toThrow('dimension mismatch');
  expect(hnsw.search([1, 0], 1)[0]?.id).toBe('old');

  const db = new Database(':memory:');
  const sqlite = new SqliteVecStore(db, 2);
  sqlite.addVector('old', [1, 0]);
  await expect(sqlite.rebuildIndex([
    { id: 'new', vector: [0, 1] },
    { id: 'invalid', vector: [1] },
  ])).rejects.toThrow('dimension mismatch');
  expect(sqlite.search([1, 0], 1)[0]?.id).toBe('old');
  db.close();
});
