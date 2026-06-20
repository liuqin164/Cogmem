export class MemoryGovernanceExecutor {
    db;
    store;
    validator;
    handlers;
    constructor(db, store, validator, handlers = {}) {
        this.db = db;
        this.store = store;
        this.validator = validator;
        this.handlers = handlers;
    }
    execute(plan) {
        if (this.store.isPlanApplied(plan.planId)) {
            return { planId: plan.planId, status: 'already_applied', appliedOperationIds: this.store.listAppliedOperations(plan.planId) };
        }
        const validation = this.validator.validate(plan);
        if (!validation.valid) {
            throw new Error(`Memory governance plan rejected: ${validation.issues.map((issue) => issue.code).join(', ')}`);
        }
        const appliedOperationIds = [];
        const transaction = this.db.transaction(() => {
            for (const operation of plan.operations) {
                if (this.store.isOperationApplied(operation.idempotencyKey))
                    continue;
                const handler = this.handlers[operation.type];
                if (!handler)
                    throw new Error(`unsupported_governance_operation:${operation.type}`);
                handler(operation, { db: this.db, plan });
                this.store.recordOperation(plan, operation);
                appliedOperationIds.push(operation.operationId);
            }
            this.store.recordPlan(plan);
        });
        transaction();
        return { planId: plan.planId, status: 'applied', appliedOperationIds };
    }
}
