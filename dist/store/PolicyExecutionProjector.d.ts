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
    private replayRange;
    private writeCheckpoint;
    private applyEvent;
}
//# sourceMappingURL=PolicyExecutionProjector.d.ts.map