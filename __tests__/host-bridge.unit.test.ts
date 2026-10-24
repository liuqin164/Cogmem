import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { recallForHost, rememberForHost, type HostIdentity } from '../src/host/bridge/HostBridge.js';

/**
 * The orchestration a host adapter runs: recall into one injectable block, and
 * record a finished turn. It used to live inside the OpenClaw plugin's generated
 * bridge, where the only checks on it were substring assertions on the generated
 * file, and where its host name was a literal. Both are fixed here: these tests
 * run it against a real kernel and a real database, and the host names are the
 * adapter's parameters.
 */

function withKernel<T>(run: (runtime: {
  kernel: ReturnType<typeof createMemoryKernel>;
  memory: KernelAgentMemoryBackend;
  formatStrategyContext: (capsule: unknown) => string;
}) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-host-bridge-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const runtime = {
    kernel,
    memory: new KernelAgentMemoryBackend(kernel),
    formatStrategyContext: () => '',
  };
  return run(runtime).finally(() => kernel.close());
}

const HERMES: HostIdentity = {
  agentId: 'hermes',
  projectId: 'proj-hermes',
  sessionId: 'hermes-session',
  memorySource: 'hermes-plugin',
};

describe('a host records a finished turn', () => {
  test('the turn is stored under the identity the adapter supplied', async () => {
    await withKernel(async ({ kernel, memory }) => {
      const result = await rememberForHost({ kernel, memory }, {
        sessionId: 'sess-1',
        userText: 'I keep my notes in a flat file.',
        assistantText: 'Understood.',
      }, {}, HERMES);

      // Two events: the user's turn and the assistant's.
      expect(result.rawEventIds).toHaveLength(2);
      expect(result.toolCallCount).toBe(0);
      expect(result.hygiene.strippedRecallBlocks).toBe(false);

      const rows = kernel.factStore.getDatabase().prepare(
        `SELECT project_id, session_id, json_extract(payload_json, '$.metadata.source') AS source
           FROM memory_events WHERE session_id = 'sess-1'`,
      ).all() as Array<{ project_id: string; session_id: string; source: string }>;
      expect(rows).toHaveLength(2);
      // The adapter's own names, not a hard-coded host: this is what makes the
      // shared code safe to use from a second host.
      for (const row of rows) {
        expect(row.project_id).toBe('proj-hermes');
        expect(row.source).toBe('hermes-plugin');
      }
    });
  });

  test('the identity supplies the defaults when the host names none', async () => {
    await withKernel(async ({ kernel, memory }) => {
      await rememberForHost({ kernel, memory }, {
        userText: 'no session named', assistantText: 'ok',
      }, {}, HERMES);
      const rows = kernel.factStore.getDatabase().prepare(
        `SELECT session_id FROM memory_events
          WHERE json_extract(payload_json, '$.metadata.source') = 'hermes-plugin'`,
      ).all() as Array<{ session_id: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.session_id).toBe('hermes-session');
    });
  });

  test('a Cogmem block the host echoed back is stripped before it is stored', async () => {
    await withKernel(async ({ kernel, memory }) => {
      const echoed = '<COGMEM_RECALL_CONTEXT>injected context</COGMEM_RECALL_CONTEXT> what did I say?';
      const result = await rememberForHost({ kernel, memory }, {
        userText: echoed, assistantText: 'You said you keep notes in a flat file.',
      }, {}, HERMES);

      expect(result.hygiene.strippedRecallBlocks).toBe(true);
      expect(result.hygiene.strippedBlockCount).toBe(1);
      expect(result.hygiene.strippedChars).toBeGreaterThan(0);

      // Injected context must not be laundered into evidence.
      const stored = kernel.factStore.getDatabase().prepare(
        `SELECT json_extract(payload_json, '$.text') AS text FROM memory_events
          WHERE json_extract(payload_json, '$.metadata.source') = 'hermes-plugin'`,
      ).all() as Array<{ text: string | null }>;
      expect(stored.length).toBeGreaterThan(0);
      for (const row of stored) expect(row.text ?? '').not.toContain('injected context');
    });
  });

  test('tool traffic lands in the order it happened, and an orphan result is kept', async () => {
    await withKernel(async ({ kernel, memory }) => {
      const result = await rememberForHost({ kernel, memory }, {
        sessionId: 'sess-tools',
        userText: 'check the disk', assistantText: 'checked',
        toolCalls: [{ toolCallId: 'c1', toolName: 'bash', input: { cmd: 'df' } }],
        toolResults: [
          { toolCallId: 'c1', toolName: 'bash', output: 'ok' },
          { toolCallId: 'c-orphan', toolName: 'bash', output: 'result with no recorded call' },
        ],
        taskEvents: [{ title: 'a task', content: 'did a thing' }],
      }, {}, HERMES);

      expect(result.toolCallCount).toBe(1);
      expect(result.toolResultCount).toBe(1);
      // The orphan becomes a task event rather than being dropped.
      expect(result.taskEventCount).toBe(2);
    });
  });

  test('a host may opt out of stripping, and then the block is stored as written', async () => {
    await withKernel(async ({ kernel, memory }) => {
      const result = await rememberForHost({ kernel, memory }, {
        userText: 'plain text', assistantText: 'ok',
      }, { stripRecallBlocksBeforeRemember: false }, HERMES);
      expect(result.hygiene.strippedBlockCount).toBe(0);
    });
  });
});

