import type Database from 'bun:sqlite';
import type { TopicAliasRegistry } from './TopicAliasRegistry.js';
import type { TopicPathRegistry } from './TopicPathRegistry.js';
import type { TopicRelationGraph } from './TopicRelationGraph.js';
import type { TopicOperationInput, TopicOperationRecord } from './TopicTypes.js';
export declare class TopicGovernance {
    private readonly db;
    private readonly paths;
    private readonly aliases;
    private readonly relations;
    constructor(db: Database, paths: TopicPathRegistry, aliases: TopicAliasRegistry, relations: TopicRelationGraph);
    apply(input: TopicOperationInput): TopicOperationRecord;
    rollback(operationId: string, projectId: string, now?: number): TopicOperationRecord;
    listOperations(input: {
        projectId: string;
        limit?: number;
    }): TopicOperationRecord[];
    getOperation(operationId: string): TopicOperationRecord | undefined;
    private deleteTopicGraph;
}
//# sourceMappingURL=TopicGovernance.d.ts.map