import Database from 'bun:sqlite';
export class CompilerConfidenceStore {
    db;
    ownsDb;
    constructor(dbOrPath = ':memory:') {
        if (typeof dbOrPath === 'string') {
            this.db = new Database(dbOrPath);
            this.ownsDb = true;
        }
        else {
            this.db = dbOrPath;
            this.ownsDb = false;
        }
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS compiler_confidence_runs (
        run_id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT,
        project_id TEXT,
        compiler_name TEXT NOT NULL,
        confidence REAL NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_compiler_confidence_target
        ON compiler_confidence_runs(target_type, target_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_compiler_confidence_project
        ON compiler_confidence_runs(project_id, created_at DESC);
    `);
    }
    insert(record) {
        this.db.prepare(`
      INSERT OR REPLACE INTO compiler_confidence_runs (
        run_id, target_type, target_id, project_id, compiler_name, confidence, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.runId, record.targetType, record.targetId || null, record.projectId ?? null, record.compilerName, record.confidence, record.metadata ? JSON.stringify(record.metadata) : null, record.createdAt);
    }
    listByTarget(targetType, targetId) {
        const rows = this.db.prepare(`
      SELECT *
      FROM compiler_confidence_runs
      WHERE target_type = ? AND target_id = ?
      ORDER BY created_at DESC
    `).all(targetType, targetId);
        return rows.map((row) => ({
            runId: row.run_id,
            targetType: row.target_type,
            targetId: row.target_id || undefined,
            projectId: row.project_id == null ? undefined : String(row.project_id),
            compilerName: row.compiler_name,
            confidence: row.confidence,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
            createdAt: row.created_at
        }));
    }
    listByTimeRange(startTime, endTime, targetType = 'memory') {
        const rows = this.db.prepare(`
      SELECT *
      FROM compiler_confidence_runs
      WHERE target_type = ?
        AND created_at >= ?
        AND created_at < ?
      ORDER BY created_at DESC
    `).all(targetType, startTime, endTime);
        return rows.map((row) => ({
            runId: row.run_id,
            targetType: row.target_type,
            targetId: row.target_id || undefined,
            projectId: row.project_id == null ? undefined : String(row.project_id),
            compilerName: row.compiler_name,
            confidence: row.confidence,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
            createdAt: row.created_at
        }));
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
}
