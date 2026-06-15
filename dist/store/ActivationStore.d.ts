import Database from 'bun:sqlite';
export interface ActivationTouchInput {
    neuronId: string;
    projectId?: string;
    delta?: number;
    source?: string;
    touchedAt?: number;
}
export interface ActivationDecayOptions {
    projectId?: string;
    factor?: number;
    floor?: number;
    now?: number;
}
export interface ActivationHotspot {
    neuronId: string;
    projectId?: string;
    activation: number;
    touchCount: number;
    lastTouchedAt: number;
    source?: string;
}
export interface ActivationDecayResult {
    decayedCount: number;
    removedCount: number;
    factor: number;
    floor: number;
}
export declare class ActivationStore {
    private readonly db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string);
    touch(input: ActivationTouchInput): ActivationHotspot;
    get(neuronId: string): ActivationHotspot | null;
    getTop(options?: {
        projectId?: string;
        limit?: number;
        excludeNeuronIds?: string[];
    }): ActivationHotspot[];
    decay(options?: ActivationDecayOptions): ActivationDecayResult;
    close(): void;
    private initializeSchema;
}
//# sourceMappingURL=ActivationStore.d.ts.map