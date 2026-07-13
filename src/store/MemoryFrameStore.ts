import { createHash, randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import { validateMemoryFrame } from '../semantic/MemoryFrameValidator.js';
import type { MemoryFrameStatus, MemoryFrameV1 } from '../semantic/MemoryFrameTypes.js';

export interface MemoryFrameSaveInput { frame: MemoryFrameV1; sourceFingerprint: string; status?: MemoryFrameStatus; now?: number; }

export class MemoryFrameStore {
  constructor(readonly db: Database) {}

  save(input: MemoryFrameSaveInput): MemoryFrameV1 {
    const validation = validateMemoryFrame(input.frame);
    if (!validation.valid) throw new Error(`invalid_memory_frame:${validation.errors.join(',')}`);
    const frame = input.frame;
    const now = input.now ?? Date.now();
    const status = input.status ?? frame.status ?? 'staged';
    const existing = this.db.prepare(`SELECT frame_id FROM memory_frames WHERE episode_id=? AND source_fingerprint=? AND processor_prompt_version=?`).get(frame.episodeId, input.sourceFingerprint, frame.processor.promptVersion) as { frame_id?: string } | null;
    const storedFrameId = existing?.frame_id ?? frame.frameId;
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memory_frames (
          frame_id, project_id, episode_id, schema_version, source_fingerprint, processor_prompt_version,
          title, summary, episode_kind, confidence, evidence_event_ids_json, processor_json, status,
          source_authority, semantic_completeness, needs_review, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_id, source_fingerprint, processor_prompt_version) DO UPDATE SET
          frame_id=excluded.frame_id, title=excluded.title, summary=excluded.summary,
          episode_kind=excluded.episode_kind, confidence=excluded.confidence,
          evidence_event_ids_json=excluded.evidence_event_ids_json, processor_json=excluded.processor_json,
          status=excluded.status, source_authority=excluded.source_authority,
          semantic_completeness=excluded.semantic_completeness, needs_review=excluded.needs_review, updated_at=excluded.updated_at
      `).run(storedFrameId, frame.projectId, frame.episodeId, frame.schemaVersion, input.sourceFingerprint,
        frame.processor.promptVersion, frame.title, frame.summary, frame.episodeKind, frame.confidence,
        JSON.stringify(frame.evidenceEventIds), JSON.stringify(frame.processor), status,
        frame.sourceAuthority ?? 'processor', frame.semanticCompleteness ?? 'full', frame.needsReview ? 1 : 0, now, now);
      this.db.prepare(`DELETE FROM memory_frame_nodes WHERE frame_id=?`).run(storedFrameId);
      this.db.prepare(`DELETE FROM memory_frame_relations WHERE frame_id=?`).run(storedFrameId);
      const node = this.db.prepare(`INSERT INTO memory_frame_nodes (frame_node_id,frame_id,dimension,label,aliases_json,description,confidence,evidence_event_ids_json,canonical_hint_json) VALUES (?,?,?,?,?,?,?,?,?)`);
      const nodeIds = new Map(frame.nodes.map((item) => [item.frameNodeId, `${storedFrameId}:${item.frameNodeId}`]));
      for (const item of frame.nodes) node.run(nodeIds.get(item.frameNodeId)!, storedFrameId, item.dimension, item.label, JSON.stringify(item.aliases ?? []), item.description ?? null, item.confidence, JSON.stringify(item.evidenceEventIds), item.canonicalHint ? JSON.stringify(item.canonicalHint) : null);
      const relation = this.db.prepare(`INSERT INTO memory_frame_relations (frame_relation_id,frame_id,source_frame_node_id,relation_type,target_frame_node_id,confidence,evidence_event_ids_json,valid_from,valid_to) VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const item of frame.relations) {
        const sourceId = nodeIds.get(item.sourceFrameNodeId); const targetId = nodeIds.get(item.targetFrameNodeId);
        if (!sourceId || !targetId) throw new Error('memory_frame_relation_node_missing');
        relation.run(randomUUID(), storedFrameId, sourceId, item.relationType, targetId, item.confidence, JSON.stringify(item.evidenceEventIds), item.validFrom ?? null, item.validTo ?? null);
      }
    })();
    return { ...frame, frameId: storedFrameId, status };
  }

  get(frameId: string): MemoryFrameV1 | null {
    const row = this.db.prepare(`SELECT * FROM memory_frames WHERE frame_id=?`).get(frameId) as Record<string, unknown> | null;
    return row ? this.read(row) : null;
  }

  list(projectId: string, options: { statuses?: MemoryFrameStatus[]; limit?: number } = {}): MemoryFrameV1[] {
    const statuses = options.statuses ?? ['active', 'needs_confirmation'];
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM memory_frames WHERE project_id=? AND status IN (${placeholders}) ORDER BY updated_at DESC, frame_id DESC LIMIT ?`).all(projectId, ...statuses, Math.max(1, Math.min(options.limit ?? 100, 1000))) as Array<Record<string, unknown>>;
    return rows.map((row) => this.read(row));
  }

  publish(frameId: string, from: MemoryFrameStatus, to: MemoryFrameStatus, now = Date.now()): boolean {
    return Number(this.db.prepare(`UPDATE memory_frames SET status=?, updated_at=? WHERE frame_id=? AND status=?`).run(to, now, frameId, from).changes ?? 0) === 1;
  }

  private read(row: Record<string, unknown>): MemoryFrameV1 {
    const frameId = String(row.frame_id);
    const nodes = (this.db.prepare(`SELECT * FROM memory_frame_nodes WHERE frame_id=? ORDER BY frame_node_id`).all(frameId) as Array<Record<string, unknown>>).map((item) => ({
      frameNodeId: String(item.frame_node_id).startsWith(`${frameId}:`) ? String(item.frame_node_id).slice(frameId.length + 1) : String(item.frame_node_id),
      dimension: item.dimension, label: item.label, aliases: JSON.parse(String(item.aliases_json ?? '[]')),
      description: item.description ?? undefined, confidence: Number(item.confidence), evidenceEventIds: JSON.parse(String(item.evidence_event_ids_json ?? '[]')),
      canonicalHint: item.canonical_hint_json ? JSON.parse(String(item.canonical_hint_json)) : undefined,
    }));
    const relations = (this.db.prepare(`SELECT * FROM memory_frame_relations WHERE frame_id=? ORDER BY frame_relation_id`).all(frameId) as Array<Record<string, unknown>>).map((item) => ({
      sourceFrameNodeId: stripFrameNodeId(String(item.source_frame_node_id), frameId), relationType: item.relation_type,
      targetFrameNodeId: stripFrameNodeId(String(item.target_frame_node_id), frameId), confidence: Number(item.confidence),
      evidenceEventIds: JSON.parse(String(item.evidence_event_ids_json ?? '[]')), validFrom: item.valid_from == null ? undefined : Number(item.valid_from), validTo: item.valid_to == null ? undefined : Number(item.valid_to),
    }));
    const frame = {
      schemaVersion: row.schema_version,
      frameId: row.frame_id, projectId: row.project_id, episodeId: row.episode_id,
      title: row.title, summary: row.summary, episodeKind: row.episode_kind,
      nodes, relations, temporalReferences: [], stateTransitions: [], confidence: Number(row.confidence),
      evidenceEventIds: JSON.parse(String(row.evidence_event_ids_json ?? '[]')),
      processor: JSON.parse(String(row.processor_json ?? '{}')), status: row.status,
      sourceAuthority: row.source_authority, semanticCompleteness: row.semantic_completeness, needsReview: Boolean(row.needs_review),
    } as unknown as MemoryFrameV1;
    return frame;
  }
}

function stripFrameNodeId(value: string, frameId: string): string {
  return value.startsWith(`${frameId}:`) ? value.slice(frameId.length + 1) : value;
}

export function frameSourceFingerprint(eventIds: string[], episodeId: string): string {
  return createHash('sha256').update(`${episodeId}\u0000${eventIds.join('\u0000')}`).digest('hex');
}
