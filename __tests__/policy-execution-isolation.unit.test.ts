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
import { migration_0059 } from '../src/migrations/0059_project_execution_and_provenance_guards.js';

describe('policy execution project isolation', () => {
  test('the same effect executes independently in each exact project scope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-policy-scope-'));
    const path = join(dir, 'policy.db');
    const store = new PolicyExecutionStore(path);
    const calls: string[] = [];
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect: PolicySideEffect) {
        calls.push(effect.projectId);
        return { policy: effect.policy, action: effect.action, status: 'executed' };
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

    expect(executions.getByIdempotencyKey('a', 'same-key')?.executionId).toBe('a-execution');
    expect(executions.getByIdempotencyKey('', 'same-key')?.executionId).toBe('global-execution');
    expect(executions.getByIdempotencyKey('b', 'same-key')).toBeNull();
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
        return { policy: effect.policy, action: effect.action, status: 'executed' };
      },
    }, store));

    const results = await Promise.all(executors.map((executor) => executor.execute({
      projectId: 'a', policy: 'once', action: 'allow', idempotencyKey: 'shared',
    })));

    expect(calls).toBe(1);
    expect(results.filter((result) => result.status === 'executed')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'skipped')).toHaveLength(19);
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('returned failures use retries and end in the manual dead letter queue', async () => {
    const store = new PolicyExecutionStore(':memory:');
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return { policy: effect.policy, action: effect.action, status: 'failed', detail: 'returned_failure' };
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
        return { policy: effect.policy, action: effect.action, status: 'executed' };
      },
    }, store);

    const result = await executor.execute({
      projectId: 'a', policy: 'once', action: 'allow', idempotencyKey: 'ambiguous',
    });

    expect(calls).toBe(0);
    expect(result).toMatchObject({ status: 'failed', detail: 'execution_outcome_ambiguous_after_lease_expiry' });
    store.close();
  });

  test('legacy executed keys become fail-closed tombstones after migration', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE policy_executions(
      execution_id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE,policy TEXT,action TEXT,status TEXT,
      attempt_count INTEGER,detail TEXT,created_at INTEGER,updated_at INTEGER
    );
    INSERT INTO policy_executions VALUES('legacy','already-ran','p','allow','executed',1,NULL,1,1)`);
    migration_0059.up(db);
    const store = new PolicyExecutionStore(db);
    let calls = 0;
    const executor = new ReliablePolicySideEffectExecutor({
      execute(effect) {
        calls += 1;
        return { policy: effect.policy, action: effect.action, status: 'executed' };
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
