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
        readonly episodeKind: {
            readonly type: "string";
            readonly enum: readonly ["discussion", "operation", "decision", "correction", "diagnostic", "planning", "status_update", "preference", "other"];
        };
        readonly nodes: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["frameNodeId", "dimension", "label", "confidence", "evidenceEventIds"];
                readonly properties: {
                    readonly frameNodeId: {
                        readonly type: "string";
                    };
                    readonly dimension: {
                        readonly type: "string";
                    };
                    readonly label: {
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
                        };
                    };
                };
            };
        };
        readonly relations: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["sourceFrameNodeId", "relationType", "targetFrameNodeId", "confidence", "evidenceEventIds"];
                readonly properties: {
                    readonly sourceFrameNodeId: {
                        readonly type: "string";
                    };
                    readonly relationType: {
                        readonly type: "string";
                    };
                    readonly targetFrameNodeId: {
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
                        };
                    };
                    readonly validFrom: {
                        readonly type: "number";
                    };
                    readonly validTo: {
                        readonly type: "number";
                    };
                };
            };
        };
        readonly temporalReferences: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["label", "confidence", "evidenceEventIds"];
                readonly properties: {
                    readonly label: {
                        readonly type: "string";
                    };
                    readonly occurredAt: {
                        readonly type: "number";
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
                        };
                    };
                };
            };
        };
        readonly stateTransitions: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["subjectFrameNodeId", "to", "confidence", "evidenceEventIds"];
                readonly properties: {
                    readonly subjectFrameNodeId: {
                        readonly type: "string";
                    };
                    readonly from: {
                        readonly type: "string";
                    };
                    readonly to: {
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
                        };
                    };
                };
            };
        };
        readonly processor: {
            readonly type: "object";
            readonly required: readonly ["promptVersion", "generatedAt"];
            readonly properties: {
                readonly provider: {
                    readonly type: "string";
                };
                readonly model: {
                    readonly type: "string";
                };
                readonly promptVersion: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
                readonly generatedAt: {
                    readonly type: "number";
                };
            };
        };
    };
};
export declare function isMemoryFrame(value: unknown): value is MemoryFrameV1;
//# sourceMappingURL=MemoryFrameSchema.d.ts.map