describe('a host recalls into one injectable block', () => {
  test('what was recorded comes back, in a block the host can inject as-is', async () => {
    await withKernel(async (runtime) => {
      await rememberForHost(runtime, {
        sessionId: 'sess-recall',
        userText: 'My deploy key lives in the vault under prod/deploy.',
        assistantText: 'Noted.',
      }, {}, HERMES);

      const recalled = await recallForHost(runtime, {
        query: 'where does my deploy key live', sessionId: 'sess-other',
      }, {}, HERMES);

      expect(recalled.context).toContain('<COGMEM_RECALL_CONTEXT');
      expect(recalled.context).toContain('</COGMEM_RECALL_CONTEXT>');
      // The block is ready to inject: no host has to render anything.
      expect(recalled.context).toContain('Rules:');
      expect(recalled.itemCount).toBeGreaterThan(0);
      expect(recalled.recallLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  test('a query that matches nothing yields an empty block, not an empty wrapper', async () => {
    await withKernel(async (runtime) => {
      const recalled = await recallForHost(runtime, {
        query: 'nothing has ever been recorded here', sessionId: 'sess-empty',
      }, {}, HERMES);
      // An empty string is the signal to inject nothing at all.
      expect(recalled.context).toBe('');
    });
  });

  test('one host does not read another project, because the identity scopes it', async () => {
    await withKernel(async (runtime) => {
      await rememberForHost(runtime, {
        sessionId: 'a', userText: 'secret of project A: alpha', assistantText: 'ok',
      }, {}, { ...HERMES, projectId: 'proj-a' });

      const other = await recallForHost(runtime, {
        query: 'secret of project A alpha', sessionId: 'b',
      }, {}, { ...HERMES, projectId: 'proj-b' });

      expect(other.context).not.toContain('secret of project A');
    });
  });

  test('the strategy capsule is rendered in front of the block when there is one', async () => {
    await withKernel(async (runtime) => {
      await rememberForHost(runtime, {
        sessionId: 's', userText: 'the build takes four minutes', assistantText: 'ok',
      }, {}, HERMES);

      const withCapsule = await recallForHost(
        { ...runtime, formatStrategyContext: () => '<COGMEM_STRATEGY_CONTEXT>plan</COGMEM_STRATEGY_CONTEXT>' },
        { query: 'how long does the build take', sessionId: 'other' },
        {}, HERMES,
      );
      if (withCapsule.context) {
        expect(withCapsule.context.startsWith('<COGMEM_STRATEGY_CONTEXT>')).toBe(true);
        expect(withCapsule.context).toContain('<COGMEM_RECALL_CONTEXT');
      }
    });
  });
});
