import type { MemoryEvent } from '../types/index.js';
import { validateMemoryFrame } from './MemoryFrameValidator.js';
import type { MemoryFrameV1 } from './MemoryFrameTypes.js';

export interface StructuredSemanticProcessorInput { projectId: string; episodeId: string; events: MemoryEvent[]; episodeType?: MemoryFrameV1['episodeKind']; }
export type StructuredFrameGenerator = (input: StructuredSemanticProcessorInput) => Promise<unknown>;

export class StructuredSemanticProcessor {
  constructor(private readonly generate: StructuredFrameGenerator) {}

  async process(input: StructuredSemanticProcessorInput): Promise<MemoryFrameV1> {
    const result = validateMemoryFrame(await this.generate(input));
    if (!result.valid || !result.frame) throw new Error(`invalid_memory_frame_output:${result.errors.join(',')}`);
    if (result.frame.projectId !== input.projectId || result.frame.episodeId !== input.episodeId) throw new Error('memory_frame_scope_mismatch');
    const allowed = new Set(input.events.map((event) => event.eventId));
    if (!result.frame.evidenceEventIds.every((id) => allowed.has(id))) throw new Error('memory_frame_evidence_scope_mismatch');
    return result.frame;
  }
}
