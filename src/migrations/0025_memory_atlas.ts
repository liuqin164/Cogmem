import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0025: Migration = {
  version: '0025',
  description: 'source-anchored memory atlas projection and activation state',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_atlas_documents (
        node_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        memory_kind TEXT,
        source_id TEXT NOT NULL,
        label TEXT NOT NULL,
        summary TEXT,
        topic_path TEXT,
        confidence REAL NOT NULL DEFAULT 1,
        support_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        occurred_at INTEGER,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_documents_project_type
        ON memory_atlas_documents(project_id, node_type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_documents_project_topic
        ON memory_atlas_documents(project_id, topic_path, updated_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_atlas_fts USING fts5(
        node_id UNINDEXED,
        project_id UNINDEXED,
        node_type UNINDEXED,
        label,
        summary,
        topic_path,
        tokenize='unicode61'
      );
      CREATE TABLE IF NOT EXISTS memory_action_frames (
        action_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        frame_type TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        target_entity_id TEXT,
        target_label TEXT,
        topic_path TEXT,
        episode_id TEXT,
        occurred_at INTEGER NOT NULL,
        confidence REAL NOT NULL,
        source_authority TEXT NOT NULL DEFAULT 'raw_evidence',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_action_frames_query
        ON memory_action_frames(project_id, target_label, occurred_at DESC);
      CREATE TABLE IF NOT EXISTS memory_action_frame_evidence (
        action_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (action_id, event_id),
        FOREIGN KEY(action_id) REFERENCES memory_action_frames(action_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_action_evidence_event
        ON memory_action_frame_evidence(project_id, event_id);
      CREATE TABLE IF NOT EXISTS memory_atlas_access (
        access_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        access_kind TEXT NOT NULL,
        query_hash TEXT,
        accessed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_access_node
        ON memory_atlas_access(project_id, node_id, accessed_at DESC);
      CREATE TABLE IF NOT EXISTS memory_atlas_activation (
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        activation REAL NOT NULL DEFAULT 0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS memory_atlas_projection_state (
        project_id TEXT NOT NULL,
        projection_name TEXT NOT NULL,
        cursor_value TEXT,
        status TEXT NOT NULL,
        last_rebuild_at INTEGER,
        last_error TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (project_id, projection_name)
      );
    `);
    installAtlasProjectionDirtyTriggers(db);
    backfillAtlasDocuments(db);
  },
  down(db) {
    dropAtlasProjectionDirtyTriggers(db);
    db.exec(`
      DROP TABLE IF EXISTS memory_atlas_projection_state;
      DROP TABLE IF EXISTS memory_atlas_activation;
      DROP TABLE IF EXISTS memory_atlas_access;
      DROP TABLE IF EXISTS memory_action_frame_evidence;
      DROP TABLE IF EXISTS memory_action_frames;
      DROP TABLE IF EXISTS memory_atlas_fts;
      DROP TABLE IF EXISTS memory_atlas_documents;
    `);
  },
};

export function backfillAtlasDocuments(db: Database, projectId?: string): void {
  const now = Date.now();
  const scoped = projectId !== undefined;
  const projectWhere = scoped ? ` WHERE COALESCE(project_id, '') = ?` : '';
  const projectParams = scoped ? [projectId] : [];
  if (tableExists(db, 'memory_entities')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, confidence,
        support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'entity:' || entity_id, COALESCE(project_id, ''), 'entity', entity_id,
        canonical_name, NULL, 1, 0, 'active', created_at, '[]',
        json_object('entityType', entity_type, 'aliases', aliases_json, 'stablePath', stable_path),
        COALESCE(updated_at, ?)
      FROM memory_entities${projectWhere}
    `).run(now, ...projectParams);
  }
  if (tableExists(db, 'memory_topics')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, topic_path,
        confidence, support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'topic:' || COALESCE(project_id, '') || ':' || topic_path, COALESCE(project_id, ''),
        'topic', topic_path, topic_path, summary, topic_path, 1, 0, 'active', created_at, '[]',
        json_object('topicType', topic_type, 'parentPath', parent_path), COALESCE(updated_at, ?)
      FROM memory_topics${projectWhere}
    `).run(now, ...projectParams);
  }
  if (tableExists(db, 'topic_nodes')) {
    const legacySummary = tableExists(db, 'memory_topics')
      ? `(SELECT mt.summary FROM memory_topics mt WHERE mt.project_id=topic_nodes.project_id AND mt.topic_path=topic_nodes.topic_path LIMIT 1)`
      : 'NULL';
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, topic_path,
        confidence, support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'topic:' || project_id || ':' || topic_path, project_id, 'topic', topic_path,
        canonical_name,
        TRIM(COALESCE(${legacySummary}, '') || ' ' || COALESCE((
          SELECT group_concat(alias, ' ') FROM topic_aliases a
          WHERE a.project_id=topic_nodes.project_id AND a.topic_id=topic_nodes.topic_id AND a.status='active'
        ), '')),
        topic_path, confidence, 0, status, last_used_at, evidence_event_ids_json,
        json_object('topicId', topic_id, 'ontologyClass', ontology_class, 'createdBy', created_by), updated_at
      FROM topic_nodes${projectWhere}
    `).run(...projectParams);
  }
  if (tableExists(db, 'memory_clusters')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, topic_path,
        confidence, support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'cluster:' || cluster_id, COALESCE(project_id, ''), 'cluster', cluster_id,
        title, summary, topic_path, confidence, support_count, status, created_at,
        evidence_event_ids_json, json_object('clusterType', cluster_type, 'claimKey', claim_key),
        COALESCE(updated_at, ?)
      FROM memory_clusters${projectWhere}
    `).run(now, ...projectParams);
  }
  if (tableExists(db, 'memory_episodes')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, topic_path,
        confidence, support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'episode:' || episode_id, project_id, 'episode', episode_id,
        COALESCE(summary, topic_path, episode_type || ' episode'), summary, topic_path,
        importance, event_count, status, started_at,
        json_array(start_event_id, end_event_id),
        json_object('episodeType', episode_type, 'sessionId', session_id), updated_at
      FROM memory_episodes${projectWhere}
    `).run(...projectParams);
  }
  if (tableExists(db, 'beliefs')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, confidence,
        support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'belief:' || id, COALESCE(project_id, ''), 'belief', id,
        subject || ' ' || predicate, object_value, confidence, 1, status, valid_from,
        CASE WHEN source_event_id IS NULL THEN '[]' ELSE json_array(source_event_id) END,
        json_object('canonicalKey', canonical_key, 'scope', scope), updated_at
      FROM beliefs${projectWhere}
    `).run(...projectParams);
  }
  if (scoped) db.prepare(`DELETE FROM memory_atlas_fts WHERE project_id=?`).run(projectId);
  else db.exec(`DELETE FROM memory_atlas_fts;`);
  const ftsWhere = scoped ? ' WHERE project_id=?' : '';
  db.prepare(`
    INSERT INTO memory_atlas_fts (node_id, project_id, node_type, label, summary, topic_path)
    SELECT node_id, project_id, node_type, label, COALESCE(summary, ''), COALESCE(topic_path, '')
    FROM memory_atlas_documents${ftsWhere};
  `).run(...projectParams);
  db.exec(`
    UPDATE memory_atlas_documents SET memory_kind = CASE
      WHEN node_type IN ('action','project','event','time') THEN node_type
      WHEN lower(json_extract(metadata_json, '$.clusterType')) IN ('decision','correction','goal','preference','plan','event','evidence')
        THEN lower(json_extract(metadata_json, '$.clusterType'))
      WHEN lower(json_extract(metadata_json, '$.episodeType')) IN ('decision','correction','goal','preference','plan','event','evidence')
        THEN lower(json_extract(metadata_json, '$.episodeType'))
      WHEN lower(json_extract(metadata_json, '$.ontologyClass')) IN ('person','place','project','object','decision','correction','goal','preference','plan','event','evidence')
        THEN lower(json_extract(metadata_json, '$.ontologyClass'))
      WHEN lower(json_extract(metadata_json, '$.entityType')) IN ('person','place','project','object')
        THEN lower(json_extract(metadata_json, '$.entityType'))
      ELSE NULL
    END
    WHERE memory_kind IS NULL;
  `);
}

export function installAtlasProjectionDirtyTriggers(db: Database): void {
  const sources: Array<[string, string]> = [
    ['memory_entities', 'project_id'], ['memory_topics', 'project_id'], ['memory_clusters', 'project_id'],
    ['memory_episodes', 'project_id'], ['beliefs', 'project_id'], ['memory_bindings', 'project_id'],
    ['topic_nodes', 'project_id'], ['topic_aliases', 'project_id'], ['topic_relations', 'project_id'],
  ];
  for (const [table, projectColumn] of sources) {
    if (!tableExists(db, table)) continue;
    for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
      const trigger = `trg_memory_atlas_dirty_${table}_${operation.toLowerCase()}`;
      const markOldProject = operation === 'UPDATE' ? `
          INSERT INTO memory_atlas_projection_state(
            project_id, projection_name, cursor_value, status, last_rebuild_at, last_error, metadata_json
          ) VALUES(COALESCE(OLD.${projectColumn}, ''), 'memory_atlas.v1', NULL, 'dirty', NULL, NULL, '{}')
          ON CONFLICT(project_id, projection_name) DO UPDATE SET status='dirty', cursor_value=NULL, last_error=NULL;
      ` : '';
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${trigger}
        AFTER ${operation} ON ${table}
        BEGIN
          INSERT INTO memory_atlas_projection_state(
            project_id, projection_name, cursor_value, status, last_rebuild_at, last_error, metadata_json
          ) VALUES(COALESCE(${ref}.${projectColumn}, ''), 'memory_atlas.v1', NULL, 'dirty', NULL, NULL, '{}')
          ON CONFLICT(project_id, projection_name) DO UPDATE SET status='dirty', cursor_value=NULL, last_error=NULL;
          ${markOldProject}
        END;
      `);
    }
  }
}

function dropAtlasProjectionDirtyTriggers(db: Database): void {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_memory_atlas_dirty_%'`).all() as Array<{ name: string }>;
  for (const row of rows) {
    if (!/^trg_memory_atlas_dirty_[a-z0-9_]+$/u.test(row.name)) continue;
    db.exec(`DROP TRIGGER IF EXISTS ${row.name};`);
  }
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}
