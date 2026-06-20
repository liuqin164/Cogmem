import type { Migration } from '../types/Migration.js';

export const migration_0021: Migration = {
  version: '0021',
  description: 'read-only strategy cortex outcome telemetry',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS context_strategy_outcomes (
        outcome_id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, project_id TEXT,
        strategy_id TEXT NOT NULL, strategy_template TEXT NOT NULL, intent TEXT NOT NULL,
        score REAL NOT NULL, unsafe_leak INTEGER NOT NULL DEFAULT 0,
        outcome_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_strategy_project_time
        ON context_strategy_outcomes(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_context_strategy_template_intent
        ON context_strategy_outcomes(strategy_template, intent, created_at DESC);
    `);
  },
  down(db) {
    db.exec(`DROP INDEX IF EXISTS idx_context_strategy_template_intent;`);
    db.exec(`DROP INDEX IF EXISTS idx_context_strategy_project_time;`);
    db.exec(`DROP TABLE IF EXISTS context_strategy_outcomes;`);
  },
};
