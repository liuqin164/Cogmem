/**
 * One writer process: opens a kernel on the given database and writes N turns.
 * Used by multi-writer.mjs to see what actually happens when several hosts
 * point at the same file, which CONCURRENT_ACCESS.md forbids but nothing enforces.
 */
import { createMemoryKernel } from '../../src/factory.js';
import { KernelAgentMemoryBackend } from '../../src/agent/index.js';

const [dbPath, writerId, rawCount] = process.argv.slice(2);
const count = Number(rawCount ?? 20);
const kernel = createMemoryKernel({ dbPath });
const memory = new KernelAgentMemoryBackend(kernel);
let ok = 0;
const errors: string[] = [];

for (let i = 0; i < count; i += 1) {
  try {
    await memory.rememberTurnWithResult({
      agentId: `writer-${writerId}`,
      projectId: 'concurrency-probe',
      sessionId: `session-${writerId}`,
      userText: `writer ${writerId} turn ${i} marker-conc-${writerId}-${i}`,
      assistantText: `ack ${i}`,
      timestamp: Date.now(),
      ingestMode: 'immediate_compile',
    });
    ok += 1;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

kernel.close();
console.log(JSON.stringify({ writer: writerId, ok, failed: errors.length, errors: [...new Set(errors)].slice(0, 3) }));
