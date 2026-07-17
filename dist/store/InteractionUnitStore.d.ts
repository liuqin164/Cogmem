import Database from 'bun:sqlite';
export type InteractionUnitType = 'statement' | 'question' | 'proposal' | 'bound_reply';
export type PendingBindingType = 'action' | 'entity' | 'question';
export declare const BINDING_PRIORITY: Record<PendingBindingType, number>;
export interface InteractionUnitRecord {
    unitId: string;
    type: InteractionUnitType;
    messageNeuronIds: string[];
    semanticText: string;
    status: 'pending' | 'resolved';
    createdAt: number;
    updatedAt: number;
}
export interface PendingBindingRecord {
    pendingId: string;
    bindingType: PendingBindingType;
    unitId: string;
    referenceText: string;
    status: 'pending' | 'resolved';
    createdAt: number;
    updatedAt: number;
}
export declare class InteractionUnitStore {
    private db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string);
    private initializeSchema;
    createUnit(input: {
        type: InteractionUnitType;
        messageNeuronIds: string[];
        semanticText: string;
        status?: 'pending' | 'resolved';
        createdAt?: number;
    }): InteractionUnitRecord;
    registerPending(input: {
        bindingType: PendingBindingType;
        unitId: string;
        referenceText: string;
        createdAt?: number;
    }): PendingBindingRecord;
    getLatestPending(bindingTypes?: PendingBindingType[], maxAgeMs?: number, now?: number): PendingBindingRecord | null;
    getUnit(unitId: string): InteractionUnitRecord | null;
    listUnitsByNeuronIds(neuronIds: string[]): InteractionUnitRecord[];
    resolvePendingWithReply(input: {
        pendingId: string;
        replyNeuronId: string;
        semanticText: string;
        resolvedAt?: number;
    }): InteractionUnitRecord | null;
    close(): void;
    private mapUnit;
    private mapPending;
}
//# sourceMappingURL=InteractionUnitStore.d.ts.map