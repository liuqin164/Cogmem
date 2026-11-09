import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import { normalizeEpisodeKind, type MemoryFrameV1 } from './MemoryFrameTypes.js';

/**
 * The fallback frame for an episode, built without a model.
 *
 * `episodeKinds` is the project's `[taxonomy] episode_kinds` when it declared one; the kind is mapped through it so
 * the frame the store then validates is one that vocabulary accepts (#175).
 */
export function deterministicFrameFallback(input: { projectId: string; episodeId: string; episodeType?: string; episodeKinds?: readonly string[]; events: MemoryEvent[]; promptVersion?: string; now?: number }): MemoryFrameV1 {
  const events = input.events.slice().sort((a, b) => a.occurredAt - b.occurredAt || a.eventId.localeCompare(b.eventId));
  const evidenceEventIds = events.map((event) => event.eventId);
  const frameId = `frame:${createHash('sha256').update(`${input.episodeId}:${evidenceEventIds.join(',')}`).digest('hex').slice(0, 32)}`;
  const nodes: MemoryFrameV1['nodes'] = [
    { frameNodeId: 'episode', dimension: 'episode', label: input.episodeId, confidence: 1, evidenceEventIds },
    { frameNodeId: 'project', dimension: 'project', label: input.projectId, confidence: 1, evidenceEventIds },
  ];
  for (const event of events) {
    const eventEvidence = [event.eventId];
    nodes.push({ frameNodeId: `event:${event.eventId}`, dimension: 'event', label: event.eventId, confidence: 0.6, evidenceEventIds: eventEvidence });
    nodes.push({ frameNodeId: `raw:${event.eventId}`, dimension: 'raw_event', label: event.eventId, confidence: 1, evidenceEventIds: eventEvidence });
    const actor = event.actorId ?? event.role;
    if (actor && !nodes.some((node) => node.frameNodeId === `actor:${actor}`)) nodes.push({ frameNodeId: `actor:${actor}`, dimension: 'actor', label: actor, confidence: 0.7, evidenceEventIds: eventEvidence });
  }
  const stateTransitions: MemoryFrameV1['stateTransitions'] = [];
  const relations: MemoryFrameV1['relations'] = [{ sourceFrameNodeId: 'episode', relationType: 'PART_OF_PROJECT', targetFrameNodeId: 'project', confidence: 1, evidenceEventIds }];
  for (const event of events) {
    relations.push({ sourceFrameNodeId: 'episode', relationType: 'PART_OF_EVENT', targetFrameNodeId: `event:${event.eventId}`, confidence: 0.7, evidenceEventIds: [event.eventId] });
    relations.push({ sourceFrameNodeId: 'episode', relationType: 'SUPPORTED_BY', targetFrameNodeId: `raw:${event.eventId}`, confidence: 1, evidenceEventIds: [event.eventId] });
    const actor = event.actorId ?? event.role;
    if (actor) relations.push({ sourceFrameNodeId: `actor:${actor}`, relationType: 'PARTICIPATED_IN', targetFrameNodeId: `event:${event.eventId}`, confidence: 0.7, evidenceEventIds: [event.eventId] });
  }
  // #141: the two dimensions the model path produces and this fallback did not. Places may be generous — a marker
  // plus a noun phrase is enough, because a wrong-but-cited place is cheap to correct — while states are strict:
  // only the explicit markers, and only when there is a name to attach, so the frame never claims a transition the
  // turn did not state. Both mirror the shape the query side already accepts
  // (`__tests__/facet-state-place-e2e.unit.test.ts`), which is what "align with the model path" means here.
  const placePatterns: Array<{ pattern: RegExp; label: (match: RegExpMatchArray) => string }> = [
    { pattern: /在\s*([^\s，。；、]{1,12}?(?:办公室|会议室|门店|总部|现场))/u, label: (m) => m[1]! },
    { pattern: /\b(?:at|in)\s+(?:the\s+)?([A-Z][\w'-]*(?:\s+(?!(?:and|or|but|while|when|because|so|that|to|for|with|we|i|they|it|he|she)\b)[A-Za-z][\w'-]*){0,2})/u, label: (m) => m[1]! },
  ];
  const statePatterns = [
    /(?:当时还是|用的还是)\s*([^\s，。；、]{1,24})/u,
    /while\s+still\s+on\s+([^\s,.;]{1,24})/iu,
  ];
  // The projector only accepts an edge whose source is task/entity/event/object, and it turns a state transition into
  // CHANGED_TO only when the subject is an `event` node (MemoryFrameProjector). The actor node the fallback already
  // builds is neither, so the place and the state hang off the event they were read from, which is also the truer
  // subject: the place is where that event happened, the state is what it was on then.
  const eventNodeId = (event: MemoryEvent) => `event:${event.eventId}`;
  // The Atlas derives a node's id from `place:` plus the lowercased label (that is the id the query side looks up,
  // and the existing end-to-end fixture writes it by hand), so the frame node has to use the same spelling.
  const placeNodeId = (value: string) => `place:${value.toLowerCase()}`;
  for (const event of events) {
    const text = String((event.payload as { text?: string } | undefined)?.text ?? '');
    for (const { pattern, label } of placePatterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const place = label(match).trim().replace(/[，。；、,.;:]+$/u, '');
      if (!place) continue;
      const frameNodeId = placeNodeId(place);
      if (!nodes.some((node) => node.frameNodeId === frameNodeId)) {
        nodes.push({ frameNodeId, dimension: 'location', label: place, description: text.slice(0, 200), aliases: [place], confidence: 0.6, evidenceEventIds: [event.eventId] });
      }
      relations.push({ sourceFrameNodeId: eventNodeId(event), relationType: 'LOCATED_AT', targetFrameNodeId: frameNodeId, confidence: 0.6, evidenceEventIds: [event.eventId] });
      break;
    }
    for (const pattern of statePatterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const to = match[1]!.trim().replace(/[，。；、,.;:]+$/u, '');
      if (!to) continue;
      stateTransitions.push({ subjectFrameNodeId: eventNodeId(event), to, confidence: 0.6, evidenceEventIds: [event.eventId] });
      break;
    }
  }
  return { schemaVersion: 'memory_frame.v1', frameId, projectId: input.projectId, episodeId: input.episodeId,
    title: input.episodeId, summary: '', episodeKind: normalizeEpisodeKind(input.episodeType, input.episodeKinds), nodes,
    relations, temporalReferences: events.length ? [{ label: events[0]!.localDate ?? new Date(events[0]!.occurredAt).toISOString().slice(0, 10), occurredAt: events[0]!.occurredAt, evidenceEventIds: [events[0]!.eventId], confidence: 0.8 }] : [], stateTransitions, confidence: 0.8, evidenceEventIds,
    processor: { promptVersion: input.promptVersion ?? 'deterministic-fallback', generatedAt: input.now ?? Date.now() },
    status: 'needs_confirmation', sourceAuthority: 'deterministic_fallback', semanticCompleteness: 'minimal', needsReview: true };
}
