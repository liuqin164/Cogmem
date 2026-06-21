import type Database from 'bun:sqlite';
import { type MemoryOntologyClass } from '../ontology/MemoryOntology.js';
import type { TopicCreatedBy, TopicNode, TopicStatus } from './TopicTypes.js';
export declare class TopicPathRegistry {
    private readonly db;
    constructor(db: Database);
    create(input: {
        projectId: string;
        topicPath: string;
        canonicalName: string;
        parentTopicId?: string;
        ontologyClass?: MemoryOntologyClass;
        status?: TopicStatus;
        createdBy: TopicCreatedBy;
        confidence?: number;
        evidenceEventIds?: string[];
        evidenceEpisodeIds?: string[];
        now?: number;
    }): TopicNode;
    get(topicId: string): TopicNode | undefined;
    getByPath(projectId: string, topicPath: string): TopicNode | undefined;
    list(projectId: string, statuses?: TopicStatus[]): TopicNode[];
    update(topicId: string, projectId: string, patch: {
        canonicalName?: string;
        topicPath?: string;
        parentTopicId?: string | null;
        status?: TopicStatus;
        mergeCandidates?: string[];
        now?: number;
    }): TopicNode;
    delete(topicId: string, projectId: string): void;
    assertProject(topicId: string, projectId: string): TopicNode;
    private listAliases;
}
export declare function normalizeTopicPath(value: string): string;
//# sourceMappingURL=TopicPathRegistry.d.ts.map