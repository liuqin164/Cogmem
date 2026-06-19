import type Database from 'bun:sqlite';

import type { Migration } from '../types/Migration.js';

export const migration_0015: Migration = {
  version: '0015',
  description: 'transactional memory governance plans and activation-aware graph edges',

  up(db) {
    db.exec(`
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
    ensureEdgeColumns(db);
  },

  down(db) {
    db.exec(`DROP INDEX IF EXISTS idx_memory_governance_audit_project;`);
    db.exec(`DROP INDEX IF EXISTS idx_memory_governance_operations_plan;`);
    db.exec(`DROP TABLE IF EXISTS memory_governance_audit;`);
    db.exec(`DROP TABLE IF EXISTS memory_governance_operations;`);
    db.exec(`DROP TABLE IF EXISTS memory_governance_plans;`);
  },
};

function ensureEdgeColumns(db: Database): void {
  const columns = db.prepare(`PRAGMA table_info(memory_edges)`).all() as Array<{ name: string }>;
  if (columns.length === 0) return;
  const names = new Set(columns.map((column) => column.name));
  const definitions: Array<[string, string]> = [
    ['base_weight', 'REAL NOT NULL DEFAULT 1'],
    ['stability', 'REAL NOT NULL DEFAULT 1'],
    ['activation', 'REAL NOT NULL DEFAULT 1'],
    ['valid_from', 'INTEGER NOT NULL DEFAULT 0'],
    ['valid_to', 'INTEGER'],
    ['version', 'INTEGER NOT NULL DEFAULT 1'],
    ['source_authority', "TEXT NOT NULL DEFAULT 'raw_evidence'"],
    ['updated_at', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, definition] of definitions) {
    if (!names.has(name)) db.exec(`ALTER TABLE memory_edges ADD COLUMN ${name} ${definition};`);
  }
  db.exec(`UPDATE memory_edges SET valid_from = created_at WHERE valid_from = 0;`);
  db.exec(`UPDATE memory_edges SET updated_at = created_at WHERE updated_at = 0;`);
}
