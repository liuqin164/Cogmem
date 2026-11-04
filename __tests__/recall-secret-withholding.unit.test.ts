import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { EventStore } from '../src/store/EventStore.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * A conversation turn holding a secret is written verbatim and marked, never redacted, so the default
 * lanes must not hand it back — while a question about the words someone used still may.
 *
 * Seeded through the event store: events written through the compile path are not searchable
 * in-process, so a recall fixture has to land in the ledger directly.
 */
function withLedger<T>(run: (runtime: { kernel: ReturnType<typeof createMemoryKernel>; memory: KernelAgentMemoryBackend }) => T): T {
  const dir = makeTempDir('cogmem-withhold-');
  const dbPath = join(dir, 'brain.db');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  const store = new EventStore(dbPath);
  let ordinal = 0;
  const append = (text: string, metadata?: Record<string, unknown>): void => {
    ordinal += 1;
    store.append({
      streamType: 'thread', streamId: 't', eventType: 'RAW_EVENT_RECORDED', projectId: 'p', threadId: 't',
      sessionId: 's', threadSeq: ordinal, eventOrdinal: ordinal, role: 'user', sourceId: 'a',
      occurredAt: 1_700_000_000_000 + ordinal, payload: { text, ...(metadata ? { metadata } : {}) },
    });
  };
  append('注意 ghp_abcdefghijklmnopqrstuvwx 这个令牌要轮换', { secretFindings: { total: 1, byKind: { github_token: 1 } } });
  append('轮换流程写在运维手册里');
  return run({ kernel, memory: new KernelAgentMemoryBackend(kernel) });
}

test('a secret-bearing turn is withheld from the default lane and the reason is auditable', () => {
  withLedger(({ kernel, memory }) => {
    try {
      const result = memory.recall({ query: '轮换', projectId: 'p', agentId: 'a' });
      const text = result.items.map((item) => item.text).join('\n');
      // The ordinary turn answers; the marked one does not appear in any form.
      expect(text).toContain('轮换流程写在运维手册里');
      expect(text).not.toContain('令牌要轮换');
      expect(result.decisionTrace?.suppressed).toContainEqual({ reason: 'secret_bearing_withheld', count: 1 });
    } finally {
      kernel.close();
    }
  });
});

test('a question about the words themselves still reaches it', () => {
  withLedger(({ kernel, memory }) => {
    try {
      const result = memory.recall({ query: '轮换', projectId: 'p', agentId: 'a', intent: 'forensic_quote' });
      expect(result.items.some((item) => item.text.includes('令牌要轮换'))).toBe(true);
    } finally {
      kernel.close();
    }
  });
});
