import type { MemoryFrameV1 } from './MemoryFrameTypes.js';

export const MEMORY_FRAME_SCHEMA_VERSION = 'memory_frame.v1' as const;
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
} as const;

export const MEMORY_DIMENSIONS = ['actor','entity','project','topic','issue','event','raw_event','episode','task','object','location','time','state'] as const;
export const MEMORY_FRAME_REQUIRED_DIMENSIONS = ['episode', 'project'] as const;
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
    episodeKind: { type: 'string', enum: ['discussion','operation','decision','correction','diagnostic','planning','status_update','preference','other'] },
    nodes: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.nodes, items: { type: 'object', additionalProperties: false, required: ['frameNodeId','dimension','label','confidence','evidenceEventIds'], properties: { frameNodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, dimension: { type: 'string', enum: MEMORY_DIMENSIONS }, label: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.text, pattern: NON_WHITESPACE_PATTERN }, description: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.text }, aliases: { type: 'array', maxItems: MEMORY_FRAME_LIMITS.aliases, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.alias, pattern: NON_WHITESPACE_PATTERN } }, canonicalHint: { type: 'object', additionalProperties: false, properties: { nodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, canonicalLabel: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.text }, confidence: { type: 'number', minimum: 0, maximum: 1 } } }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } } } } },
    relations: { type: 'array', maxItems: MEMORY_FRAME_LIMITS.relations, items: { type: 'object', additionalProperties: false, required: ['sourceFrameNodeId','relationType','targetFrameNodeId','confidence','evidenceEventIds'], properties: { sourceFrameNodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, relationType: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, targetFrameNodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } }, validFrom: { type: 'number' }, validTo: { type: 'number' } } } },
    temporalReferences: { type: 'array', maxItems: MEMORY_FRAME_LIMITS.temporalReferences, items: { type: 'object', additionalProperties: false, required: ['label','confidence','evidenceEventIds'], properties: { label: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.text, pattern: NON_WHITESPACE_PATTERN }, occurredAt: { type: 'number' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } } } } },
    stateTransitions: { type: 'array', maxItems: MEMORY_FRAME_LIMITS.stateTransitions, items: { type: 'object', additionalProperties: false, required: ['subjectFrameNodeId','to','confidence','evidenceEventIds'], properties: { subjectFrameNodeId: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, from: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.text, pattern: NON_WHITESPACE_PATTERN }, to: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.text, pattern: NON_WHITESPACE_PATTERN }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', minItems: 1, maxItems: MEMORY_FRAME_LIMITS.evidence, items: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN } } } } },
    processor: { type: 'object', additionalProperties: false, required: ['promptVersion','generatedAt'], properties: { provider: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.id }, model: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.id }, promptVersion: { type: 'string', minLength: 1, maxLength: MEMORY_FRAME_LIMITS.id, pattern: NON_WHITESPACE_PATTERN }, generatedAt: { type: 'number' } } },
    primaryLanguage: { type: 'string', maxLength: MEMORY_FRAME_LIMITS.language }, sourceAuthority: { type: 'string', enum: ['processor','deterministic_fallback'] },
    semanticCompleteness: { type: 'string', enum: ['full','minimal'] }, needsReview: { type: 'boolean' },
    publishStatus: { type: 'string', enum: ['active','needs_confirmation'] }, status: { type: 'string', enum: ['staged','active','needs_confirmation','superseded','failed'] },
  },
} as const;

export function memoryFrameJsonSchema(options: { allowEmptyEvidence?: boolean } = {}): Record<string, unknown> {
  if (!options.allowEmptyEvidence) return MEMORY_FRAME_JSON_SCHEMA as unknown as Record<string, unknown>;
  const schema = JSON.parse(JSON.stringify(MEMORY_FRAME_JSON_SCHEMA)) as any;
  schema.properties.evidenceEventIds.minItems = 0;
  for (const key of ['nodes', 'relations', 'temporalReferences', 'stateTransitions']) {
    schema.properties[key].items.properties.evidenceEventIds.minItems = 0;
  }
  return schema;
}

/**
 * Why a value is not a frame, in one word per defect.
 *
 * `isMemoryFrame` answers yes or no, and a no is what the pipeline used to
 * report — leaving a reading model's mistake indistinguishable from a
 * truncated answer (measured on the box: the model returned every required key
 * with `processor` as a string, and the log said only
 * `invalid_memory_frame_shape`).
 */
