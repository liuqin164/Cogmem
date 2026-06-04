import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inferEmbeddingVectorDimension,
  suggestEmbeddingModel,
} from '../src/bin/init.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');
const initBin = join(coreRoot, 'src/bin/init.ts');
const snapshotBin = join(coreRoot, 'src/bin/snapshot.ts');
const reEmbedBin = join(coreRoot, 'src/bin/re-embed.ts');
const migrateVectorsBin = join(coreRoot, 'src/bin/migrate-vectors.ts');

test('doctor validates a structured cogmem config file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-doctor-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(configPath, [
    '[core]',
    'db_path = "brain.db"',
    'vector_backend = "sqlite-vec"',
  ].join('\n'));

  const proc = Bun.spawn({
    cmd: ['bun', doctorBin, '--config', configPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  expect(output).toContain('OK configuration parsed');
  expect(output).toContain('OK cogmem home');
  expect(output).toContain('OK kernel ready');
});

test('init supports non-interactive dry-run config generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-init-'));
  const homePath = join(dir, '.cogmem');

  const proc = Bun.spawn({
    cmd: [
      'bun',
      initBin,
      '--yes',
      '--dry-run',
      '--agent',
      'none',
      '--home',
      homePath,
    ],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  expect(output).toContain(`[core]`);
  expect(output).toContain('db_path = "memory.db"');
  expect(output).toContain('vector_backend = "sqlite-vec"');
  expect(output).toContain('vector_dimension = 384');
  expect(output).toContain('[integrations.openclaw]');
  expect(output).toContain('[integrations.hermes]');
  expect(existsSync(join(homePath, 'config.toml'))).toBe(false);
});

test('init recognizes Qwen3 embedding GGUF model names exposed by Ollama', () => {
  const suggested = suggestEmbeddingModel({
    ollamaAvailable: true,
    ollamaModels: ['qwen3-embedding-4b:latest'],
    openaiAvailable: false,
    anthropicAvailable: false,
    qwenAvailable: false,
  });

  expect(suggested.provider).toBe('openai_compatible');
  expect(suggested.model).toBe('qwen3-embedding-4b:latest');
  expect(suggested.vectorDimension).toBe(2560);
  expect(inferEmbeddingVectorDimension('openai_compatible', 'qwen3-embedding-8b:latest')).toBe(4096);
});

test('init exposes vector dimension and warns for high-dimensional embeddings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-init-vector-dimension-'));
  const homePath = join(dir, '.cogmem');

  const proc = Bun.spawn({
    cmd: [
      'bun',
      initBin,
      '--yes',
      '--dry-run',
      '--agent',
      'none',
      '--home',
      homePath,
      '--vector-dimension',
      '4096',
    ],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  expect(output).toContain('vector_dimension = 4096');
  expect(output).toContain('High vector dimension');
  expect(output).toContain('100,000 memories');
});

test('init dry-run can target Hermes agent workspaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-init-hermes-'));
  const homePath = join(dir, '.cogmem');

  const proc = Bun.spawn({
    cmd: [
      'bun',
      initBin,
      '--yes',
      '--dry-run',
      '--agent',
      'hermes',
      '--home',
      homePath,
    ],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  expect(output).toContain('[integrations.hermes]');
  expect(output).toContain('enabled = true');
  expect(output).toContain('[integrations.openclaw]');
  expect(existsSync(join(homePath, 'config.toml'))).toBe(false);
});

test('init non-interactive output shows current SDK quickstart calls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-init-snippet-'));
  const homePath = join(dir, '.cogmem');

  const proc = Bun.spawn({
    cmd: [
      'bun',
      initBin,
      '--yes',
      '--agent',
      'none',
      '--home',
      homePath,
    ],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  expect(output).toContain('const kernel = createMemoryKernelFromConfig();');
  expect(output).toContain("await kernel.ingest({ content: 'Remember that the user prefers concise answers.'");
  expect(output).toContain("kernel.recall('what does the user prefer?'");
  expect(output).not.toContain('turns:');
  expect(existsSync(join(homePath, 'config.toml'))).toBe(true);
});

test('init project scope writes a workspace-local .cogmem config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-init-project-'));

  const proc = Bun.spawn({
    cmd: [
      'bun',
      initBin,
      '--yes',
      '--agent',
      'none',
      '--scope',
      'project',
    ],
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  expect(output).toContain(join(dir, '.cogmem'));
  expect(existsSync(join(dir, '.cogmem', 'config.toml'))).toBe(true);
  expect(existsSync(join(dir, '.cogmem', 'snapshots'))).toBe(true);
});

test('init expands tilde in --home paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-init-home-'));
  const homeRoot = join(dir, 'home');
  mkdirSync(homeRoot, { recursive: true });

  const proc = Bun.spawn({
    cmd: [
      'bun',
      initBin,
      '--yes',
      '--dry-run',
      '--agent',
      'none',
      '--home',
      '~/.cogmem-test',
    ],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      HOME: homeRoot,
      NO_COLOR: '1',
    },
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  expect(output).toContain(join(homeRoot, '.cogmem-test'));
  expect(existsSync(join(homeRoot, '.cogmem-test', 'config.toml'))).toBe(false);
});

