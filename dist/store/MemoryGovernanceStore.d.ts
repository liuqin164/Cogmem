import Database from 'bun:sqlite';
import type { MemoryGovernanceOperation, MemoryGovernancePlan } from '../governance/MemoryGovernancePlan.js';
export interface MemoryGovernanceAuditEntry {
    auditId: string;
    planId: string;
    operationId: string;
    projectId?: string;
    operationType: string;
    evidenceEventIds: string[];
    createdAt: number;
}
export declare class MemoryGovernanceStore {
    private readonly db;
    constructor(db: Database);
    isPlanApplied(planId: string): boolean;
    isOperationApplied(idempotencyKey: string): boolean;
    recordPlan(plan: MemoryGovernancePlan): void;
    recordOperation(plan: MemoryGovernancePlan, operation: MemoryGovernanceOperation): void;
    listAppliedOperations(planId: string): string[];
    listAudit(projectId?: string): MemoryGovernanceAuditEntry[];
    private initializeSchema;
}
//# sourceMappingURL=MemoryGovernanceStore.d.ts.map