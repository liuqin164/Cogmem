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
});
