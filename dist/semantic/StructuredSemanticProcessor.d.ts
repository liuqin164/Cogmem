import type { MemoryEvent } from '../types/index.js';
import type { MemoryFrameV1 } from './MemoryFrameTypes.js';
export interface StructuredSemanticProcessorInput {
    projectId: string;
    episodeId: string;
    events: MemoryEvent[];
    episodeType?: MemoryFrameV1['episodeKind'];
}
export type StructuredFrameGenerator = (input: StructuredSemanticProcessorInput) => Promise<unknown>;
export declare class StructuredSemanticProcessor {
    private readonly generate;
    constructor(generate: StructuredFrameGenerator);
    process(input: StructuredSemanticProcessorInput): Promise<MemoryFrameV1>;
}
//# sourceMappingURL=StructuredSemanticProcessor.d.ts.map