export type MemoryEntityType = 'person' | 'project' | 'object' | 'event' | 'time' | 'place' | 'concept';
export type MemoryBindingType = 'about' | 'mentions' | 'decision' | 'correction' | 'preference' | 'boundary' | 'diagnostic' | 'goal';
export type MemoryBindingSource = 'deterministic';
export interface MemoryEntityRecord {
    entityId: string;
    projectId?: string;
    canonicalName: string;
    entityType: MemoryEntityType;
    aliases: string[];
    stablePath?: string;
    createdAt: number;
    updatedAt: number;
}
export interface MemoryTopicRecord {
    topicPath: string;
    projectId?: string;
    parentPath?: string;
    topicType: 'project' | 'person' | 'object' | 'event' | 'place' | 'time' | 'concept';
    summary?: string;
    createdAt: number;
    updatedAt: number;
}
export interface MemoryBindingRecord {
    bindingId: string;
    eventId: string;
    projectId?: string;
    role?: string;
    rawEventType?: string;
    entityId?: string;
    entityName?: string;
    entityType?: MemoryEntityType;
    topicPath: string;
    bindingType: MemoryBindingType;
    confidence: number;
    source: MemoryBindingSource;
    signal: string;
    createdAt: number;
}
export interface MemoryBindingInput {
    eventId: string;
    projectId?: string;
    role?: string;
    rawEventType?: string;
    entityId?: string;
    entityName?: string;
    entityType?: MemoryEntityType;
    topicPath: string;
    bindingType: MemoryBindingType;
    confidence: number;
    source: MemoryBindingSource;
    signal: string;
    createdAt?: number;
}
export interface MemoryBindingListOptions {
    projectId?: string;
    eventId?: string;
    topicPath?: string;
    entityName?: string;
    bindingType?: MemoryBindingType;
    role?: string;
    limit?: number;
}
export interface MemoryBindingStats {
    bindings: number;
    topics: number;
    entities: number;
}
//# sourceMappingURL=MemoryBindingTypes.d.ts.map