test('doctor rejects legacy env-path configuration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-doctor-legacy-'));
  const envPath = join(dir, '.agent-brain.env');
  writeFileSync(envPath, 'COGMEM_DB=brain.db\n');

  const proc = Bun.spawn({
    cmd: ['bun', doctorBin, '--env-path', envPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(output).toBe('');
  expect(exitCode).toBe(1);
  expect(errorOutput).toContain('--env-path is no longer supported');
});

test('doctor prints a high vector dimension warning for structured config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-doctor-vector-warning-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(configPath, [
    '[core]',
    'db_path = "brain.db"',
    'vector_dimension = 4096',
  ].join('\n'));

  const proc = Bun.spawn({
    cmd: ['bun', doctorBin, '--config', configPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  expect(output).toContain('WARN high_vector_dimension');
  expect(output).toContain('100,000 memories');
});

test('init rejects legacy env generation flags', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-init-legacy-'));
  const envPath = join(dir, '.agent-brain.env');

  const proc = Bun.spawn({
    cmd: [
      'bun',
      initBin,
      '--yes',
      '--dry-run',
      '--legacy-env',
      '--agent',
      'none',
      '--env-path',
      envPath,
    ],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(output).not.toContain('COGMEM_DB=./cogmem.db');
  expect(exitCode).toBe(1);
  expect(errorOutput).toContain('--legacy-env and --env-path are no longer supported');
  expect(existsSync(envPath)).toBe(false);
});

test('snapshot export uses configured database and default snapshots directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-snapshot-config-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  const seed = Bun.spawn({
    cmd: ['bun', doctorBin, '--config', configPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await new Response(seed.stdout).text();
  await new Response(seed.stderr).text();
  expect(await seed.exited).toBe(0);

  const proc = Bun.spawn({
    cmd: ['bun', snapshotBin, 'export', '--config', configPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  const parsed = JSON.parse(output);
  expect(parsed.snapshotPath).toContain(join(dir, '.cogmem', 'snapshots'));
  expect(existsSync(parsed.snapshotPath)).toBe(true);
});

test('re-embed status can read the configured database without --db', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-reembed-config-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  const seed = Bun.spawn({
    cmd: ['bun', doctorBin, '--config', configPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await new Response(seed.stdout).text();
  await new Response(seed.stderr).text();
  expect(await seed.exited).toBe(0);

  const proc = Bun.spawn({
    cmd: ['bun', reEmbedBin, 'status', '--config', configPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  const parsed = JSON.parse(output);
  expect(parsed.dbPath).toBe(join(dir, '.cogmem', 'memory.db'));
  expect(parsed.percentComplete).toBe(100);
});

test('vector migration dry-run can read the configured database without --db', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-vector-config-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  const seed = Bun.spawn({
    cmd: ['bun', doctorBin, '--config', configPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await new Response(seed.stdout).text();
  await new Response(seed.stderr).text();
  expect(await seed.exited).toBe(0);

  const proc = Bun.spawn({
    cmd: ['bun', migrateVectorsBin, '--config', configPath, '--dry-run'],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  const parsed = JSON.parse(output);
  expect(parsed.dryRun).toBe(true);
  expect(parsed.eligible).toBe(0);
});

test('vector migration dry-run uses configured vector_dimension by default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-vector-dimension-config-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_dimension = 4096',
  ].join('\n'));

  const seed = Bun.spawn({
    cmd: ['bun', doctorBin, '--config', configPath],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await new Response(seed.stdout).text();
  await new Response(seed.stderr).text();
  expect(await seed.exited).toBe(0);

  const proc = Bun.spawn({
    cmd: ['bun', migrateVectorsBin, '--config', configPath, '--dry-run'],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(errorOutput).toBe('');
  expect(exitCode).toBe(0);
  const parsed = JSON.parse(output);
  expect(parsed.dimension).toBe(4096);
  expect(parsed.dryRun).toBe(true);
});

test('vector migration rejects invalid explicit dimensions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-vector-invalid-dimension-'));
  const dbPath = join(dir, 'memory.db');

  const proc = Bun.spawn({
    cmd: ['bun', migrateVectorsBin, '--db', dbPath, '--dimension', '4096px', '--dry-run'],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(output).toBe('');
  expect(exitCode).toBe(1);
  expect(errorOutput).toContain('--dimension must be a positive integer');
});

test('snapshot import rejects invalid explicit dimensions before importing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-snapshot-invalid-dimension-'));
  const dbPath = join(dir, 'memory.db');
  const snapshotPath = join(dir, 'memory.snap');

  const proc = Bun.spawn({
    cmd: [
      'bun',
      snapshotBin,
      'import',
      '--snap',
      snapshotPath,
      '--db',
      dbPath,
      '--dimension',
      '4096px',
      '--dry-run',
    ],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(output).toBe('');
  expect(exitCode).toBe(1);
  expect(errorOutput).toContain('--dimension must be a positive integer');
});
