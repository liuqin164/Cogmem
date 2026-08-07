import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';

import { memoryEdgeId } from './MemoryBindingIdentity.js';

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
  supportSourceType?: string;
  supportSourceId?: string;
  operation?: 'append' | 'replace' | 'revision';
  createdAt?: number;
  updatedAt?: number;
}

export interface MemoryValidityInterval { validFrom: number; validTo: number | null; }

export function mergeMemoryValidityIntervals(intervals: readonly MemoryValidityInterval[]): MemoryValidityInterval & { disjoint: boolean } {
  const ranges = intervals.slice().sort((left, right) => left.validFrom - right.validFrom
    || (left.validTo ?? Number.POSITIVE_INFINITY) - (right.validTo ?? Number.POSITIVE_INFINITY));
  if (!ranges.length) throw new Error('memory_edge_validity_required');
  const components: MemoryValidityInterval[] = [];
  for (const range of ranges) {
    const current = components.at(-1);
    if (!current || (current.validTo !== null && range.validFrom > current.validTo)) {
      components.push({ ...range });
      continue;
    }
    current.validTo = current.validTo === null || range.validTo === null
      ? null
      : Math.max(current.validTo, range.validTo);
  }
  return { ...components.at(-1)!, disjoint: components.length > 1 };
}

interface MemoryEdgeSupportRow {
  support_id: string;
  edge_id: string;
  project_id: string | null;
  source_type: string;
  source_id: string;
  relation_type: string;
  target_type: string;
  target_id: string;
  support_source_type: string;
  support_source_id: string;
  confidence: number;
  base_weight: number;
  stability: number;
  activation: number;
  evidence_event_ids_json: string;
  status: string;
  valid_from: number;
  valid_to: number | null;
  version: number;
  source_authority: string;
  support_status: string;
  invalidated_at: number | null;
  created_at: number;
  updated_at: number;
}

interface MemoryEdgeProjectionRow {
  edge_id: string;
  project_id: string | null;
  source_type: string;
  source_id: string;
  relation_type: string;
  target_type: string;
  target_id: string;
  confidence: number;
  base_weight: number;
  stability: number;
  activation: number;
  evidence_event_ids_json: string;
  status: string;
  valid_from: number;
  valid_to: number | null;
  version: number;
  source_authority: string;
  created_at: number;
  updated_at: number;
}

export function mergeMemoryEdge(db: Database, input: MemoryEdgeMergeInput): string {
  const merge = () => mergeMemoryEdgeInTransaction(db, input);
  if (db.inTransaction) return merge();
  const transaction = db.transaction(merge) as (() => string) & { immediate?: () => string };
  return typeof transaction.immediate === 'function' ? transaction.immediate() : transaction();
}

