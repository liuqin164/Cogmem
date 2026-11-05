import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The host-integration switch, which is the part of ADR-0003 an audit could not
 * settle from the code: "never enables a host in the written config unless the flag
 * was passed explicitly".
 *
 * `--agent auto` **is** the flag being passed explicitly — it is a request for
 * detection to decide — while the unattended default is `none`, which is what makes
 * an agent-installed config contain no host nobody asked for. The interactive wizard
 * asks a human (step 6), so machine-global state does not decide anything on its own
 * in either path.
 */
async function initInWorkspace(args: string[]): Promise<{ openclaw: boolean; hermes: boolean; config: string }> {
  const home = mkdtempSync(join(tmpdir(), 'cogmem-agent-flag-'));
  const workspace = join(home, 'ws');
  mkdirSync(join(workspace, 'memory'), { recursive: true });
  for (const marker of ['USER.md', 'SOUL.md']) {
    await Bun.write(join(workspace, marker), '# marker\n');
  }
  const proc = Bun.spawn({
    cmd: ['bun', join(coreRoot, 'src/bin/cogmem.ts'), 'init', '--yes', ...args, '--json'],
    cwd: workspace,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: home, TMPDIR: join(coreRoot, '.cogmem/tmp'), NO_COLOR: '1' },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  expect({ exitCode, stderr: stderr.trim() === '' ? '' : stderr.slice(0, 300) }).toEqual({ exitCode: 0, stderr: '' });
  // The JSON reports the value itself; the file is what gets written, and both
  // are asserted below — one is the answer, the other is the config.
  const payload = JSON.parse(stdout) as { config: { integrations: { openclaw: boolean; hermes: boolean } } };
  const config = readFileSync(join(workspace, '.cogmem', 'config.toml'), 'utf8');
  rmSync(home, { recursive: true, force: true });
  return { openclaw: payload.config.integrations.openclaw, hermes: payload.config.integrations.hermes, config };
}

test('an unattended run enables no host unless the flag asks for one', async () => {
  // A workspace that would definitely be detected: the markers are right there.
  const run = await initInWorkspace([]);
  expect({ openclaw: run.openclaw, hermes: run.hermes }).toEqual({ openclaw: false, hermes: false });
  expect(run.config).toContain('enabled = false');
});

test('--agent auto is an explicit request for detection to decide', async () => {
  const run = await initInWorkspace(['--agent', 'auto']);
  expect(run.openclaw).toBe(true);
});

test('--agent none keeps the switch off in a detected workspace', async () => {
  const run = await initInWorkspace(['--agent', 'none']);
  expect({ openclaw: run.openclaw, hermes: run.hermes }).toEqual({ openclaw: false, hermes: false });
});
