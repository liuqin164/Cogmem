import type { MemoryDimension } from './MemoryFrameTypes.js';
export declare function normalizeAlias(value: string): string;
export interface CanonicalMemoryCandidate {
    nodeId: string;
    label: string;
    dimension: MemoryDimension;
    confidence: number;
}
export declare function resolveCanonicalAlias(label: string, dimension: MemoryDimension, candidates: CanonicalMemoryCandidate[]): CanonicalMemoryCandidate | undefined;
export declare function containsCanonicalAlias(text: string, alias: string): boolean;
export declare function resolveTextAlias<T extends {
    stableId: string;
    aliases: string[];
}>(text: string, candidates: T[]): T | undefined;
//# sourceMappingURL=CanonicalMemoryResolver.d.ts.map