import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

const exists = (db: Database, name: string, type = 'table'): boolean => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type=? AND name=?`).get(type, name));
const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/\s+/gu, ' ');

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export const migration_0042: Migration = {
  version: '0042',
  description: 'repair revision chronology and validate frame alias provenance',
  up(db: Database) {
    if (!exists(db, 'memory_frames')) return;
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
      `);
      db.prepare(`DELETE FROM memory_atlas_alias_supports WHERE source_frame_id IS NOT NULL`).run();
      const frameRows = db.prepare(`SELECT frame_id,project_id,episode_id,created_at FROM memory_frames WHERE status='active'`).all() as Array<{ frame_id: string; project_id: string; episode_id: string; created_at: number }>;
      const nodeRows = (frameId: string) => db.prepare(`SELECT frame_id,dimension,label,aliases_json,canonical_hint_json,evidence_event_ids_json FROM memory_frame_nodes WHERE frame_id=?`).all(frameId);
      const aliasRows = (projectId: string, dimension: string, normalizedAlias: string) => db.prepare(`SELECT alias_id,project_id,node_id,normalized_alias,dimension FROM memory_atlas_aliases WHERE project_id=? AND dimension=? AND normalized_alias=?`).all(projectId, dimension, normalizedAlias);
      const insertSupport = db.prepare(`INSERT INTO memory_atlas_alias_supports (support_id,alias_id,project_id,node_id,source_frame_id,source_episode_id,evidence_event_ids_json,status,created_at) VALUES (?,?,?,?,?,?,?,'active',?) ON CONFLICT(alias_id,source_frame_id) DO UPDATE SET project_id=excluded.project_id,node_id=excluded.node_id,source_episode_id=excluded.source_episode_id,evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',invalidated_at=NULL`);
      for (const frame of frameRows) {
        for (const node of nodeRows(frame.frame_id) as Array<Record<string, unknown>>) {
          const hint = (() => { try { return JSON.parse(String(node.canonical_hint_json ?? '{}')) as { canonicalLabel?: string }; } catch { return {}; } })();
          const labels = [...new Set([String(node.label), ...jsonArray(node.aliases_json), ...(typeof hint.canonicalLabel === 'string' ? [hint.canonicalLabel] : [])].map(normalize).filter(Boolean))];
          const evidence = JSON.stringify(jsonArray(node.evidence_event_ids_json));
          for (const label of labels) {
            for (const alias of aliasRows(frame.project_id, String(node.dimension), label) as Array<{ alias_id: string; project_id: string; node_id: string }>) {
              if (alias.project_id !== frame.project_id) throw new Error('memory_frame_alias_cross_project');
              insertSupport.run(`${alias.alias_id}:${frame.frame_id}`, alias.alias_id, frame.project_id, alias.node_id, frame.frame_id, frame.episode_id, evidence, frame.created_at);
            }
          }
        }
      }
      db.exec(`
        UPDATE memory_atlas_aliases
        SET status='active',updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
        WHERE source_frame_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active' AND f.status='active');
        UPDATE memory_atlas_aliases
        SET status='invalidated',updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
        WHERE source_frame_id IS NOT NULL AND status='active'
          AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active' AND f.status='active');
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
  down() {},
};
