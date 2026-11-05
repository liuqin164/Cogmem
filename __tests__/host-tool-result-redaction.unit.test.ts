import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import type { HostIdentity } from '../src/host/bridge/HostBridge.js';
import { rememberForHost } from '../src/host/bridge/HostBridge.js';
import { makeTempDir } from './helpers/tmp.js';

const IDENTITY: HostIdentity = { agentId: 'hermes', projectId: 'p', sessionId: 's', memorySource: 'hermes-plugin' };
const SECRET = `sk-${'a'.repeat(24)}`;
const LOG_LINE = 'plain log line: nothing to hide';

type Kernel = ReturnType<typeof createMemoryKernel>;
const storedToolText = (kernel: Kernel): string => {
  const rows = kernel.factStore.getDatabase().prepare(
    `SELECT json_extract(payload_json, '$.text') AS t, json_extract(payload_json, '$.metadata.redaction') AS r
       FROM memory_events`,
  ).all() as Array<{ t: string | null; r: string | null }>;
  return JSON.stringify(rows.find((row) => row.t && row.t.includes('log line')));
};

async function remember(output: string): Promise<{ kernel: Kernel; result: Awaited<ReturnType<typeof rememberForHost>> }> {
  const dir = makeTempDir('cogmem-redact-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const result = await rememberForHost({ kernel, memory: new KernelAgentMemoryBackend(kernel) }, {
    sessionId: 's1', userText: 'run the deploy check', assistantText: 'done',
    toolCalls: [{ toolCallId: 't1', input: 'cat env' }],
    toolResults: [{ toolCallId: 't1', output }],
  }, {}, IDENTITY);
  return { kernel, result };
}

test('a tool result is redacted before it is written, and the ledger keeps no copy', async () => {
  const { kernel, result } = await remember(`TOKEN=${SECRET}\n${LOG_LINE}`);
  try {
    const db = kernel.factStore.getDatabase();
    const row = db.prepare(
      `SELECT json_extract(payload_json, '$.text') AS t, json_extract(payload_json, '$.metadata.redaction') AS r FROM memory_events`,
    ).all().find((entry) => entry.t && String(entry.t).includes('log line')) as { t: string; r: string };
    // The secret is a redacted form, the ordinary line is untouched, and the event says so.
    expect(row.t).toContain('sk-[REDACTED]');
    expect(row.t).toContain(LOG_LINE);
    expect(JSON.parse(row.r)).toEqual({ count: 1, chars: 27 });
    // No copy of the original anywhere in the ledger.
    expect(db.prepare('SELECT COUNT(*) AS c FROM memory_events WHERE payload_json LIKE ?').get(`%${SECRET}%`).c).toBe(0);
    // The mark is still reported, so the count and the mark agree.
    expect(result.hygiene.secretFindings.total).toBeGreaterThan(0);
  } finally {
    kernel.close();
  }
});

test('a tool result with no secret is stored byte for byte as before', async () => {
  const plain = 'step 1 ok\nstep 2 ok\nplain log line: nothing to hide';
  const { kernel } = await remember(plain);
  try {
    const row = JSON.parse(storedToolText(kernel)) as { t: string; r: string | null };
    expect(row.t).toBe(plain);
    // No redaction mark either: an untouched result is not marked as treated.
    expect(row.r).toBeNull();
  } finally {
    kernel.close();
  }
});
