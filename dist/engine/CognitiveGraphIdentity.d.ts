import type { CognitiveEdgeType, CognitiveNodeType } from '../types/index.js';
export declare function cognitiveNodeId(projectId: string | undefined, nodeType: CognitiveNodeType, nodeKey: string): string;
export declare function cognitiveEdgeId(input: {
    projectId?: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: CognitiveEdgeType;
}): string;
//# sourceMappingURL=CognitiveGraphIdentity.d.ts.map