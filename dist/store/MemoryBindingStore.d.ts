import Database from 'bun:sqlite';
import type { MemoryBindingInput, MemoryBindingListOptions, MemoryBindingRecord, MemoryBindingStats, MemoryEntityRecord, MemoryEntityType, MemoryTopicRecord } from '../binding/MemoryBindingTypes.js';
export interface UpsertMemoryEntityInput {
    projectId?: string;
    canonicalName: string;
    entityType: MemoryEntityType;
    aliases?: string[];
    stablePath?: string;
    now?: number;
}
export interface UpsertMemoryTopicInput {
    projectId?: string;
    topicPath: string;
    parentPath?: string;
    topicType: MemoryTopicRecord['topicType'];
    summary?: string;
    now?: number;
}
export declare class MemoryBindingStore {
    private readonly db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string);
    upsertEntity(input: UpsertMemoryEntityInput): MemoryEntityRecord;
    upsertTopic(input: UpsertMemoryTopicInput): MemoryTopicRecord;
    insertBinding(input: MemoryBindingInput): MemoryBindingRecord;
    listBindings(options?: MemoryBindingListOptions): MemoryBindingRecord[];
    getStats(projectId?: string): MemoryBindingStats;
    deleteByProject(projectId: string): number;
    close(): void;
    private initializeSchema;
    private ensureCompatibilityColumns;
}
//# sourceMappingURL=MemoryBindingStore.d.ts.map