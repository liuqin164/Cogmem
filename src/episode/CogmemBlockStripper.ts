import type { MemoryEvent } from '../types/index.js';

const CONTROL_BLOCKS = new Set([
  'COGMEM_RECALL_CONTEXT', 'COGMEM_MEMORY_ATLAS', 'COGMEM_TURN_BRIDGE', 'COGMEM_SESSION_STATE', 'COGMEM_STRATEGY_CONTEXT',
]);

export class CogmemBlockStripper {
  private readonly maxBlockChars: number;

  constructor(options: { maxBlockChars?: number } = {}) {
    this.maxBlockChars = Math.max(64, Math.min(options.maxBlockChars ?? 256_000, 1_000_000));
  }

  strip(value: string): string {
    const text = String(value || '');
    const token = /<\/?([A-Z0-9_]+)\b[^>]*>/giu;
    const stack: string[] = [];
    let result = '';
    let cursor = 0;
    let hiddenChars = 0;
    for (const match of text.matchAll(token)) {
      const index = match.index ?? 0;
      const name = String(match[1] || '').toUpperCase();
      if (!CONTROL_BLOCKS.has(name)) continue;
      const closing = match[0].startsWith('</');
      if (stack.length === 0) result += text.slice(cursor, index);
      else hiddenChars += index - cursor;
      if (closing) {
        const position = stack.lastIndexOf(name);
        if (position >= 0) stack.splice(position);
      } else {
        stack.push(name);
      }
      cursor = index + match[0].length;
      if (hiddenChars > this.maxBlockChars && stack.length) {
        cursor = text.length;
        break;
      }
    }
    if (stack.length === 0 && cursor < text.length) result += text.slice(cursor);
    return result.replace(/\s+/g, ' ').trim();
  }
}

const DEFAULT_STRIPPER = new CogmemBlockStripper();

export function stripCogmemBlocks(value: string): string {
  return DEFAULT_STRIPPER.strip(value);
}

export function eventTextForMemory(event: Pick<MemoryEvent, 'payload'>): string {
  const payload = event.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== 'object') return '';
  for (const field of ['text', 'content', 'output', 'title', 'summary']) {
    if (typeof payload[field] === 'string') return stripCogmemBlocks(payload[field] as string);
  }
  return '';
}
