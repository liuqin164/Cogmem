export function createMemoryQueryFrame(input) {
    return { schemaVersion: 'memory_query_frame.v1', ...input };
}
export function queryFacet(label, dimension, canonicalNodeId) {
    return { label, dimension, canonicalNodeId };
}
