import type { MemoryFrameV1 } from './MemoryFrameTypes.js';

export const MEMORY_FRAME_SCHEMA_VERSION = 'memory_frame.v1' as const;

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
    episodeKind: { type: 'string', enum: ['discussion','operation','decision','correction','diagnostic','planning','status_update','preference','other'] },
    nodes: { type: 'array', items: { type: 'object', required: ['frameNodeId','dimension','label','confidence','evidenceEventIds'], properties: { frameNodeId: { type: 'string' }, dimension: { type: 'string' }, label: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
    relations: { type: 'array', items: { type: 'object', required: ['sourceFrameNodeId','relationType','targetFrameNodeId','confidence','evidenceEventIds'], properties: { sourceFrameNodeId: { type: 'string' }, relationType: { type: 'string' }, targetFrameNodeId: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } }, validFrom: { type: 'number' }, validTo: { type: 'number' } } } },
    temporalReferences: { type: 'array', items: { type: 'object', required: ['label','confidence','evidenceEventIds'], properties: { label: { type: 'string' }, occurredAt: { type: 'number' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
    stateTransitions: { type: 'array', items: { type: 'object', required: ['subjectFrameNodeId','to','confidence','evidenceEventIds'], properties: { subjectFrameNodeId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', items: { type: 'string' } } } } },
    processor: { type: 'object', required: ['promptVersion','generatedAt'], properties: { provider: { type: 'string' }, model: { type: 'string' }, promptVersion: { type: 'string', minLength: 1 }, generatedAt: { type: 'number' } } },
    primaryLanguage: { type: 'string' }, sourceAuthority: { type: 'string', enum: ['processor','deterministic_fallback'] },
    semanticCompleteness: { type: 'string', enum: ['full','minimal'] }, needsReview: { type: 'boolean' },
    publishStatus: { type: 'string', enum: ['active','needs_confirmation'] }, status: { type: 'string', enum: ['staged','active','needs_confirmation','superseded','failed'] },
  },
} as const;

export function isMemoryFrame(value: unknown): value is MemoryFrameV1 {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<MemoryFrameV1>;
  const allowedKeys = new Set(['schemaVersion','frameId','projectId','episodeId','revisionId','revisionNumber','supersedesFrameId','title','summary','episodeKind','nodes','relations','temporalReferences','stateTransitions','confidence','evidenceEventIds','processor','primaryLanguage','sourceAuthority','semanticCompleteness','needsReview','publishStatus','status']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  const objectArray = (items: unknown): boolean => Array.isArray(items) && items.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  const stringArray = (items: unknown): boolean => Array.isArray(items) && items.every((item) => typeof item === 'string' && item.trim().length > 0);
  const processor = frame.processor && typeof frame.processor === 'object' ? frame.processor : undefined;
  return Boolean(frame.schemaVersion === MEMORY_FRAME_SCHEMA_VERSION && typeof frame.frameId === 'string'
    && typeof frame.projectId === 'string' && typeof frame.episodeId === 'string'
    && typeof frame.title === 'string' && typeof frame.summary === 'string'
    && objectArray(frame.nodes) && Array.isArray(frame.nodes) && frame.nodes.length <= 256
    && objectArray(frame.relations) && Array.isArray(frame.relations) && frame.relations.length <= 512
    && objectArray(frame.temporalReferences) && Array.isArray(frame.temporalReferences) && frame.temporalReferences.length <= 128
    && objectArray(frame.stateTransitions) && Array.isArray(frame.stateTransitions) && frame.stateTransitions.length <= 128
    && stringArray(frame.evidenceEventIds)
    && Boolean(processor) && typeof processor?.promptVersion === 'string' && processor.promptVersion.trim().length > 0 && Number.isFinite(processor.generatedAt));
}
