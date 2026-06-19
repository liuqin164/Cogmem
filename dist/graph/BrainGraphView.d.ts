import type { MemoryEdgeRecord } from '../binding/MemoryBindingTypes.js';
import { MemoryBindingStore } from '../store/MemoryBindingStore.js';
export interface BrainGraphTraversalOptions {
    projectId?: string;
    maxHops?: number;
    limit?: number;
}
export interface BrainGraphTraversalResult {
    rootId: string;
    nodeIds: string[];
    edges: MemoryEdgeRecord[];
    evidenceEventIds: string[];
    truncated: boolean;
}
export declare class BrainGraphView {
    private readonly store;
    constructor(store: MemoryBindingStore);
    neighbors(rootId: string, options?: BrainGraphTraversalOptions): BrainGraphTraversalResult;
}
//# sourceMappingURL=BrainGraphView.d.ts.map