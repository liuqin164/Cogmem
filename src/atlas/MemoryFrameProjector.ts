import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { MemoryFrameStore } from '../store/MemoryFrameStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import type { MemoryFrameNode, MemoryFrameRelation, MemoryFrameV1 } from '../semantic/MemoryFrameTypes.js';

export interface MemoryFrameProjectionResult { frames: number; nodes: number; edges: number; needsReview: number; }

export class MemoryFrameProjector {
  constructor(private readonly db: Database, private readonly frameStore: MemoryFrameStore, private readonly atlasStore: MemoryAtlasStore) {}

  rebuild(projectId: string, now = Date.now()): MemoryFrameProjectionResult {
    const frames = this.frameStore.list(projectId, { statuses: ['active'], limit: 1000 });
    let nodes = 0; let edges = 0; let needsReview = 0;
    this.db.prepare(`DELETE FROM memory_edges WHERE project_id=? AND source_authority='memory_frame_projector'`).run(projectId);
    this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND json_extract(metadata_json, '$.projection')='memory_atlas.frame.v2'`).run(projectId);
    this.db.prepare(`UPDATE memory_atlas_supports SET status='invalidated', invalidated_at=? WHERE project_id=? AND source_type='frame' AND status='active'`).run(now, projectId);
    for (const frame of frames) {
        if (frame.needsReview) needsReview += 1;
        const nodeIds = new Map(frame.nodes.map((node) => [node.frameNodeId, this.nodeId(projectId, node)]));
        for (const node of frame.nodes) {
          const id = nodeIds.get(node.frameNodeId)!;
          this.atlasStore.upsertDocument({
            id, projectId, nodeType: node.dimension === 'episode' ? 'episode' : node.dimension,
            sourceId: id.slice(id.indexOf(':') + 1), label: node.label, summary: node.description,
            confidence: node.confidence, supportCount: 1, status: frame.needsReview ? 'needs_confirmation' : 'active',
            evidenceEventIds: node.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId, frameSchemaVersion: frame.schemaVersion }, updatedAt: now,
          });
          nodes += 1;
          this.upsertSupport(projectId, id, frame, node.evidenceEventIds, now);
        }
        for (const relation of frame.relations) {
          const source = nodeIds.get(relation.sourceFrameNodeId); const target = nodeIds.get(relation.targetFrameNodeId);
          if (!source || !target) continue;
          this.upsertEdge(projectId, source, target, relation, frame, now);
          edges += 1;
        }
    }
    return { frames: frames.length, nodes, edges, needsReview };
  }

  private nodeId(projectId: string, node: MemoryFrameNode): string {
    if (node.canonicalHint?.nodeId) return node.canonicalHint.nodeId;
    if (node.dimension === 'episode') return `episode:${node.label}`;
    if (node.dimension === 'project') return `project:${node.label}`;
    const key = `${projectId}\0${node.dimension}\0${node.label.normalize('NFKC').toLocaleLowerCase('und').trim()}`;
    return `${node.dimension}:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
  }

  private upsertSupport(projectId: string, nodeId: string, frame: MemoryFrameV1, evidenceEventIds: string[], now: number): void {
    const supportId = createHash('sha256').update(`${nodeId}\0frame\0${frame.frameId}`).digest('hex');
    this.db.prepare(`
      INSERT INTO memory_atlas_supports (support_id,project_id,node_id,source_type,source_id,source_episode_id,source_frame_id,evidence_event_ids_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(node_id,source_type,source_id) DO UPDATE SET evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',invalidated_at=NULL
    `).run(supportId, projectId, nodeId, 'frame', frame.frameId, frame.episodeId, frame.frameId, JSON.stringify(evidenceEventIds), 'active', now);
  }

  private upsertEdge(projectId: string, source: string, target: string, relation: MemoryFrameRelation, frame: MemoryFrameV1, now: number): void {
    const parsedSource = splitNodeId(source); const parsedTarget = splitNodeId(target);
    const edgeId = createHash('sha256').update(`${projectId}\0${source}\0${relation.relationType}\0${target}`).digest('hex');
    this.db.prepare(`
      INSERT INTO memory_edges (edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,base_weight,stability,activation,evidence_event_ids_json,status,valid_from,valid_to,version,source_authority,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(edge_id) DO UPDATE SET confidence=excluded.confidence,evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',updated_at=excluded.updated_at
    `).run(edgeId, projectId, parsedSource.type, parsedSource.id, relation.relationType, parsedTarget.type, parsedTarget.id,
      relation.confidence, 1, 0.85, 1, JSON.stringify(relation.evidenceEventIds), 'active', relation.validFrom ?? frame.processor.generatedAt, relation.validTo ?? null, 1, 'memory_frame_projector', now, now);
  }
}

function splitNodeId(value: string): { type: string; id: string } {
  const index = value.indexOf(':');
  return index < 0 ? { type: 'semantic', id: value } : { type: value.slice(0, index), id: value.slice(index + 1) };
}
