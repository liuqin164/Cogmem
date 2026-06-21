import type Database from 'bun:sqlite';
import type { TopicCreatedBy, TopicRelationRecord } from './TopicTypes.js';
export declare class TopicRelationGraph {
    private readonly db;
    constructor(db: Database);
    add(input: {
        projectId: string;
        sourceTopicId: string;
        relation: string;
        targetTopicId: string;
        createdBy: TopicCreatedBy;
        confidence?: number;
        evidenceEventIds?: string[];
        evidenceEpisodeIds?: string[];
        now?: number;
    }): TopicRelationRecord;
    get(relationId: string): TopicRelationRecord | undefined;
    archive(relationId: string, projectId: string, now?: number): void;
    setStatus(relationId: string, projectId: string, status: TopicRelationRecord['status'], now?: number): void;
    list(projectId: string): TopicRelationRecord[];
    private assertTopic;
}
//# sourceMappingURL=TopicRelationGraph.d.ts.map