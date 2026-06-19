export class MemoryGovernanceValidator {
    findEvidence;
    constructor(findEvidence) {
        this.findEvidence = findEvidence;
    }
    validate(plan) {
        const issues = [];
        const operationIds = new Set();
        const idempotencyKeys = new Set();
        if (!plan.planId.trim())
            issues.push({ code: 'missing_plan_id', message: 'planId is required.' });
        if (plan.operations.length === 0)
            issues.push({ code: 'empty_plan', message: 'At least one operation is required.' });
        for (const operation of plan.operations) {
            if (!operation.operationId.trim()) {
                issues.push({ code: 'missing_operation_id', message: 'operationId is required.' });
            }
            else if (operationIds.has(operation.operationId)) {
                issues.push({ code: 'duplicate_operation_id', message: 'operationId must be unique.', operationId: operation.operationId });
            }
            operationIds.add(operation.operationId);
            if (!operation.idempotencyKey.trim()) {
                issues.push({ code: 'missing_idempotency_key', message: 'idempotencyKey is required.', operationId: operation.operationId });
            }
            else if (idempotencyKeys.has(operation.idempotencyKey)) {
                issues.push({ code: 'duplicate_idempotency_key', message: 'idempotencyKey must be unique inside a plan.', operationId: operation.operationId });
            }
            idempotencyKeys.add(operation.idempotencyKey);
            if (operation.evidenceEventIds.length === 0) {
                issues.push({ code: 'missing_evidence', message: 'Durable operations require raw event evidence.', operationId: operation.operationId });
                continue;
            }
            const evidence = operation.evidenceEventIds.map((eventId) => this.findEvidence(eventId));
            if (evidence.some((record) => !record)) {
                issues.push({ code: 'unknown_evidence', message: 'Every evidence event must exist in the Raw Ledger.', operationId: operation.operationId });
            }
            if (operation.projectId && evidence.some((record) => record?.projectId && record.projectId !== operation.projectId)) {
                issues.push({ code: 'project_boundary_violation', message: 'Evidence must remain inside the operation project.', operationId: operation.operationId });
            }
            if (operation.ownership === 'user' && !evidence.some((record) => record?.role === 'user')) {
                issues.push({
                    code: 'user_ownership_requires_user_evidence',
                    message: 'User-owned memory requires at least one explicit user event.',
                    operationId: operation.operationId,
                });
            }
            if (operation.expectedVersion !== undefined && (!Number.isInteger(operation.expectedVersion) || operation.expectedVersion < 0)) {
                issues.push({ code: 'invalid_expected_version', message: 'expectedVersion must be a non-negative integer.', operationId: operation.operationId });
            }
        }
        return { valid: issues.length === 0, issues };
    }
}
