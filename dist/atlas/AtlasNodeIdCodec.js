const PROJECT_SCOPED = new Set(['topic', 'time', 'issue', 'session', 'thread', 'memoryKind', 'actionKind']);
export function encodeAtlasNodeId(type, id, projectId) {
    if (type === 'entity' && id.startsWith('facet:'))
        return `entity:${projectId}:${id}`;
    return PROJECT_SCOPED.has(type) ? `${type}:${projectId}:${id}` : `${type}:${id}`;
}
export function decodeAtlasNodeId(nodeId, projectId) {
    for (const type of PROJECT_SCOPED) {
        const prefix = `${type}:${projectId}:`;
        if (nodeId.startsWith(prefix))
            return { type, id: nodeId.slice(prefix.length) };
    }
    const entityPrefix = `entity:${projectId}:`;
    if (nodeId.startsWith(entityPrefix))
        return { type: 'entity', id: nodeId.slice(entityPrefix.length) };
    const separator = nodeId.indexOf(':');
    if (separator <= 0 || separator === nodeId.length - 1)
        return null;
    return { type: nodeId.slice(0, separator), id: nodeId.slice(separator + 1) };
}
export function toAtlasNodeEndpoint(nodeId, projectId) {
    const decoded = decodeAtlasNodeId(nodeId, projectId);
    return decoded ? { ...decoded, nodeId: encodeAtlasNodeId(decoded.type, decoded.id, projectId) } : null;
}
export function fromAtlasEdgeEndpoint(type, id, projectId) {
    return encodeAtlasNodeId(type, id, projectId);
}
export function isProjectScopedAtlasType(type) {
    return PROJECT_SCOPED.has(type);
}
