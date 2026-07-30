import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BeliefStore } from '../src/belief/BeliefStore.js';
import { ReliablePolicySideEffectExecutor, type PolicySideEffect } from '../src/retrieval/PolicySideEffectExecutor.js';
import { EventStore } from '../src/store/EventStore.js';
import { PolicyExecutionProjector } from '../src/store/PolicyExecutionProjector.js';
import { PolicyExecutionStore, type PolicyExecutionRecord } from '../src/store/PolicyExecutionStore.js';
import { PolicyProjectionStore } from '../src/store/PolicyProjectionStore.js';
import { migration_0059 } from '../src/migrations/v3_7_4/0059_project_execution_and_provenance_guards.js';
import { migration_0061 } from '../src/migrations/v3_7_4/0061_runtime_scope_and_projection_integrity.js';
import { migration_0062 } from '../src/migrations/v3_7_4/0062_projection_scope_and_outbox_recovery.js';

describe('policy execution project isolation', () => {
  test('the same effect executes independently in each exact project scope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-scope-'));
    const path = join(dir, 'policy.db');
    const store = new PolicyExecutionStore(path);
    const calls: string[] = [];
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect: PolicySideEffect) {
        calls.push(effect.projectId);
        return { policy: effect.policy, action: effect.action, status: 'executed', outcome: 'executed' };
      },
    }, store);

    const common = { policy: 'safe', action: 'allow' as const, idempotencyKey: 'same-key' };
    await executor.execute({ ...common, projectId: 'a' });
    await executor.execute({ ...common, projectId: 'b' });
    expect((await executor.execute({ ...common, projectId: 'a' })).status).toBe('skipped');
    expect(calls).toEqual(['a', 'b']);
    expect(store.getByIdempotencyKey('a', 'same-key')?.projectId).toBe('a');
    expect(store.getByIdempotencyKey('b', 'same-key')?.projectId).toBe('b');

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('belief feedback only calibrates beliefs in the execution project', () => {
    const db = new Database(':memory:');
    const beliefs = new BeliefStore(db);
    db.exec(`
      CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,is_deleted INTEGER);
      INSERT INTO neurons VALUES('na','a',0),('nb','b',0);
      INSERT INTO beliefs(id,project_id,scope,subject,predicate,object_value,canonical_key,confidence,trust_score,
        source_neuron_id,source_type,validity_kind,valid_from,status,created_at,updated_at)
      VALUES
        ('a','a','project','policy-a','preference','on','a',1,0.5,'na','user_input','open',1,'active',1,1),
        ('b','b','project','policy-a','preference','on','b',1,0.5,'nb','user_input','open',1,'active',1,1)
      ;
      UPDATE beliefs SET metadata_json='{"planDsl":{"policyGroup":"policy-a"}}'
    `);
    const record: PolicyExecutionRecord = {
      executionId: 'e', projectId: 'a', idempotencyKey: 'k', policy: 'policy-a', action: 'allow',
      status: 'executed', attemptCount: 1, policyGroup: 'policy-a', createdAt: 2, updatedAt: 2,
    };

    expect(beliefs.applyExecutionFeedbackCalibration('a', [record], 3)).toBe(1);
    expect(db.prepare(`SELECT id,trust_score FROM beliefs ORDER BY id`).all()).toEqual([
      { id: 'a', trust_score: 0.52 },
      { id: 'b', trust_score: 0.5 },
    ]);
    beliefs.close();
    db.close();
  });

  test('event projection replays only the requested named or projectless scope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-projector-'));
    const path = join(dir, 'policy.db');
    const events = new EventStore(path);
    const executions = new PolicyExecutionStore(path);
    const projections = new PolicyProjectionStore(path);
    const append = (projectId: string, executionId: string, at: number) => events.append({
      projectId, streamId: `policy-${executionId}`, streamType: 'system',
      eventType: 'POLICY_EXECUTION_UPDATED', occurredAt: at,
      payload: {
        executionId, idempotencyKey: 'same-key', policy: 'safe', action: 'allow',
        status: 'executed', attemptCount: 1, createdAt: at, updatedAt: at,
      },
    });
    append('a', 'a-execution', 1);
    append('b', 'b-execution', 2);
    append('', 'global-execution', 3);

    await new PolicyExecutionProjector(events, executions, projections, 'a').fullRebuild('test');
    await new PolicyExecutionProjector(events, executions, projections, '').fullRebuild('test');

    expect(executions.getReadModelByIdempotencyKey('a', 'same-key')?.executionId).toBe('a-execution');
    expect(executions.getReadModelByIdempotencyKey('', 'same-key')?.executionId).toBe('global-execution');
    expect(executions.getReadModelByIdempotencyKey('b', 'same-key')).toBeNull();
    projections.close();
    executions.close();
    events.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('concurrent callers atomically claim one side effect', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-concurrent-'));
    const path = join(dir, 'policy.db');
    const stores = Array.from({ length: 20 }, () => new PolicyExecutionStore(path));
    let calls = 0;
    const executors = stores.map((store) => new ReliablePolicySideEffectExecutor({
      async execute(effect) {
        calls += 1;
        await Bun.sleep(10);
        return { policy: effect.policy, action: effect.action, status: 'executed', outcome: 'executed' };
      },
    }, store));

    const results = await Promise.all(executors.map((executor) => executor.execute({
      projectId: 'a', policy: 'once', action: 'allow', idempotencyKey: 'shared',
    })));

    expect(calls).toBe(1);
    expect(results.filter((result) => result.status === 'executed')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'in_progress')).toHaveLength(19);
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('lease heartbeat prevents a second worker from taking a long-running side effect', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-heartbeat-'));
    const path = join(dir, 'policy.db');
    const firstStore = new PolicyExecutionStore(path);
    const secondStore = new PolicyExecutionStore(path);
    let calls = 0;
    const delegate = {
      async execute(effect: PolicySideEffect) {
        calls += 1;
        await Bun.sleep(1_300);
        return { policy: effect.policy, action: effect.action, status: 'executed' as const, outcome: 'executed' as const };
      },
    };
    const first = new ReliablePolicySideEffectExecutor(delegate, firstStore, 0, 1, {
      leaseMs: 1_000, heartbeatIntervalMs: 100,
    });
    const second = new ReliablePolicySideEffectExecutor(delegate, secondStore, 0, 1, {
      leaseMs: 1_000, heartbeatIntervalMs: 100,
    });
    const effect = { projectId: 'a', policy: 'slow', action: 'allow' as const, idempotencyKey: 'heartbeat' };
    const running = first.execute(effect);
    await Bun.sleep(1_100);
    expect(await second.execute(effect)).toMatchObject({ status: 'in_progress', detail: 'execution_in_progress' });
    expect((await running).status).toBe('executed');
    expect(calls).toBe(1);
    firstStore.close();
    secondStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('stable operation identity executes distinct operations and deduplicates retries', async () => {
    const store = new PolicyExecutionStore(':memory:');
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return { policy: effect.policy, action: effect.action, status: 'executed', outcome: 'executed' };
      },
    }, store);
    await executor.execute({
      projectId: 'a', policy: 'stable', action: 'allow', target: 'device',
      stableOperationId: 'operation-1',
      runtimeId: 'run-1', actorId: 'actor-1', correlationId: 'trace-1',
      metadata: { timestamp: 1, nested: { b: 2, a: 1 } },
    });
    expect((await executor.execute({
      projectId: 'a', policy: 'stable', action: 'allow', target: 'device',
      stableOperationId: 'operation-1',
      runtimeId: 'run-2', actorId: 'actor-2', correlationId: 'trace-2',
      metadata: { nested: { a: 1, b: 2 }, timestamp: 2 },
    })).status).toBe('skipped');
    expect((await executor.execute({
      projectId: 'a', policy: 'stable', action: 'allow', target: 'device',
      stableOperationId: 'operation-2',
    })).status).toBe('executed');
    expect(calls).toBe(2);
    store.close();
  });

  test('missing operation identity fails closed before invoking the delegate', async () => {
    const store = new PolicyExecutionStore(':memory:');
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return { policy: effect.policy, action: effect.action, status: 'executed', outcome: 'executed' };
      },
    }, store);
    const result = await executor.execute({
      projectId: 'a', policy: 'stable', action: 'allow', target: 'device',
    });
    expect(result).toMatchObject({
      status: 'failed',
      outcome: 'definitely_not_executed',
      detail: 'policy_operation_identity_required',
    });
    expect(calls).toBe(0);
    store.close();
  });

  test('contradictory delegate result is persisted only as an unknown protocol failure', async () => {
    const store = new PolicyExecutionStore(':memory:');
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        return {
          policy: effect.policy,
          action: effect.action,
          status: 'executed',
          outcome: 'outcome_unknown',
        } as any;
      },
    }, store);
    const result = await executor.execute({
      projectId: 'a', policy: 'stable', action: 'allow', idempotencyKey: 'protocol-error',
    });
    expect(result).toMatchObject({
      status: 'failed',
      outcome: 'outcome_unknown',
      detail: 'outcome_unknown:delegate_protocol_error',
    });
    expect(store.getByIdempotencyKey('a', 'protocol-error')?.status).toBe('failed');
    store.close();
  });

  test('returned failures use retries and end in the manual dead letter queue', async () => {
    const store = new PolicyExecutionStore(':memory:');
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return {
          policy: effect.policy,
          action: effect.action,
          status: 'failed',
          outcome: 'definitely_not_executed',
          detail: 'returned_failure',
        };
      },
    }, store, 2, 1);

    const result = await executor.execute({ projectId: 'a', policy: 'retry', action: 'deny', idempotencyKey: 'failed' });

    expect(calls).toBe(3);
    expect(result).toMatchObject({ status: 'failed', detail: 'returned_failure' });
    expect(store.getByIdempotencyKey('a', 'failed')).toMatchObject({
      status: 'failed', attemptCount: 3, detail: 'returned_failure',
    });
    expect(executor.getDeadLetters('a')).toHaveLength(1);
    store.close();
  });

  test('unknown delegate exceptions are fail-closed and never retried automatically', async () => {
    const store = new PolicyExecutionStore(':memory:');
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute() {
        calls += 1;
        throw new Error('transport_disconnected_after_send');
      },
    }, store, 5, 1);

    const result = await executor.execute({
      projectId: 'a', policy: 'once', action: 'allow', idempotencyKey: 'unknown',
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({ status: 'failed', outcome: 'outcome_unknown' });
    expect(store.getByIdempotencyKey('a', 'unknown')?.nextRetryAt).toBeUndefined();
    store.close();
  });

  test('audit delivery failure cannot turn a successful side effect into a retry', async () => {
    const db = new Database(':memory:');
    const eventStore = { append() { throw new Error('audit unavailable'); } } as unknown as EventStore;
    const store = new PolicyExecutionStore(db, eventStore);
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return { policy: effect.policy, action: effect.action, status: 'executed', outcome: 'executed' };
      },
    }, store);

    expect((await executor.execute({
      projectId: 'a', policy: 'once', action: 'allow', idempotencyKey: 'audit-failure',
    })).status).toBe('executed');
    expect((await executor.execute({
      projectId: 'a', policy: 'once', action: 'allow', idempotencyKey: 'audit-failure',
    })).status).toBe('skipped');
    expect(calls).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM policy_execution_audit_outbox`).get()).toEqual({ count: 1 });
    store.close();
    db.close();
  });

  test('restart respects audit retry schedule and a later due drain succeeds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-audit-restart-'));
    const path = join(dir, 'policy.db');
    const bootstrap = new EventStore(path);
    bootstrap.close();
    const unavailable = { append() { throw new Error('audit unavailable'); } } as unknown as EventStore;
    const first = new PolicyExecutionStore(path, unavailable);
    first.upsert({
      executionId: 'restart', projectId: 'a', idempotencyKey: 'restart',
      policy: 'once', action: 'allow', status: 'executed', attemptCount: 1,
      createdAt: 1, updatedAt: 1,
    });
    expect(first.getAuditOutboxStats().pending).toBe(1);
    const scheduled = new Database(path);
    expect(scheduled.prepare(`SELECT attempt_count FROM policy_execution_audit_outbox`).get()).toEqual({ attempt_count: 1 });
    scheduled.close();
    first.close();

    const events = new EventStore(path);
    const recovered = new PolicyExecutionStore(path, events);
    expect(recovered.getAuditOutboxStats().pending).toBe(1);
    const due = new Database(path);
    expect(due.prepare(`SELECT attempt_count FROM policy_execution_audit_outbox`).get()).toEqual({ attempt_count: 1 });
    due.exec(`UPDATE policy_execution_audit_outbox SET next_retry_at=0`);
    due.close();
    expect(recovered.flushAuditOutbox()).toBe(1);
    expect(recovered.getAuditOutboxStats().pending).toBe(0);
    expect(events.getEventsByStreamId('policy:1:a:restart', 'a')).toHaveLength(1);
    recovered.close();
    events.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('one audit drain attempts each due row once and dead-letters on the fifth due cycle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-audit-cycles-'));
    const path = join(dir, 'policy.db');
    const bootstrap = new EventStore(path);
    bootstrap.close();
    const unavailable = { append() { throw new Error('audit unavailable'); } } as unknown as EventStore;
    const store = new PolicyExecutionStore(path, unavailable);
    store.upsert({
      executionId: 'cycles', projectId: 'a', idempotencyKey: 'cycles',
      policy: 'once', action: 'allow', status: 'executed', attemptCount: 1,
      createdAt: 1, updatedAt: 1,
    });

    for (let expected = 2; expected <= 5; expected += 1) {
      const due = new Database(path);
      due.exec(`UPDATE policy_execution_audit_outbox SET next_retry_at=0`);
      due.close();
      store.flushAuditOutbox();
      const inspected = new Database(path, { readonly: true });
      const row = inspected.prepare(`SELECT attempt_count,dead_lettered_at FROM policy_execution_audit_outbox`).get() as {
        attempt_count: number;
        dead_lettered_at: number | null;
      };
      inspected.close();
      expect(row.attempt_count).toBe(expected);
      expect(Boolean(row.dead_lettered_at)).toBe(expected === 5);
    }
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('delegate success followed by ledger failure is reported unknown without re-executing', async () => {
    const store = new PolicyExecutionStore(':memory:');
    const original = store.finishClaim.bind(store);
    let persistCalls = 0;
    (store as unknown as { finishClaim: PolicyExecutionStore['finishClaim'] }).finishClaim = (...args) => {
      persistCalls += 1;
      if (persistCalls === 1) throw new Error('simulated_crash_before_commit');
      return original(...args);
    };
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return { policy: effect.policy, action: effect.action, status: 'executed', outcome: 'executed' };
      },
    }, store);

    const result = await executor.execute({
      projectId: 'a', policy: 'once', action: 'allow', idempotencyKey: 'persist-failure',
    });
    expect(result).toMatchObject({ status: 'failed', outcome: 'outcome_unknown' });
    expect(calls).toBe(1);
    store.close();
  });

  test('expired in-progress leases fail closed instead of replaying an ambiguous external action', async () => {
    const store = new PolicyExecutionStore(':memory:');
    const seed: PolicyExecutionRecord = {
      executionId: 'crashed', projectId: 'a', idempotencyKey: 'ambiguous',
      policy: 'once', action: 'allow', status: 'failed', attemptCount: 0,
      createdAt: 1, updatedAt: 1,
    };
    expect(store.claim(seed, 'dead-worker', 2, 1).kind).toBe('claimed');
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return { policy: effect.policy, action: effect.action, status: 'executed', outcome: 'executed' };
      },
    }, store);

    const result = await executor.execute({
      projectId: 'a', policy: 'once', action: 'allow', idempotencyKey: 'ambiguous',
    });

    expect(calls).toBe(0);
    expect(result).toMatchObject({ status: 'failed', detail: 'execution_outcome_ambiguous_after_lease_expiry' });
    store.close();
  });

  test('failure outcomes survive reopen and in-progress replay omits outcome', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-outcome-'));
    const path = join(dir, 'policy.db');
    const first = new PolicyExecutionStore(path);
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        return {
          policy: effect.policy,
          action: effect.action,
          status: 'failed',
          outcome: 'definitely_not_executed',
          detail: 'rejected_before_send',
        };
      },
    }, first);
    await executor.execute({
      projectId: 'a', runtimeId: 'runtime', policy: 'once', action: 'allow',
      idempotencyKey: 'failed', replayPolicy: 'manual',
    });
    first.close();

    const reopened = new PolicyExecutionStore(path);
    const replay = new ReliablePolicySideEffectExecutor({ execute: () => {
      throw new Error('not called');
    } }, reopened).replay('a', 'runtime');
    expect(replay[0]).toMatchObject({ status: 'failed', outcome: 'definitely_not_executed' });
    expect(reopened.getByIdempotencyKey('a', 'failed')?.executionOutcome).toBe('definitely_not_executed');

    const seed: PolicyExecutionRecord = {
      executionId: 'busy', projectId: 'a', idempotencyKey: 'busy',
      runtimeId: 'runtime', policy: 'once', action: 'allow', status: 'in_progress',
      attemptCount: 0, createdAt: 2, updatedAt: 2,
    };
    expect(reopened.claim(seed, 'worker', Date.now() + 60_000).kind).toBe('claimed');
    const busy = new ReliablePolicySideEffectExecutor({ execute: () => {
      throw new Error('not called');
    } }, reopened).replay('a', 'runtime').find((result) => result.status === 'in_progress');
    expect(busy).toEqual(expect.objectContaining({ status: 'in_progress' }));
    expect(busy).not.toHaveProperty('outcome');
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('same-millisecond policy updates keep distinct audit events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-audit-id-'));
    const path = join(dir, 'policy.db');
    const events = new EventStore(path);
    const store = new PolicyExecutionStore(path, events);
    const base: PolicyExecutionRecord = {
      executionId: 'same', projectId: 'a', idempotencyKey: 'same',
      policy: 'p', action: 'allow', status: 'failed',
      executionOutcome: 'definitely_not_executed',
      attemptCount: 1, createdAt: 1, updatedAt: 10,
    };
    store.upsert(base);
    store.upsert({ ...base, attemptCount: 2, detail: 'second' });
    expect(events.queryEvents(1, 10, { eventType: ['POLICY_EXECUTION_UPDATED'] }).total).toBe(2);
    store.close();
    events.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('legacy executed keys become fail-closed tombstones after migration', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE policy_executions(
      execution_id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE,policy TEXT,action TEXT,status TEXT,
      attempt_count INTEGER,detail TEXT,created_at INTEGER,updated_at INTEGER
    );
    INSERT INTO policy_executions VALUES('legacy','already-ran','p','allow','executed',1,NULL,1,1)`);
    migration_0059.up(db);
    migration_0061.up(db);
    migration_0062.up(db);
    const store = new PolicyExecutionStore(db);
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return { policy: effect.policy, action: effect.action, status: 'executed', outcome: 'executed' };
      },
    }, store);

    const result = await executor.execute({
      projectId: 'a', policy: 'p', action: 'allow', idempotencyKey: 'already-ran',
    });

    expect(calls).toBe(0);
    expect(result).toMatchObject({ status: 'failed', detail: 'legacy_execution_scope_ambiguous' });
    store.close();
    db.close();
  });
});