function mergeMemoryEdgeInTransaction(db: Database, input: MemoryEdgeMergeInput): string {
  const updatedAt = input.updatedAt ?? input.createdAt ?? Date.now();
  const createdAt = input.createdAt ?? updatedAt;
  const edgeId = memoryEdgeId(input);
  const sourceAuthority = input.sourceAuthority ?? 'raw_evidence';
  const supportSourceType = input.supportSourceType ?? sourceAuthority;
  const supportSourceId = input.supportSourceId ?? edgeId;
  const supportId = memoryEdgeSupportId(edgeId, sourceAuthority, supportSourceType, supportSourceId);
  const evidence = unique(input.evidenceEventIds);
  const existing = db.prepare(`SELECT * FROM memory_edge_supports WHERE support_id=?`)
    .get(supportId) as MemoryEdgeSupportRow | null;
  const operation = input.operation ?? ((input.status && !['active', 'weak'].includes(input.status)) || input.validTo != null
    ? 'revision'
    : 'append');

  if (!existing) {
    db.prepare(`
      INSERT INTO memory_edge_supports(
        support_id,edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,
        support_source_type,support_source_id,confidence,base_weight,stability,activation,
        evidence_event_ids_json,status,valid_from,valid_to,version,source_authority,
        support_status,invalidated_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active',NULL,?,?)
    `).run(
      supportId, edgeId, input.projectId ?? null, input.sourceType, input.sourceId,
      input.relationType, input.targetType, input.targetId, supportSourceType, supportSourceId,
      clamp(input.confidence, 0, 1), clamp(input.baseWeight ?? 1, 0, 10),
      clamp(input.stability ?? 1, 0, 1), clamp(input.activation ?? 1, 0, 10),
      JSON.stringify(evidence), input.status ?? 'active', input.validFrom ?? createdAt,
      input.validTo ?? null, input.version ?? 1, sourceAuthority, createdAt, updatedAt,
    );
  } else {
    const append = operation === 'append';
    const replace = operation === 'replace';
    const next = {
      confidence: append ? Math.max(existing.confidence, clamp(input.confidence, 0, 1)) : clamp(input.confidence, 0, 1),
      baseWeight: append
        ? Math.max(existing.base_weight, clamp(input.baseWeight ?? 1, 0, 10))
        : clamp(input.baseWeight ?? (replace ? 1 : existing.base_weight), 0, 10),
      stability: append
        ? Math.max(existing.stability, clamp(input.stability ?? 1, 0, 1))
        : clamp(input.stability ?? (replace ? 1 : existing.stability), 0, 1),
      activation: append
        ? Math.max(existing.activation, clamp(input.activation ?? 1, 0, 10))
        : clamp(input.activation ?? (replace ? 1 : existing.activation), 0, 10),
      evidence: replace ? evidence : unique([...parseStringArray(existing.evidence_event_ids_json), ...evidence]),
      status: append && existing.support_status === 'active' ? existing.status : input.status ?? 'active',
      validFrom: replace ? input.validFrom ?? createdAt : Math.min(existing.valid_from, input.validFrom ?? createdAt),
      validTo: append ? existing.valid_to : input.validTo ?? null,
      createdAt: Math.min(existing.created_at, createdAt),
    };
    const semanticChanged = existing.confidence !== next.confidence
      || existing.base_weight !== next.baseWeight
      || existing.stability !== next.stability
      || existing.activation !== next.activation
      || existing.evidence_event_ids_json !== JSON.stringify(next.evidence)
      || existing.status !== next.status
      || existing.valid_from !== next.validFrom
      || existing.valid_to !== next.validTo;
    if (semanticChanged || existing.support_status !== 'active') db.prepare(`
      UPDATE memory_edge_supports SET
        confidence=?,base_weight=?,stability=?,activation=?,evidence_event_ids_json=?,status=?,
        valid_from=?,valid_to=?,version=version+?,support_status='active',invalidated_at=NULL,
        created_at=?,updated_at=?
      WHERE support_id=?
    `).run(
      next.confidence, next.baseWeight, next.stability, next.activation, JSON.stringify(next.evidence),
      next.status, next.validFrom, next.validTo, semanticChanged ? 1 : 0, next.createdAt,
      semanticChanged ? updatedAt : existing.updated_at, supportId,
    );
  }

  reduceMemoryEdge(db, edgeId, updatedAt);
  return edgeId;
}

export function invalidateMemoryEdgeSupportIds(
  db: Database,
  supportIds: readonly string[],
  now = Date.now(),
  reduce = true,
): string[] {
  if (!supportIds.length) return [];
  const select = db.prepare(`SELECT edge_id FROM memory_edge_supports WHERE support_id=? AND support_status='active'`);
  const update = db.prepare(`UPDATE memory_edge_supports SET support_status='invalidated',invalidated_at=? WHERE support_id=? AND support_status='active'`);
  const edgeIds = new Set<string>();
  for (const supportId of new Set(supportIds)) {
    const row = select.get(supportId) as { edge_id: string } | null;
    if (!row) continue;
    update.run(now, supportId);
    edgeIds.add(row.edge_id);
  }
  if (reduce) reduceMemoryEdges(db, edgeIds, now);
  return [...edgeIds];
}

export function reduceMemoryEdges(db: Database, edgeIds: Iterable<string>, now = Date.now()): void {
  for (const edgeId of new Set(edgeIds)) reduceMemoryEdge(db, edgeId, now);
}

