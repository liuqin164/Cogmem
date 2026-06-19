export const migration_0017 = {
    version: '0017',
    description: 'evidence-backed versioned belief graph',
    up(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS belief_graph_nodes (
        belief_id TEXT PRIMARY KEY, project_id TEXT, ownership TEXT NOT NULL, belief_type TEXT NOT NULL,
        canonical_key TEXT NOT NULL, statement TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, valid_from INTEGER NOT NULL, valid_to INTEGER,
        supersedes_belief_id TEXT, superseded_by_belief_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_belief_graph_current
        ON belief_graph_nodes(project_id, canonical_key) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_belief_graph_history
        ON belief_graph_nodes(project_id, canonical_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS belief_graph_evidence (
        belief_id TEXT NOT NULL, event_id TEXT NOT NULL, source_role TEXT NOT NULL,
        evidence_type TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0, created_at INTEGER NOT NULL,
        PRIMARY KEY (belief_id, event_id, evidence_type)
      );
      CREATE TABLE IF NOT EXISTS belief_graph_versions (
        belief_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
        reason TEXT NOT NULL, evidence_event_id TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (belief_id, version)
      );
      CREATE TABLE IF NOT EXISTS belief_graph_conflicts (
        conflict_id TEXT PRIMARY KEY, project_id TEXT, prior_belief_id TEXT NOT NULL,
        proposed_belief_id TEXT NOT NULL, relation TEXT NOT NULL, status TEXT NOT NULL,
        reason TEXT, evidence_event_ids_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    },
    down(db) {
        db.exec(`DROP TABLE IF EXISTS belief_graph_conflicts;`);
        db.exec(`DROP TABLE IF EXISTS belief_graph_versions;`);
        db.exec(`DROP TABLE IF EXISTS belief_graph_evidence;`);
        db.exec(`DROP INDEX IF EXISTS idx_belief_graph_history;`);
        db.exec(`DROP INDEX IF EXISTS idx_belief_graph_current;`);
        db.exec(`DROP TABLE IF EXISTS belief_graph_nodes;`);
    },
};
