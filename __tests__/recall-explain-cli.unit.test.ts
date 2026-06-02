import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel } from '../src/factory.js';

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
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-explain-cli-'));
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
