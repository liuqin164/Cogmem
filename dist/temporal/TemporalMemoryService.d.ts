import Database from 'bun:sqlite';
export type TimelineEntryType = 'milestone' | 'decision' | 'correction' | 'belief_version';
export interface TimelineEntryRecord {
    entryId: string;
    projectId?: string;
    entryType: TimelineEntryType;
    canonicalKey?: string;
    entityId?: string;
    beliefId?: string;
    title: string;
    summary?: string;
    reason?: string;
    occurredAt: number;
    evidenceEventIds: string[];
    createdAt: number;
}
export interface RecordTimelineEntryInput {
    projectId?: string;
    entryType: TimelineEntryType;
    canonicalKey?: string;
    entityId?: string;
    beliefId?: string;
    title: string;
    summary?: string;
    reason?: string;
    occurredAt?: number;
    evidenceEventIds: string[];
}
export interface TimelineListOptions {
    projectId?: string;
    canonicalKey?: string;
    entityId?: string;
    entryTypes?: TimelineEntryType[];
    startTime?: number;
    endTime?: number;
    limit?: number;
}
export interface TemporalBeliefRecord {
    beliefId: string;
    projectId?: string;
    canonicalKey: string;
    statement: string;
    status: string;
    version: number;
    validFrom: number;
    validTo?: number;
    supersedesBeliefId?: string;
    supersededByBeliefId?: string;
}
export declare class TemporalMemoryService {
    private readonly db;
    constructor(db: Database);
    record(input: RecordTimelineEntryInput): TimelineEntryRecord;
    get(entryId: string): TimelineEntryRecord | null;
    list(options?: TimelineListOptions): TimelineEntryRecord[];
    getBeliefAt(projectId: string | undefined, canonicalKey: string, atTime: number): TemporalBeliefRecord | null;
    getBeliefHistory(projectId: string | undefined, canonicalKey: string): TemporalBeliefRecord[];
    private mapTimelineRow;
    private mapBeliefRow;
    private initializeSchema;
}
//# sourceMappingURL=TemporalMemoryService.d.ts.map