import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * #43: `update --json` promises one JSON document on stdout. A config that could
 * not be read made the command stop before the gate and print nothing on stdout,
 * leaving an agent that asked for JSON to parse stderr instead.
 *
 * The package manager is shimmed so this stays offline: the failure happens while
 * loading the config, which is before any package manager is invoked, and the
 * shim makes sure of that rather than assuming it.
 */
test('update --json still answers with JSON when the config cannot be read', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cogmem-update-json-'));
  const binDir = join(home, 'shim-bin');
  mkdirSync(binDir);
  const npmShim = join(binDir, 'npm');
  writeFileSync(npmShim, `#!/bin/sh\necho npm-ran >> ${JSON.stringify(join(home, 'npm.log'))}\nexit 0\n`);
  chmodSync(npmShim, 0o755);
  // Not TOML at all, so reading it fails rather than merely disagreeing.
  const configPath = join(home, 'broken.toml');
  writeFileSync(configPath, 'this is not = = toml\n');

  const proc = Bun.spawn({
    cmd: ['bun', join(coreRoot, 'src/bin/cogmem.ts'), 'update', '--json', '--yes', '--config', configPath, '--install-home', home],
    cwd: home,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}`, TMPDIR: join(coreRoot, '.cogmem/tmp'), NO_COLOR: '1' },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;

  expect(exitCode).not.toBe(0);
  // The whole point: stdout parses, and it names the failure.
  const payload = JSON.parse(stdout) as { command?: string; status?: string; error?: { message?: string } };
  expect(payload.command).toBe('update');
  expect(payload.status).toBe('error');
  expect(payload.error?.message ?? '').toContain('config');
  expect(stderr).toContain('config');
  rmSync(home, { recursive: true, force: true });
}, 30000);
