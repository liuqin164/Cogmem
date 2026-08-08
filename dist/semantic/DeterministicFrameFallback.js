import { createHash } from 'node:crypto';
export function deterministicFrameFallback(input) {
    const events = input.events.slice().sort((a, b) => a.occurredAt - b.occurredAt || a.eventId.localeCompare(b.eventId));
    const evidenceEventIds = events.map((event) => event.eventId);
    const frameId = `frame:${createHash('sha256').update(`${input.episodeId}:${evidenceEventIds.join(',')}`).digest('hex').slice(0, 32)}`;
    const nodes = [
        { frameNodeId: 'episode', dimension: 'episode', label: input.episodeId, confidence: 1, evidenceEventIds },
        { frameNodeId: 'project', dimension: 'project', label: input.projectId, confidence: 1, evidenceEventIds },
    ];
    for (const event of events) {
        const eventEvidence = [event.eventId];
        nodes.push({ frameNodeId: `event:${event.eventId}`, dimension: 'event', label: event.eventId, confidence: 0.6, evidenceEventIds: eventEvidence });
        nodes.push({ frameNodeId: `raw:${event.eventId}`, dimension: 'raw_event', label: event.eventId, confidence: 1, evidenceEventIds: eventEvidence });
        const actor = event.actorId ?? event.role;
        if (actor && !nodes.some((node) => node.frameNodeId === `actor:${actor}`))
            nodes.push({ frameNodeId: `actor:${actor}`, dimension: 'actor', label: actor, confidence: 0.7, evidenceEventIds: eventEvidence });
    }
    const relations = [{ sourceFrameNodeId: 'episode', relationType: 'PART_OF_PROJECT', targetFrameNodeId: 'project', confidence: 1, evidenceEventIds }];
    for (const event of events) {
        relations.push({ sourceFrameNodeId: 'episode', relationType: 'PART_OF_EVENT', targetFrameNodeId: `event:${event.eventId}`, confidence: 0.7, evidenceEventIds: [event.eventId] });
        relations.push({ sourceFrameNodeId: 'episode', relationType: 'SUPPORTED_BY', targetFrameNodeId: `raw:${event.eventId}`, confidence: 1, evidenceEventIds: [event.eventId] });
        const actor = event.actorId ?? event.role;
        if (actor)
            relations.push({ sourceFrameNodeId: `actor:${actor}`, relationType: 'PARTICIPATED_IN', targetFrameNodeId: `event:${event.eventId}`, confidence: 0.7, evidenceEventIds: [event.eventId] });
    }
    return { schemaVersion: 'memory_frame.v1', frameId, projectId: input.projectId, episodeId: input.episodeId,
        title: input.episodeId, summary: '', episodeKind: input.episodeType ?? 'other', nodes,
        relations, temporalReferences: events.length ? [{ label: events[0].localDate ?? new Date(events[0].occurredAt).toISOString().slice(0, 10), occurredAt: events[0].occurredAt, evidenceEventIds: [events[0].eventId], confidence: 0.8 }] : [], stateTransitions: [], confidence: 0.8, evidenceEventIds,
        processor: { promptVersion: input.promptVersion ?? 'deterministic-fallback', generatedAt: input.now ?? Date.now() },
        status: 'needs_confirmation', sourceAuthority: 'deterministic_fallback', semanticCompleteness: 'minimal', needsReview: true };
}
