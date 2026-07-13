export const MEMORY_FRAME_SCHEMA_VERSION = 'memory_frame.v1';
export const MEMORY_FRAME_JSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'frameId', 'projectId', 'episodeId', 'title', 'summary', 'episodeKind', 'nodes', 'relations', 'temporalReferences', 'stateTransitions', 'confidence', 'evidenceEventIds', 'processor'],
    properties: {
        schemaVersion: { const: MEMORY_FRAME_SCHEMA_VERSION },
        frameId: { type: 'string', minLength: 1 }, projectId: { type: 'string', minLength: 1 }, episodeId: { type: 'string', minLength: 1 },
        title: { type: 'string' }, summary: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidenceEventIds: { type: 'array', items: { type: 'string', minLength: 1 } },
        episodeKind: { type: 'string', enum: ['discussion', 'operation', 'decision', 'correction', 'diagnostic', 'planning', 'status_update', 'preference', 'other'] },
        nodes: { type: 'array', items: { type: 'object', required: ['frameNodeId', 'dimension', 'label', 'confidence', 'evidenceEventIds'], properties: { frameNodeId: { type: 'string' }, dimension: { type: 'string' }, label: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
        relations: { type: 'array', items: { type: 'object', required: ['sourceFrameNodeId', 'relationType', 'targetFrameNodeId', 'confidence', 'evidenceEventIds'], properties: { sourceFrameNodeId: { type: 'string' }, relationType: { type: 'string' }, targetFrameNodeId: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } }, validFrom: { type: 'number' }, validTo: { type: 'number' } } } },
        temporalReferences: { type: 'array', items: { type: 'object', required: ['label', 'confidence', 'evidenceEventIds'], properties: { label: { type: 'string' }, occurredAt: { type: 'number' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
        stateTransitions: { type: 'array', items: { type: 'object', required: ['subjectFrameNodeId', 'to', 'confidence', 'evidenceEventIds'], properties: { subjectFrameNodeId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
        processor: { type: 'object', required: ['promptVersion', 'generatedAt'], properties: { provider: { type: 'string' }, model: { type: 'string' }, promptVersion: { type: 'string', minLength: 1 }, generatedAt: { type: 'number' } } },
    },
};
export function isMemoryFrame(value) {
    if (!value || typeof value !== 'object')
        return false;
    const frame = value;
    const objectArray = (items) => Array.isArray(items) && items.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    return Boolean(frame.schemaVersion === MEMORY_FRAME_SCHEMA_VERSION && typeof frame.frameId === 'string'
        && typeof frame.projectId === 'string' && typeof frame.episodeId === 'string'
        && typeof frame.title === 'string' && typeof frame.summary === 'string'
        && objectArray(frame.nodes) && objectArray(frame.relations) && objectArray(frame.temporalReferences) && objectArray(frame.stateTransitions)
        && Array.isArray(frame.evidenceEventIds) && frame.evidenceEventIds.every((id) => typeof id === 'string')
        && Boolean(frame.processor) && typeof frame.processor?.promptVersion === 'string' && Number.isFinite(frame.processor.generatedAt));
}
