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

test('legacy unscoped runtime and policy events are discarded instead of becoming projectless', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-projector-unscoped-'));
  const path = join(dir, 'memory.db');
  const events = new EventStore(path);
  events.append({
    streamId: 'legacy-runtime', streamType: 'system',
    eventType: 'RUNTIME_STATE_UPDATED', occurredAt: 1,
    payload: { runtimeId: 'same', entityType: 'step', entityKey: 'legacy', status: 'blocked' },
  });
  events.append({
    projectId: '', streamId: 'projectless-runtime', streamType: 'system',
    eventType: 'RUNTIME_STATE_UPDATED', occurredAt: 2,
    payload: { runtimeId: 'same', entityType: 'step', entityKey: 'current', status: 'ready' },
  });
  events.append({
    streamId: 'legacy-policy', streamType: 'system',
    eventType: 'POLICY_EXECUTION_UPDATED', occurredAt: 3,
    payload: {
      executionId: 'legacy-policy', idempotencyKey: 'legacy', policy: 'p', action: 'allow',
      status: 'executed', attemptCount: 1, createdAt: 3, updatedAt: 3,
    },
  });
  events.append({
    projectId: '', streamId: 'projectless-policy', streamType: 'system',
    eventType: 'POLICY_EXECUTION_UPDATED', occurredAt: 4,
    payload: {
      executionId: 'projectless-policy', idempotencyKey: 'current', policy: 'p', action: 'allow',
      status: 'executed', executionOutcome: 'executed', attemptCount: 1, createdAt: 4, updatedAt: 4,
    },
  });

  const runtime = new PlanRuntimeStore(path, events);
  const runtimeCheckpoints = new RuntimeProjectionStore(path);
  await new RuntimeProjector(events, runtime, runtimeCheckpoints).fullRebuild('legacy_scope');
  expect(runtime.getProjectionStateCount('runtime_projection_main', '')).toBe(1);

  const executions = new PolicyExecutionStore(path, events);
  const policyCheckpoints = new PolicyProjectionStore(path);
  await new PolicyExecutionProjector(events, executions, policyCheckpoints, '').fullRebuild('legacy_scope');
  expect(executions.getReadModelByIdempotencyKey('', 'legacy')).toBeNull();
  expect(executions.getReadModelByIdempotencyKey('', 'current')?.executionId).toBe('projectless-policy');

  const db = new Database(path, { readonly: true });
  expect(db.prepare(`
    SELECT projector,event_id FROM projection_event_discard_receipts ORDER BY projector,event_id
  `).all()).toEqual([
    { projector: 'policy_execution', event_id: expect.any(String) },
    { projector: 'runtime', event_id: expect.any(String) },
  ]);
  db.close();
  policyCheckpoints.close();
  executions.close();
  runtimeCheckpoints.close();
  runtime.close();
  events.close();
  rmSync(dir, { recursive: true, force: true });
});

test('projectors reject scope conflicts and invalid payload enums', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-projector-invalid-'));
  const path = join(dir, 'memory.db');
  const events = new EventStore(path);
  events.append({
    projectId: 'a', streamId: 'runtime-scope', streamType: 'system',
    eventType: 'RUNTIME_STATE_UPDATED', occurredAt: 1,
    payload: { projectId: 'b', runtimeId: 'r', entityType: 'step', entityKey: 'one', status: 'ready' },
  });
  events.append({
    projectId: 'a', streamId: 'runtime-invalid', streamType: 'system',
    eventType: 'RUNTIME_STATE_UPDATED', occurredAt: 2,
    payload: { projectId: 'a', runtimeId: 'r', entityType: 'alien', entityKey: 'two', status: 'ready' },
  });
  events.append({
    projectId: 'a', streamId: 'policy-scope', streamType: 'system',
    eventType: 'POLICY_EXECUTION_UPDATED', occurredAt: 3,
    payload: {
      projectId: 'b', executionId: 'scope', idempotencyKey: 'scope', policy: 'p', action: 'allow',
      status: 'executed', attemptCount: 1, createdAt: 3, updatedAt: 3,
    },
  });
  events.append({
    projectId: 'a', streamId: 'policy-invalid', streamType: 'system',
    eventType: 'POLICY_EXECUTION_UPDATED', occurredAt: 4,
    payload: {
      projectId: 'a', executionId: 'invalid', idempotencyKey: 'invalid', policy: 'p', action: 'allow',
      status: 'invented', attemptCount: 1, createdAt: 4, updatedAt: 4,
    },
  });

  const runtime = new PlanRuntimeStore(path, events);
  const runtimeCheckpoints = new RuntimeProjectionStore(path);
  await new RuntimeProjector(events, runtime, runtimeCheckpoints).fullRebuild('invalid');
  const executions = new PolicyExecutionStore(path, events);
  const policyCheckpoints = new PolicyProjectionStore(path);
  await new PolicyExecutionProjector(events, executions, policyCheckpoints, 'a').fullRebuild('invalid');

  expect(runtime.getProjectionStateCount('runtime_projection_main', 'a')).toBe(0);
  expect(executions.getReadModelByIdempotencyKey('a', 'scope')).toBeNull();
  expect(executions.getReadModelByIdempotencyKey('a', 'invalid')).toBeNull();
  const db = new Database(path, { readonly: true });
  expect(db.prepare(`
    SELECT projector,reason FROM projection_event_discard_receipts ORDER BY projector,reason
  `).all()).toEqual([
    { projector: 'policy_execution', reason: 'event_payload_scope_mismatch' },
    { projector: 'policy_execution', reason: 'invalid_policy_event_payload' },
    { projector: 'runtime', reason: 'event_payload_scope_mismatch' },
    { projector: 'runtime', reason: 'invalid_runtime_event_payload' },
  ]);
  db.close();
  policyCheckpoints.close();
  executions.close();
  runtimeCheckpoints.close();
  runtime.close();
  events.close();
  rmSync(dir, { recursive: true, force: true });
});

