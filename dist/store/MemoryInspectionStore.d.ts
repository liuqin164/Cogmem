import type { DeepWriteCandidateRecord, DeepWriteCandidateStatus } from './DeepWriteCandidateStore.js';
export interface MemoryInspectionScope {
    projectId?: string;
    workspaceId?: string;
    threadId?: string;
    sessionId?: string;
}
export interface MemoryInspectionStatus {
    rawEventCount: number;
    rawEvents: number;
    vectorCount: number;
    vectors: number;
    vectorState: {
        indexed: number;
        liveEmbeddings: number;
        recallAvailableWithoutVectors: boolean;
        status: 'not_indexed' | 'indexed';
    };
    dreamedRawCount: number;
    undreamedRawCount: number;
    dreamCoverageRate: number;
    lastDreamedGlobalSeq?: number;
    lastDreamedAt?: number;
    dreamBacklog: Record<string, unknown>;
    episodeDream: Record<string, unknown>;
    dreamCandidateQueue: {
        candidate: number;
        needsConfirmation: number;
        promoted: number;
        rejected: number;
        superseded: number;
        shadow: number;
    };
    activeBeliefs: number;
}
/**
 * A query-only operational view. It deliberately does not initialize or migrate
 * schema, so status/candidate inspection can run beside an MCP process without
 * acquiring a write lock or changing an empty database.
 */
export declare class MemoryInspectionStore {
    private readonly dbPath;
    private db?;
    constructor(dbPath: string);
    status(scope?: MemoryInspectionScope): MemoryInspectionStatus;
    listCandidates(options: {
        projectId?: string;
        status: DeepWriteCandidateStatus;
        limit: number;
    }): DeepWriteCandidateRecord[];
    close(): void;
    private tableExists;
    private countTable;
    private countScopedEvents;
    private countRawEvents;
    private readDreamState;
    private episodeDream;
    private candidateQueue;
    private countBeliefs;
}
//# sourceMappingURL=MemoryInspectionStore.d.ts.map