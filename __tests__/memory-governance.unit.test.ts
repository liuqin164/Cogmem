import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import {
  MemoryGovernanceExecutor,
  MemoryGovernanceStore,
  MemoryGovernanceValidator,
  type MemoryGovernancePlan,
} from '../src/governance/index.js';

function plan(overrides: Partial<MemoryGovernancePlan> = {}): MemoryGovernancePlan {
  return {
    planId: 'plan-1',
    projectId: 'brain',
    proposedBy: 'deterministic',
    createdAt: 1,
    operations: [{
      operationId: 'op-1',
      type: 'CREATE_BELIEF',
      projectId: 'brain',
      evidenceEventIds: ['evt-user'],
      sourceRole: 'user',
      ownership: 'user',
      idempotencyKey: 'belief:user:local-first',
      payload: { subject: 'user', predicate: 'prefers', object: 'local-first' },
    }],
    ...overrides,
  };
}

describe('memory governance foundation', () => {
  test('rejects durable operations without raw event evidence', () => {
    const validator = new MemoryGovernanceValidator(() => undefined);
    const candidate = plan({
      operations: [{ ...plan().operations[0]!, evidenceEventIds: [] }],
    });

    const result = validator.validate(candidate);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('missing_evidence');
  });

  test('requires explicit user evidence for user-owned memory', () => {
    const validator = new MemoryGovernanceValidator((eventId) => ({
      eventId,
      projectId: 'brain',
      role: 'assistant',
    }));
    const candidate = plan({
      operations: [{
        ...plan().operations[0]!,
        evidenceEventIds: ['evt-assistant'],
        sourceRole: 'assistant',
      }],
    });

    const result = validator.validate(candidate);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('user_ownership_requires_user_evidence');
  });

  test('executes once and rolls back operations and audit records together', () => {
    const db = new Database(':memory:');
    const store = new MemoryGovernanceStore(db);
    const validator = new MemoryGovernanceValidator((eventId) => ({
      eventId,
      projectId: 'brain',
      role: 'user',
    }));
    const executor = new MemoryGovernanceExecutor(db, store, validator, {
      CREATE_BELIEF: (_operation, context) => {
        context.db.exec('CREATE TABLE IF NOT EXISTS applied_effects (value TEXT NOT NULL)');
        context.db.prepare('INSERT INTO applied_effects (value) VALUES (?)').run('created');
      },
      REJECT_BELIEF: () => {
        throw new Error('forced failure');
      },
    });

    expect(executor.execute(plan()).status).toBe('applied');
    expect(executor.execute(plan()).status).toBe('already_applied');
    expect(db.prepare('SELECT COUNT(*) AS count FROM applied_effects').get()).toEqual({ count: 1 });

    const failing = plan({
      planId: 'plan-fail',
      operations: [
        { ...plan().operations[0]!, operationId: 'op-fail-1', idempotencyKey: 'fail:create' },
        {
          ...plan().operations[0]!,
          operationId: 'op-fail-2',
          type: 'REJECT_BELIEF',
          idempotencyKey: 'fail:reject',
        },
      ],
    });

    expect(() => executor.execute(failing)).toThrow('forced failure');
    expect(store.listAppliedOperations('plan-fail')).toEqual([]);
    expect(store.listAudit('brain').some((entry) => entry.planId === 'plan-fail')).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS count FROM applied_effects').get()).toEqual({ count: 1 });
    db.close();
  });
});
