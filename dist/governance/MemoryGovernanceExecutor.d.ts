import Database from 'bun:sqlite';
import { MemoryGovernanceStore } from '../store/MemoryGovernanceStore.js';
import type { MemoryGovernanceExecutionResult, MemoryGovernanceOperation, MemoryGovernanceOperationType, MemoryGovernancePlan } from './MemoryGovernancePlan.js';
import { MemoryGovernanceValidator } from './MemoryGovernanceValidator.js';
export interface MemoryGovernanceExecutionContext {
    db: Database;
    plan: MemoryGovernancePlan;
}
export type MemoryGovernanceOperationHandler = (operation: MemoryGovernanceOperation, context: MemoryGovernanceExecutionContext) => void;
export declare class MemoryGovernanceExecutor {
    private readonly db;
    private readonly store;
    private readonly validator;
    private readonly handlers;
    constructor(db: Database, store: MemoryGovernanceStore, validator: MemoryGovernanceValidator, handlers?: Partial<Record<MemoryGovernanceOperationType, MemoryGovernanceOperationHandler>>);
    execute(plan: MemoryGovernancePlan): MemoryGovernanceExecutionResult;
}
//# sourceMappingURL=MemoryGovernanceExecutor.d.ts.map