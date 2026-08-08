import type { MemoryEvent } from '../types/index.js';
import { MemoryGraph } from '../core/MemoryGraph.js';
import { EventStore } from './EventStore.js';
import type { IVectorStore } from './IVectorStore.js';
/**
 * 基于 memory_events 的最小向量投影器。
 * 目标：
 * - 启动时优先 replay 增量事件
 * - 只有在 checkpoint 不可信时才 full rebuild
 */
export declare class VectorProjector {
    private eventStore;
    private memoryGraph;
    private vectorStore;
    private projectionName;
    constructor(eventStore: EventStore, memoryGraph: MemoryGraph, vectorStore: IVectorStore, projectionName?: string);
    bootstrap(): Promise<void>;
    fullRebuild(reason: string): Promise<void>;
    replay(events: MemoryEvent[], previousRebuildAt?: number): Promise<void>;
    private applyEvent;
    private applyEventToMap;
}
//# sourceMappingURL=VectorProjector.d.ts.map