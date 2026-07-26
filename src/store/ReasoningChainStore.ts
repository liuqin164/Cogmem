// ============================================
// ReasoningChainStore - 推理链存储（SQLite）
// ============================================

import Database from 'bun:sqlite';
import type { ReasoningChain, ReasoningStep } from '../types/reasoning.js';
import { logger } from '../utils/Logger.js';
import { projectScope } from '../topology/ProjectScope.js';

export class ReasoningChainStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reasoning_chains (
        id TEXT PRIMARY KEY,
        outcome TEXT NOT NULL,
        project_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reasoning_steps (
        chain_id TEXT NOT NULL,
        neuron_id TEXT NOT NULL,
        role TEXT NOT NULL,
        step_order INTEGER NOT NULL,
        PRIMARY KEY (chain_id, neuron_id),
        FOREIGN KEY (chain_id) REFERENCES reasoning_chains(id)
      );

      CREATE INDEX IF NOT EXISTS idx_chain_project ON reasoning_chains(project_id);
      CREATE INDEX IF NOT EXISTS idx_step_neuron ON reasoning_steps(neuron_id);
    `);
  }

  addChain(chain: ReasoningChain): void {
    this.db.transaction(() => {
      const scope = projectScope(chain.projectId);
      for (const step of chain.steps) {
        const neuron = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0`)
          .get(step.neuronId) as { scope: string } | null;
        if (!neuron || neuron.scope !== scope) throw new Error('reasoning_chain_project_scope_mismatch');
      }
      this.db.prepare(`
        INSERT INTO reasoning_chains (id, outcome, project_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(chain.id, chain.outcome, scope, chain.createdAt);

      for (const step of chain.steps) {
        this.db.prepare(`
          INSERT INTO reasoning_steps (chain_id, neuron_id, role, step_order)
          VALUES (?, ?, ?, ?)
        `).run(chain.id, step.neuronId, step.role, step.order);
      }
    })();
    logger.debug(`ReasoningChain ${chain.id} added`);
  }

  getChain(chainId: string): ReasoningChain | null {
    const row = this.db.prepare(`SELECT * FROM reasoning_chains WHERE id = ?`).get(chainId) as any;
    if (!row) return null;

    const steps = this.db.prepare(`SELECT * FROM reasoning_steps WHERE chain_id = ? ORDER BY step_order`).all(chainId) as any[];
    return {
      id: row.id,
      steps: steps.map(s => ({ neuronId: s.neuron_id, role: s.role, order: s.step_order })),
      outcome: row.outcome,
      projectId: row.project_id,
      createdAt: row.created_at
    };
  }

  getChainIdForNeuron(neuronId: string): string | null {
    const row = this.db.prepare(`SELECT chain_id FROM reasoning_steps WHERE neuron_id = ? ORDER BY chain_id LIMIT 1`).get(neuronId) as any;
    return row?.chain_id || null;
  }

  areNeuronsInSameChain(neuronId1: string, neuronId2: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM reasoning_steps a JOIN reasoning_steps b
      ON b.chain_id=a.chain_id WHERE a.neuron_id=? AND b.neuron_id=? LIMIT 1`).get(neuronId1, neuronId2));
  }

  getChainsByProject(projectId: string): ReasoningChain[] {
    const rows = this.db.prepare(`SELECT id FROM reasoning_chains WHERE project_id = ?`).all(projectId) as any[];
    return rows.map(r => this.getChain(r.id)!).filter(Boolean);
  }
}
