import { validateMemoryFrame } from './MemoryFrameValidator.js';
export class StructuredSemanticProcessor {
    generate;
    constructor(generate) {
        this.generate = generate;
    }
    async process(input) {
        const result = validateMemoryFrame(await this.generate(input));
        if (!result.valid || !result.frame)
            throw new Error(`invalid_memory_frame_output:${result.errors.join(',')}`);
        if (result.frame.projectId !== input.projectId || result.frame.episodeId !== input.episodeId)
            throw new Error('memory_frame_scope_mismatch');
        const allowed = new Set(input.events.map((event) => event.eventId));
        if (!result.frame.evidenceEventIds.every((id) => allowed.has(id)))
            throw new Error('memory_frame_evidence_scope_mismatch');
        return result.frame;
    }
}
