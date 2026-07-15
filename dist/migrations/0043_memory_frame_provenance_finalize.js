const tableExists = (db, name) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
/** Finalizes the 3.7.4 repair without changing any earlier migration. */
export const migration_0043 = {
    version: '0043',
    description: 'finalize frame publication and alias provenance invariants',
    up(db) {
        if (!tableExists(db, 'memory_frames'))
            return;
        db.exec(`
      UPDATE memory_frames
      SET status='needs_confirmation', publish_status='needs_confirmation', updated_at=updated_at
      WHERE status='active'
        AND (source_authority='deterministic_fallback' OR needs_review=1 OR publish_status='needs_confirmation');
    `);
        if (tableExists(db, 'memory_atlas_alias_supports') && tableExists(db, 'memory_atlas_aliases') && tableExists(db, 'memory_frame_nodes')) {
            db.prepare(`DELETE FROM memory_atlas_alias_supports WHERE source_frame_id IS NOT NULL`).run();
            const frames = db.prepare(`SELECT frame_id,project_id,episode_id,created_at FROM memory_frames WHERE status='active'`).all();
            const insert = db.prepare(`
        INSERT INTO memory_atlas_alias_supports
          (support_id,alias_id,project_id,node_id,source_frame_id,source_episode_id,evidence_event_ids_json,status,created_at)
        VALUES (?,?,?,?,?,?,?,'active',?)
        ON CONFLICT(alias_id,source_frame_id) DO UPDATE SET
          project_id=excluded.project_id,node_id=excluded.node_id,source_episode_id=excluded.source_episode_id,
          evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',invalidated_at=NULL
      `);
            for (const frame of frames) {
                const nodes = db.prepare(`SELECT dimension,label,aliases_json,evidence_event_ids_json FROM memory_frame_nodes WHERE frame_id=?`).all(frame.frame_id);
                for (const node of nodes) {
                    let aliases = [];
                    try {
                        const parsed = JSON.parse(String(node.aliases_json ?? '[]'));
                        if (Array.isArray(parsed))
                            aliases = parsed.filter((value) => typeof value === 'string');
                    }
                    catch {
                        aliases = [];
                    }
                    const labels = [...new Set([node.label, ...aliases].map((value) => value.normalize('NFKC').toLocaleLowerCase('und').trim()).filter(Boolean))];
                    for (const label of labels) {
                        const rows = db.prepare(`SELECT alias_id,project_id,node_id FROM memory_atlas_aliases WHERE project_id=? AND dimension=? AND normalized_alias=?`).all(frame.project_id, node.dimension, label);
                        for (const row of rows) {
                            if (row.project_id !== frame.project_id)
                                throw new Error('memory_frame_alias_cross_project');
                            insert.run(`${row.alias_id}:${frame.frame_id}`, row.alias_id, frame.project_id, row.node_id, frame.frame_id, frame.episode_id, node.evidence_event_ids_json ?? '[]', frame.created_at);
                        }
                    }
                }
            }
            db.exec(`
        UPDATE memory_atlas_aliases AS a
        SET status='active'
        WHERE a.source_frame_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM memory_atlas_alias_supports s
            JOIN memory_frames f ON f.frame_id=s.source_frame_id
            WHERE s.alias_id=a.alias_id AND s.status='active' AND f.status='active'
          );
        UPDATE memory_atlas_aliases AS a
        SET status='invalidated'
        WHERE a.source_frame_id IS NOT NULL AND a.status='active'
          AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=a.alias_id AND s.status='active' AND f.status='active');
      `);
            if (db.prepare(`SELECT 1 FROM memory_atlas_alias_supports s LEFT JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.status='active' AND (f.frame_id IS NULL OR f.status<>'active') LIMIT 1`).get())
                throw new Error('memory_frame_alias_support_inactive');
            if (db.prepare(`SELECT 1 FROM memory_atlas_alias_supports s LEFT JOIN memory_atlas_aliases a ON a.alias_id=s.alias_id WHERE s.status='active' AND (a.alias_id IS NULL OR a.project_id<>s.project_id OR a.node_id<>s.node_id) LIMIT 1`).get())
                throw new Error('memory_frame_alias_support_orphan');
        }
        db.exec(`
      CREATE TABLE IF NOT EXISTS _memory_frame_integrity_markers (marker TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      INSERT OR REPLACE INTO _memory_frame_integrity_markers(marker,created_at) VALUES ('memory_frame_integrity_0043',CAST(strftime('%s','now') AS INTEGER)*1000);
    `);
    },
    down() { },
};
