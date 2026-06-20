import Database from 'bun:sqlite';

import type { StrategyRolloutOutcome } from './MemoryUseJudge.js';

export class ContextOutcomeStore {
  constructor(private readonly db: Database) {
    this.initializeSchema();
  }

  record(outcome: StrategyRolloutOutcome): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO context_strategy_outcomes (
        outcome_id, receipt_id, project_id, strategy_id, strategy_template, intent,
        score, unsafe_leak, outcome_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      outcome.outcomeId, outcome.receiptId, outcome.projectId ?? null, outcome.strategyId,
      outcome.strategyTemplate, outcome.intent, outcome.score, outcome.unsafeLeak ? 1 : 0,
      JSON.stringify(outcome), outcome.createdAt,
    );
  }

  get(outcomeId: string): StrategyRolloutOutcome | null {
    const row = this.db.prepare(`SELECT outcome_json FROM context_strategy_outcomes WHERE outcome_id = ?`)
      .get(outcomeId) as { outcome_json: string } | null;
    return row ? JSON.parse(row.outcome_json) : null;
  }

  list(projectId: string, limit = 100): StrategyRolloutOutcome[] {
    const rows = this.db.prepare(`
      SELECT outcome_json FROM context_strategy_outcomes
      WHERE project_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(projectId, Math.max(1, Math.min(1000, Math.floor(limit)))) as Array<{ outcome_json: string }>;
    return rows.map((row) => JSON.parse(row.outcome_json));
  }

  deleteProject(projectId: string): number {
    return Number(this.db.prepare(`DELETE FROM context_strategy_outcomes WHERE project_id = ?`).run(projectId).changes);
  }

  private initializeSchema(): void {
    this.db.exec(`
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
  }
}
