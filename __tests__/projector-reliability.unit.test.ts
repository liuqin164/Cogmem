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

function appendPolicyEvent(events: EventStore, projectId: string, executionId: string, occurredAt: number): void {
  events.append({
    projectId, streamId: `policy-${executionId}`, streamType: 'system',
    eventType: 'POLICY_EXECUTION_UPDATED', occurredAt,
    payload: {
      executionId, idempotencyKey: executionId, policy: 'p', action: 'allow',
      status: 'executed', attemptCount: 1, createdAt: occurredAt, updatedAt: occurredAt,
    },
  });
}

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
  runtime.upsertState({ projectId: 'p', runtimeId: 'r', entityType: 'step', entityKey: 'one', status: 'ready', updatedAt: 10 });
  const beforeEvents = events.getLatestGlobalSeq();
  const projector = new RuntimeProjector(events, runtime, checkpoints);
  await projector.fullRebuild('test');
  expect(runtime.getStateCount('p')).toBe(1);
  expect(events.getLatestGlobalSeq()).toBe(beforeEvents);

  events.append({
    projectId: 'p',
    streamId: 'r:step:two', streamType: 'system', eventType: 'RUNTIME_STATE_UPDATED', occurredAt: 1,
    payload: { runtimeId: 'r', entityType: 'step', entityKey: 'two', status: 'blocked' },
  });
  await projector.bootstrap();
  expect(runtime.getStateCount('p')).toBe(1);
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
  first.upsertState({ projectId: 'p', runtimeId: 'r', entityType: 'step', entityKey: 'one', status: 'ready', updatedAt: 1 });
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

test('empty rebuilds checkpoint a fixed high-water and consume the first concurrent target event next', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-projector-high-water-'));
  const path = join(dir, 'memory.db');
  const events = new EventStore(path);
  events.append({
    projectId: 'other', streamId: 'unrelated', streamType: 'system',
    eventType: 'UNRELATED', occurredAt: 1, payload: {},
  });
  const executions = new PolicyExecutionStore(path);
  const policyCheckpoints = new PolicyProjectionStore(path);
  const policyProjector = new PolicyExecutionProjector(events, executions, policyCheckpoints, 'p');
  const page = events.getEventsByGlobalSeqPage.bind(events);
  let injected = false;
  events.getEventsByGlobalSeqPage = ((input) => {
    if (!injected) {
      injected = true;
      appendPolicyEvent(events, 'p', 'first-concurrent', 2);
    }
    return page(input);
  }) as EventStore['getEventsByGlobalSeqPage'];
  await policyProjector.fullRebuild('race');
  expect(executions.getReadModelByIdempotencyKey('p', 'first-concurrent')).toBeNull();
  await policyProjector.bootstrap();
  expect(executions.getReadModelByIdempotencyKey('p', 'first-concurrent')?.executionId).toBe('first-concurrent');

  const runtime = new PlanRuntimeStore(path, events);
  const runtimeCheckpoints = new RuntimeProjectionStore(path);
  const runtimeProjector = new RuntimeProjector(events, runtime, runtimeCheckpoints);
  const runtimePage = events.getEventsByGlobalSeqPage.bind(events);
  injected = false;
  events.getEventsByGlobalSeqPage = ((input) => {
    if (!injected) {
      injected = true;
      events.append({
        projectId: 'p', streamId: 'runtime-first', streamType: 'system',
        eventType: 'RUNTIME_STATE_UPDATED', occurredAt: 3,
        payload: { runtimeId: 'same', entityType: 'step', entityKey: 'one', status: 'ready' },
      });
    }
    return runtimePage(input);
  }) as EventStore['getEventsByGlobalSeqPage'];
  await runtimeProjector.fullRebuild('race');
  expect(runtime.getProjectionStateCount('runtime_projection_main')).toBe(0);
  await runtimeProjector.bootstrap();
  expect(runtime.getProjectionStateCount('runtime_projection_main')).toBe(1);

  runtimeCheckpoints.close();
  runtime.close();
  policyCheckpoints.close();
  executions.close();
  events.close();
  rmSync(dir, { recursive: true, force: true });
});

test('failed full rebuild preserves the published policy read model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-projector-shadow-'));
  const path = join(dir, 'memory.db');
  const events = new EventStore(path);
  appendPolicyEvent(events, 'p', 'published', 1);
  const executions = new PolicyExecutionStore(path);
  const checkpoints = new PolicyProjectionStore(path);
  const projector = new PolicyExecutionProjector(events, executions, checkpoints, 'p');
  await projector.fullRebuild('seed');
  const original = executions.upsertReadModel.bind(executions);
  executions.upsertReadModel = ((record, seq, staging) => {
    if (staging) throw new Error('staging_failed');
    return original(record, seq, staging);
  }) as PolicyExecutionStore['upsertReadModel'];

  await expect(projector.fullRebuild('fail')).rejects.toThrow('staging_failed');
  expect(executions.getReadModelByIdempotencyKey('p', 'published')?.executionId).toBe('published');

  checkpoints.close();
  executions.close();
  events.close();
  rmSync(dir, { recursive: true, force: true });
});

test('runtime identity is project scoped and standalone legacy schemas fail explicitly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-runtime-scope-'));
  const path = join(dir, 'memory.db');
  const runtime = new PlanRuntimeStore(path);
  runtime.upsertState({ projectId: 'a', runtimeId: 'same', entityType: 'step', entityKey: 'one', status: 'ready' });
  runtime.upsertState({ projectId: 'b', runtimeId: 'same', entityType: 'step', entityKey: 'one', status: 'blocked' });
  expect(runtime.getSnapshot('a', 'same').states[0]?.status).toBe('ready');
  expect(runtime.getSnapshot('b', 'same').states[0]?.status).toBe('blocked');
  runtime.close();

  const legacy = join(dir, 'legacy.db');
  const db = new Database(legacy);
  db.exec(`
    CREATE TABLE runtime_states(runtime_id TEXT,entity_type TEXT,entity_key TEXT,status TEXT,updated_at INTEGER);
    CREATE TABLE policy_projection_state(projection_name TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE runtime_projection_state(projection_name TEXT PRIMARY KEY,status TEXT);
  `);
  db.close();
  expect(() => new PlanRuntimeStore(legacy)).toThrow('runtime_schema_not_migrated:runtime_states');
  expect(() => new PolicyProjectionStore(legacy)).toThrow('projection_schema_not_migrated:policy_projection_state');
  expect(() => new RuntimeProjectionStore(legacy)).toThrow('projection_schema_not_migrated:runtime_projection_state');
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
