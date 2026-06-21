import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import type { MemoryAtlasNodeDetail, MemoryAtlasPathResult, MemoryAtlasQueryOptions, MemoryAtlasSlice, MemoryAtlasTimelineResult } from './MemoryAtlasTypes.js';
export declare class MemoryAtlasService {
    private store;
    private eventStore;
    constructor(store: MemoryAtlasStore, eventStore: EventStore);
    overview(options: MemoryAtlasQueryOptions): MemoryAtlasSlice;
    search(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasSlice;
    explore(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasSlice;
    node(nodeId: string, options: MemoryAtlasQueryOptions): MemoryAtlasNodeDetail | null;
    neighbors(nodeId: string, options: MemoryAtlasQueryOptions & {
        hops?: number;
    }): MemoryAtlasSlice;
    path(from: string, to: string, options: MemoryAtlasQueryOptions & {
        maxHops?: number;
    }): MemoryAtlasPathResult;
    timeline(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasTimelineResult;
    private evidence;
    private edgesFor;
    private safeEdges;
    private adjacentEdges;
    private directEdgesToTarget;
}
//# sourceMappingURL=MemoryAtlasService.d.ts.map