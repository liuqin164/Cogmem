import type { BrainRecallResult } from './BrainRecallResult.js';
import type { Neuron } from './index.js';
export interface ILLMClarifier {
    clarify(prompt: string, evidence: BrainRecallResult): Promise<{
        finalAnswer: string;
    } | string>;
}
export interface SkillCandidateLike {
    skillId: string;
    skillVersion?: string;
    description: string;
    intentTags?: string[];
    successRate?: number;
    executionCount?: number;
    lastExecutedAt?: number;
    relevanceScore?: number;
    confidence?: number;
}
export interface ISkillDiscovery {
    findCandidates(query: string, projectId?: string, topK?: number): SkillCandidateLike[];
}
export interface ISkillMemoryStore {
    recordExecution(skillId: string, success: boolean, failureReason?: string): void;
    listAll(): Neuron[];
    getExecutionStatsForTags?(tags: string[], options?: {
        projectId?: string;
        before?: number;
        after?: number;
    }): Record<string, {
        samples: number;
        successRate: number;
    }>;
}
export interface IAuditLedger {
    getPendingVerificationEntries(projectId: string): Array<{
        proposalId: string;
        projectId: string;
        skillId: string;
        predictedImpact: unknown;
    }>;
    updateVerificationResult(proposalId: string, result: unknown): void;
    predictionStats?(intentTag: string): {
        accuracy: number;
        verifiedCount?: number;
        total?: number;
        verified?: number;
    };
}
export interface IProceduralBridge {
    scan(projectId: string): Promise<unknown> | unknown;
}
export interface AutonomyContext {
    readonly taskId?: string;
    readonly workspaceId?: string;
    readonly authorityId?: string;
    readonly autonomyMode?: 'observe' | 'safe_edit' | 'autonomous_local' | 'supervised';
}
export interface ChatSessionLike {
    getRecentTurns(limit?: number): Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
    }>;
    getRelevantTurns?(input: {
        query: string;
        projectId?: string;
        maxChars?: number;
    }): Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
    }>;
    getContextForLLM?(): string;
}
export interface QueryManagerLike {
    query(input: unknown): Promise<unknown> | unknown;
}
export interface ManagerRegistryLike {
    dispatch(intent: string, params?: Record<string, unknown>): Promise<unknown> | unknown;
}
export interface RuntimeSelfManifestLike {
    manifestId: string;
    generatedAt: number;
    capabilities: unknown[];
    models: {
        roles: unknown[];
    };
    fileAssets: {
        indexedAssetCount: number;
    };
    constraints: Array<{
        id: string;
    }>;
}
export interface GraphEdgeRecordLike {
    fromNodeId?: string;
    toNodeId?: string;
    edgeRecordId?: string;
    sourceNeuronId?: string;
    targetNeuronId?: string;
    fromNeuronId?: string;
    toNeuronId?: string;
    relation?: string;
    relationType?: string;
    weight?: number;
    status?: string;
}
export interface GraphEdgeStoreLike {
    list?(options?: unknown): GraphEdgeRecordLike[];
    listActiveNeighborEdges?(entityIds: string[], edgeTypes?: string[], limit?: number): GraphEdgeRecordLike[];
    appendEdge?(input: unknown): GraphEdgeRecordLike;
}
export interface ProposalLedgerLike {
    append?(items: unknown[]): void;
}
//# sourceMappingURL=ExtensionPoints.d.ts.map