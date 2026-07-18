import type { MemoryGraph } from '../core/MemoryGraph.js';
export interface GraphCommunityEngineOptions {
    maxIterations?: number;
    minCommunitySize?: number;
    excludeArchived?: boolean;
    incrementalWindowMs?: number;
}
export declare class GraphCommunityEngine {
    private readonly memoryGraph;
    private readonly options;
    constructor(memoryGraph: MemoryGraph, options?: GraphCommunityEngineOptions);
    run(projectId: string): Promise<{
        communitiesDetected: number;
        neuronsUpdated: number;
    }>;
    getCommunityMembers(communityId: string, projectId?: string): string[];
    private neighborIds;
    private mergeSmallCommunities;
}
//# sourceMappingURL=GraphCommunityEngine.d.ts.map