export function reduceMemoryEdge(db: Database, edgeId: string, now = Date.now()): void {
  const supports = db.prepare(`
    SELECT * FROM memory_edge_supports
    WHERE edge_id=? AND support_status='active'
    ORDER BY updated_at DESC,support_id ASC
  `).all(edgeId) as MemoryEdgeSupportRow[];
  if (!supports.length) {
    db.prepare(`DELETE FROM memory_edges WHERE edge_id=?`).run(edgeId);
    return;
  }

  const highestRank = Math.max(...supports.map((support) => authorityRank(support.source_authority)));
  const authoritative = supports.filter((support) => authorityRank(support.source_authority) === highestRank);
  const winner = authoritative[0]!;
  const validity = mergeMemoryValidityIntervals(authoritative.map((support) => ({
    validFrom: support.valid_from,
    validTo: support.valid_to,
  })));
  const evidence = unique(supports
    .slice()
    .sort((left, right) => left.created_at - right.created_at
      || left.support_source_type.localeCompare(right.support_source_type)
      || left.support_source_id.localeCompare(right.support_source_id)
      || authorityRank(right.source_authority) - authorityRank(left.source_authority)
      || left.support_id.localeCompare(right.support_id))
    .flatMap((support) => parseStringArray(support.evidence_event_ids_json)));
  const desired = {
    projectId: winner.project_id,
    sourceType: winner.source_type,
    sourceId: winner.source_id,
    relationType: winner.relation_type,
    targetType: winner.target_type,
    targetId: winner.target_id,
    confidence: Math.max(...authoritative.map((support) => support.confidence)),
    baseWeight: Math.max(...authoritative.map((support) => support.base_weight)),
    stability: Math.max(...authoritative.map((support) => support.stability)),
    activation: Math.max(...authoritative.map((support) => support.activation)),
    evidenceJson: JSON.stringify(evidence),
    status: validity.disjoint || authoritative.some((support) => support.status === 'needs_confirmation') ? 'needs_confirmation' : winner.status,
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    sourceAuthority: winner.source_authority,
    createdAt: Math.min(...supports.map((support) => support.created_at)),
  };
  const current = db.prepare(`SELECT * FROM memory_edges WHERE edge_id=?`).get(edgeId) as MemoryEdgeProjectionRow | null;
  if (current && projectionMatches(current, desired)) return;
  db.prepare(`
    INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,
      confidence,base_weight,stability,activation,evidence_event_ids_json,status,
      valid_from,valid_to,version,source_authority,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(edge_id) DO UPDATE SET
      project_id=excluded.project_id,source_type=excluded.source_type,source_id=excluded.source_id,
      relation_type=excluded.relation_type,target_type=excluded.target_type,target_id=excluded.target_id,
      confidence=excluded.confidence,base_weight=excluded.base_weight,stability=excluded.stability,
      activation=excluded.activation,evidence_event_ids_json=excluded.evidence_event_ids_json,
      status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,
      version=memory_edges.version+1,source_authority=excluded.source_authority,
      created_at=excluded.created_at,updated_at=excluded.updated_at
  `).run(
    edgeId, desired.projectId, desired.sourceType, desired.sourceId, desired.relationType,
    desired.targetType, desired.targetId, desired.confidence, desired.baseWeight, desired.stability,
    desired.activation, desired.evidenceJson, desired.status, desired.validFrom, desired.validTo,
    current ? current.version + 1 : Math.max(...supports.map((support) => support.version)),
    desired.sourceAuthority, desired.createdAt, now,
  );
}

function projectionMatches(current: MemoryEdgeProjectionRow, desired: {
  projectId: string | null;
  sourceType: string;
  sourceId: string;
  relationType: string;
  targetType: string;
  targetId: string;
  confidence: number;
  baseWeight: number;
  stability: number;
  activation: number;
  evidenceJson: string;
  status: string;
  validFrom: number;
  validTo: number | null;
  sourceAuthority: string;
  createdAt: number;
}): boolean {
  return current.project_id === desired.projectId
    && current.source_type === desired.sourceType
    && current.source_id === desired.sourceId
    && current.relation_type === desired.relationType
    && current.target_type === desired.targetType
    && current.target_id === desired.targetId
    && current.confidence === desired.confidence
    && current.base_weight === desired.baseWeight
    && current.stability === desired.stability
    && current.activation === desired.activation
    && current.evidence_event_ids_json === desired.evidenceJson
    && current.status === desired.status
    && current.valid_from === desired.validFrom
    && current.valid_to === desired.validTo
    && current.source_authority === desired.sourceAuthority
    && current.created_at === desired.createdAt;
}

function memoryEdgeSupportId(edgeId: string, authority: string, sourceType: string, sourceId: string): string {
  return `edge-support-${createHash('sha256').update(`${edgeId}\0${authority}\0${sourceType}\0${sourceId}`).digest('hex').slice(0, 32)}`;
}

function authorityRank(value: string): number {
  switch (value) {
    case 'raw_evidence': return 4;
    case 'governed_projection': return 3;
    case 'memory_frame_projector': return 2;
    case 'atlas_curator': return 1;
    default: return 0;
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item)) : [];
  } catch {
    return [];
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
