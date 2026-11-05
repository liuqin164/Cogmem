import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { EventStore } from '../src/store/EventStore.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * A database written through host adapters, seeded through the event store so the turns are in the
 * index the raw lane reads (events written through the compile path are not searchable in-process).
 *
 * Identity lives on `sourceId`: identity `a` holds two matching turns, identity `b` holds three, and
 * one turn carries no identity at all — an un-attributed turn is visible to every scope, so the
 * counts below are about `b`'s three.
 */
async function hostWrittenBackend(): Promise<{ memory: KernelAgentMemoryBackend; close: () => void; bHeld: number }> {
  const dir = makeTempDir('cogmem-zero-scope-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  const store = new EventStore(dbPath);
  let ordinal = 0;
  const append = (text: string, sourceId?: string): void => {
    ordinal += 1;
    store.append({
      streamType: 'thread', streamId: 't', eventType: 'RAW_EVENT_RECORDED', projectId: 'p',
      threadId: 't', sessionId: 's', threadSeq: ordinal, eventOrdinal: ordinal, role: 'user',
      occurredAt: 1_700_000_000_000 + ordinal, payload: { text },
      ...(sourceId ? { sourceId } : {}),
    });
  };
  // One word only identity `a` uses, in three turns: a single-token query keeps the search's own
  // semantics out of the way, so the out-of-scope count is exactly the three turns seeded here.
  append('提前部署窗口到周三。', 'a');
  append('提前通知了值班。', 'a');
  append('提前一天准备。', 'a');
  append('迁移脚本已经写完，b 的记录。', 'b');
  append('迁移在新机器上验证过，b 的补充。', 'b');
  append('迁移完成，b 的说明。', 'b');
  append('归档保留期是三十天，无身份记录。');
  return { memory: new KernelAgentMemoryBackend(kernel), close: () => kernel.close(), bHeld: 3 };
}

test('a zero caused by the identity scope explains itself, with counts and no content', async () => {
  const { memory, close, bHeld } = await hostWrittenBackend();
  try {
    const unscoped = memory.recall({ query: '提前', projectId: 'p', agentId: 'b' });
    expect(unscoped.items).toEqual([]);
    const explanation = unscoped.decisionTrace?.zeroExplanation;
    expect(explanation?.kind).toBe('scope_filtered');
    if (explanation?.kind === 'scope_filtered') {
      expect(explanation.otherScopes).toBe(bHeld);
      expect(JSON.stringify(explanation)).not.toContain('提前');
    }
  } finally {
    close();
  }
});

test('the writing identity still hits, and an absent question is not called a scope problem', async () => {
  const { memory, close } = await hostWrittenBackend();
  try {
    const scoped = memory.recall({ query: '提前', projectId: 'p', agentId: 'a' });
    expect(scoped.items.length).toBeGreaterThan(0);
    expect(scoped.decisionTrace?.zeroExplanation).toBeUndefined();

    const absent = memory.recall({ query: 'zzzz 不存在', projectId: 'p', agentId: 'b' });
    expect(absent.items).toEqual([]);
    expect(absent.decisionTrace?.zeroExplanation?.kind).toBe('no_match');
    expect(JSON.stringify(absent.decisionTrace)).not.toContain('scope_filtered');
  } finally {
    close();
  }
});