test('runtime command and outbox commit together, respect retry time, and later recover', () => {
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
  expect(db.prepare(`SELECT MIN(attempt_count) AS minimum,MAX(attempt_count) AS maximum FROM runtime_event_outbox`).get())
    .toEqual({ minimum: 1, maximum: 1 });
  db.close();

  const events = new EventStore(path);
  const recovered = new PlanRuntimeStore(path, events);
  expect(events.getEventsAfterGlobalSeq().filter((event) => event.eventType.startsWith('RUNTIME_'))).toHaveLength(0);
  const due = new Database(path);
  expect(due.prepare(`SELECT MIN(attempt_count) AS minimum,MAX(attempt_count) AS maximum FROM runtime_event_outbox`).get())
    .toEqual({ minimum: 1, maximum: 1 });
  due.exec(`UPDATE runtime_event_outbox SET next_retry_at=0`);
  due.close();
  expect(recovered.flushEventOutbox()).toBe(2);
  expect(events.getEventsAfterGlobalSeq().filter((event) => event.eventType.startsWith('RUNTIME_'))).toHaveLength(2);
  const verify = new Database(path);
  expect(verify.prepare(`SELECT COUNT(*) AS count FROM runtime_event_outbox`).get()).toEqual({ count: 0 });
  verify.close();
  recovered.close();
  events.close();
  rmSync(dir, { recursive: true, force: true });
});

test('policy and runtime outboxes drain multiple pages and dead-letter malformed rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-outbox-pages-'));
  const path = join(dir, 'memory.db');
  const policy = new PolicyExecutionStore(path);
  for (let index = 0; index < 250; index++) {
    policy.upsert({
      executionId: `execution-${index}`, projectId: index % 2 ? 'a' : 'b',
      idempotencyKey: `key-${index}`, policy: 'p', action: 'allow',
      status: 'executed', executionOutcome: 'executed', attemptCount: 1,
      createdAt: index + 1, updatedAt: index + 1,
    });
  }
  policy.close();
  const seed = new Database(path);
  seed.prepare(`
    INSERT INTO policy_execution_audit_outbox(outbox_id,project_scope,payload_json,created_at)
    VALUES('malformed-policy','a','{',0)
  `).run();
  seed.exec(`UPDATE policy_execution_audit_outbox SET next_retry_at=0`);
  seed.close();

  const events = new EventStore(path);
  const recoveredPolicy = new PolicyExecutionStore(path, events);
  expect(recoveredPolicy.getAuditOutboxStats()).toMatchObject({ pending: 0, deadLetter: 1 });
  expect(events.queryEvents(1, 500, { eventType: ['POLICY_EXECUTION_UPDATED'] }).total).toBe(250);
  recoveredPolicy.close();

  const runtime = new PlanRuntimeStore(path);
  for (let index = 0; index < 125; index++) {
    runtime.upsertState({
      projectId: index % 2 ? 'a' : 'b', runtimeId: `runtime-${index}`,
      entityType: 'step', entityKey: 'one', status: 'ready', updatedAt: index + 1,
    });
  }
  runtime.close();
  const corrupt = new Database(path);
  corrupt.prepare(`
    INSERT INTO runtime_event_outbox(project_scope,outbox_id,payload_json,created_at)
    VALUES('a','malformed-runtime','{',0)
  `).run();
  corrupt.exec(`UPDATE runtime_event_outbox SET next_retry_at=0`);
  corrupt.close();

  const recoveredRuntime = new PlanRuntimeStore(path, events);
  expect(recoveredRuntime.getEventOutboxStats()).toMatchObject({ pending: 0, deadLetter: 1 });
  expect(events.queryEvents(1, 500, {
    eventType: ['RUNTIME_STATE_UPDATED', 'RUNTIME_TRANSITION_RECORDED'],
  }).total).toBe(250);
  recoveredRuntime.close();
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
