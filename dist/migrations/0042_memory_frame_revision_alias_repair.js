const exists = (db, name, type = 'table') => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type=? AND name=?`).get(type, name));
export const migration_0042 = {
    version: '0042',
    description: 'repair revision chronology and validate frame alias provenance',
    up(db) {
        if (!exists(db, 'memory_frames'))
            return;
        db.exec(`
      UPDATE memory_frames SET revision_number=-rowid;
      UPDATE memory_frames AS current
      SET revision_number=(
        SELECT COUNT(*) FROM memory_frames AS prior
        WHERE prior.episode_id=current.episode_id
          AND prior.source_fingerprint=current.source_fingerprint
          AND prior.processor_prompt_version=current.processor_prompt_version
          AND (prior.created_at < current.created_at OR (prior.created_at=current.created_at AND prior.frame_id<=current.frame_id))
      )
      WHERE current.revision_number < 0;
    `);
        if (exists(db, 'memory_atlas_alias_supports') && exists(db, 'memory_atlas_aliases')) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS memory_atlas_alias_ambiguities (
          candidate_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          dimension TEXT NOT NULL,
          normalized_alias TEXT NOT NULL,
          node_ids_json TEXT NOT NULL,
          source_frame_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO memory_atlas_alias_supports
          (support_id,alias_id,project_id,node_id,source_frame_id,source_episode_id,evidence_event_ids_json,status,created_at)
        SELECT a.alias_id || ':' || a.source_frame_id,a.alias_id,a.project_id,a.node_id,a.source_frame_id,
               f.episode_id,COALESCE(a.evidence_event_ids_json,'[]'),'active',COALESCE(a.created_at,CAST(strftime('%s','now') AS INTEGER)*1000)
        FROM memory_atlas_aliases a
        JOIN memory_frames f ON f.frame_id=a.source_frame_id
        WHERE a.source_frame_id IS NOT NULL AND a.status='active' AND f.status='active'
          AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s WHERE s.alias_id=a.alias_id AND s.source_frame_id=a.source_frame_id);
        UPDATE memory_atlas_aliases
        SET status='invalidated',updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
        WHERE source_frame_id IS NOT NULL AND status='active'
          AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active');
      `);
            if (db.prepare(`SELECT 1 FROM memory_atlas_aliases a JOIN memory_frames f ON f.frame_id=a.source_frame_id WHERE a.source_frame_id IS NOT NULL AND a.project_id<>f.project_id LIMIT 1`).get()) {
                throw new Error('memory_frame_alias_cross_project');
            }
            if (db.prepare(`SELECT 1 FROM memory_atlas_aliases a LEFT JOIN memory_atlas_documents d ON d.project_id=a.project_id AND d.node_id=a.node_id WHERE a.status='active' AND d.node_id IS NULL LIMIT 1`).get()) {
                throw new Error('memory_frame_alias_orphan');
            }
            if (db.prepare(`SELECT 1 FROM memory_atlas_aliases WHERE source_frame_id IS NOT NULL AND status='active' AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active') LIMIT 1`).get()) {
                throw new Error('memory_frame_alias_provenance_incomplete');
            }
        }
        db.exec(`
      CREATE TABLE IF NOT EXISTS _memory_frame_integrity_markers (
        marker TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      INSERT OR REPLACE INTO _memory_frame_integrity_markers(marker,created_at)
      VALUES ('memory_frame_integrity_0042',CAST(strftime('%s','now') AS INTEGER)*1000);
    `);
    },
    down() { },
};
