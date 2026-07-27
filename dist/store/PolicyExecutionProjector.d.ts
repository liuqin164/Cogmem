import type { MemoryEvent } from '../types/index.js';
import { EventStore } from './EventStore.js';
import { PolicyExecutionStore } from './PolicyExecutionStore.js';
import { PolicyProjectionStore } from './PolicyProjectionStore.js';
export declare class PolicyExecutionProjector {
    private eventStore;
    private executionStore;
    private projectionStore;
    private projectId;
    private projectionName;
    constructor(eventStore: EventStore, executionStore: PolicyExecutionStore, projectionStore: PolicyProjectionStore, projectId: string, projectionName?: string);
    bootstrap(): Promise<void>;
    fullRebuild(reason: string): Promise<void>;
    replay(events: MemoryEvent[], previousRebuildAt?: number): Promise<void>;
    private applyEvent;
    private isPolicyExecutionEvent;
}
//# sourceMappingURL=PolicyExecutionProjector.d.ts.map