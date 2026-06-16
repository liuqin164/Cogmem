import Database from 'bun:sqlite';

export interface ActivationTouchInput {
  neuronId: string;
  projectId?: string;
  delta?: number;
  source?: string;
  touchedAt?: number;
}

export interface ActivationDecayOptions {
  projectId?: string;
  factor?: number;
  floor?: number;
  now?: number;
}

export interface ActivationHotspot {
  neuronId: string;
  projectId?: string;
  activation: number;
  touchCount: number;
  lastTouchedAt: number;
  source?: string;
}

export interface ActivationDecayResult {
  decayedCount: number;
  removedCount: number;
  factor: number;
  floor: number;
}

export class ActivationStore {
  private readonly db: Database;
  private readonly ownsDb: boolean;

  constructor(dbOrPath: Database | string = ':memory:') {
    if (typeof dbOrPath === 'string') {
      this.db = new Database(dbOrPath);
      this.ownsDb = true;
    } else {
      this.db = dbOrPath;
      this.ownsDb = false;
    }
    this.initializeSchema();
  }

  touch(input: ActivationTouchInput): ActivationHotspot {
    const now = input.touchedAt ?? Date.now();
    const delta = clamp(input.delta ?? 1, 0, 10);
    const existing = this.get(input.neuronId);
    const activation = clamp((existing?.activation ?? 0) + delta, 0, 10);
    const touchCount = (existing?.touchCount ?? 0) + 1;
    this.db.prepare(`
      INSERT INTO memory_activation (
        neuron_id, project_id, activation, touch_count, source, last_touched_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(neuron_id) DO UPDATE SET
        project_id = excluded.project_id,
        activation = excluded.activation,
        touch_count = excluded.touch_count,
        source = excluded.source,
        last_touched_at = excluded.last_touched_at
    `).run(
      input.neuronId,
      input.projectId || existing?.projectId || null,
      activation,
      touchCount,
      input.source || existing?.source || null,
      now,
    );
    return {
      neuronId: input.neuronId,
      projectId: input.projectId || existing?.projectId,
      activation,
      touchCount,
      source: input.source || existing?.source,
      lastTouchedAt: now,
    };
  }

  get(neuronId: string): ActivationHotspot | null {
    const row = this.db.prepare(`
      SELECT * FROM memory_activation WHERE neuron_id = ?
    `).get(neuronId) as ActivationRow | null;
    return row ? mapRow(row) : null;
  }

  getTop(options: {
    projectId?: string;
    limit?: number;
    excludeNeuronIds?: string[];
  } = {}): ActivationHotspot[] {
    const limit = options.limit ?? 10;
    const exclude = options.excludeNeuronIds || [];
    const clauses = ['activation > 0'];
    const params: Array<string | number> = [];
    if (options.projectId) {
      clauses.push('project_id = ?');
      params.push(options.projectId);
    }
    if (exclude.length > 0) {
      clauses.push(`neuron_id NOT IN (${exclude.map(() => '?').join(', ')})`);
      params.push(...exclude);
    }
    params.push(limit);
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_activation
      WHERE ${clauses.join(' AND ')}
      ORDER BY activation DESC, last_touched_at DESC
      LIMIT ?
    `).all(...params) as ActivationRow[];
    return rows.map(mapRow);
  }

  decay(options: ActivationDecayOptions = {}): ActivationDecayResult {
    const factor = clamp(options.factor ?? 0.85, 0, 1);
    const floor = Math.max(0, options.floor ?? 0.05);
    const now = options.now ?? Date.now();
    const where = options.projectId ? 'WHERE project_id = ?' : '';
    const params = options.projectId ? [options.projectId] : [];
    const decayed = this.db.prepare(`
      UPDATE memory_activation
      SET activation = activation * ?, last_decayed_at = ?
      ${where}
    `).run(factor, now, ...params);
    const deleteWhere = options.projectId ? 'WHERE project_id = ? AND activation < ?' : 'WHERE activation < ?';
    const deleteParams = options.projectId ? [options.projectId, floor] : [floor];
    const removed = this.db.prepare(`
      DELETE FROM memory_activation
      ${deleteWhere}
    `).run(...deleteParams);
    return {
      decayedCount: Number(decayed.changes ?? 0),
      removedCount: Number(removed.changes ?? 0),
      factor,
      floor,
    };
  }

  close(): void {
    if (this.ownsDb) this.db.close();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_activation (
        neuron_id TEXT PRIMARY KEY,
        project_id TEXT,
        activation REAL NOT NULL DEFAULT 0,
        touch_count INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        last_touched_at INTEGER NOT NULL,
        last_decayed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_memory_activation_project
        ON memory_activation(project_id, activation DESC, last_touched_at DESC);
    `);
  }
}

interface ActivationRow {
  neuron_id: string;
  project_id?: string | null;
  activation: number;
  touch_count: number;
  source?: string | null;
  last_touched_at: number;
}

function mapRow(row: ActivationRow): ActivationHotspot {
  return {
    neuronId: row.neuron_id,
    projectId: row.project_id || undefined,
    activation: Number(row.activation),
    touchCount: Number(row.touch_count),
    source: row.source || undefined,
    lastTouchedAt: Number(row.last_touched_at),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
