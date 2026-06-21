import type { MemoryEvent } from '../types/index.js';
export declare class CogmemBlockStripper {
    private readonly maxBlockChars;
    constructor(options?: {
        maxBlockChars?: number;
    });
    strip(value: string): string;
}
export declare function stripCogmemBlocks(value: string): string;
export declare function eventTextForMemory(event: Pick<MemoryEvent, 'payload'>): string;
//# sourceMappingURL=CogmemBlockStripper.d.ts.map