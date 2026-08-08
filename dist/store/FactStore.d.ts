import Database from 'bun:sqlite';
import type { EncryptionProvider } from '../encryption/index.js';
export interface FactRecord {
    factId: string;
    neuronId: string;
    unitId?: string;
    subject: string;
    predicateFamily: string;
    predicateValue?: string;
    object?: string;
    entityId?: string;
    timeText?: string;
    validFrom: number;
    validTo?: number;
    certaintyLevel: 'certain' | 'probable' | 'possible' | 'denied';
    confidence: number;
    status: 'provisional' | 'verified' | 'superseded' | 'archived' | 'rejected' | 'provisional_enriched' | 'enriched_candidate';
    sourceText: string;
    metadata?: Record<string, unknown>;
}
export interface EventRecord {
    eventId: string;
    neuronId: string;
    unitId?: string;
    eventType: string;
    actor?: string;
    target?: string;
    payload?: Record<string, unknown>;
    timeText?: string;
    validFrom: number;
    validTo?: number;
    confidence: number;
    status: 'provisional' | 'verified' | 'archived';
}
export declare class FactStore {
    private readonly encryptionProvider?;
    private db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string, encryptionProvider?: EncryptionProvider | undefined);
    private initializeSchema;
    insertFacts(facts: Array<Omit<FactRecord, 'factId'>>): FactRecord[];
    insertEvents(events: Array<Omit<EventRecord, 'eventId'>>): EventRecord[];
    listFactsByNeuron(neuronId: string): FactRecord[];
    getFactById(factId: string): FactRecord | null;
    listFactsBySubjectPredicate(subject: string, predicateFamily: string, options?: {
        limit?: number;
        statuses?: FactRecord['status'][];
    }): FactRecord[];
    listFactsByNeuronIds(neuronIds: string[], limit?: number): FactRecord[];
    listFactsByEntityIds(entityIds: string[], options?: {
        predicateFamilies?: string[];
        limit?: number;
        projectId?: string;
    }): FactRecord[];
    listNeuronIdsByEntityIds(entityIds: string[], limit?: number): string[];
    listEventsByNeuronIds(neuronIds: string[], limit?: number, projectId?: string): EventRecord[];
    listEventsByUnitId(unitId: string): EventRecord[];
    listEventsByUnitIds(unitIds: string[], limit?: number): EventRecord[];
    listFactsByTimeRange(startTime: number, endTime: number, options?: {
        statuses?: FactRecord['status'][];
        limit?: number;
        projectId?: string;
    }): FactRecord[];
    listEventsByTimeRange(startTime: number, endTime: number, options?: {
        statuses?: EventRecord['status'][];
        limit?: number;
        projectId?: string;
    }): EventRecord[];
    updateFactStatus(factId: string, status: FactRecord['status'], confidence?: number, metadata?: Record<string, unknown>): void;
    bindFactEntity(factId: string, entityId: string, confidence?: number, metadata?: Record<string, unknown>): void;
    updateFactMetadata(factId: string, metadata: Record<string, unknown>): void;
    getDatabase(): Database;
    updateEventStatus(eventId: string, status: EventRecord['status'], confidence?: number): void;
    close(): void;
    private mapFact;
    private mapEvent;
    private encodeText;
    private decodeText;
}
//# sourceMappingURL=FactStore.d.ts.map