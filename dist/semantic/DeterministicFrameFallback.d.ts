import type { MemoryEvent } from '../types/index.js';
import type { MemoryFrameV1 } from './MemoryFrameTypes.js';
export declare function deterministicFrameFallback(input: {
    projectId: string;
    episodeId: string;
    episodeType?: MemoryFrameV1['episodeKind'];
    events: MemoryEvent[];
    promptVersion?: string;
    now?: number;
}): MemoryFrameV1;
//# sourceMappingURL=DeterministicFrameFallback.d.ts.map