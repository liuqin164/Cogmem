import type { MemoryDimension } from './MemoryFrameTypes.js';
export declare function normalizeAlias(value: string): string;
export interface CanonicalMemoryCandidate {
    nodeId: string;
    label: string;
    dimension: MemoryDimension;
    confidence: number;
}
export declare function resolveCanonicalAlias(label: string, dimension: MemoryDimension, candidates: CanonicalMemoryCandidate[]): CanonicalMemoryCandidate | undefined;
//# sourceMappingURL=CanonicalMemoryResolver.d.ts.map