import type Database from 'bun:sqlite';

import { memoryEdgeAuthorityRankSql, memoryEdgeId } from './MemoryBindingIdentity.js';

export interface MemoryEdgeMergeInput {
  projectId?: string;
  sourceType: string;
  sourceId: string;
  relationType: string;
  targetType: string;
  targetId: string;
  confidence: number;
  baseWeight?: number;
  stability?: number;
  activation?: number;
  evidenceEventIds: string[];
  status?: string;
  validFrom?: number;
  validTo?: number | null;
  version?: number;
  sourceAuthority?: string;
  createdAt?: number;
  updatedAt?: number;
}

export function mergeMemoryEdge(db: Database, input: MemoryEdgeMergeInput): string {
  const updatedAt = input.updatedAt ?? input.createdAt ?? Date.now();
  const createdAt = input.createdAt ?? updatedAt;
  const edgeId = memoryEdgeId(input);
  const existingRank = memoryEdgeAuthorityRankSql('memory_edges.source_authority');
  const incomingRank = memoryEdgeAuthorityRankSql('excluded.source_authority');
  const incomingWins = `(${incomingRank}>${existingRank} OR (${incomingRank}=${existingRank} AND excluded.valid_from>=memory_edges.valid_from))`;
  db.prepare(`
    INSERT INTO memory_edges (
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,
      confidence,base_weight,stability,activation,evidence_event_ids_json,status,
      valid_from,valid_to,version,source_authority,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(edge_id) DO UPDATE SET
      confidence=CASE WHEN ${incomingWins} THEN excluded.confidence ELSE memory_edges.confidence END,
      base_weight=CASE WHEN ${incomingWins} THEN excluded.base_weight ELSE memory_edges.base_weight END,
      stability=CASE WHEN ${incomingWins} THEN excluded.stability ELSE memory_edges.stability END,
      activation=CASE WHEN ${incomingWins} THEN excluded.activation ELSE memory_edges.activation END,
      evidence_event_ids_json=(SELECT json_group_array(value) FROM (
        SELECT value,MIN(position) AS position FROM (
          SELECT value,CAST(key AS INTEGER) AS position FROM json_each(memory_edges.evidence_event_ids_json)
          UNION ALL
          SELECT value,1000000+CAST(key AS INTEGER) FROM json_each(excluded.evidence_event_ids_json)
        ) GROUP BY value ORDER BY position
      )),
      status=CASE WHEN ${incomingWins} THEN excluded.status ELSE memory_edges.status END,
      valid_from=CASE WHEN ${incomingWins} THEN excluded.valid_from ELSE memory_edges.valid_from END,
      valid_to=CASE WHEN ${incomingWins} THEN excluded.valid_to ELSE memory_edges.valid_to END,
      version=MAX(memory_edges.version,excluded.version)+1,
      source_authority=CASE WHEN ${incomingWins} THEN excluded.source_authority ELSE memory_edges.source_authority END,
      created_at=MIN(memory_edges.created_at,excluded.created_at),
      updated_at=MAX(memory_edges.updated_at,excluded.updated_at)
  `).run(
    edgeId,
    input.projectId ?? null,
    input.sourceType,
    input.sourceId,
    input.relationType,
    input.targetType,
    input.targetId,
    clamp(input.confidence, 0, 1),
    clamp(input.baseWeight ?? 1, 0, 10),
    clamp(input.stability ?? 1, 0, 1),
    clamp(input.activation ?? 1, 0, 10),
    JSON.stringify(Array.from(new Set(input.evidenceEventIds.filter(Boolean)))),
    input.status ?? 'active',
    input.validFrom ?? createdAt,
    input.validTo ?? null,
    input.version ?? 1,
    input.sourceAuthority ?? 'raw_evidence',
    createdAt,
    updatedAt,
  );
  return edgeId;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
