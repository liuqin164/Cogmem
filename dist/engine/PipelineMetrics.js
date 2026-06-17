export class PipelineMetrics {
    db;
    constructor(db) {
        this.db = db;
        this.initSchema();
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        run_id TEXT PRIMARY KEY,
        total_ms INTEGER NOT NULL,
        aborted INTEGER NOT NULL CHECK (aborted IN (0, 1)),
        completed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pipeline_step_timings (
        run_id TEXT NOT NULL,
        step_name TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        completed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_completed_at
        ON pipeline_runs(completed_at DESC);

      CREATE INDEX IF NOT EXISTS idx_pipeline_step_name
        ON pipeline_step_timings(step_name, completed_at DESC);

      CREATE TABLE IF NOT EXISTS pipeline_nonfatal_events (
        event_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        project_id TEXT,
        message TEXT,
        details_json TEXT,
        occurred_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_nonfatal_kind_project
        ON pipeline_nonfatal_events(kind, project_id, occurred_at DESC);
    `);
    }
    record(runId, steps, totalMs, aborted) {
        this.db.prepare(`
      INSERT OR REPLACE INTO pipeline_runs (run_id, total_ms, aborted, completed_at)
      VALUES (?, ?, ?, ?)
    `).run(runId, totalMs, aborted ? 1 : 0, Date.now());
        this.db.prepare(`DELETE FROM pipeline_step_timings WHERE run_id = ?`).run(runId);
        const insert = this.db.prepare(`
      INSERT INTO pipeline_step_timings (run_id, step_name, duration_ms, completed_at)
      VALUES (?, ?, ?, ?)
    `);
        for (const step of steps) {
            insert.run(runId, step.stepName, step.durationMs, step.completedAt);
        }
    }
    getPipelineP99(recentN = 100) {
        const rows = this.db.prepare(`
      SELECT total_ms FROM pipeline_runs
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(recentN);
        if (rows.length === 0)
            return 0;
        const values = rows.map((row) => row.total_ms).sort((a, b) => a - b);
        return values[Math.max(0, Math.ceil(values.length * 0.99) - 1)];
    }
    getLastRun() {
        const row = this.db.prepare(`
      SELECT completed_at, aborted, total_ms
      FROM pipeline_runs
      ORDER BY completed_at DESC
      LIMIT 1
    `).get();
        return row
            ? { completedAt: row.completed_at, aborted: row.aborted === 1, totalMs: row.total_ms }
            : undefined;
    }
    getStepAverages() {
        const rows = this.db.prepare(`
      SELECT step_name, AVG(duration_ms) AS avg_ms
      FROM pipeline_step_timings
      GROUP BY step_name
    `).all();
        return Object.fromEntries(rows.map((row) => [row.step_name, row.avg_ms]));
    }
    recordNonFatal(kind, input = {}) {
        const occurredAt = input.occurredAt ?? Date.now();
        const eventId = `${kind}-${occurredAt}-${Math.random().toString(36).slice(2)}`;
        this.db.prepare(`
      INSERT INTO pipeline_nonfatal_events (
        event_id, kind, project_id, message, details_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(eventId, kind, input.projectId || null, input.message || null, input.details ? JSON.stringify(input.details) : null, occurredAt);
    }
    getNonFatalCount(kind, options = {}) {
        const clauses = [];
        const params = [];
        if (kind) {
            clauses.push('kind = ?');
            params.push(kind);
        }
        if (options.projectId) {
            clauses.push('project_id = ?');
            params.push(options.projectId);
        }
        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM pipeline_nonfatal_events
      ${where}
    `).get(...params);
        return Number(row.count);
    }
    cleanup(retentionMs = 30 * 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - retentionMs;
        const oldRuns = this.db.prepare(`
      SELECT run_id FROM pipeline_runs
      WHERE completed_at < ?
    `).all(cutoff);
        const deleteSteps = this.db.prepare(`DELETE FROM pipeline_step_timings WHERE run_id = ?`);
        for (const run of oldRuns)
            deleteSteps.run(run.run_id);
        this.db.prepare(`DELETE FROM pipeline_runs WHERE completed_at < ?`).run(cutoff);
        this.db.prepare(`DELETE FROM pipeline_nonfatal_events WHERE occurred_at < ?`).run(cutoff);
    }
}
