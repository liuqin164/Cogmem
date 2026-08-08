import { EventStore } from './EventStore.js';
import { PlanRuntimeStore } from './PlanRuntimeStore.js';
import { RuntimeProjectionStore } from './RuntimeProjectionStore.js';
export declare class RuntimeProjector {
    private eventStore;
    private runtimeStore;
    private projectionStore;
    private projectionName;
    constructor(eventStore: EventStore, runtimeStore: PlanRuntimeStore, projectionStore: RuntimeProjectionStore, projectionName?: string);
    bootstrap(): Promise<void>;
    fullRebuild(reason: string): Promise<void>;
    private replayRange;
    private writeCheckpoint;
    private applyEvent;
}
//# sourceMappingURL=RuntimeProjector.d.ts.map