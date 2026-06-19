import Database from 'bun:sqlite';
import type { GovernanceEvidenceRecord } from '../governance/MemoryGovernanceValidator.js';
import { EntityStore } from '../store/EntityStore.js';
export type EntityMergeCandidateStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'reverted';
export interface EntityMergeCandidate {
    candidateId: string;
    projectId?: string;
    sourceEntityId: string;
    targetEntityId: string;
    alias: string;
    confidence: number;
    status: EntityMergeCandidateStatus;
    reviewReasons: string[];
    evidenceEventIds: string[];
    createdAt: number;
    updatedAt: number;
    version: number;
}
export interface ProposeEntityMergeInput {
    projectId?: string;
    sourceEntityId: string;
    targetEntityId: string;
    alias: string;
    confidence: number;
    evidenceEventIds: string[];
    now?: number;
}
export declare class EntityGovernanceService {
    private readonly db;
    private readonly entities;
    private readonly findEvidence;
    constructor(db: Database, entities: EntityStore, findEvidence: (eventId: string) => GovernanceEvidenceRecord | undefined);
    proposeMerge(input: ProposeEntityMergeInput): EntityMergeCandidate;
    apply(candidateId: string, now?: number): EntityMergeCandidate;
    revert(candidateId: string, now?: number): EntityMergeCandidate;
    get(candidateId: string): EntityMergeCandidate | null;
    list(options?: {
        projectId?: string;
        status?: EntityMergeCandidateStatus;
        limit?: number;
    }): EntityMergeCandidate[];
    private requireEntity;
    private requireCandidate;
    private updateStatus;
    private initializeSchema;
}
//# sourceMappingURL=EntityGovernanceService.d.ts.map