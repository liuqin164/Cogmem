import type { MemoryFrameV1 } from './MemoryFrameTypes.js';
export interface MemoryFrameValidationResult {
    valid: boolean;
    errors: string[];
    frame?: MemoryFrameV1;
}
export declare function validateMemoryFrame(value: unknown): MemoryFrameValidationResult;
//# sourceMappingURL=MemoryFrameValidator.d.ts.map