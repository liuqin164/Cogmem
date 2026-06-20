import Database from 'bun:sqlite';
export type ProspectiveMemoryType = 'intention' | 'commitment' | 'reminder' | 'open_loop' | 'plan';
export type ProspectiveMemoryStatus = 'pending' | 'confirmed' | 'deferred' | 'rejected' | 'completed' | 'expired';
export type ProspectiveMemoryProposer = 'deterministic' | 'model_candidate' | 'operator';
export interface ProspectiveEvidenceRecord {
    eventId: string;
    projectId?: string;
    role?: string;
    globalSeq?: number;
    content?: string;
}
export interface ProspectiveMemoryRecord {
    candidateId: string;
    projectId: string;
    candidateType: ProspectiveMemoryType;
    canonicalKey: string;
    title: string;
    details?: string;
    status: ProspectiveMemoryStatus;
    proposedBy: ProspectiveMemoryProposer;
    evidenceEventIds: string[];
    confirmationEvidenceEventId?: string;
    dueAt?: number;
    deferredUntil?: number;
    version: number;
    createdAt: number;
    updatedAt: number;
}
export interface ProposeProspectiveMemoryInput {
    projectId: string;
    candidateType: ProspectiveMemoryType;
    canonicalKey: string;
    title: string;
    details?: string;
    evidenceEventIds: string[];
    proposedBy: ProspectiveMemoryProposer;
    dueAt?: number;
}
export type ResolveProspectiveMemoryInput = {
    action: 'confirm';
    confirmationEvidenceEventId: string;
} | {
    action: 'reject';
} | {
    action: 'defer';
    deferredUntil: number;
} | {
    action: 'complete';
} | {
    action: 'expire';
};
export interface ProspectiveMemoryListOptions {
    projectId: string;
    statuses?: ProspectiveMemoryStatus[];
    limit?: number;
}
export type ProspectiveEvidenceLookup = (eventId: string) => ProspectiveEvidenceRecord | undefined;
export declare class ProspectiveMemoryService {
    private readonly db;
    private readonly findEvidence;
    constructor(db: Database, findEvidence: ProspectiveEvidenceLookup);
    propose(input: ProposeProspectiveMemoryInput): ProspectiveMemoryRecord;
    private proposeInTransaction;
    resolve(candidateId: string, input: ResolveProspectiveMemoryInput, projectId: string): ProspectiveMemoryRecord;
    private resolveInTransaction;
    get(candidateId: string, projectId: string): ProspectiveMemoryRecord | null;
    list(options: ProspectiveMemoryListOptions): ProspectiveMemoryRecord[];
    listDue(input: {
        projectId: string;
        atTime?: number;
        limit?: number;
    }): ProspectiveMemoryRecord[];
    private getLatest;
    private getUnscoped;
    private recordTransition;
    private mapRow;
    private initializeSchema;
}
//# sourceMappingURL=ProspectiveMemoryService.d.ts.map