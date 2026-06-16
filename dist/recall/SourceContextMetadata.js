export function memoryEventLabel(event) {
    const metadata = eventMetadata(event);
    const sourceRef = isRecord(metadata.sourceRef) ? metadata.sourceRef : undefined;
    const metadataLabel = firstLabel([
        metadata.messageId,
        metadata.message_id,
        metadata.telegramMessageId,
        metadata.telegram_message_id,
        metadata.openclawMessageId,
        metadata.openclaw_message_id,
        metadata.hermesStateDbMessageId,
        metadata.hermes_state_db_message_id,
        metadata.sourceMessageId,
        metadata.source_message_id,
        metadata.originalMessageId,
        metadata.original_message_id,
        sourceRef?.messageId,
        sourceRef?.message_id,
        sourceRef?.telegramMessageId,
        sourceRef?.hermesStateDbMessageId,
    ]);
    if (metadataLabel)
        return metadataLabel;
    if (Number.isFinite(event.globalSeq))
        return `#${event.globalSeq}`;
    const sourceOffset = numberField(event.sourceOffset) ?? numberField(metadata.sourceOffset) ?? numberField(sourceRef?.sourceOffset);
    if (sourceOffset !== undefined)
        return `#${sourceOffset}`;
    return `#${event.eventId.slice(4, 12)}`;
}
export function memoryEventCharRange(event) {
    const metadata = eventMetadata(event);
    const sourceRef = isRecord(metadata.sourceRef) ? metadata.sourceRef : undefined;
    const start = numberField(event.charStart) ?? numberField(metadata.charStart) ?? numberField(sourceRef?.charStart);
    const end = numberField(event.charEnd) ?? numberField(metadata.charEnd) ?? numberField(sourceRef?.charEnd);
    if (start === undefined || end === undefined)
        return undefined;
    return { start, end };
}
export function memoryEventSourceRange(event) {
    const metadata = eventMetadata(event);
    const sourceRef = isRecord(metadata.sourceRef) ? metadata.sourceRef : undefined;
    const range = {
        sourceOffset: numberField(event.sourceOffset) ?? numberField(metadata.sourceOffset) ?? numberField(sourceRef?.sourceOffset),
        lineStart: numberField(event.lineStart) ?? numberField(metadata.lineStart) ?? numberField(sourceRef?.lineStart),
        lineEnd: numberField(event.lineEnd) ?? numberField(metadata.lineEnd) ?? numberField(sourceRef?.lineEnd),
        charStart: numberField(event.charStart) ?? numberField(metadata.charStart) ?? numberField(sourceRef?.charStart),
        charEnd: numberField(event.charEnd) ?? numberField(metadata.charEnd) ?? numberField(sourceRef?.charEnd),
    };
    return Object.values(range).some((value) => value !== undefined) ? range : undefined;
}
export function normalizeSourceContextWindow(anchor, before, after, requested) {
    const seen = new Set([anchor.eventId]);
    const droppedOverlapEventIds = [];
    const normalizedBefore = [];
    for (const event of before) {
        if (seen.has(event.eventId)) {
            droppedOverlapEventIds.push(event.eventId);
            continue;
        }
        seen.add(event.eventId);
        normalizedBefore.push(event);
    }
    const normalizedAfter = [];
    for (const event of after) {
        if (seen.has(event.eventId)) {
            droppedOverlapEventIds.push(event.eventId);
            continue;
        }
        seen.add(event.eventId);
        normalizedAfter.push(event);
    }
    const beforeIds = new Set(normalizedBefore.map((event) => event.eventId));
    const overlapEventIds = unique(normalizedAfter
        .filter((event) => beforeIds.has(event.eventId))
        .map((event) => event.eventId));
    const window = {
        anchorEventId: anchor.eventId,
        anchorLabel: memoryEventLabel(anchor),
        excludesAnchor: true,
        roleFilter: 'all',
        ordering: 'chronological',
        unit: 'raw_event',
        overlapHandling: 'drop_from_after',
        overlapEventIds,
        droppedOverlapEventIds: unique(droppedOverlapEventIds),
        before: windowSide(requested.before, normalizedBefore, overlapEventIds),
        after: windowSide(requested.after, normalizedAfter, overlapEventIds),
    };
    return {
        before: normalizedBefore,
        after: normalizedAfter,
        window,
    };
}
function windowSide(requestedCount, events, overlapEventIds) {
    return {
        requestedCount,
        count: events.length,
        excludesAnchor: true,
        roleFilter: 'all',
        ordering: 'chronological',
        unit: 'raw_event',
        eventIds: events.map((event) => event.eventId),
        labels: events.map(memoryEventLabel),
        overlapEventIds,
    };
}
function eventMetadata(event) {
    const payload = event.payload;
    return isRecord(payload.metadata) ? payload.metadata : {};
}
function firstLabel(values) {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value))
            return `#${value}`;
        if (typeof value !== 'string')
            continue;
        const trimmed = value.trim();
        if (!trimmed)
            continue;
        return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    }
    return undefined;
}
function numberField(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function unique(values) {
    return Array.from(new Set(values));
}
