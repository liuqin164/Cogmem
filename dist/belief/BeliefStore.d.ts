import type { BeliefCandidate, BeliefConflictCandidate, BeliefEvidenceRecord, BeliefRecord, BeliefRevisionDecision } from '../types/index.js';
import { EventStore } from '../store/EventStore.js';
import type { PolicyExecutionRecord } from '../store/PolicyExecutionStore.js';
export declare class BeliefStore {
    private eventStore?;
    private static readonly SOURCE_TRUST;
    private static readonly SCOPE_PRIORITY;
    private db;
    constructor(dbPath?: string, eventStore?: EventStore | undefined);
    private initializeSchema;
    findByCanonicalKey(canonicalKey: string): BeliefRecord[];
    countActive(projectId?: string): number;
    listByTimeRange(startTime: number, endTime: number, options?: {
        projectId?: string;
        statuses?: Array<'active' | 'superseded' | 'revoked' | 'suspect' | 'expired'>;
        limit?: number;
    }): BeliefRecord[];
    getActiveBeliefsForQuery(input: {
        query: string;
        projectId?: string;
        limit?: number;
        atTime?: number;
        intent?: 'fact_lookup' | 'preference_lookup' | 'decision_lookup' | 'constraint_lookup' | 'trace' | 'debug_context' | 'recall';
        entities?: string[];
        mustMatch?: string[];
        shouldMatch?: string[];
        semantics?: {
            subjectHint?: string;
            predicateHint?: 'preference' | 'decision' | 'constraint' | 'fact' | 'workflow' | 'graph' | 'sequence' | 'plan';
            entityHints: string[];
            valueHints: string[];
            conditionHints: string[];
            environmentHints: string[];
            stateHints: string[];
            policyHints: string[];
            asksForHistory: boolean;
        };
    }): BeliefRecord[];
    getBeliefHistoryForCanonicalKeys(canonicalKeys: string[], options?: {
        includeStatuses?: Array<'active' | 'superseded' | 'revoked' | 'suspect' | 'expired'>;
        limitPerCanonical?: number;
    }): Map<string, BeliefRecord[]>;
    getExecutionFeedbackNeuronSignals(records: PolicyExecutionRecord[]): Array<{
        neuronId: string;
        matchedExecutions: number;
        executed: number;
        failed: number;
        latestUpdatedAt?: number;
    }>;
    applyExecutionFeedbackCalibration(records: PolicyExecutionRecord[], now?: number): number;
    getEvidenceNeuronIds(beliefIds: string[], limitPerBelief?: number): string[];
    upsert(candidate: BeliefCandidate, now?: number): {
        belief: BeliefRecord | null;
        decision: BeliefRevisionDecision;
    };
    attachEvidence(records: BeliefEvidenceRecord[]): void;
    resolveConflict(incoming: BeliefCandidate, conflicts: BeliefConflictCandidate[], now?: number): BeliefRevisionDecision;
    private compareBeliefs;
    private computeBeliefStrength;
    private resolveWeightMatrix;
    private computeTemporalFreshness;
    private computeScopeWeight;
    private buildContradictionGroup;
    private mapBelief;
    private isSameBeliefValue;
    private toCanonicalKey;
    private getSourceTrust;
    private getScopePriority;
    private scoreBeliefForQuery;
    private computeExecutionFeedbackForBelief;
    private extractQueryTokens;
    private extractStructuredTargets;
    private pickEntityToken;
    private clamp;
    close(): void;
}
//# sourceMappingURL=BeliefStore.d.ts.map