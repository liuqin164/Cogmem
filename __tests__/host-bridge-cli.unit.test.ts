import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridgeBin = join(coreRoot, 'src/bin/host-bridge.ts');

/**
 * `cogmem-host-bridge` is the entry point for a host that cannot import
 * TypeScript — a Python plugin, a shell hook, a host whose plugin API is not
 * JavaScript. These tests run the real binary as a separate process against a
 * real database, because that is the only thing that proves a second host can
 * actually reach the shared orchestration.
 */

function makeHome(): { dir: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-host-bridge-bin-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `[core]\ndb_path = ${JSON.stringify(join(dir, 'memory.db'))}\nvector_backend = "sqlite-vec"\n`);
  return { dir, configPath };
}

async function run(args: string[], stdin: string) {
  const proc = Bun.spawn({
    cmd: ['bun', bridgeBin, ...args],
    cwd: coreRoot,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  proc.stdin.write(stdin);
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('the host bridge binary', () => {
  test('a host can record a turn and get a block back, across two processes', async () => {
    const { configPath } = makeHome();
    const identity = ['--config', configPath, '--host', 'hermes', '--project', 'proj-bin'];

    const remembered = await run(['remember', ...identity, '--session', 'sess-1'], JSON.stringify({
      userText: 'The staging database is called cogmem_staging and it lives in eu-west.',
      assistantText: 'Noted.',
    }));
    expect(remembered.stderr).toBe('');
    expect(remembered.exitCode).toBe(0);
    const written = JSON.parse(remembered.stdout);
    expect(written.ok).toBe(true);
    expect(written.result.rawEventIds).toHaveLength(2);

    const recalled = await run(['recall', ...identity, '--session', 'sess-2'], JSON.stringify({
      query: 'what is the staging database called',
    }));
    expect(recalled.stderr).toBe('');
    expect(recalled.exitCode).toBe(0);
    const read = JSON.parse(recalled.stdout);
    expect(read.ok).toBe(true);
    // The block is the whole point: a host injects `context` as-is.
    expect(read.result.context).toContain('<COGMEM_RECALL_CONTEXT');
    expect(read.result.context).toContain('cogmem_staging');
  });

  test('the host names itself, and the tool refuses to guess one', async () => {
    const { configPath } = makeHome();
    const proc = await run(['recall', '--config', configPath], JSON.stringify({ query: 'anything' }));
    expect(proc.exitCode).toBe(1);
    expect(proc.stdout).toBe('');
    expect(proc.stderr).toContain('--host <id> is required');
  });

  test('an unknown command fails loudly instead of doing something plausible', async () => {
    const { configPath } = makeHome();
    const proc = await run(['summarize', '--config', configPath, '--host', 'hermes'], '{}');
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr).toContain('expected "recall" or "remember"');
  });

  test('unparseable stdin is reported rather than treated as an empty request', async () => {
    const { configPath } = makeHome();
    const proc = await run(['recall', '--config', configPath, '--host', 'hermes'], '{not json');
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr).toContain('stdin is not JSON');
  });

  test('a query that matches nothing answers with an empty block, not an empty wrapper', async () => {
    const { configPath } = makeHome();
    const identity = ['--config', configPath, '--host', 'pi', '--project', 'proj-empty'];
    const proc = await run(['recall', ...identity], JSON.stringify({ query: 'nothing was ever recorded' }));
    expect(proc.exitCode).toBe(0);
    expect(JSON.parse(proc.stdout).result.context).toBe('');
  });

  test('one project cannot read another through the binary either', async () => {
    const { configPath } = makeHome();
    await run(['remember', '--config', configPath, '--host', 'hermes', '--project', 'proj-secret'],
      JSON.stringify({ userText: 'the proj-secret passphrase is hunter2', assistantText: 'ok' }));

    const leak = await run(['recall', '--config', configPath, '--host', 'hermes', '--project', 'proj-other'],
      JSON.stringify({ query: 'what is the proj-secret passphrase' }));
    expect(leak.exitCode).toBe(0);
    expect(JSON.parse(leak.stdout).result.context).not.toContain('hunter2');
  });
});
