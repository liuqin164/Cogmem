import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { MemoryFrameV1 } from './MemoryFrameTypes.js';

export function deterministicFrameFallback(input: { projectId: string; episodeId: string; episodeType?: MemoryFrameV1['episodeKind']; events: MemoryEvent[]; promptVersion?: string; now?: number }): MemoryFrameV1 {
  const events = input.events.slice().sort((a, b) => a.occurredAt - b.occurredAt || a.eventId.localeCompare(b.eventId));
  const evidenceEventIds = events.map((event) => event.eventId);
  const frameId = `frame:${createHash('sha256').update(`${input.episodeId}:${evidenceEventIds.join(',')}`).digest('hex').slice(0, 32)}`;
  const nodes: MemoryFrameV1['nodes'] = [
    { frameNodeId: 'episode', dimension: 'episode', label: input.episodeId, confidence: 1, evidenceEventIds },
    { frameNodeId: 'project', dimension: 'project', label: input.projectId, confidence: 1, evidenceEventIds },
  ];
  return { schemaVersion: 'memory_frame.v1', frameId, projectId: input.projectId, episodeId: input.episodeId,
    title: input.episodeId, summary: '', episodeKind: input.episodeType ?? 'other', nodes,
    relations: [{ sourceFrameNodeId: 'episode', relationType: 'PART_OF_PROJECT', targetFrameNodeId: 'project', confidence: 1, evidenceEventIds }],
    temporalReferences: [], stateTransitions: [], confidence: 1, evidenceEventIds,
    processor: { promptVersion: input.promptVersion ?? 'deterministic-fallback', generatedAt: input.now ?? Date.now() },
    status: 'needs_confirmation', sourceAuthority: 'deterministic_fallback', semanticCompleteness: 'minimal', needsReview: true };
}
