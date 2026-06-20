import type { MemoryEvent } from '../types/index.js';
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
    private readonly softReopenWindowMs;
    constructor(store: EpisodeStore, softReopenWindowMs?: number);
    appendTurn(events: MemoryEvent[], input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        now?: number;
        batchSeal?: boolean;
    }): EpisodeAssemblyResult;
    appendEvent(event: MemoryEvent, input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        now?: number;
    }): EpisodeAssemblyResult;
}
//# sourceMappingURL=EpisodeAssembler.d.ts.map