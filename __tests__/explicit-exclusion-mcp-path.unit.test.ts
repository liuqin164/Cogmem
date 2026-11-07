import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #133's convention on the surface that teaches it (#152).
 *
 * `EXPLICIT_EXCLUSION_TEACHING` is injected into the MCP teaching surface and promises that marked text is never
 * stored, but the tool the user then calls reached the store without ever asking. Found in the box, with the ledger
 * checked rather than recall: the marked span came back with a hit count of 1.
 */
function kernelFor(dir: string) {
  return createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
}

test('the MCP write path stores no explicitly marked span (#152)', async () => {
  const dir = makeTempDir('cogmem-exclusion-mcp-inline-');
  const dbPath = join(dir, 'brain.db');
  const MARK = 'ZZMCPEXCLUSIONSPAN';
  const result = await callCogmemMcpTool('cogmem_remember_turn', {
    agentId: 'hermes',
    projectId: 'p',
    sessionId: 's',
    userText: `Release note: the pipeline has three steps.<COGMEM_PRIVATE>${MARK} must never be stored.</COGMEM_PRIVATE>`,
  }, { dbPath, hostId: 'hermes' });
  expect(result.isError).toBeFalsy();

  const kernel = kernelFor(dir);
  try {
    // The ledger, not recall: recall could withhold it for an unrelated reason and look like success.
    expect(kernel.searchRawEvents(MARK, { projectId: 'p' }).length).toBe(0);
    expect(kernel.searchRawEvents('pipeline has three steps', { projectId: 'p' }).length).toBeGreaterThan(0);
  } finally {
    kernel.close();
  }
});

test('the whole-turn marker leaves no user text in the ledger (#152)', async () => {
  const dir = makeTempDir('cogmem-exclusion-mcp-whole-');
  const dbPath = join(dir, 'brain.db');
  const MARK = 'ZZMCPWHOLEMARK';
  const result = await callCogmemMcpTool('cogmem_remember_turn', {
    agentId: 'hermes',
    projectId: 'p',
    sessionId: 's',
    userText: `<COGMEM_PRIVATE_ALL>${MARK} the whole turn stays out.`,
    assistantText: 'Acknowledged.',
  }, { dbPath, hostId: 'hermes' });
  expect(result.isError).toBeFalsy();

  const kernel = kernelFor(dir);
  try {
    expect(kernel.searchRawEvents(MARK, { projectId: 'p' }).length).toBe(0);
    // The assistant's reply is not the user's to mark, so it is still recorded — the same reading the bridge has.
    expect(kernel.searchRawEvents('Acknowledged', { projectId: 'p' }).length).toBeGreaterThan(0);
  } finally {
    kernel.close();
  }
});
