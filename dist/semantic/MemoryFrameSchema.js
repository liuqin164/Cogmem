export const MEMORY_FRAME_SCHEMA_VERSION = 'memory_frame.v1';
export const MEMORY_FRAME_LIMITS = {
    id: 512,
    text: 20_000,
    dimension: 64,
    language: 128,
    nodes: 256,
    relations: 512,
    temporalReferences: 128,
    stateTransitions: 128,
    aliases: 64,
    alias: 1_000,
    evidence: 1_000,
};
export const MEMORY_DIMENSIONS = ['actor', 'entity', 'project', 'topic', 'issue', 'event', 'raw_event', 'episode', 'task', 'object', 'location', 'time', 'state'];
export const MEMORY_FRAME_REQUIRED_DIMENSIONS = ['episode', 'project'];
const NON_WHITESPACE_PATTERN = '.*\\S.*';
export const MEMORY_FRAME_JSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    allOf: [
        ...MEMORY_FRAME_REQUIRED_DIMENSIONS.map((dimension) => ({ properties: { nodes: { contains: { type: 'object', required: ['dimension'], properties: { dimension: { const: dimension } } } } } })),
    ],
    required: ['schemaVersion', 'frameId', 'projectId', 'episodeId', 'title', 'summary', 'episodeKind', 'nodes', 'relations', 'temporalReferences', 'stateTransitions', 'confidence', 'evidenceEventIds', 'processor'],
    properties: {
        schemaVersion: { const: MEMORY_FRAME_SCHEMA_VERSION },
        frameId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, projectId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, episodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN },
        revisionId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, revisionNumber: { type: 'integer', minimum: 1 }, supersedesFrameId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN },
        title: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.text }, summary: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.text }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } },
        episodeKind: { type: 'string', enum: ['discussion', 'operation', 'decision', 'correction', 'diagnostic', 'planning', 'status_update', 'preference', 'other'] },
        nodes: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.nodes, items: { type: 'object', additionalProperties: false, required: ['frameNodeId', 'dimension', 'label', 'confidence', 'evidenceEventIds'], properties: { frameNodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, dimension: { type: 'string', enum: MEMORY_DIMENSIONS }, label: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.text, pattern: NON_WHITESPACE_PATTERN }, description: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.text }, aliases: { type: 'array', maxItems: MEMORY_FRAME_LIMITS.aliases, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.alias, pattern: NON_WHITESPACE_PATTERN } }, canonicalHint: { type: 'object', additionalProperties: false, properties: { nodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, canonicalLabel: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.text }, confidence: { type: 'number', minimum: 0, maximum: 1 } } }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } } } } },
        relations: { type: 'array', maxItems: MEMORY_FRAME_LIMITS.relations, items: { type: 'object', additionalProperties: false, required: ['sourceFrameNodeId', 'relationType', 'targetFrameNodeId', 'confidence', 'evidenceEventIds'], properties: { sourceFrameNodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, relationType: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, targetFrameNodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } }, validFrom: { type: 'number' }, validTo: { type: 'number' } } } },
        temporalReferences: { type: 'array', maxItems: MEMORY_FRAME_LIMITS.temporalReferences, items: { type: 'object', additionalProperties: false, required: ['label', 'confidence', 'evidenceEventIds'], properties: { label: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.text, pattern: NON_WHITESPACE_PATTERN }, occurredAt: { type: 'number' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } } } } },
        stateTransitions: { type: 'array', maxItems: MEMORY_FRAME_LIMITS.stateTransitions, items: { type: 'object', additionalProperties: false, required: ['subjectFrameNodeId', 'to', 'confidence', 'evidenceEventIds'], properties: { subjectFrameNodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, from: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.text, pattern: NON_WHITESPACE_PATTERN }, to: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.text, pattern: NON_WHITESPACE_PATTERN }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } } } } },
        processor: { type: 'object', additionalProperties: false, required: ['promptVersion', 'generatedAt'], properties: { provider: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.id }, model: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.id }, promptVersion: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, generatedAt: { type: 'number' } } },
        primaryLanguage: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.language }, sourceAuthority: { type: 'string', enum: ['processor', 'deterministic_fallback'] },
        semanticCompleteness: { type: 'string', enum: ['full', 'minimal'] }, needsReview: { type: 'boolean' },
        publishStatus: { type: 'string', enum: ['active', 'needs_confirmation'] }, status: { type: 'string', enum: ['staged', 'active', 'needs_confirmation', 'superseded', 'failed'] },
    },
};
export function memoryFrameJsonSchema(options = {}) {
    if (!options.allowEmptyEvidence)
        return MEMORY_FRAME_JSON_SCHEMA;
    const schema = JSON.parse(JSON.stringify(MEMORY_FRAME_JSON_SCHEMA));
    schema.properties.evidenceEventIds.minItems = 0;
    for (const key of ['nodes', 'relations', 'temporalReferences', 'stateTransitions']) {
        schema.properties[key].items.properties.evidenceEventIds.minItems = 0;
    }
    return schema;
}
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
        && (frame.revisionId === undefined || (typeof frame.revisionId === 'string' && frame.revisionId.trim().length > 0 && frame.revisionId.length <= MEMORY_FRAME_LIMITS.id))
        && (frame.revisionNumber === undefined || (Number.isInteger(frame.revisionNumber) && frame.revisionNumber >= 1))
        && (frame.supersedesFrameId === undefined || (typeof frame.supersedesFrameId === 'string' && frame.supersedesFrameId.trim().length > 0 && frame.supersedesFrameId.length <= MEMORY_FRAME_LIMITS.id))
        && typeof frame.title === 'string' && typeof frame.summary === 'string'
        && objectArray(frame.nodes) && Array.isArray(frame.nodes) && frame.nodes.length <= MEMORY_FRAME_LIMITS.nodes && frame.nodes.every((node) => onlyKeys(node, ['frameNodeId', 'dimension', 'label', 'description', 'aliases', 'canonicalHint', 'confidence', 'evidenceEventIds']) && (node.canonicalHint === undefined || onlyKeys(node.canonicalHint, ['nodeId', 'canonicalLabel', 'confidence'])))
        && objectArray(frame.relations) && Array.isArray(frame.relations) && frame.relations.length <= MEMORY_FRAME_LIMITS.relations && frame.relations.every((relation) => onlyKeys(relation, ['sourceFrameNodeId', 'relationType', 'targetFrameNodeId', 'confidence', 'evidenceEventIds', 'validFrom', 'validTo']))
        && objectArray(frame.temporalReferences) && Array.isArray(frame.temporalReferences) && frame.temporalReferences.length <= MEMORY_FRAME_LIMITS.temporalReferences && frame.temporalReferences.every((reference) => onlyKeys(reference, ['label', 'occurredAt', 'confidence', 'evidenceEventIds']))
        && objectArray(frame.stateTransitions) && Array.isArray(frame.stateTransitions) && frame.stateTransitions.length <= MEMORY_FRAME_LIMITS.stateTransitions && frame.stateTransitions.every((transition) => onlyKeys(transition, ['subjectFrameNodeId', 'from', 'to', 'confidence', 'evidenceEventIds']))
        && stringArray(frame.evidenceEventIds)
        && Boolean(processor) && onlyKeys(processor, ['provider', 'model', 'promptVersion', 'generatedAt']) && typeof processor?.promptVersion === 'string' && processor.promptVersion.trim().length > 0 && Number.isFinite(processor.generatedAt));
}
