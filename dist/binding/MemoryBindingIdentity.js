import { createHash } from 'node:crypto';
export function memoryEntityId(projectId, entityType, identity) {
    return `entity-${hash([projectId ?? '', entityType, identity.toLowerCase()].join('\0'))}`;
}
export function memoryEdgeId(input) {
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
];
export function preferredMemoryEdgeAuthority(left, right) {
    return EDGE_AUTHORITY_PRIORITY.indexOf(left)
        >= EDGE_AUTHORITY_PRIORITY.indexOf(right) ? left : right;
}
export function preferredMemoryEdgeAuthoritySql(left, right) {
    return `CASE WHEN ${memoryEdgeAuthorityRankSql(left)} >= ${memoryEdgeAuthorityRankSql(right)} THEN ${left} ELSE ${right} END`;
}
export function memoryEdgeAuthorityRankSql(value) {
    return `CASE ${value} WHEN 'raw_evidence' THEN 4 WHEN 'governed_projection' THEN 3
    WHEN 'memory_frame_projector' THEN 2 WHEN 'atlas_curator' THEN 1 ELSE 0 END`;
}
function hash(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
