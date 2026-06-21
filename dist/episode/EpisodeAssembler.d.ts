import type { MemoryEvent } from '../types/index.js';
import { type TurnClassificationContext, type TurnRelationAdvisoryReviewer } from './TurnRelationClassifier.js';
import type { EpisodeClosureReceipt, MemoryEpisode } from './EpisodeTypes.js';
import { EpisodeStore } from './EpisodeStore.js';
export interface EpisodeAssemblyResult {
    episode?: MemoryEpisode;
    assignedEventIds: string[];
    unassignedEventIds: string[];
    ignoredEventIds: string[];
    closureReceipt?: EpisodeClosureReceipt;
    reopened: boolean;
}
export declare class EpisodeAssembler {
    private readonly store;
    private readonly resolveEvent?;
    private readonly softReopenWindowMs;
    private readonly reviewer?;
    private readonly resolveTopicContext?;
    constructor(store: EpisodeStore, resolveEvent?: ((eventId: string) => MemoryEvent | null | undefined) | undefined, softReopenWindowMs?: number, reviewer?: TurnRelationAdvisoryReviewer | undefined, resolveTopicContext?: ((primary: MemoryEvent, episode?: MemoryEpisode) => Partial<TurnClassificationContext>) | undefined);
    appendTurn(events: MemoryEvent[], input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        conversationThreadId?: string;
        now?: number;
        batchSeal?: boolean;
        forceBatchSeal?: boolean;
    }): EpisodeAssemblyResult;
    appendTurnAsync(events: MemoryEvent[], input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        conversationThreadId?: string;
        now?: number;
        batchSeal?: boolean;
        forceBatchSeal?: boolean;
    }): Promise<EpisodeAssemblyResult>;
    private appendTurnClassified;
    appendEvent(event: MemoryEvent, input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        now?: number;
    }): EpisodeAssemblyResult;
    appendEventAsync(event: MemoryEvent, input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        now?: number;
    }): Promise<EpisodeAssemblyResult>;
    private classificationContext;
    private classifyPrimary;
}
//# sourceMappingURL=EpisodeAssembler.d.ts.map