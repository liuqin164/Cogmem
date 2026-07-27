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
});
