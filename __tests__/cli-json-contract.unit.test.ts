import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatCliJson } from '../src/bin/CliJson.js';

test('shared CLI JSON metadata cannot be overridden by command payloads', () => {
  expect(formatCliJson('memory.status', { command: 'spoofed', schemaVersion: 'old', value: 1 })).toEqual({
    command: 'memory.status', schemaVersion: 'cogmem.cli.v1', value: 1,
  });
});

const memoryBin = join(import.meta.dir, '..', 'src', 'bin', 'memory.ts');
const cogmemBin = join(import.meta.dir, '..', 'src', 'bin', 'cogmem.ts');

async function runMemory(args: string[]): Promise<Record<string, unknown>> {
  const proc = Bun.spawn({
    cmd: ['bun', memoryBin, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
  return JSON.parse(stdout) as Record<string, unknown>;
}

test('top-level help documents the machine-readable JSON shape', async () => {
  const proc = Bun.spawn({ cmd: ['bun', cogmemBin, '--help'], stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(stdout).toContain('cogmem.cli.v1');
  expect(stdout).toContain('arrays use items');
  expect(stdout).toContain('needs_confirmation');
});

test('memory status --json exposes stable top-level queue counters', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-cli-json-')), 'memory.db');
  const output = await runMemory(['status', '--db', dbPath, '--project', 'demo', '--json']);

  expect(output.schemaVersion).toBe('cogmem.cli.v1');
  expect(output.command).toBe('memory.status');
  expect(output.candidate).toBe(0);
  expect(output.promoted).toBe(0);
  expect(output.needs_confirmation).toBe(0);
  expect(output.beliefs).toBe(0);
  expect(output.dreamCandidateQueue).toEqual(expect.objectContaining({ candidate: 0, promoted: 0 }));
});

test('memory dream --promote --json exposes queue counters without requiring governance.queue paths', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-cli-json-')), 'memory.db');
  const output = await runMemory(['dream', '--promote', '--db', dbPath, '--project', 'demo', '--json']);

  expect(output.schemaVersion).toBe('cogmem.cli.v1');
  expect(output.command).toBe('memory.dream');
  expect(output.candidate).toBe(0);
  expect(output.promoted).toBe(0);
  expect(output.needs_confirmation).toBe(0);
  expect(output.beliefs).toBe(0);
});
