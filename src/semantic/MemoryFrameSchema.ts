import type { MemoryFrameV1 } from './MemoryFrameTypes.js';

export const MEMORY_FRAME_SCHEMA_VERSION = 'memory_frame.v1' as const;

export const MEMORY_FRAME_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'frameId', 'projectId', 'episodeId', 'title', 'summary', 'episodeKind', 'nodes', 'relations', 'temporalReferences', 'stateTransitions', 'confidence', 'evidenceEventIds', 'processor'],
  properties: {
    schemaVersion: { const: MEMORY_FRAME_SCHEMA_VERSION },
    frameId: { type: 'string', minLength: 1 }, projectId: { type: 'string', minLength: 1 }, episodeId: { type: 'string', minLength: 1 },
    title: { type: 'string' }, summary: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidenceEventIds: { type: 'array', items: { type: 'string', minLength: 1 } },
    nodes: { type: 'array' }, relations: { type: 'array' }, temporalReferences: { type: 'array' }, stateTransitions: { type: 'array' },
    processor: { type: 'object' },
  },
} as const;

export function isMemoryFrame(value: unknown): value is MemoryFrameV1 {
  const frame = value as Partial<MemoryFrameV1> | null;
  return Boolean(frame && frame.schemaVersion === MEMORY_FRAME_SCHEMA_VERSION && typeof frame.frameId === 'string'
    && typeof frame.projectId === 'string' && typeof frame.episodeId === 'string'
    && typeof frame.title === 'string' && typeof frame.summary === 'string'
    && Array.isArray(frame.nodes) && Array.isArray(frame.relations)
    && Array.isArray(frame.evidenceEventIds) && typeof frame.processor?.promptVersion === 'string');
}
