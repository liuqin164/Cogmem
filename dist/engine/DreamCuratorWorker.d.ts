import type { DeepWriteCandidateRecord } from '../store/DeepWriteCandidateStore.js';
import type { DeepWriteCandidateStore } from '../store/DeepWriteCandidateStore.js';
import type { DreamBacklogStatus, DreamLedgerStore } from '../store/DreamLedgerStore.js';
import type { EventStore } from '../store/EventStore.js';
import type { ModelRegistry } from '../models/ModelRegistry.js';
import type { TextGenerateFn } from '../models/ModelRole.js';
export interface DreamCuratorRunOptions {
    projectId?: string;
    limit?: number;
    mode?: 'candidate' | 'shadow';
    now?: number;
    generateText?: TextGenerateFn;
}
export interface DreamCuratorRunResult {
    runId?: string;
    projectId?: string;
    skipped: boolean;
    reason?: string;
    processedEventCount: number;
    dreamableEventCount: number;
    candidateCount: number;
    maxGlobalSeq?: number;
    status: DreamBacklogStatus;
    candidates: DeepWriteCandidateRecord[];
}
export interface DreamCuratorWorkerDeps {
    eventStore: EventStore;
    dreamLedgerStore: DreamLedgerStore;
    candidateStore: DeepWriteCandidateStore;
    modelRegistry?: ModelRegistry;
}
export declare class DreamCuratorWorker {
    private readonly deps;
    constructor(deps: DreamCuratorWorkerDeps);
    run(options?: DreamCuratorRunOptions): Promise<DreamCuratorRunResult>;
    private buildCandidates;
    private buildProviderCandidates;
    private flattenProviderCandidates;
    private buildSemanticOrganizationCandidates;
    private providerEvidenceFor;
    private providerDiagnosticCandidate;
    private supersedeProviderWarnings;
    private resolveGenerateText;
    private resolveProviderConfig;
    private isDreamableEvent;
    private toEvidence;
    private singleSessionId;
}
//# sourceMappingURL=DreamCuratorWorker.d.ts.map