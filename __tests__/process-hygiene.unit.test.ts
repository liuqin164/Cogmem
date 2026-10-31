import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A leaked MCP server is invisible to the test runner: every test still reports
// pass while a `bun src/bin/mcp.ts --transport http` process keeps its port and
// its SQLite files open. These guards keep both leak sources closed: transport
// tests must start the server in process, and shell entrypoints that background
// a real server must trap-kill it.

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function shellScripts(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...shellScripts(path));
      continue;
    }
    if (entry.endsWith('.sh')) found.push(path);
  }
  return found;
}

describe('process hygiene', () => {
  test('the transport tests run the MCP server in process, not as a subprocess', () => {
    const transportTests = [
      '__tests__/mcp-execution.unit.test.ts',
      '__tests__/mcp-http.unit.test.ts',
    ];
    const toolTests = ['__tests__/mcp-tools.unit.test.ts'];

    for (const file of transportTests) {
      const source = readText(join(coreRoot, file));
      expect(source).toContain('startCogmemMcpHttpServer');
      // Every in-process server must be closed, otherwise the process keeps the
      // listening socket until the runner exits.
      expect(source).toContain('stop()');
    }

    for (const file of [...transportTests, ...toolTests]) {
      const source = readText(join(coreRoot, file));
      expect(source).not.toContain('Bun.spawn');
      expect(source).not.toContain('node:child_process');
    }
  });

  test('every shell script that backgrounds an MCP server kills it on exit', () => {
    const offenders: string[] = [];

    for (const path of shellScripts(join(coreRoot, 'evals'))) {
      const source = readText(path);
      const backgroundsServer = /bin\/mcp\.(ts|js)/.test(source) && /&\s*$/m.test(source);
      if (!backgroundsServer) continue;
      const rel = path.slice(coreRoot.length + 1);
      if (!/\btrap\b/.test(source) || !/\bkill\b/.test(source)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  test('an executable leak check covers the MCP test files', () => {
    const path = join(coreRoot, 'evals/mcp/leak-check.sh');
    const source = readText(path);

    expect(statSync(path).mode & 0o111).not.toBe(0);
    for (const file of [
      '__tests__/mcp-execution.unit.test.ts',
      '__tests__/mcp-http.unit.test.ts',
      '__tests__/mcp-tools.unit.test.ts',
      '__tests__/mcp-cli.unit.test.ts',
    ]) {
      expect(source).toContain(file);
    }
  });
});
