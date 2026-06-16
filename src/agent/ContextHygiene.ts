export const COGMEM_RECALL_BLOCK_RE =
  /<COGMEM_RECALL_CONTEXT\b[\s\S]*?<\/COGMEM_RECALL_CONTEXT>/g;

export interface StripCogmemRecallBlocksResult {
  text: string;
  stripped: boolean;
  strippedChars: number;
  blockCount: number;
}

export function stripCogmemRecallBlocks(text: string): StripCogmemRecallBlocksResult {
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
