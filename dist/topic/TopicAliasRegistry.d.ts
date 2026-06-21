import type Database from 'bun:sqlite';
import type { TopicAliasRecord, TopicCreatedBy } from './TopicTypes.js';
export declare class TopicAliasRegistry {
    private readonly db;
    constructor(db: Database);
    add(input: {
        projectId: string;
        topicId: string;
        alias: string;
        createdBy: TopicCreatedBy;
        confidence: number;
        evidenceEventIds?: string[];
        now?: number;
    }): TopicAliasRecord;
    resolve(projectId: string, alias: string): TopicAliasRecord | undefined;
    matchText(projectId: string, text: string, limit?: number): TopicAliasRecord[];
    archive(aliasId: string, projectId: string, now?: number): void;
    get(aliasId: string): TopicAliasRecord | undefined;
}
export declare function normalizeTopicAlias(value: string): string;
//# sourceMappingURL=TopicAliasRegistry.d.ts.map