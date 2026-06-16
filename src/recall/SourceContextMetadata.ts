import type { MemoryEvent } from '../types/index.js';

export interface MemoryEventCharRange {
  start: number;
  end: number;
}

export interface MemoryEventSourceRange {
  sourceOffset?: number;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
}

export interface SourceContextWindowSide {
  requestedCount: number;
  count: number;
  excludesAnchor: true;
  roleFilter: 'all';
  ordering: 'chronological';
  unit: 'raw_event';
  eventIds: string[];
  labels: string[];
  overlapEventIds: string[];
}

export interface SourceContextWindowMetadata {
  anchorEventId: string;
  anchorLabel: string;
  excludesAnchor: true;
  roleFilter: 'all';
  ordering: 'chronological';
  unit: 'raw_event';
  overlapHandling: 'drop_from_after';
  overlapEventIds: string[];
  droppedOverlapEventIds: string[];
  before: SourceContextWindowSide;
  after: SourceContextWindowSide;
}

export interface NormalizedSourceContextWindow<TEvent extends MemoryEvent = MemoryEvent> {
  before: TEvent[];
  after: TEvent[];
  window: SourceContextWindowMetadata;
}

export function memoryEventLabel(event: MemoryEvent): string {
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
  if (metadataLabel) return metadataLabel;
  if (Number.isFinite(event.globalSeq)) return `#${event.globalSeq}`;
  const sourceOffset = numberField(event.sourceOffset) ?? numberField(metadata.sourceOffset) ?? numberField(sourceRef?.sourceOffset);
  if (sourceOffset !== undefined) return `#${sourceOffset}`;
  return `#${event.eventId.slice(4, 12)}`;
}

export function memoryEventCharRange(event: MemoryEvent): MemoryEventCharRange | undefined {
  const metadata = eventMetadata(event);
  const sourceRef = isRecord(metadata.sourceRef) ? metadata.sourceRef : undefined;
  const start = numberField(event.charStart) ?? numberField(metadata.charStart) ?? numberField(sourceRef?.charStart);
  const end = numberField(event.charEnd) ?? numberField(metadata.charEnd) ?? numberField(sourceRef?.charEnd);
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

export function memoryEventSourceRange(event: MemoryEvent): MemoryEventSourceRange | undefined {
  const metadata = eventMetadata(event);
  const sourceRef = isRecord(metadata.sourceRef) ? metadata.sourceRef : undefined;
  const range: MemoryEventSourceRange = {
    sourceOffset: numberField(event.sourceOffset) ?? numberField(metadata.sourceOffset) ?? numberField(sourceRef?.sourceOffset),
    lineStart: numberField(event.lineStart) ?? numberField(metadata.lineStart) ?? numberField(sourceRef?.lineStart),
    lineEnd: numberField(event.lineEnd) ?? numberField(metadata.lineEnd) ?? numberField(sourceRef?.lineEnd),
    charStart: numberField(event.charStart) ?? numberField(metadata.charStart) ?? numberField(sourceRef?.charStart),
    charEnd: numberField(event.charEnd) ?? numberField(metadata.charEnd) ?? numberField(sourceRef?.charEnd),
  };
  return Object.values(range).some((value) => value !== undefined) ? range : undefined;
}

export function normalizeSourceContextWindow<TEvent extends MemoryEvent>(
  anchor: TEvent,
  before: TEvent[],
  after: TEvent[],
  requested: { before: number; after: number },
): NormalizedSourceContextWindow<TEvent> {
  const seen = new Set<string>([anchor.eventId]);
  const droppedOverlapEventIds: string[] = [];
  const normalizedBefore: TEvent[] = [];
  for (const event of before) {
    if (seen.has(event.eventId)) {
      droppedOverlapEventIds.push(event.eventId);
      continue;
    }
    seen.add(event.eventId);
    normalizedBefore.push(event);
  }

  const normalizedAfter: TEvent[] = [];
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

  const window: SourceContextWindowMetadata = {
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

function windowSide(requestedCount: number, events: MemoryEvent[], overlapEventIds: string[]): SourceContextWindowSide {
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

function eventMetadata(event: MemoryEvent): Record<string, unknown> {
  const payload = event.payload as { metadata?: unknown };
  return isRecord(payload.metadata) ? payload.metadata : {};
}

function firstLabel(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return `#${value}`;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
  return undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
