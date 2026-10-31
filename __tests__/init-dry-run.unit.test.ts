import { expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * #69: `--dry-run` is the flag a careful operator uses before letting a tool
 * write to their machine, and on the interactive path it wrote anyway. The
 * `--yes` path honoured it, so the defect was confined to the wizard.
 *
 * The wizard is driven with an endless stream of empty answers, which is how it
 * behaves for someone pressing Enter through the prompts. A fixed number of
 * newlines is not enough: the wizard exits at the first prompt when its input
 * ends, and then nothing would be written even without the fix — the test would
 * pass for the wrong reason.
 */
test('init --dry-run without --yes writes no config', async () => {
  const home = makeTempDir('cogmem-init-dry-run-');
  const proc = Bun.spawn({
    cmd: ['bash', '-c', `yes '' | bun ${JSON.stringify(join(coreRoot, 'src/bin/cogmem.ts'))} init --dry-run`],
    cwd: home,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: home, TMPDIR: join(coreRoot, '.cogmem/tmp'), NO_COLOR: '1', OPENAI_API_KEY: 'sk-not-a-real-key' },
  });
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
  expect(existsSync(join(home, '.cogmem', 'config.toml'))).toBe(false);
  expect(existsSync(join(home, '.cogmem'))).toBe(false);
  // It says what it would have written, rather than going quiet.
  expect(stdout).toContain('Dry run');
  expect(stdout).toContain('nothing written');
  rmSync(home, { recursive: true, force: true });
}, 30000);
