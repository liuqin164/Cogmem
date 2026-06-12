export interface NoisyOutputRecord {
    id: string;
    capabilityId: string;
    taskId: string;
    success: boolean;
    callCountThisTask: number;
    rawOutput: string;
    shouldFilter: boolean;
    reason: 'fetch_failed' | 'output_too_short' | 'call_limit_reached' | 'accepted';
}
export interface NoisyOutputDataset {
    name: string;
    items: NoisyOutputRecord[];
}
export declare function generateNoisyCorpus(size: number): NoisyOutputDataset;
//# sourceMappingURL=noisy_tool_output_corpus.d.ts.map