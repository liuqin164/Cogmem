import type { MemoryEvent } from '../types/index.js';
export interface EpisodeTitleInput {
    episodeId: string;
    summary?: string | null;
    topicPath?: string | null;
    episodeType?: string | null;
    startedAt?: number | null;
    events: MemoryEvent[];
}
export interface EpisodeTitleResult {
    displayTitle: string;
    oneLineSummary: string;
    topicHints: string[];
    issueHints: string[];
    eventKind: string;
    userIntent?: string;
    localDate?: string;
    confidence: number;
    reviewNeeded: boolean;
    sourceEventIds: string[];
    generatorTrace: {
        usedUserText: boolean;
        usedAssistantText: boolean;
        fallback: boolean;
        matchedRules: string[];
    };
}
export declare class EpisodeTitleGenerator {
    generate(input: EpisodeTitleInput): EpisodeTitleResult;
}
//# sourceMappingURL=EpisodeTitleGenerator.d.ts.map