import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The two ends the ticket asks for, at the level every caller routes through.
 *
 * The corpus deliberately contains a turn whose words a social query would match (proof that
 * defence 1 is the gate and not an empty search) and a turn that is itself social (proof that
 * defence 2 removes entries, with the ledger untouched).
 */
async function backendWithSocialCorpus(): Promise<{ memory: KernelAgentMemoryBackend; close: () => void }> {
  const dir = makeTempDir('cogmem-social-lane-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db') });
  await kernel.ingest({ content: '谢谢你的帮助，部署窗口改到周四 20:00 了。', projectId: 'p', tags: ['agent:a'] });
  await kernel.ingest({ content: '好的收到谢谢', projectId: 'p', tags: ['agent:a'] });
  return { memory: new KernelAgentMemoryBackend(kernel), close: () => kernel.close() };
}

test('a social query returns nothing and says which reason withheld it', async () => {
  const { memory, close } = await backendWithSocialCorpus();
  try {
    const result = memory.recall({ query: '这次谢谢你啦', projectId: 'p', agentId: 'a' });
    expect(result.items).toEqual([]);
    expect(result.recallMode).toBe('social_turn_suppressed');
    expect(result.decisionTrace?.suppressed).toEqual([{ reason: 'residue_empty', count: 0 }]);
  } finally {
    close();
  }
});

test('a social entry is not handed back as an answer to a real question', async () => {
  const { memory, close } = await backendWithSocialCorpus();
  try {
    // The entry's own words are in the query, so only defence 2 keeps it out of the answer.
    const result = memory.recall({ query: '好的收到谢谢，这是哪次的事', projectId: 'p', agentId: 'a' });
    const text = result.items.map((item) => item.text).join('\n');
    expect(text).not.toContain('好的收到谢谢');
    expect((result.decisionTrace?.suppressed ?? []).some((entry) => entry.reason === 'entry_social')).toBe(true);
  } finally {
    close();
  }
});

test('a quote-seeking intent is exempt from the entry filter', async () => {
  const { memory, close } = await backendWithSocialCorpus();
  try {
    const result = memory.recall({ query: '好的收到谢谢，原话', projectId: 'p', agentId: 'a', intent: 'forensic_quote' });
    expect((result.decisionTrace?.suppressed ?? []).some((entry) => entry.reason === 'entry_social')).toBe(false);
  } finally {
    close();
  }
});