export function memoryFrameShapeError(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return 'not_an_object';
  const frame = value as Partial<MemoryFrameV1>;
  const allowedKeys = new Set(['schemaVersion','frameId','projectId','episodeId','revisionId','revisionNumber','supersedesFrameId','title','summary','episodeKind','nodes','relations','temporalReferences','stateTransitions','confidence','evidenceEventIds','processor','primaryLanguage','sourceAuthority','semanticCompleteness','needsReview','publishStatus','status']);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) return `unknown_key:${unknown}`;
  const objectArray = (items: unknown): boolean => Array.isArray(items) && items.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  const stringArray = (items: unknown): boolean => Array.isArray(items) && items.every((item) => typeof item === 'string' && item.trim().length > 0);
  const onlyKeys = (item: unknown, keys: readonly string[]): boolean => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    return Object.keys(item).every((key) => keys.includes(key));
  };
  if (frame.schemaVersion !== MEMORY_FRAME_SCHEMA_VERSION) return `schemaVersion:${String(frame.schemaVersion)}`;
  for (const key of ['frameId', 'projectId', 'episodeId', 'title', 'summary'] as const) {
    if (typeof frame[key] !== 'string') return `${key}_not_string`;
  }
  if (frame.revisionId !== undefined && !(typeof frame.revisionId === 'string' && frame.revisionId.trim().length > 0 && frame.revisionId.length <= MEMORY_FRAME_LIMITS.id)) return 'revisionId_invalid';
  if (frame.revisionNumber !== undefined && !(Number.isInteger(frame.revisionNumber) && frame.revisionNumber >= 1)) return 'revisionNumber_invalid';
  if (frame.supersedesFrameId !== undefined && !(typeof frame.supersedesFrameId === 'string' && frame.supersedesFrameId.trim().length > 0 && frame.supersedesFrameId.length <= MEMORY_FRAME_LIMITS.id)) return 'supersedesFrameId_invalid';
  if (!objectArray(frame.nodes) || (frame.nodes?.length ?? 0) > MEMORY_FRAME_LIMITS.nodes) return Array.isArray(frame.nodes) ? 'nodes_too_many_or_malformed' : 'nodes_not_array';
  if (!frame.nodes!.every((node) => onlyKeys(node, ['frameNodeId','dimension','label','description','aliases','canonicalHint','confidence','evidenceEventIds']) && (node.canonicalHint === undefined || onlyKeys(node.canonicalHint, ['nodeId','canonicalLabel','confidence'])))) return 'node_has_unknown_key';
  if (!objectArray(frame.relations) || (frame.relations?.length ?? 0) > MEMORY_FRAME_LIMITS.relations) return Array.isArray(frame.relations) ? 'relations_too_many_or_malformed' : 'relations_not_array';
  if (!frame.relations!.every((relation) => onlyKeys(relation, ['sourceFrameNodeId','relationType','targetFrameNodeId','confidence','evidenceEventIds','validFrom','validTo']))) return 'relation_has_unknown_key';
  if (!objectArray(frame.temporalReferences) || (frame.temporalReferences?.length ?? 0) > MEMORY_FRAME_LIMITS.temporalReferences) return Array.isArray(frame.temporalReferences) ? 'temporalReferences_too_many_or_malformed' : 'temporalReferences_not_array';
  if (!frame.temporalReferences!.every((reference) => onlyKeys(reference, ['label','occurredAt','confidence','evidenceEventIds']))) return 'temporalReference_has_unknown_key';
  if (!objectArray(frame.stateTransitions) || (frame.stateTransitions?.length ?? 0) > MEMORY_FRAME_LIMITS.stateTransitions) return Array.isArray(frame.stateTransitions) ? 'stateTransitions_too_many_or_malformed' : 'stateTransitions_not_array';
  if (!frame.stateTransitions!.every((transition) => onlyKeys(transition, ['subjectFrameNodeId','from','to','confidence','evidenceEventIds']))) return 'stateTransition_has_unknown_key';
  if (!stringArray(frame.evidenceEventIds)) return 'evidenceEventIds_not_string_array';
  const processor = frame.processor;
  if (processor === undefined || processor === null) return 'processor_missing';
  if (typeof processor !== 'object' || Array.isArray(processor)) return `processor_not_object:${typeof processor}`;
  // The processor bag is provenance the pipeline overwrites with its own
  // (worker: `{...frame.processor, ...resolveProviderConfig(), promptVersion,
  // generatedAt}`), so a key the model invented there costs nothing — while
  // rejecting it cost a whole frame on the box
  // (`invalid_memory_frame_shape:processor_has_unknown_key`).
  const promptVersion = (processor as { promptVersion?: unknown }).promptVersion;
  if (typeof promptVersion !== 'string' || !promptVersion.trim()) return 'processor_promptVersion_missing';
  if (!Number.isFinite((processor as { generatedAt?: unknown }).generatedAt)) return 'processor_generatedAt_missing';
  return undefined;
}

export function isMemoryFrame(value: unknown): value is MemoryFrameV1 {
  return memoryFrameShapeError(value) === undefined;
}
