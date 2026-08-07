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
    supportSourceType?: string;
    supportSourceId?: string;
    operation?: 'append' | 'replace' | 'revision';
    createdAt?: number;
    updatedAt?: number;
}
export declare function mergeMemoryEdge(db: Database, input: MemoryEdgeMergeInput): string;
export declare function invalidateMemoryEdgeSupportIds(db: Database, supportIds: readonly string[], now?: number, reduce?: boolean): string[];
export declare function reduceMemoryEdges(db: Database, edgeIds: Iterable<string>, now?: number): void;
export declare function reduceMemoryEdge(db: Database, edgeId: string, now?: number): void;
//# sourceMappingURL=MemoryEdgeMerge.d.ts.map