import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';

/**
 * A stdio MCP client keeps the connection open: it writes `initialize`, waits for
 * the response, and only then writes the next message. Sending a message and
 * closing stdin — which is what the other stdio tests do — reads the answer out of
 * the pipe after the server exits, so it cannot tell a server that answers from one
 * that flushes only at exit.
 *
 * pi found the difference: with the connection held open it reported
 * `MCP request timed out after 60000ms` and an empty tool list, while a minimal
 * server on the same runtime answered in 0.15s. This test is that client.
 */
const coreRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const cogmemBin = join(coreRoot, 'src/bin/cogmem.ts');
const BUN_DIR = join(process.execPath, '..');

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    // The version pi asks for, and the reason this was found: the request is one
    // the SDK answers, so anything that goes wrong is on the delivery side.
    protocolVersion: '2025-11-25',
    capabilities: { roots: {} },
    clientInfo: { name: 'pi', version: '1.4.0' },
  },
});

describe('the stdio MCP server answers while the connection stays open', () => {
  test('initialize is delivered before stdin closes', async () => {
    // `--config` is the form the host docs use, and the form that boots the full
    // kernel: its background work is what kept bun's stdout sink from draining.
    const workspace = makeTempDir('cogmem-stdio-handshake-');
    const configPath = join(workspace, '.cogmem', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
    const proc = Bun.spawn({
      // The dispatcher, because `cogmem mcp` is what the host docs configure and
      // what every client actually runs.
      cmd: ['bun', cogmemBin, 'mcp', '--config', configPath],
      cwd: coreRoot,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PATH: `${BUN_DIR}:${process.env.PATH ?? ''}`, NO_COLOR: '1' },
    });

    proc.stdin.write(`${INITIALIZE}\n`);
    await proc.stdin.flush();

    const reader = proc.stdout.getReader();
    const answer = await Promise.race([
      reader.read(),
      new Promise<'no-answer'>((resolve) => setTimeout(() => resolve('no-answer'), 8_000)),
    ]);

    // Close the pipe either way, so a failure cannot leave the process behind.
    proc.stdin.end();
    const stderr = await new Response(proc.stderr).text();
    if (proc.exitCode === null) proc.kill();

    expect(answer === 'no-answer' ? 'no answer arrived while stdin stayed open' : 'answered').toBe('answered');
    const text = new TextDecoder().decode((answer as ReadableStreamReadResult<Uint8Array>).value);
    expect(text).toContain('"serverInfo"');
    expect(text).toContain('cogmem-core');
    expect(stderr).toBe('');
  }, 20_000);
});
