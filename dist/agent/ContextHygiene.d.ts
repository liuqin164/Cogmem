export declare const COGMEM_RECALL_BLOCK_RE: RegExp;
export interface StripCogmemRecallBlocksResult {
    text: string;
    stripped: boolean;
    strippedChars: number;
    blockCount: number;
}
export declare function stripCogmemRecallBlocks(text: string): StripCogmemRecallBlocksResult;
//# sourceMappingURL=ContextHygiene.d.ts.map