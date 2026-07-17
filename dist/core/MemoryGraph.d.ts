import Database from 'bun:sqlite';
import type { MemoryAnchor, MemoryImportanceLevel, Neuron, NeuronMetadata, NeuronType, Synapse, TopicNode } from '../types/index.js';
export interface VectorPageRow {
    id: string;
    vector: number[];
}
export interface TopicReclassifiedObservation {
    type: 'TopicReclassified';
    neuronId: string;
    projectId?: string;
    from: string | undefined;
    to: string | undefined;
    content: string;
    timestamp: number;
}
export interface TimeProjectionNeuron {
    id: string;
    projectId: string;
    createdAt: number;
    title: string;
}
export declare class MemoryGraph {
    private db;
    private readonly ownsDb;
    private timeIndex;
    private projectIndex;
    private anchorIndex;
    private topicReclassifiedListeners;
    constructor(dbOrPath?: Database | string);
    private initializeSchema;
    private ensureCompatibilityColumns;
    addNeuron(neuron: Neuron): number;
    addNeuronInTransaction(neuron: Neuron): number;
    indexCommittedNeuron(neuron: Neuron): void;
    private recordTimeProjectionSourceMutation;
    private insertNeuron;
    private insertIntoFTS;
    rebuildIndexes(): void;
    private updateMemoryIndexes;
    addSynapse(sourceId: string, synapse: Synapse): void;
    getNeuron(id: string): Neuron | null;
    getNeuronIdsByProject(projectId: string): string[];
    listTimeProjectionNeurons(projectId?: string, options?: {
        afterCreatedAt?: number;
        afterId?: string;
        limit?: number;
    }): TimeProjectionNeuron[];
    getSynapses(sourceId: string): Synapse[];
    getAllNeurons(): Neuron[];
    findNeuronsByType(type: NeuronType, options?: {
        projectId?: string;
        topicPath?: string;
        limit?: number;
    }): Neuron[];
    listNeuronsByTimeRange(startTime: number, endTime: number, projectId?: string): Neuron[];
    private mapNeuron;
    private encodeAaakSummary;
    private decodeAaakSummary;
    private decodeProceduralLink;
    private decodeVectorBlob;
    createAnchor(neuronIds: string[], projectId?: string): MemoryAnchor;
    private computeAnchorSummary;
    getLatestAnchor(projectId?: string): MemoryAnchor | null;
    getLatestNeuronSelfHash(projectId?: string): string | null;
    fullTextSearch(query: string, projectId?: string, limit?: number): string[];
    private toFTSQuery;
    private extractFallbackSearchTokens;
    private fallbackTextSearch;
    transaction(fn: () => void): void;
    close(): void;
    getStats(): {
        neuronCount: number;
        synapseCount: number;
        anchorCount: number;
    };
    findSimilarNeurons(vector: number[], topK: number): Array<{
        id: string;
        score: number;
    }>;
    private cosineSimilarity;
    updateNeuronStatus(neuronId: string, status: 'active' | 'cold' | 'archived'): void;
    updateNeuronMetadata(neuronId: string, metadata: Partial<NeuronMetadata>): void;
    onTopicReclassified(listener: (observation: TopicReclassifiedObservation) => void): () => void;
    getTopicPaths(projectId?: string): string[];
    getNeuronIdsByTopicPrefix(prefix: string, projectId?: string): string[];
    buildTopicTree(projectId?: string): TopicNode[];
    updateNeuronContent(neuronId: string, content: string): void;
    updateNeuronImportance(neuronId: string, importanceLevel: MemoryImportanceLevel, isPinned?: boolean): void;
    listPinnedNeurons(options?: number | {
        limit?: number;
        projectId?: string;
    }): Neuron[];
    getRecentNeurons(options?: {
        sinceMs?: number;
        limit?: number;
        projectId?: string;
    }): Neuron[];
    hasSynapse(sourceId: string, targetId: string): boolean;
    getNeuronEnergy(neuronId: string): number;
    getOrphanNeuronIds(limit: number): string[];
    getNeuronIdsForReinforcement(limit: number): string[];
    getNeuronIdsForTransition(limit: number): string[];
    getArchivedFileNeurons(): Neuron[];
    iterateNeuronVectors(pageSize: number, options?: {
        includeStatuses?: Array<'active' | 'cold' | 'suspect' | 'archived'>;
        projectId?: string;
        onlyNotDeleted?: boolean;
    }): IterableIterator<VectorPageRow[]>;
    forEachNeuronVectorPage(pageSize: number, onPage: (rows: VectorPageRow[]) => Promise<void> | void, options?: {
        includeStatuses?: Array<'active' | 'cold' | 'suspect' | 'archived'>;
        projectId?: string;
        onlyNotDeleted?: boolean;
    }): Promise<void>;
}
//# sourceMappingURL=MemoryGraph.d.ts.map