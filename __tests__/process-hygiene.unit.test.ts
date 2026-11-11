import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A leaked resident server is invisible to the test runner: every test still reports pass while a
// `bun src/bin/observatory.ts` process keeps its port and its SQLite files open. These guards keep
// both leak sources closed: transport tests must start the server in process, and shell entrypoints
// that background the resident must trap-kill it.

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
  test('the observatory tests run the server in process, not as a subprocess', () => {
    const serverTests = ['__tests__/observatory.unit.test.ts'];

    for (const file of serverTests) {
      const source = readText(join(coreRoot, file));
      expect(source).toContain('startObservatoryServer');
      // Every in-process server must be closed, otherwise the process keeps the
      // listening socket until the runner exits.
      expect(source).toContain('stop()');
      expect(source).not.toContain('Bun.spawn');
      expect(source).not.toContain('node:child_process');
    }
  });

  test('every shell script that backgrounds the resident kills it on exit', () => {
    const offenders: string[] = [];

    for (const path of shellScripts(join(coreRoot, 'evals'))) {
      const source = readText(path);
      const backgroundsServer = /bin\/observatory\.(ts|js)/.test(source) && /&\s*$/m.test(source);
      if (!backgroundsServer) continue;
      const rel = path.slice(coreRoot.length + 1);
      if (!/\btrap\b/.test(source) || !/\bkill\b/.test(source)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });
});
