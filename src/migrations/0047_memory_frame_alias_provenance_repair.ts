import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

const normalizeAlias = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/\s+/gu, ' ');
const tableExists = (db: Database, name: string): boolean => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
const array = (value: unknown): string[] => { try { const parsed = JSON.parse(String(value ?? '[]')); return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []; } catch { return []; } };

export const migration_0047: Migration = {
  version: '0047',
  description: 'rebuild frame alias provenance from exact frame nodes',
  up(db: Database) {
    if (!tableExists(db, 'memory_frames') || !tableExists(db, 'memory_atlas_alias_supports')) return;
    db.prepare(`DELETE FROM memory_atlas_alias_supports WHERE source_frame_id IS NOT NULL`).run();
    const frames = db.prepare(`SELECT frame_id,project_id,episode_id,created_at FROM memory_frames WHERE status='active'`).all() as Array<{ frame_id: string; project_id: string; episode_id: string; created_at: number }>;
    const insert = db.prepare(`INSERT INTO memory_atlas_alias_supports (support_id,alias_id,project_id,node_id,source_frame_id,source_episode_id,evidence_event_ids_json,status,created_at) VALUES (?,?,?,?,?,?,?,'active',?) ON CONFLICT(alias_id,source_frame_id) DO UPDATE SET project_id=excluded.project_id,node_id=excluded.node_id,source_episode_id=excluded.source_episode_id,evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',invalidated_at=NULL`);
    for (const frame of frames) {
      const nodes = db.prepare(`SELECT frame_node_id,dimension,label,aliases_json,canonical_hint_json,evidence_event_ids_json FROM memory_frame_nodes WHERE frame_id=?`).all(frame.frame_id) as Array<{ frame_node_id: string; dimension: string; label: string; aliases_json?: string; canonical_hint_json?: string; evidence_event_ids_json?: string }>;
      for (const node of nodes) {
        let hintLabel: string | undefined;
        try { const hint = JSON.parse(String(node.canonical_hint_json ?? '{}')); if (typeof hint.canonicalLabel === 'string') hintLabel = hint.canonicalLabel; } catch { /* invalid hint is handled by frame validation */ }
        const labels = [...new Set([node.label, ...array(node.aliases_json), ...(hintLabel ? [hintLabel] : [])].map(normalizeAlias).filter(Boolean))];
        for (const label of labels) {
          const aliases = db.prepare(`SELECT alias_id,node_id,project_id FROM memory_atlas_aliases WHERE project_id=? AND dimension=? AND normalized_alias=? AND status='active'`).all(frame.project_id, node.dimension, label) as Array<{ alias_id: string; node_id: string; project_id: string }>;
          const matching = aliases.filter((alias) => alias.project_id === frame.project_id && db.prepare(`SELECT 1 FROM memory_atlas_supports WHERE project_id=? AND node_id=? AND source_frame_id=? AND source_type='frame' AND status='active'`).get(frame.project_id, alias.node_id, frame.frame_id));
          if (matching.length === 1) insert.run(`${matching[0]!.alias_id}:${frame.frame_id}`, matching[0]!.alias_id, frame.project_id, matching[0]!.node_id, frame.frame_id, frame.episode_id, node.evidence_event_ids_json ?? '[]', frame.created_at);
          if (matching.length > 1 && tableExists(db, 'memory_atlas_alias_ambiguities')) db.prepare(`INSERT INTO memory_atlas_alias_ambiguities(candidate_id,project_id,dimension,normalized_alias,node_ids_json,source_frame_id,status,created_at) VALUES(?,?,?,?,?,?,'pending',?) ON CONFLICT(candidate_id) DO NOTHING`).run(`${frame.frame_id}:${node.frame_node_id}:${label}`, frame.project_id, node.dimension, label, JSON.stringify(matching.map((row) => row.node_id).sort()), frame.frame_id, frame.created_at);
        }
      }
    }
    db.exec(`
      UPDATE memory_atlas_aliases SET status='invalidated'
      WHERE source_frame_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active' AND f.status='active');
      CREATE TABLE IF NOT EXISTS _memory_frame_integrity_markers (marker TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      INSERT OR REPLACE INTO _memory_frame_integrity_markers(marker,created_at) VALUES ('memory_frame_integrity_0047',CAST(strftime('%s','now') AS INTEGER)*1000);
    `);
    if (db.prepare(`SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.status='active' AND f.status<>'active' LIMIT 1`).get()) throw new Error('memory_frame_alias_support_inactive');
  },
  down() {},
};
