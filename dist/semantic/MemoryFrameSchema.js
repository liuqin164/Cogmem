export const MEMORY_FRAME_SCHEMA_VERSION = 'memory_frame.v1';
export const MEMORY_FRAME_JSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'frameId', 'projectId', 'episodeId', 'title', 'summary', 'episodeKind', 'nodes', 'relations', 'temporalReferences', 'stateTransitions', 'confidence', 'evidenceEventIds', 'processor'],
    properties: {
        schemaVersion: { const: MEMORY_FRAME_SCHEMA_VERSION },
        frameId: { type: 'string', minLength: 1 }, projectId: { type: 'string', minLength: 1 }, episodeId: { type: 'string', minLength: 1 },
        revisionId: { type: 'string', minLength: 1 }, revisionNumber: { type: 'integer', minimum: 1 }, supersedesFrameId: { type: 'string', minLength: 1 },
        title: { type: 'string' }, summary: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidenceEventIds: { type: 'array', items: { type: 'string', minLength: 1 } },
        episodeKind: { type: 'string', enum: ['discussion', 'operation', 'decision', 'correction', 'diagnostic', 'planning', 'status_update', 'preference', 'other'] },
        nodes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['frameNodeId', 'dimension', 'label', 'confidence', 'evidenceEventIds'], properties: { frameNodeId: { type: 'string', minLength: 1, maxLength: 512 }, dimension: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, canonicalHint: { type: 'object', additionalProperties: false, properties: { nodeId: { type: 'string', minLength: 1, maxLength: 512 }, canonicalLabel: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } } }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
        relations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceFrameNodeId', 'relationType', 'targetFrameNodeId', 'confidence', 'evidenceEventIds'], properties: { sourceFrameNodeId: { type: 'string', minLength: 1, maxLength: 512 }, relationType: { type: 'string', minLength: 1 }, targetFrameNodeId: { type: 'string', minLength: 1, maxLength: 512 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } }, validFrom: { type: 'number' }, validTo: { type: 'number' } } } },
        temporalReferences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'confidence', 'evidenceEventIds'], properties: { label: { type: 'string' }, occurredAt: { type: 'number' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
        stateTransitions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['subjectFrameNodeId', 'to', 'confidence', 'evidenceEventIds'], properties: { subjectFrameNodeId: { type: 'string', minLength: 1, maxLength: 512 }, from: { type: 'string' }, to: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
        processor: { type: 'object', additionalProperties: false, required: ['promptVersion', 'generatedAt'], properties: { provider: { type: 'string' }, model: { type: 'string' }, promptVersion: { type: 'string', minLength: 1 }, generatedAt: { type: 'number' } } },
        primaryLanguage: { type: 'string' }, sourceAuthority: { type: 'string', enum: ['processor', 'deterministic_fallback'] },
        semanticCompleteness: { type: 'string', enum: ['full', 'minimal'] }, needsReview: { type: 'boolean' },
        publishStatus: { type: 'string', enum: ['active', 'needs_confirmation'] }, status: { type: 'string', enum: ['staged', 'active', 'needs_confirmation', 'superseded', 'failed'] },
    },
};
export function isMemoryFrame(value) {
    if (!value || typeof value !== 'object')
        return false;
    const frame = value;
    const allowedKeys = new Set(['schemaVersion', 'frameId', 'projectId', 'episodeId', 'revisionId', 'revisionNumber', 'supersedesFrameId', 'title', 'summary', 'episodeKind', 'nodes', 'relations', 'temporalReferences', 'stateTransitions', 'confidence', 'evidenceEventIds', 'processor', 'primaryLanguage', 'sourceAuthority', 'semanticCompleteness', 'needsReview', 'publishStatus', 'status']);
    if (Object.keys(value).some((key) => !allowedKeys.has(key)))
        return false;
    const objectArray = (items) => Array.isArray(items) && items.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    const stringArray = (items) => Array.isArray(items) && items.every((item) => typeof item === 'string' && item.trim().length > 0);
    const onlyKeys = (item, keys) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            return false;
        return Object.keys(item).every((key) => keys.includes(key));
    };
    const processor = frame.processor && typeof frame.processor === 'object' ? frame.processor : undefined;
    return Boolean(frame.schemaVersion === MEMORY_FRAME_SCHEMA_VERSION && typeof frame.frameId === 'string'
        && typeof frame.projectId === 'string' && typeof frame.episodeId === 'string'
        && (frame.revisionId === undefined || (typeof frame.revisionId === 'string' && frame.revisionId.trim().length > 0 && frame.revisionId.length <= 512))
        && (frame.revisionNumber === undefined || (Number.isInteger(frame.revisionNumber) && frame.revisionNumber >= 1))
        && (frame.supersedesFrameId === undefined || (typeof frame.supersedesFrameId === 'string' && frame.supersedesFrameId.trim().length > 0 && frame.supersedesFrameId.length <= 512))
        && typeof frame.title === 'string' && typeof frame.summary === 'string'
        && objectArray(frame.nodes) && Array.isArray(frame.nodes) && frame.nodes.length <= 256 && frame.nodes.every((node) => onlyKeys(node, ['frameNodeId', 'dimension', 'label', 'description', 'aliases', 'canonicalHint', 'confidence', 'evidenceEventIds']) && (node.canonicalHint === undefined || onlyKeys(node.canonicalHint, ['nodeId', 'canonicalLabel', 'confidence'])))
        && objectArray(frame.relations) && Array.isArray(frame.relations) && frame.relations.length <= 512 && frame.relations.every((relation) => onlyKeys(relation, ['sourceFrameNodeId', 'relationType', 'targetFrameNodeId', 'confidence', 'evidenceEventIds', 'validFrom', 'validTo']))
        && objectArray(frame.temporalReferences) && Array.isArray(frame.temporalReferences) && frame.temporalReferences.length <= 128 && frame.temporalReferences.every((reference) => onlyKeys(reference, ['label', 'occurredAt', 'confidence', 'evidenceEventIds']))
        && objectArray(frame.stateTransitions) && Array.isArray(frame.stateTransitions) && frame.stateTransitions.length <= 128 && frame.stateTransitions.every((transition) => onlyKeys(transition, ['subjectFrameNodeId', 'from', 'to', 'confidence', 'evidenceEventIds']))
        && stringArray(frame.evidenceEventIds)
        && Boolean(processor) && onlyKeys(processor, ['provider', 'model', 'promptVersion', 'generatedAt']) && typeof processor?.promptVersion === 'string' && processor.promptVersion.trim().length > 0 && Number.isFinite(processor.generatedAt));
}
