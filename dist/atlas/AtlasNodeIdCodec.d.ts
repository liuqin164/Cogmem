import type { MemoryAtlasNodeType } from './MemoryAtlasTypes.js';
export interface AtlasNodeEndpoint {
    type: string;
    id: string;
    nodeId: string;
}
export declare function encodeAtlasNodeId(type: string, id: string, projectId: string): string;
export declare function decodeAtlasNodeId(nodeId: string, projectId: string): {
    type: string;
    id: string;
} | null;
export declare function toAtlasNodeEndpoint(nodeId: string, projectId: string): AtlasNodeEndpoint | null;
export declare function fromAtlasEdgeEndpoint(type: string, id: string, projectId: string): string;
export declare function isProjectScopedAtlasType(type: string): boolean;
export type { MemoryAtlasNodeType };
//# sourceMappingURL=AtlasNodeIdCodec.d.ts.map