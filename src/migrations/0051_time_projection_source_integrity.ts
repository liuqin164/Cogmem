import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0051: Migration = {
  version: '0051',
  description: 'add global time scope, source revisions, and deterministic rebuild staging',
  up(db) {
    ensureColumn(db, 'topology_projection_state', 'source_revision', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn(db, 'topology_time_rebuild_jobs', 'source_revision', 'INTEGER NOT NULL DEFAULT 0');
    db.exec(`
      CREATE TABLE IF NOT EXISTS topology_source_revisions (
        project_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topology_time_rebuild_cognitive_nodes (
        generation TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        node_key TEXT NOT NULL,
        title TEXT NOT NULL,
        project_id TEXT NOT NULL,
        source_neuron_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(generation,node_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS topology_time_rebuild_cognitive_edges (
        generation TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL,
        project_id TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(generation,edge_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS topology_time_rebuild_adjacency (
        generation TEXT NOT NULL,
        project_id TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        source_bucket_id TEXT NOT NULL,
        adjacent_bucket_id TEXT NOT NULL,
        bucket_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(generation,source_bucket_id,adjacent_bucket_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      );

    `);

    dedupeReferenceTable(db, 'time_bucket_entries', 'bucket_id', 'idx_time_bucket_entries_reference_unique');
    dedupeReferenceTable(db, 'branch_entries', 'branch_id', 'idx_branch_entries_reference_unique');
    dedupeReferenceTable(db, 'task_branch_entries', 'task_id', 'idx_task_branch_entries_reference_unique');
    dedupeReferenceTable(db, 'event_cluster_entries', 'cluster_id', 'idx_event_cluster_entries_reference_unique');

    db.exec(`
      INSERT OR IGNORE INTO topology_source_revisions(project_id,revision,updated_at)
      SELECT project_id,0,unixepoch()*1000
      FROM topology_projection_state;
    `);

    if (tableExists(db, 'neurons')) {
      db.exec(`
        INSERT INTO topology_source_revisions(project_id,revision,updated_at)
        SELECT COALESCE(project_id,''),COUNT(*),unixepoch()*1000
        FROM neurons
        WHERE is_deleted=0
        GROUP BY COALESCE(project_id,'')
        ON CONFLICT(project_id) DO UPDATE SET
          revision=MAX(topology_source_revisions.revision,excluded.revision),
          updated_at=excluded.updated_at;

        INSERT INTO topology_projection_state(project_id,projection_version,status,time_zone,updated_at,error,source_revision)
        SELECT source.project_id,4,'dirty',COALESCE(existing.time_zone,'UTC'),unixepoch()*1000,NULL,0
        FROM topology_source_revisions source
        LEFT JOIN topology_projection_state existing ON existing.project_id=source.project_id
        ON CONFLICT(project_id) DO UPDATE SET
          projection_version=4,status='dirty',updated_at=excluded.updated_at,error=NULL,source_revision=0;
      `);
    }

    db.exec(`
      UPDATE topology_projection_state
      SET projection_version=4,status='dirty',source_revision=0,updated_at=unixepoch()*1000,error=NULL;
      UPDATE topology_time_rebuild_jobs
      SET status='failed',source_revision=COALESCE((SELECT revision FROM topology_source_revisions r WHERE r.project_id=topology_time_rebuild_jobs.project_id),0),updated_at=unixepoch()*1000,error='source_revision_upgrade_required';
    `);
  },
  down() {},
};

function ensureColumn(db: Database, table: string, name: string, definition: string): void {
  if (!tableExists(db, table)) return;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function dedupeReferenceTable(db: Database, table: string, ownerColumn: string, index: string): void {
  if (!tableExists(db, table)) return;
  db.exec(`
    DELETE FROM ${table}
    WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM ${table}
      GROUP BY ${ownerColumn},COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,'')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ${index}
      ON ${table}(${ownerColumn},COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
  `);
}
