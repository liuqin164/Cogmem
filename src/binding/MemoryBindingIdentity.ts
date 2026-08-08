import { createHash } from 'node:crypto';

export function memoryEntityId(
  projectId: string | undefined,
  entityType: string,
  identity: string,
): string {
  return `entity-${hash([projectId ?? '', entityType, identity.toLowerCase()].join('\0'))}`;
}

export function memoryEdgeId(input: {
  projectId?: string;
  sourceType: string;
  sourceId: string;
  relationType: string;
  targetType: string;
  targetId: string;
}): string {
  return `edge-${hash([
    input.projectId ?? '',
    input.sourceType,
    input.sourceId,
    input.relationType,
    input.targetType,
    input.targetId,
  ].join('\0'))}`;
}

const EDGE_AUTHORITY_PRIORITY = [
  'model_candidate',
  'atlas_curator',
  'memory_frame_projector',
  'governed_projection',
  'raw_evidence',
] as const;

export function preferredMemoryEdgeAuthority(left: string, right: string): string {
  return EDGE_AUTHORITY_PRIORITY.indexOf(left as typeof EDGE_AUTHORITY_PRIORITY[number])
    >= EDGE_AUTHORITY_PRIORITY.indexOf(right as typeof EDGE_AUTHORITY_PRIORITY[number]) ? left : right;
}

export function preferredMemoryEdgeAuthoritySql(left: string, right: string): string {
  return `CASE WHEN ${memoryEdgeAuthorityRankSql(left)} >= ${memoryEdgeAuthorityRankSql(right)} THEN ${left} ELSE ${right} END`;
}

export function memoryEdgeAuthorityRankSql(value: string): string {
  return `CASE ${value} WHEN 'raw_evidence' THEN 4 WHEN 'governed_projection' THEN 3
    WHEN 'memory_frame_projector' THEN 2 WHEN 'atlas_curator' THEN 1 ELSE 0 END`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
