import Database from 'bun:sqlite';
export type BeliefOwnership = 'user' | 'project' | 'system';
export type GovernedBeliefType = 'preference' | 'goal' | 'boundary' | 'decision' | 'fact' | 'observation';
export type GovernedBeliefStatus = 'active' | 'weak' | 'needs_confirmation' | 'possible_conflict' | 'superseded' | 'rejected';
export type BeliefRelation = 'assert' | 'reinforce' | 'correct' | 'contradict';
export interface BeliefEvidenceRecord {
    eventId: string;
    projectId?: string;
    role?: string;
}
export interface GovernedBeliefRecord {
    beliefId: string;
    projectId?: string;
    ownership: BeliefOwnership;
    beliefType: GovernedBeliefType;
    canonicalKey: string;
    statement: string;
    status: GovernedBeliefStatus;
    confidence: number;
    version: number;
    validFrom: number;
    validTo?: number;
    supersedesBeliefId?: string;
    supersededByBeliefId?: string;
    evidenceEventIds: string[];
    sourceRoles: string[];
    createdAt: number;
    updatedAt: number;
}
export interface ApplyBeliefInput {
    projectId?: string;
    ownership: BeliefOwnership;
    beliefType: GovernedBeliefType;
    canonicalKey: string;
    statement: string;
    evidenceEventIds: string[];
    relation?: BeliefRelation;
    confidence?: number;
    reason?: string;
    occurredAt?: number;
}
export type BeliefEvidenceLookup = (eventId: string) => BeliefEvidenceRecord | undefined;
export declare class BeliefGovernanceService {
    private readonly db;
    private readonly findEvidence;
    constructor(db: Database, findEvidence: BeliefEvidenceLookup);
    apply(input: ApplyBeliefInput): GovernedBeliefRecord;
    getById(beliefId: string): GovernedBeliefRecord | null;
    getCurrent(projectId: string | undefined, canonicalKey: string): GovernedBeliefRecord[];
    getHistory(projectId: string | undefined, canonicalKey: string): GovernedBeliefRecord[];
    private reinforce;
    private insertEvidence;
    private insertVersion;
    private mapRow;
    private normalizeStatement;
    private clamp;
    private initializeSchema;
}
//# sourceMappingURL=BeliefGovernanceService.d.ts.map