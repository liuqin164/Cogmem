import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tmp.js';

describe('cogmem mcp dispatcher', () => {
  test('forwards stdin to the stdio MCP server', async () => {
    const dbPath = join(makeTempDir('cogmem-mcp-cli-'), 'memory.db');
    const input = [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      '',
    ].join('\n');
    const process = Bun.spawn({
      cmd: ['bun', 'src/bin/cogmem.ts', 'mcp', '--db', dbPath],
      cwd: import.meta.dir.replace(/\/__tests__$/, ''),
      stdin: new Blob([input]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(process.stdout).text();
    const stderr = await new Response(process.stderr).text();

    expect(await process.exited).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('"name":"cogmem-core"');
    expect(stdout).toContain('"name":"cogmem_recall"');
  });

  test('a stdio server started with --host reports that identity on recall (#143)', async () => {
    // Susan asked for this at the startup level rather than the function level: the trace has to name the host the
    // server was started with, because identity comes from the connection and never from the caller's arguments
    // (ADR-0006 / #92). Measured before the fix was landed: the trace showed the project id instead.
    const dbPath = join(makeTempDir('cogmem-mcp-host-'), 'memory.db');
    const input = [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'cogmem_recall', arguments: { query: 'deploy window', agentId: 'someone-else' } },
      }),
      '',
    ].join('\n');
    const process = Bun.spawn({
      cmd: ['bun', 'src/bin/cogmem.ts', 'mcp', '--db', dbPath, '--host', 'hermes'],
      cwd: import.meta.dir.replace(/\/__tests__$/, ''),
      stdin: new Blob([input]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(process.stdout).text();

    expect(await process.exited).toBe(0);
    // The arguments asked to be someone else; the connection says hermes, and the connection wins.
    expect(stdout.replace(/\\"/g, '"')).toContain('"agentId": "hermes"');
  });
});
