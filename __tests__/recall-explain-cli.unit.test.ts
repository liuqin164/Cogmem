import { expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const explainBin = join(coreRoot, 'src/bin/explain-recall.ts');

async function runCli(cmd: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd,
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

test('cogmem-explain-recall prints universe navigation details as json', async () => {
  const dir = makeTempDir('cogmem-explain-cli-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  await kernel.ingest({
    content: 'Bluetooth protocol project used a GATT configuration service.',
    projectId: 'explain-test',
    tags: ['agent:openclaw', 'openclaw'],
  });
  kernel.close();

  const result = await runCli([
    'bun',
    explainBin,
    '--db',
    dbPath,
    '--project',
    'explain-test',
    '--agent',
    'openclaw',
    '--query',
    'Do you remember the Bluetooth project?',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.query).toBe('Do you remember the Bluetooth project?');
  expect(parsed.projectId).toBe('explain-test');
  expect(parsed.agentId).toBe('openclaw');
  expect(parsed.recallMode).toBe('universe_navigation');
  expect(parsed.narrative).toBeTruthy();
  expect(parsed.pulseTrace).toBeTruthy();
  expect(parsed.evidence.some((item: { text: string }) => item.text.includes('GATT configuration service'))).toBe(true);

  if (existsSync(dbPath)) unlinkSync(dbPath);
});

test('cogmem-explain-recall help documents filtered evidence governance fields', async () => {
  const result = await runCli([
    'bun',
    explainBin,
    '--help',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('filteredEvidence');
  expect(result.stdout).toContain('governanceReason');
});

test('explain-recall reads under the same default scope as recall', async () => {
  // The two commands diverge silently if they default differently: on a real 20k-event database
  // `recall` scoped itself to the project and answered 0 while `explain-recall` read unscoped and
  // answered 8 for the same query, so the inspector contradicted the thing it inspects (#128).
  const dir = makeTempDir('cogmem-explain-scope-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  await kernel.ingest({
    content: 'The retention window for archived logs is thirty days.',
    projectId: 'p',
    tags: ['agent:a'],
  });
  kernel.close();

  const run = async (command: 'recall' | 'explain', extra: string[]): Promise<Record<string, any>> => {
    const { exitCode, stdout, stderr } = await runCli([
      'bun', join(coreRoot, 'src/bin/cogmem.ts'),
      ...(command === 'recall' ? ['memory', 'recall'] : ['explain-recall']),
      // `recall` requires a timezone alongside `--db`; `explain-recall` has no such flag (its own
      // small divergence from the command it explains), so it is passed only where it is accepted.
      '--db', dbPath, ...(command === 'recall' ? ['--timezone', 'UTC'] : []),
      '--project', 'p', '--query', 'retention window', ...extra, '--json',
    ]);
    expect({ command, exitCode, stderr: stderr.slice(0, 140) }).toEqual({ command, exitCode: 0, stderr: '' });
    return JSON.parse(stdout);
  };

  // Neither command is told an agent: both must resolve the same one and therefore agree.
  const recallDefault = await run('recall', []);
  const explainDefault = await run('explain', []);
  expect(recallDefault.agentId).toBe(explainDefault.agentId);
  expect(recallDefault.agentId).toBe('p');

  // Told the agent the memory is tagged with, both see it — so the empty default is a scope
  // answer, not a missing memory.
  const recallScoped = await run('recall', ['--agent', 'a']);
  const explainScoped = await run('explain', ['--agent', 'a']);
  expect((recallScoped.items ?? []).length).toBeGreaterThan(0);
  expect((explainScoped.evidence ?? []).length).toBeGreaterThan(0);
});
