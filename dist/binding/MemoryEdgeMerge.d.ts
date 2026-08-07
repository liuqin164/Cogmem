import type Database from 'bun:sqlite';
export interface MemoryEdgeMergeInput {
    projectId?: string;
    sourceType: string;
    sourceId: string;
    relationType: string;
    targetType: string;
    targetId: string;
    confidence: number;
    baseWeight?: number;
    stability?: number;
    activation?: number;
    evidenceEventIds: string[];
    status?: string;
    validFrom?: number;
    validTo?: number | null;
    version?: number;
    sourceAuthority?: string;
    createdAt?: number;
    updatedAt?: number;
}
export declare function mergeMemoryEdge(db: Database, input: MemoryEdgeMergeInput): string;
//# sourceMappingURL=MemoryEdgeMerge.d.ts.map