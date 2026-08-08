import type { MemoryQueryFrameV1 } from '../semantic/MemoryFrameTypes.js';
export declare class MultidimensionalQueryPlanner {
    plan(query: string, context?: {
        now?: number;
        localDateNow?: string;
        timeZone?: string;
    } | number): MemoryQueryFrameV1;
    private states;
    private intent;
    private timeRange;
}
//# sourceMappingURL=MultidimensionalQueryPlanner.d.ts.map