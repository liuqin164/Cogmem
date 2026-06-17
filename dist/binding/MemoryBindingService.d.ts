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
    constructor(store: MemoryBindingStore);
    bindRawEvent(event: MemoryEvent): MemoryBindingRecord[];
    bindEvent(input: MemoryBindingEventInput): MemoryBindingRecord[];
    recallGraphAnchors(query: string, options?: {
        projectId?: string;
        limit?: number;
    }): MemoryGraphRecallAnchor[];
}
//# sourceMappingURL=MemoryBindingService.d.ts.map