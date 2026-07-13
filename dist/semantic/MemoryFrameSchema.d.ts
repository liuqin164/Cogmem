import type { MemoryFrameV1 } from './MemoryFrameTypes.js';
export declare const MEMORY_FRAME_SCHEMA_VERSION: "memory_frame.v1";
export declare const MEMORY_FRAME_JSON_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["schemaVersion", "frameId", "projectId", "episodeId", "title", "summary", "episodeKind", "nodes", "relations", "temporalReferences", "stateTransitions", "confidence", "evidenceEventIds", "processor"];
    readonly properties: {
        readonly schemaVersion: {
            readonly const: "memory_frame.v1";
        };
        readonly frameId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly projectId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly episodeId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly title: {
            readonly type: "string";
        };
        readonly summary: {
            readonly type: "string";
        };
        readonly confidence: {
            readonly type: "number";
            readonly minimum: 0;
            readonly maximum: 1;
        };
        readonly evidenceEventIds: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
        readonly nodes: {
            readonly type: "array";
        };
        readonly relations: {
            readonly type: "array";
        };
        readonly temporalReferences: {
            readonly type: "array";
        };
        readonly stateTransitions: {
            readonly type: "array";
        };
        readonly processor: {
            readonly type: "object";
        };
    };
};
export declare function isMemoryFrame(value: unknown): value is MemoryFrameV1;
//# sourceMappingURL=MemoryFrameSchema.d.ts.map