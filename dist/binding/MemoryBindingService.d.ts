import type { MemoryEvent } from '../types/index.js';
import type { MemoryBindingRecord, MemoryGraphRecallAnchor } from './MemoryBindingTypes.js';
import { MemoryBindingStore } from '../store/MemoryBindingStore.js';
import { EntityStore } from '../store/EntityStore.js';
export interface MemoryBindingEventInput {
    eventId: string;
    projectId?: string;
    role?: string;
    rawEventType?: string;
    text: string;
    occurredAt?: number;
}
export declare class MemoryBindingService {
    private readonly store;
    private readonly entityStore?;
    private readonly classifier;
    private readonly decisionEngine;
    constructor(store: MemoryBindingStore, entityStore?: EntityStore | undefined);
    bindRawEvent(event: MemoryEvent): MemoryBindingRecord[];
    bindEvent(input: MemoryBindingEventInput): MemoryBindingRecord[];
    isBindableRawEvent(event: MemoryEvent): boolean;
    recallGraphAnchors(query: string, options?: {
        projectId?: string;
        limit?: number;
    }): MemoryGraphRecallAnchor[];
    private rawEventText;
}
//# sourceMappingURL=MemoryBindingService.d.ts.map