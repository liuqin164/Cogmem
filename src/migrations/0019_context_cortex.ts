import type { Migration } from '../types/Migration.js';

export const migration_0019: Migration = {
  version: '0019',
  description: 'auditable context activation receipts',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS context_activation_receipts (
        receipt_id TEXT PRIMARY KEY, project_id TEXT, intent TEXT NOT NULL,
        budget_tokens INTEGER NOT NULL, used_tokens INTEGER NOT NULL,
        receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_activation_project_time
        ON context_activation_receipts(project_id, created_at DESC);
    `);
  },
  down(db) {
    db.exec(`DROP INDEX IF EXISTS idx_context_activation_project_time;`);
    db.exec(`DROP TABLE IF EXISTS context_activation_receipts;`);
  },
};
