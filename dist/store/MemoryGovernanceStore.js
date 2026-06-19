export class MemoryGovernanceStore {
    db;
    constructor(db) {
        this.db = db;
        this.initializeSchema();
    }
    isPlanApplied(planId) {
        return Boolean(this.db.prepare(`SELECT 1 FROM memory_governance_plans WHERE plan_id = ? AND status = 'applied'`).get(planId));
    }
    isOperationApplied(idempotencyKey) {
        return Boolean(this.db.prepare(`SELECT 1 FROM memory_governance_operations WHERE idempotency_key = ? AND status = 'applied'`).get(idempotencyKey));
    }
    recordPlan(plan) {
        this.db.prepare(`
      INSERT INTO memory_governance_plans (plan_id, project_id, proposed_by, status, created_at, applied_at)
      VALUES (?, ?, ?, 'applied', ?, ?)
    `).run(plan.planId, plan.projectId || null, plan.proposedBy, plan.createdAt, Date.now());
    }
    recordOperation(plan, operation) {
        const now = Date.now();
        this.db.prepare(`
      INSERT INTO memory_governance_operations (
        operation_id, plan_id, project_id, operation_type, idempotency_key, expected_version,
        evidence_event_ids_json, source_role, ownership, payload_json, status, created_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?)
    `).run(operation.operationId, plan.planId, operation.projectId || plan.projectId || null, operation.type, operation.idempotencyKey, operation.expectedVersion ?? null, JSON.stringify(operation.evidenceEventIds), operation.sourceRole, operation.ownership, JSON.stringify(operation.payload), plan.createdAt, now);
        this.db.prepare(`
      INSERT INTO memory_governance_audit (
        audit_id, plan_id, operation_id, project_id, operation_type, evidence_event_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`audit:${plan.planId}:${operation.operationId}`, plan.planId, operation.operationId, operation.projectId || plan.projectId || null, operation.type, JSON.stringify(operation.evidenceEventIds), now);
    }
    listAppliedOperations(planId) {
        return this.db.prepare(`
      SELECT operation_id FROM memory_governance_operations
      WHERE plan_id = ? AND status = 'applied'
      ORDER BY created_at, operation_id
    `).all(planId).map((row) => row.operation_id);
    }
    listAudit(projectId) {
        const rows = projectId
            ? this.db.prepare(`SELECT * FROM memory_governance_audit WHERE project_id = ? ORDER BY created_at DESC`).all(projectId)
            : this.db.prepare(`SELECT * FROM memory_governance_audit ORDER BY created_at DESC`).all();
        return rows.map((row) => ({
            auditId: String(row.audit_id),
            planId: String(row.plan_id),
            operationId: String(row.operation_id),
            projectId: row.project_id ? String(row.project_id) : undefined,
            operationType: String(row.operation_type),
            evidenceEventIds: parseStringArray(row.evidence_event_ids_json),
            createdAt: Number(row.created_at),
        }));
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_governance_plans (
        plan_id TEXT PRIMARY KEY,
        project_id TEXT,
        proposed_by TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        applied_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS memory_governance_operations (
        operation_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        project_id TEXT,
        operation_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        expected_version INTEGER,
        evidence_event_ids_json TEXT NOT NULL,
        source_role TEXT NOT NULL,
        ownership TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        applied_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_memory_governance_operations_plan
        ON memory_governance_operations(plan_id, created_at);
      CREATE TABLE IF NOT EXISTS memory_governance_audit (
        audit_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        project_id TEXT,
        operation_type TEXT NOT NULL,
        evidence_event_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_governance_audit_project
        ON memory_governance_audit(project_id, created_at DESC);
    `);
    }
}
function parseStringArray(value) {
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    }
    catch {
        return [];
    }
}
