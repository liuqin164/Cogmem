export const COGMEM_RECALL_BLOCK_RE = /<(COGMEM_RECALL_CONTEXT|COGMEM_MEMORY_ATLAS|COGMEM_TURN_BRIDGE|COGMEM_SESSION_STATE|COGMEM_STRATEGY_CONTEXT)\b[\s\S]*?<\/\1>/g;
export function stripCogmemRecallBlocks(text) {
    const input = String(text || '');
    let strippedChars = 0;
    let blockCount = 0;
    const output = input
        .replace(COGMEM_RECALL_BLOCK_RE, (match) => {
        strippedChars += match.length;
        blockCount += 1;
        return '';
    })
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return {
        text: output,
        stripped: blockCount > 0,
        strippedChars,
        blockCount,
    };
}
