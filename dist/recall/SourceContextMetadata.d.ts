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
export declare function memoryEventLabel(event: MemoryEvent): string;
export declare function memoryEventCharRange(event: MemoryEvent): MemoryEventCharRange | undefined;
export declare function memoryEventSourceRange(event: MemoryEvent): MemoryEventSourceRange | undefined;
export declare function normalizeSourceContextWindow<TEvent extends MemoryEvent>(anchor: TEvent, before: TEvent[], after: TEvent[], requested: {
    before: number;
    after: number;
}): NormalizedSourceContextWindow<TEvent>;
//# sourceMappingURL=SourceContextMetadata.d.ts.map