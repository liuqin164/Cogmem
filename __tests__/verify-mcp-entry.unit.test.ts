import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { verifyMcpEntry } from '../src/host/verifyMcpEntry.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #116. `installed` and `verified` are different claims, and writing a file only supports
 * the first. #86, #94 and #96 were all cases where `connect` reported success and the
 * command it wrote could not start: a bare name the host could not resolve, an absolute
 * path whose prefix had been removed, a config the server never found. The file was there
 * every time, so this runs the entry instead of reading it.
 */

const mcpBin = join(import.meta.dir, '..', 'src', 'bin', 'mcp.ts');

function writeConfig(dir: string): string {
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `[core]\ndb_path = "${join(dir, 'memory.db')}"\n`);
  return configPath;
}

test('an entry that answers tools/list is verified, and one that cannot start is not (#116)', async () => {
  const dir = makeTempDir('cogmem-verify-entry-');
  const configPath = writeConfig(dir);

  const working = await verifyMcpEntry({
    command: process.execPath,
    args: [mcpBin, '--config', configPath, '--project', 'p'],
  });
  expect(working.ok).toBe(true);
  expect(working.how).toBe('mcp_handshake');
  expect(working.tools).toBeGreaterThan(0);
  expect(working.detail).toContain('tools/list');

  // The measured shape of #94: a command that names no installation to run.
  const missing = await verifyMcpEntry({ command: join(dir, 'gone', 'cogmem'), args: ['mcp'] }, { timeoutMs: 1500 });
  expect(missing.ok).toBe(false);
  expect(missing.detail).toMatch(/could not start|exited/);

  // The measured shape of #86: the server starts and cannot find its config, so it exits
  // without answering. A check that only looked for a live process would pass this.
  const noConfig = await verifyMcpEntry(
    { command: process.execPath, args: [mcpBin, '--config', join(dir, 'nowhere', 'config.toml'), '--project', 'p'] },
    { timeoutMs: 4000 },
  );
  expect(noConfig.ok).toBe(false);
  expect(noConfig.detail).toMatch(/exited with code|no answer/);
});
