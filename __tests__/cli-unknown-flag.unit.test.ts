import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCliArgs, CliUsageError, knownFlags } from '../src/bin/CliArgs.js';

const root = join(import.meta.dir, '..');

/** Every entry point the package publishes, read from package.json — never a hand-written list. */
function binEntries(): Array<{ name: string; source: string }> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { bin?: Record<string, string> };
  return Object.entries(pkg.bin ?? {}).map(([name, distPath]) => ({
    name,
    source: join(root, distPath.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts')),
  }));
}

test('the parser rejects an unknown flag and lists what it accepts', () => {
  const usage = 'Usage: cogmem thing [--project <id>] [--json]';
  expect(() => parseCliArgs(['thing', '--typo'], { usage })).toThrow(CliUsageError);
  expect(() => parseCliArgs(['thing', '--typo'], { usage })).toThrow(/unknown flag --typo; available: .*--json/);
  expect(parseCliArgs(['thing', '--project', 'p', '--json'], { usage })).toEqual({ command: 'thing', project: 'p', json: true });
  // `--` ends the flags rather than being read as one.
  expect(parseCliArgs(['thing', '--json', '--', '--not-a-flag'], { usage })).toEqual({ command: 'thing', json: true });
  // `--flag=value` is a spelling operators use (#83).
  expect(parseCliArgs(['thing', '--project=p'], { usage })).toEqual({ command: 'thing', project: 'p' });
});

test('every published entry point fails on an unknown flag', () => {
  const entries = binEntries();
  expect(entries.length).toBeGreaterThan(10);
  for (const entry of entries) {
    const result = Bun.spawnSync(['bun', entry.source, '--typo'], { cwd: root, timeout: 30_000 });
    const output = `${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`;
    expect({ name: entry.name, rejected: result.exitCode !== 0 }).toEqual({ name: entry.name, rejected: true });
    expect({ name: entry.name, names: /unknown flag --typo|unknown command --typo|Unknown cogmem command: --typo/i.test(output) }).toEqual({ name: entry.name, names: true });
  }
}, 120_000);

test('a documented flag is accepted and an undocumented one needs extraFlags', () => {
  expect(knownFlags('Usage: x [--a] [--b]').has('a')).toBe(true);
  expect(knownFlags('Usage: x [--a]').has('c')).toBe(false);
  expect(knownFlags('Usage: x [--a]', ['c']).has('c')).toBe(true);
});

test('memory govern separates what it promoted from what it wrote', async () => {
  const { createMemoryKernel } = await import('../src/factory.js');
  const { makeTempDir } = await import('./helpers/tmp.js');
  const kernel = createMemoryKernel({ dbPath: join(makeTempDir('cogmem-govern-'), 'memory.db') });
  try {
    const result = kernel.promoteDreamCandidates({ projectId: 'p', limit: 5 });
    // `queue.promoted` is a snapshot of how many candidates are in that status,
    // which read as "promoted just now" (#105). These two say what happened.
    expect(result.promotedCandidates).toBe(0);
    expect(result.neuronsWritten).toBe(0);
    expect(result.queue.promoted).toBe(0);
  } finally {
    kernel.close();
  }
});
