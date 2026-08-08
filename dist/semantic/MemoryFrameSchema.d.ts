import type { MemoryFrameV1 } from './MemoryFrameTypes.js';
export declare const MEMORY_FRAME_SCHEMA_VERSION: "memory_frame.v1";
export declare const MEMORY_FRAME_LIMITS: {
    readonly id: 512;
    readonly text: 20000;
    readonly dimension: 64;
    readonly language: 128;
    readonly nodes: 256;
    readonly relations: 512;
    readonly temporalReferences: 128;
    readonly stateTransitions: 128;
    readonly aliases: 64;
    readonly alias: 1000;
    readonly evidence: 1000;
};
export declare const MEMORY_DIMENSIONS: readonly ["actor", "entity", "project", "topic", "issue", "event", "raw_event", "episode", "task", "object", "location", "time", "state"];
export declare const MEMORY_FRAME_REQUIRED_DIMENSIONS: readonly ["episode", "project"];
export declare const MEMORY_FRAME_JSON_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly allOf: readonly {
        properties: {
            nodes: {
                contains: {
                    type: string;
                    required: string[];
                    properties: {
                        dimension: {
                            const: "project" | "episode";
                        };
                    };
                };
            };
        };
    }[];
    readonly required: readonly ["schemaVersion", "frameId", "projectId", "episodeId", "title", "summary", "episodeKind", "nodes", "relations", "temporalReferences", "stateTransitions", "confidence", "evidenceEventIds", "processor"];
    readonly properties: {
        readonly schemaVersion: {
            readonly const: "memory_frame.v1";
        };
        readonly frameId: {
            readonly type: "string";
            readonly minLength: 1;
            readonly maxLength: 512;
            readonly pattern: ".*\\S.*";
        };
        readonly projectId: {
            readonly type: "string";
            readonly minLength: 1;
            readonly maxLength: 512;
            readonly pattern: ".*\\S.*";
        };
        readonly episodeId: {
            readonly type: "string";
            readonly minLength: 1;
            readonly maxLength: 512;
            readonly pattern: ".*\\S.*";
        };
        readonly revisionId: {
            readonly type: "string";
            readonly minLength: 1;
            readonly maxLength: 512;
            readonly pattern: ".*\\S.*";
        };
        readonly revisionNumber: {
            readonly type: "integer";
            readonly minimum: 1;
        };
        readonly supersedesFrameId: {
            readonly type: "string";
            readonly minLength: 1;
            readonly maxLength: 512;
            readonly pattern: ".*\\S.*";
        };
        readonly title: {
            readonly type: "string";
            readonly maxLength: 20000;
        };
        readonly summary: {
            readonly type: "string";
            readonly maxLength: 20000;
        };
        readonly confidence: {
            readonly type: "number";
            readonly minimum: 0;
            readonly maximum: 1;
        };
        readonly evidenceEventIds: {
            readonly type: "array";
            readonly minItems: 1;
            readonly maxItems: 1000;
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
                readonly maxLength: 512;
                readonly pattern: ".*\\S.*";
            };
        };
        readonly episodeKind: {
            readonly type: "string";
            readonly enum: readonly ["discussion", "operation", "decision", "correction", "diagnostic", "planning", "status_update", "preference", "other"];
        };
        readonly nodes: {
            readonly type: "array";
            readonly minItems: 1;
            readonly maxItems: 256;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["frameNodeId", "dimension", "label", "confidence", "evidenceEventIds"];
                readonly properties: {
                    readonly frameNodeId: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 512;
                        readonly pattern: ".*\\S.*";
                    };
                    readonly dimension: {
                        readonly type: "string";
                        readonly enum: readonly ["actor", "entity", "project", "topic", "issue", "event", "raw_event", "episode", "task", "object", "location", "time", "state"];
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 20000;
                        readonly pattern: ".*\\S.*";
                    };
                    readonly description: {
                        readonly type: "string";
                        readonly maxLength: 20000;
                    };
                    readonly aliases: {
                        readonly type: "array";
                        readonly maxItems: 64;
                        readonly items: {
                            readonly type: "string";
                            readonly minLength: 1;
                            readonly maxLength: 1000;
                            readonly pattern: ".*\\S.*";
                        };
                    };
                    readonly canonicalHint: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly nodeId: {
                                readonly type: "string";
                                readonly minLength: 1;
                                readonly maxLength: 512;
                                readonly pattern: ".*\\S.*";
                            };
                            readonly canonicalLabel: {
                                readonly type: "string";
                                readonly maxLength: 20000;
                            };
                            readonly confidence: {
                                readonly type: "number";
                                readonly minimum: 0;
                                readonly maximum: 1;
                            };
                        };
                    };
                    readonly confidence: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly maximum: 1;
                    };
                    readonly evidenceEventIds: {
                        readonly type: "array";
                        readonly minItems: 1;
                        readonly maxItems: 1000;
                        readonly items: {
                            readonly type: "string";
                            readonly minLength: 1;
                            readonly maxLength: 512;
                            readonly pattern: ".*\\S.*";
                        };
                    };
                };
            };
        };
        readonly relations: {
            readonly type: "array";
            readonly maxItems: 512;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["sourceFrameNodeId", "relationType", "targetFrameNodeId", "confidence", "evidenceEventIds"];
                readonly properties: {
                    readonly sourceFrameNodeId: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 512;
                        readonly pattern: ".*\\S.*";
                    };
                    readonly relationType: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 512;
                        readonly pattern: ".*\\S.*";
                    };
                    readonly targetFrameNodeId: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 512;
                        readonly pattern: ".*\\S.*";
                    };
                    readonly confidence: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly maximum: 1;
                    };
                    readonly evidenceEventIds: {
                        readonly type: "array";
                        readonly minItems: 1;
                        readonly maxItems: 1000;
                        readonly items: {
                            readonly type: "string";
                            readonly minLength: 1;
                            readonly maxLength: 512;
                            readonly pattern: ".*\\S.*";
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
            readonly maxItems: 128;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["label", "confidence", "evidenceEventIds"];
                readonly properties: {
                    readonly label: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 20000;
                        readonly pattern: ".*\\S.*";
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
                        readonly minItems: 1;
                        readonly maxItems: 1000;
                        readonly items: {
                            readonly type: "string";
                            readonly minLength: 1;
                            readonly maxLength: 512;
                            readonly pattern: ".*\\S.*";
                        };
                    };
                };
            };
        };
        readonly stateTransitions: {
            readonly type: "array";
            readonly maxItems: 128;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["subjectFrameNodeId", "to", "confidence", "evidenceEventIds"];
                readonly properties: {
                    readonly subjectFrameNodeId: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 512;
                        readonly pattern: ".*\\S.*";
                    };
                    readonly from: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 20000;
                        readonly pattern: ".*\\S.*";
                    };
                    readonly to: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 20000;
                        readonly pattern: ".*\\S.*";
                    };
                    readonly confidence: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly maximum: 1;
                    };
                    readonly evidenceEventIds: {
                        readonly type: "array";
                        readonly minItems: 1;
                        readonly maxItems: 1000;
                        readonly items: {
                            readonly type: "string";
                            readonly minLength: 1;
                            readonly maxLength: 512;
                            readonly pattern: ".*\\S.*";
                        };
                    };
                };
            };
        };
        readonly processor: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["promptVersion", "generatedAt"];
            readonly properties: {
                readonly provider: {
                    readonly type: "string";
                    readonly maxLength: 512;
                };
                readonly model: {
                    readonly type: "string";
                    readonly maxLength: 512;
                };
                readonly promptVersion: {
                    readonly type: "string";
                    readonly minLength: 1;
                    readonly maxLength: 512;
                    readonly pattern: ".*\\S.*";
                };
                readonly generatedAt: {
                    readonly type: "number";
                };
            };
        };
        readonly primaryLanguage: {
            readonly type: "string";
            readonly maxLength: 128;
        };
        readonly sourceAuthority: {
            readonly type: "string";
            readonly enum: readonly ["processor", "deterministic_fallback"];
        };
        readonly semanticCompleteness: {
            readonly type: "string";
            readonly enum: readonly ["full", "minimal"];
        };
        readonly needsReview: {
            readonly type: "boolean";
        };
        readonly publishStatus: {
            readonly type: "string";
            readonly enum: readonly ["active", "needs_confirmation"];
        };
        readonly status: {
            readonly type: "string";
            readonly enum: readonly ["staged", "active", "needs_confirmation", "superseded", "failed"];
        };
    };
};
export declare function memoryFrameJsonSchema(options?: {
    allowEmptyEvidence?: boolean;
}): Record<string, unknown>;
export declare function isMemoryFrame(value: unknown): value is MemoryFrameV1;
//# sourceMappingURL=MemoryFrameSchema.d.ts.map