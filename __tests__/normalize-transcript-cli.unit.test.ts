import { expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const normalizeBin = join(coreRoot, 'src/bin/normalize-transcript.ts');

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

test('cogmem-normalize-transcript writes normalized markdown with JSON source refs', async () => {
  const dir = makeTempDir('cogmem-normalize-json-');
  const inputPath = join(dir, 'memory.json');
  const outputPath = join(dir, 'memory.normalized.md');
  writeFileSync(inputPath, JSON.stringify([
    { role: 'user', text: 'Remember JSON source order.', timestamp: '2026-06-01T10:00:00Z' },
    { role: 'assistant', text: 'Stored from JSON array.', timestamp: '2026-06-01T10:00:01Z' },
  ], null, 2));

  const result = await runCli([
    'bun',
    normalizeBin,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--family',
    'json-array',
    '--title',
    'Imported JSON Memory',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const summary = JSON.parse(result.stdout);
  expect(summary).toMatchObject({
    dryRun: false,
    family: 'json_array_transcript_export',
    messageCount: 2,
    sourceRefCount: 2,
    written: true,
    outputPath,
  });

  const output = readFileSync(outputPath, 'utf8');
  expect(output).toContain('<!-- cogmem-original-input-family: json_array_transcript_export -->');
  expect(output).toContain('<!-- cogmem-source-ref: {"sourceOffset":1,"orderingConfidence":"high"} -->');
  expect(output).toContain('<!-- cogmem-source-ref: {"sourceOffset":2,"orderingConfidence":"high"} -->');
  expect(output).toContain('- [2026-06-01T10:00:00.000Z] user: Remember JSON source order.');
});

test('cogmem-normalize-transcript dry-run reports CSV row anchors without writing output', async () => {
  const dir = makeTempDir('cogmem-normalize-csv-');
  const inputPath = join(dir, 'memory.csv');
  const outputPath = join(dir, 'memory.normalized.md');
  writeFileSync(inputPath, [
    'timestamp,role,text',
    '2026-06-01T10:00:00Z,user,Remember CSV row two.',
    '2026-06-01T10:00:01Z,assistant,Stored from CSV row three.',
  ].join('\n'));

  const result = await runCli([
    'bun',
    normalizeBin,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--family',
    'csv',
    '--dry-run',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  expect(existsSync(outputPath)).toBe(false);
  const summary = JSON.parse(result.stdout);
  expect(summary).toMatchObject({
    dryRun: true,
    family: 'csv_transcript_export',
    messageCount: 2,
    sourceRefCount: 2,
    written: false,
  });
  expect(summary.sourceRefs).toEqual([
    { sourceOffset: 1, lineStart: 2, lineEnd: 2, orderingConfidence: 'high' },
    { sourceOffset: 2, lineStart: 3, lineEnd: 3, orderingConfidence: 'high' },
  ]);
});

test('cogmem-normalize-transcript expands Hermes JSONL session objects and preserves message timestamps', async () => {
  const dir = makeTempDir('cogmem-normalize-hermes-jsonl-');
  const inputPath = join(dir, 'hermes-sessions.jsonl');
  const outputPath = join(dir, 'hermes.normalized.md');
  writeFileSync(inputPath, JSON.stringify({
    sessionId: 'hermes-session-1',
    InsertTime: '2026-06-13T16:36:00.000Z',
    messages: [
      {
        role: 'user',
        text: '6月9日のエルビ库存 PRECIOUS FRUITS を確認した。',
        occurredAt: '2026-06-09T01:02:03.000Z',
      },
      {
        role: 'assistant',
        content: 'Hermes session export should keep original message time.',
        timestamp: '2026-06-15T04:05:06.000Z',
      },
    ],
  }) + '\n');

  const result = await runCli([
    'bun',
    normalizeBin,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--family',
    'jsonl',
    '--title',
    'Hermes JSONL Export',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const summary = JSON.parse(result.stdout);
  expect(summary).toMatchObject({
    family: 'jsonl_transcript_export',
    messageCount: 2,
    sourceRefCount: 2,
    written: true,
  });
  expect(summary.sourceRefs).toEqual([
    { sourceOffset: 1, lineStart: 1, lineEnd: 1, orderingConfidence: 'high' },
    { sourceOffset: 2, lineStart: 1, lineEnd: 1, orderingConfidence: 'high' },
  ]);

  const output = readFileSync(outputPath, 'utf8');
  expect(output).toContain('- [2026-06-09T01:02:03.000Z] user: 6月9日のエルビ库存 PRECIOUS FRUITS を確認した。');
  expect(output).toContain('- [2026-06-15T04:05:06.000Z] agent: Hermes session export should keep original message time.');
  expect(output).not.toContain('[2026-06-13T16:36:00.000Z]');
});

test('cogmem-normalize-transcript treats Hermes numeric timestamp as epoch seconds before InsertTime', async () => {
  const dir = makeTempDir('cogmem-normalize-hermes-jsonl-seconds-');
  const inputPath = join(dir, 'hermes-sessions.jsonl');
  const outputPath = join(dir, 'hermes.normalized.md');
  writeFileSync(inputPath, JSON.stringify({
    session_id: '20260603_121908_8c2361',
    InsertTime: '2026-06-13T16:36:00.000Z',
    messages: [
      {
        role: 'user',
        content: 'エルビ 库存 PRECIOUS FRUITS numeric timestamp.',
        timestamp: 1780489158.33065,
      },
    ],
  }) + '\n');

  const result = await runCli([
    'bun',
    normalizeBin,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--family',
    'jsonl',
    '--title',
    'Hermes JSONL Export',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const output = readFileSync(outputPath, 'utf8');
  expect(output).toContain('- [2026-06-03T12:19:18.330Z] user: エルビ 库存 PRECIOUS FRUITS numeric timestamp.');
  expect(output).not.toContain('[2026-06-13T16:36:00.000Z]');
  expect(output).not.toContain('[1970-01-21');
});

test('README documents normalize transcript usage and source-ref output', async () => {
  const readme = await Bun.file(join(coreRoot, 'README.md')).text();

  expect(readme).toContain('cogmem-normalize-transcript');
  expect(readme).toContain('--family json-array');
  expect(readme).toContain('--family csv');
  expect(readme).toContain('--dry-run --json');
  expect(readme).toContain('cogmem-source-ref');
  expect(readme).toContain('does not open a memory database');
});
