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
function hash(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
