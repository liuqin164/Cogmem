import type { MemoryEvent } from '../types/index.js';
import type { MemoryBindingRecord, MemoryGraphRecallAnchor } from './MemoryBindingTypes.js';
import { MemoryBindingStore } from '../store/MemoryBindingStore.js';
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
    private readonly classifier;
    constructor(store: MemoryBindingStore);
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