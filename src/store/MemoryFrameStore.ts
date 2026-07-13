import { createHash, randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import { validateMemoryFrame } from '../semantic/MemoryFrameValidator.js';
import type { MemoryFrameStatus, MemoryFrameV1 } from '../semantic/MemoryFrameTypes.js';

export interface MemoryFrameSaveInput { frame: MemoryFrameV1; sourceFingerprint: string; status?: MemoryFrameStatus; publishStatus?: 'active' | 'needs_confirmation'; now?: number; }

export class MemoryFrameStore {
  constructor(readonly db: Database) {}

  save(input: MemoryFrameSaveInput): MemoryFrameV1 {
    const requestedStatus = input.status ?? input.frame.status ?? 'staged';
    const validation = validateMemoryFrame(input.frame, { allowEmptyEvidence: requestedStatus !== 'active' && input.frame.sourceAuthority === 'deterministic_fallback' });
    if (!validation.valid) throw new Error(`invalid_memory_frame:${validation.errors.join(',')}`);
    const frame = input.frame;
    const now = input.now ?? Date.now();
    const status: MemoryFrameStatus = 'staged';
    const publishStatus = input.publishStatus ?? frame.publishStatus ?? (frame.needsReview ? 'needs_confirmation' : 'active');
    const existing = this.db.prepare(`SELECT frame_id,status FROM memory_frames WHERE episode_id=? AND source_fingerprint=? AND processor_prompt_version=?`).get(frame.episodeId, input.sourceFingerprint, frame.processor.promptVersion) as { frame_id?: string; status?: MemoryFrameStatus } | null;
    const storedFrameId = existing && existing.status === 'staged' ? existing.frame_id! : (existing ? `${frame.frameId}:${randomUUID()}` : frame.frameId);
    const storedFingerprint = existing && existing.status === 'staged' ? input.sourceFingerprint : (storedFrameId === frame.frameId ? input.sourceFingerprint : `${input.sourceFingerprint}:${storedFrameId}`);
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memory_frames (
          frame_id, project_id, episode_id, schema_version, source_fingerprint, processor_prompt_version,
          title, summary, episode_kind, confidence, evidence_event_ids_json, processor_json, status,
          source_authority, semantic_completeness, needs_review, created_at, updated_at,
          primary_language, temporal_references_json, state_transitions_json, publish_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_id, source_fingerprint, processor_prompt_version) DO UPDATE SET
          frame_id=excluded.frame_id, title=excluded.title, summary=excluded.summary,
          episode_kind=excluded.episode_kind, confidence=excluded.confidence,
          evidence_event_ids_json=excluded.evidence_event_ids_json, processor_json=excluded.processor_json,
          status=excluded.status, source_authority=excluded.source_authority,
          semantic_completeness=excluded.semantic_completeness, needs_review=excluded.needs_review, updated_at=excluded.updated_at,
          primary_language=excluded.primary_language, temporal_references_json=excluded.temporal_references_json,
          state_transitions_json=excluded.state_transitions_json, publish_status=excluded.publish_status
      `).run(storedFrameId, frame.projectId, frame.episodeId, frame.schemaVersion, storedFingerprint,
        frame.processor.promptVersion, frame.title, frame.summary, frame.episodeKind, frame.confidence,
        JSON.stringify(frame.evidenceEventIds), JSON.stringify(frame.processor), status,
        frame.sourceAuthority ?? 'processor', frame.semanticCompleteness ?? 'full', frame.needsReview ? 1 : 0, now, now,
        frame.primaryLanguage ?? null, JSON.stringify(frame.temporalReferences), JSON.stringify(frame.stateTransitions), publishStatus);
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
    this.markDirty(frame.projectId, now);
    return { ...frame, frameId: storedFrameId, status, publishStatus };
  }

  get(frameId: string): MemoryFrameV1 | null {
    const row = this.db.prepare(`SELECT * FROM memory_frames WHERE frame_id=?`).get(frameId) as Record<string, unknown> | null;
    return row ? this.read(row) : null;
  }

  getByEpisode(projectId: string, episodeId: string, statuses: MemoryFrameStatus[] = ['active', 'needs_confirmation']): MemoryFrameV1 | null {
    const placeholders = statuses.map(() => '?').join(',');
    const row = this.db.prepare(`SELECT frame_id FROM memory_frames WHERE project_id=? AND episode_id=? AND status IN (${placeholders}) ORDER BY updated_at DESC, frame_id DESC LIMIT 1`).get(projectId, episodeId, ...statuses) as { frame_id?: string } | null;
    return row?.frame_id ? this.get(row.frame_id) : null;
  }

  list(projectId: string, options: { statuses?: MemoryFrameStatus[]; limit?: number; offset?: number } = {}): MemoryFrameV1[] {
    const statuses = options.statuses ?? ['active', 'needs_confirmation'];
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM memory_frames WHERE project_id=? AND status IN (${placeholders}) ORDER BY updated_at DESC, frame_id DESC LIMIT ? OFFSET ?`).all(projectId, ...statuses, Math.max(1, Math.min(options.limit ?? 100, 1000)), Math.max(0, options.offset ?? 0)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.read(row));
  }

  publish(frameId: string, from: MemoryFrameStatus, to?: MemoryFrameStatus, now = Date.now()): boolean {
    const row = this.db.prepare(`SELECT project_id, episode_id, publish_status FROM memory_frames WHERE frame_id=?`).get(frameId) as { project_id: string; episode_id: string; publish_status?: MemoryFrameStatus } | null;
    if (!row) return false;
    const next = to ?? row.publish_status ?? 'active';
    if (next === 'active') {
      const review = this.db.prepare(`SELECT needs_review FROM memory_frames WHERE frame_id=?`).get(frameId) as { needs_review?: number } | null;
      if (review?.needs_review) return false;
    }
    const changed = Number(this.db.prepare(`UPDATE memory_frames SET status=?, updated_at=? WHERE frame_id=? AND status=?`).run(next, now, frameId, from).changes ?? 0) === 1;
    if (changed) { this.db.prepare(`UPDATE memory_frames SET status='superseded', updated_at=? WHERE project_id=? AND episode_id=? AND frame_id<>? AND status IN ('active','needs_confirmation')`).run(now, row.project_id, row.episode_id, frameId); this.markDirty(row.project_id!, now); }
    return changed;
  }

  publishStaged(frameIds: string[], now = Date.now()): void { for (const id of frameIds) if (!this.publish(id, 'staged', undefined, now)) throw new Error(`memory_frame_publish_conflict:${id}`); }
  failStaged(frameIds: string[], now = Date.now()): void { for (const id of frameIds) this.db.prepare(`UPDATE memory_frames SET status='failed', updated_at=? WHERE frame_id=? AND status='staged'`).run(now, id); }
  failStagedForEpisode(episodeId: string, now = Date.now()): void { this.db.prepare(`UPDATE memory_frames SET status='failed', updated_at=? WHERE episode_id=? AND status='staged'`).run(now, episodeId); }
  failStagedOlderThan(cutoff: number, now = Date.now()): number { return Number(this.db.prepare(`UPDATE memory_frames SET status='failed', updated_at=? WHERE status='staged' AND updated_at<?`).run(now, cutoff).changes ?? 0); }
  supersedeEpisodes(episodeIds: string[], now = Date.now()): number {
    let changed = 0; for (const id of episodeIds) {
      changed += Number(this.db.prepare(`UPDATE memory_frames SET status='superseded', updated_at=? WHERE episode_id=? AND status IN ('active','needs_confirmation','staged')`).run(now, id).changes ?? 0);
      try { this.db.prepare(`UPDATE memory_atlas_supports SET status='invalidated', invalidated_at=? WHERE source_type='frame' AND source_episode_id=? AND status='active'`).run(now, id); } catch { /* pre-0033 compatibility */ }
    }
    if (changed) for (const id of episodeIds) { const row = this.db.prepare(`SELECT project_id FROM memory_frames WHERE episode_id=? LIMIT 1`).get(id) as { project_id?: string } | null; if (row?.project_id) this.markDirty(row.project_id, now); }
    return changed;
  }

  deleteByProject(projectId: string): number { return Number(this.db.prepare(`DELETE FROM memory_frames WHERE project_id=?`).run(projectId).changes ?? 0); }

  private markDirty(projectId: string, now: number): void {
    try { this.db.prepare(`INSERT INTO memory_atlas_projection_state(project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json) VALUES(?, 'memory_atlas.v2', NULL, 'dirty', ?, NULL, ?) ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty', cursor_value=NULL, last_error=NULL, metadata_json=excluded.metadata_json`).run(projectId, now, JSON.stringify({ dirtyBecause: 'memory_frame_changed' })); } catch { /* bootstrap may precede Atlas state */ }
  }

  private read(row: Record<string, unknown>): MemoryFrameV1 {
    const frameId = String(row.frame_id);
    const nodes = (this.db.prepare(`SELECT * FROM memory_frame_nodes WHERE frame_id=? ORDER BY frame_node_id`).all(frameId) as Array<Record<string, unknown>>).map((item) => ({
      frameNodeId: String(item.frame_node_id).startsWith(`${frameId}:`) ? String(item.frame_node_id).slice(frameId.length + 1) : String(item.frame_node_id),
      dimension: item.dimension, label: item.label, aliases: parseJsonArray(item.aliases_json),
      description: item.description ?? undefined, confidence: Number(item.confidence), evidenceEventIds: parseJsonArray(item.evidence_event_ids_json),
      canonicalHint: item.canonical_hint_json ? parseJsonObject(item.canonical_hint_json) : undefined,
    }));
    const relations = (this.db.prepare(`SELECT * FROM memory_frame_relations WHERE frame_id=? ORDER BY frame_relation_id`).all(frameId) as Array<Record<string, unknown>>).map((item) => ({
      sourceFrameNodeId: stripFrameNodeId(String(item.source_frame_node_id), frameId), relationType: item.relation_type,
      targetFrameNodeId: stripFrameNodeId(String(item.target_frame_node_id), frameId), confidence: Number(item.confidence),
      evidenceEventIds: parseJsonArray(item.evidence_event_ids_json), validFrom: item.valid_from == null ? undefined : Number(item.valid_from), validTo: item.valid_to == null ? undefined : Number(item.valid_to),
    }));
    const frame = {
      schemaVersion: row.schema_version,
      frameId: row.frame_id, projectId: row.project_id, episodeId: row.episode_id,
      title: row.title, summary: row.summary, episodeKind: row.episode_kind,
      nodes, relations, confidence: Number(row.confidence),
      evidenceEventIds: parseJsonArray(row.evidence_event_ids_json),
      processor: parseJsonObject(row.processor_json), status: row.status, publishStatus: row.publish_status,
      primaryLanguage: row.primary_language ?? undefined,
      temporalReferences: parseJsonArray(row.temporal_references_json),
      stateTransitions: parseJsonArray(row.state_transitions_json),
      sourceAuthority: row.source_authority, semanticCompleteness: row.semantic_completeness, needsReview: Boolean(row.needs_review),
    } as unknown as MemoryFrameV1;
    return frame;
  }
}

function parseJsonArray(value: unknown): unknown[] {
  try { const parsed = JSON.parse(String(value ?? '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try { const parsed = JSON.parse(String(value ?? '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function stripFrameNodeId(value: string, frameId: string): string {
  return value.startsWith(`${frameId}:`) ? value.slice(frameId.length + 1) : value;
}

export function frameSourceFingerprint(eventIds: string[], episodeId: string): string {
  return createHash('sha256').update(`${episodeId}\u0000${eventIds.join('\u0000')}`).digest('hex');
}
