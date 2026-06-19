import Database from 'bun:sqlite';

import { MemoryGovernanceStore } from '../store/MemoryGovernanceStore.js';
import type {
  MemoryGovernanceExecutionResult,
  MemoryGovernanceOperation,
  MemoryGovernanceOperationType,
  MemoryGovernancePlan,
} from './MemoryGovernancePlan.js';
import { MemoryGovernanceValidator } from './MemoryGovernanceValidator.js';

export interface MemoryGovernanceExecutionContext {
  db: Database;
  plan: MemoryGovernancePlan;
}

export type MemoryGovernanceOperationHandler = (
  operation: MemoryGovernanceOperation,
  context: MemoryGovernanceExecutionContext,
) => void;

export class MemoryGovernanceExecutor {
  constructor(
    private readonly db: Database,
    private readonly store: MemoryGovernanceStore,
    private readonly validator: MemoryGovernanceValidator,
    private readonly handlers: Partial<Record<MemoryGovernanceOperationType, MemoryGovernanceOperationHandler>> = {},
  ) {}

  execute(plan: MemoryGovernancePlan): MemoryGovernanceExecutionResult {
    if (this.store.isPlanApplied(plan.planId)) {
      return { planId: plan.planId, status: 'already_applied', appliedOperationIds: this.store.listAppliedOperations(plan.planId) };
    }
    const validation = this.validator.validate(plan);
    if (!validation.valid) {
      throw new Error(`Memory governance plan rejected: ${validation.issues.map((issue) => issue.code).join(', ')}`);
    }

    const appliedOperationIds: string[] = [];
    const transaction = this.db.transaction(() => {
      for (const operation of plan.operations) {
        if (this.store.isOperationApplied(operation.idempotencyKey)) continue;
        this.handlers[operation.type]?.(operation, { db: this.db, plan });
        this.store.recordOperation(plan, operation);
        appliedOperationIds.push(operation.operationId);
      }
      this.store.recordPlan(plan);
    });
    transaction();
    return { planId: plan.planId, status: 'applied', appliedOperationIds };
  }
}
