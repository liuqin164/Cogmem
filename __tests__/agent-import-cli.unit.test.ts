import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel } from '../src/factory.js';
import { parseArgs } from '../src/bin/import-support.js';
import { KernelAgentMemoryBackend } from '../src/agent/index.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const openClawImportBin = join(coreRoot, 'src/bin/import-openclaw.ts');
const hermesImportBin = join(coreRoot, 'src/bin/import-hermes.ts');
const connectBin = join(coreRoot, 'src/bin/connect.ts');

async function runCli(
  cmd: string[],
  cwd = coreRoot,
  env: Record<string, string | undefined> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...env,
      NO_COLOR: '1',
    },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

test('OpenClaw import dry-run scans workspace sources without creating a memory database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-dry-'));
  const dbPath = join(dir, 'memory.db');
  mkdirSync(join(dir, 'memory'));
  writeFileSync(join(dir, 'USER.md'), 'User prefers Bluetooth protocol project notes.');
  writeFileSync(join(dir, 'memory', '2026-05-07.md'), [
    '# 2026-05-07',
    '- 09:00 User: Bluetooth provisioning uses a GATT config service.',
    '- 09:01 Agent: Stored the Bluetooth project context.',
  ].join('\n'));

  const result = await runCli([
    'bun',
    openClawImportBin,
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'openclaw-test',
    '--dry-run',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.agent).toBe('openclaw');
  expect(parsed.dryRun).toBe(true);
  expect(parsed.sourcesScanned).toBe(2);
  expect(parsed.recordsParsed).toBeGreaterThanOrEqual(2);
  expect(parsed.recordsWouldIngest).toBe(parsed.recordsParsed);
  expect(Bun.file(dbPath).exists()).resolves.toBe(false);
});

test('OpenClaw import writes memory once and skips already imported records on repeat runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-import-'));
  const dbPath = join(dir, 'memory.db');
  mkdirSync(join(dir, 'memory'));
  writeFileSync(join(dir, 'USER.md'), 'User identity: remembers protocol design details.');
  writeFileSync(join(dir, 'memory', '2026-05-07.md'), [
    '# 2026-05-07',
    '- 09:00 User: Bluetooth protocol project used BLE device provisioning.',
    '- 09:01 Agent: Logged the Bluetooth project memory.',
  ].join('\n'));

  const first = await runCli([
    'bun',
    openClawImportBin,
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'openclaw-test',
    '--json',
  ]);

  expect(first.stderr).toBe('');
  expect(first.exitCode).toBe(0);
  const firstParsed = JSON.parse(first.stdout);
  expect(firstParsed.recordsIngested).toBeGreaterThanOrEqual(2);

  const second = await runCli([
    'bun',
    openClawImportBin,
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'openclaw-test',
    '--json',
  ]);

  expect(second.stderr).toBe('');
  expect(second.exitCode).toBe(0);
  const secondParsed = JSON.parse(second.stdout);
  expect(secondParsed.recordsIngested).toBe(0);
  expect(secondParsed.skippedRecords).toBeGreaterThanOrEqual(firstParsed.recordsIngested);

  const kernel = createMemoryKernel({ dbPath });
  const recalled = kernel.recall('Bluetooth provisioning project', {
    projectId: 'openclaw-test',
    includeRawEvidence: true,
  });
  kernel.close();
  expect(recalled.rawEvidence.some((item) => item.content.includes('BLE device provisioning'))).toBe(true);
});

test('OpenClaw migrated records are visible through KernelAgentMemoryBackend recall', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-backend-recall-'));
  const dbPath = join(dir, 'memory.db');
  mkdirSync(join(dir, 'memory'));
  writeFileSync(join(dir, 'USER.md'), 'User identity: remembers protocol design details.');
  writeFileSync(join(dir, 'memory', '2026-05-07.md'), [
    '# 2026-05-07',
    '- 09:00 User: Bluetooth protocol project used BLE device provisioning.',
    '- 09:01 Agent: Logged the Bluetooth project memory.',
  ].join('\n'));

  const imported = await runCli([
    'bun',
    openClawImportBin,
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'openclaw-test',
    '--json',
  ]);

  expect(imported.stderr).toBe('');
  expect(imported.exitCode).toBe(0);

  const kernel = createMemoryKernel({ dbPath });
  const memory = new KernelAgentMemoryBackend(kernel);
  const recalled = memory.recall({
    agentId: 'openclaw',
    projectId: 'openclaw-test',
    query: 'Bluetooth provisioning project',
    limit: 5,
  });
  kernel.close();

  expect(recalled.items.some((item) => item.text.includes('BLE device provisioning'))).toBe(true);
});

test('Hermes import migrates profile and session markdown into core memory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-hermes-import-'));
  const dbPath = join(dir, 'memory.db');
  mkdirSync(join(dir, 'sessions'));
  writeFileSync(join(dir, 'profile.md'), 'Preference: Hermes should remember release gate commands.');
  writeFileSync(join(dir, 'sessions', 'session.md'), [
    '# 2026-05-07',
    'Human: The Bluetooth protocol project used a GATT configuration service.',
    'AI: I will keep that memory available.',
  ].join('\n'));

  const result = await runCli([
    'bun',
    hermesImportBin,
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'hermes-test',
    '--profile',
    'profile.md',
    '--sessions',
    'sessions',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.agent).toBe('hermes');
  expect(parsed.sourcesScanned).toBe(2);
  expect(parsed.recordsIngested).toBeGreaterThanOrEqual(2);

  const kernel = createMemoryKernel({ dbPath });
  const recalled = kernel.recall('GATT configuration service', {
    projectId: 'hermes-test',
    includeRawEvidence: true,
  });
  kernel.close();
  expect(recalled.rawEvidence.some((item) => item.content.includes('GATT configuration service'))).toBe(true);
});

test('Hermes import accepts repeated explicit session files for single or batch migration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-hermes-explicit-sessions-'));
  const dbPath = join(dir, 'memory.db');
  writeFileSync(join(dir, 'one.md'), 'Human: Hermes explicit session one remembered OAuth refresh.\nAI: Stored.');
  writeFileSync(join(dir, 'two.md'), 'Human: Hermes explicit session two remembered vector migration.\nAI: Stored.');

  const result = await runCli([
    'bun',
    hermesImportBin,
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'hermes-explicit-test',
    '--session',
    'one.md',
    '--session',
    'two.md',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.sourcesScanned).toBe(2);
  expect(parsed.recordsIngested).toBeGreaterThanOrEqual(2);
  expect(parsed.sourceResults.map((item: { sourcePath: string }) => item.sourcePath).sort()).toEqual([
    join(dir, 'one.md'),
    join(dir, 'two.md'),
  ]);
});

test('agent import uses configured local OpenAI-compatible embedding endpoint during migration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-quantized-embed-'));
  const workspace = join(dir, 'workspace');
  const configDir = join(workspace, '.cogmem');
  mkdirSync(join(workspace, 'memory'), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(workspace, 'memory', '2026-05-07.md'), 'User: local quantized embedding import remembered release notes.');

  let embedCalls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname !== '/v1/embeddings') {
        return new Response('not found', { status: 404 });
      }
      embedCalls += 1;
      const body = await request.json() as { input?: string | string[] };
      const count = Array.isArray(body.input) ? body.input.length : 1;
      return Response.json({
        data: Array.from({ length: count }, () => ({
          embedding: Array.from({ length: 16 }, (_, index) => index / 16),
        })),
      });
    },
  });

  try {
    writeFileSync(join(configDir, 'config.toml'), [
      '[core]',
      'db_path = "memory.db"',
      'vector_backend = "sqlite-vec"',
      'vector_dimension = 16',
      '',
      '[embedding]',
      'provider = "openai_compatible"',
      `base_url = "http://127.0.0.1:${server.port}/v1"`,
      'model = "qwen3-embedding:0.6b"',
    ].join('\n'));

    const result = await runCli([
      'bun',
      openClawImportBin,
      '--workspace',
      workspace,
      '--project',
      'openclaw-quantized-test',
      '--json',
    ]);

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.recordsIngested).toBeGreaterThanOrEqual(1);
    expect(embedCalls).toBeGreaterThanOrEqual(1);
  } finally {
    server.stop(true);
  }
});

test('OpenClaw import auto-discovers structured cogmem config instead of env files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-config-import-'));
  const dbPath = join(dir, '.cogmem', 'memory.db');
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  mkdirSync(join(dir, 'memory'));
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_backend = "sqlite-vec"',
  ].join('\n'));
  writeFileSync(join(dir, 'USER.md'), 'User identity: OpenClaw remembers Bluetooth work.');
  writeFileSync(join(dir, 'memory', '2026-05-07.md'), 'User: Bluetooth GATT config service.\nAgent: Stored.');

  const result = await runCli([
    'bun',
    openClawImportBin,
    '--workspace',
    dir,
    '--project',
    'openclaw-config-test',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.recordsIngested).toBeGreaterThanOrEqual(2);
  expect(Bun.file(dbPath).exists()).resolves.toBe(true);
});

test('OpenClaw import resolves explicit --config relative to the shell cwd', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-explicit-config-'));
  const workspace = join(dir, 'workspace');
  const configDir = join(dir, 'configs');
  const dbPath = join(configDir, 'memory.db');
  mkdirSync(join(workspace, 'memory'), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.toml'), [
    '[core]',
    'db_path = "memory.db"',
    'vector_backend = "sqlite-vec"',
  ].join('\n'));
  writeFileSync(join(workspace, 'USER.md'), 'User identity: explicit config import.');
  writeFileSync(join(workspace, 'memory', '2026-05-07.md'), 'User: explicit config should resolve from cwd.');

  const result = await runCli([
    'bun',
    openClawImportBin,
    '--workspace',
    workspace,
    '--config',
    'configs/config.toml',
    '--project',
    'openclaw-explicit-config-test',
    '--json',
  ], dir);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.recordsIngested).toBeGreaterThanOrEqual(2);
  expect(Bun.file(dbPath).exists()).resolves.toBe(true);
  expect(realpathSync(parsed.dbPath)).toBe(realpathSync(dbPath));
});

test('agent import CLIs reject legacy env-path configuration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-envpath-reject-'));
  const envPath = join(dir, '.agent-brain.env');
  mkdirSync(join(dir, 'memory'));
  writeFileSync(envPath, 'COGMEM_DB=memory.db\n');
  writeFileSync(join(dir, 'USER.md'), 'User identity: env path should be rejected.');
  writeFileSync(join(dir, 'memory', '2026-05-07.md'), 'User: env path import should fail.');

  const result = await runCli([
    'bun',
    openClawImportBin,
    '--workspace',
    dir,
    '--env-path',
    envPath,
    '--project',
    'openclaw-envpath-reject',
    '--json',
  ]);

  expect(result.stdout).toBe('');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('--env-path is no longer supported');
});

test('agent-facing runbooks tell OpenClaw and Hermes agents how to self-install and migrate', async () => {
  const openclaw = await Bun.file(join(coreRoot, 'examples/openclaw-backend/AGENTS.md')).text();
  const hermes = await Bun.file(join(coreRoot, 'examples/hermes-backend/AGENTS.md')).text();

  expect(openclaw).toContain('cogmem-init --agent openclaw');
  expect(openclaw).toContain('~/.cogmem/config.toml');
  expect(openclaw).toContain('cogmem-import-openclaw');
  expect(openclaw).toContain('KernelAgentMemoryBackend');
  expect(openclaw).toContain('Do not import AGENTS.md');

  expect(hermes).toContain('cogmem-init --agent hermes');
  expect(hermes).toContain('~/.cogmem/config.toml');
  expect(hermes).toContain('cogmem-import-hermes');
  expect(hermes).toContain('KernelAgentMemoryBackend');
  expect(hermes).toContain('profile.md');
});

test('README documents complete import usage including single files, batches, and local quantized embeddings', async () => {
  const readme = await Bun.file(join(coreRoot, 'README.md')).text();

  expect(readme).toContain('## Import Existing Agent Memory');
  expect(readme).toContain('ollama pull qwen3-embedding:0.6b');
  expect(readme).toContain('provider = "openai_compatible"');
  expect(readme).toContain('model = "qwen3-embedding:0.6b"');
  expect(readme).toContain('cogmem-import-openclaw');
  expect(readme).toContain('--session ./one.md --session ./two.md');
  expect(readme).toContain('--memory ./one.md --memory ./two.md');
  expect(readme).toContain('cogmem-import-hermes');
  expect(readme).toContain('--profile ./memory/profile.md --sessions ./memory/sessions');
  expect(readme).toContain('--session ./one.md --session ./two.md');
  expect(readme).toContain('dry-run');
  expect(readme).toContain('Imported records are embedded through the configured kernel embedder');
});

test('agent-facing skill files tell OpenClaw and Hermes agents how to self-install, migrate, and recall', async () => {
  const openclaw = await Bun.file(join(coreRoot, 'examples/openclaw-backend/SKILL.md')).text();
  const hermes = await Bun.file(join(coreRoot, 'examples/hermes-backend/SKILL.md')).text();

  for (const body of [openclaw, hermes]) {
    expect(body).toStartWith('---\nname: cogmem-memory-backend');
    expect(body).toContain('cogmem-init');
    expect(body).toContain('cogmem-doctor');
    expect(body).toContain('cogmem-mcp');
    expect(body).toContain('--dry-run');
    expect(body).toContain('KernelAgentMemoryBackend');
    expect(body).toContain('createMemoryKernelFromConfig');
    expect(body).toContain('recall.narrative');
    expect(body).toContain('Do not run a separate vector search');
    expect(body).toContain('Do not create .agent-brain.env');
    expect(body).toContain('ollama pull qwen3-embedding:0.6b');
    expect(body).toContain('[embedding]');
    expect(body).toContain('provider = "openai_compatible"');
    expect(body).toContain('model = "qwen3-embedding:0.6b"');
    expect(body).toContain('Imported records are embedded through the configured kernel embedder');
  }

  expect(openclaw).toContain('cogmem-import-openclaw');
  expect(openclaw).toContain('memory_search');
  expect(openclaw).toContain('plugins.slots.memory');
  expect(openclaw).toContain('--session ./one.md --session ./two.md');
  expect(openclaw).toContain('--memory ./one.md --memory ./two.md');
  expect(hermes).toContain('cogmem-import-hermes');
  expect(hermes).toContain('~/.hermes/config.yaml');
  expect(hermes).toContain('memory.provider');
  expect(hermes).toContain('--session ./one.md --session ./two.md');
});

test('cogmem-connect installs an agent skill into a workspace without migrating data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-connect-openclaw-'));
  const skillPath = join(dir, 'skills', 'cogmem-memory', 'SKILL.md');

  const dryRun = await runCli([
    'bun',
    connectBin,
    'openclaw',
    '--workspace',
    dir,
    '--dry-run',
    '--json',
  ]);

  expect(dryRun.stderr).toBe('');
  expect(dryRun.exitCode).toBe(0);
  const dryRunParsed = JSON.parse(dryRun.stdout);
  expect(dryRunParsed.agent).toBe('openclaw');
  expect(dryRunParsed.dryRun).toBe(true);
  expect(dryRunParsed.skillPath).toBe(skillPath);
  expect(existsSync(skillPath)).toBe(false);

  const installed = await runCli([
    'bun',
    connectBin,
    'openclaw',
    '--workspace',
    dir,
    '--json',
  ]);

  expect(installed.stderr).toBe('');
  expect(installed.exitCode).toBe(0);
  const installedParsed = JSON.parse(installed.stdout);
  expect(installedParsed.installed).toBe(true);
  expect(installedParsed.hostConfigSnippet).toContain('plugins.slots.memory');
  expect(existsSync(skillPath)).toBe(true);
  const body = readFileSync(skillPath, 'utf8');
  expect(body).toStartWith('---\nname: cogmem-memory-backend');
  expect(body).toContain('OpenClaw');
});

test('cogmem-connect installs Hermes skill into the real Hermes skills directory by default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-connect-hermes-home-'));
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  const skillPath = join(dir, '.hermes', 'skills', 'cogmem-memory', 'SKILL.md');

  const installed = await runCli([
    'bun',
    connectBin,
    'hermes',
    '--workspace',
    workspace,
    '--json',
  ], coreRoot, { HOME: dir });

  expect(installed.stderr).toBe('');
  expect(installed.exitCode).toBe(0);
  const parsed = JSON.parse(installed.stdout);
  expect(parsed.skillPath).toBe(skillPath);
  expect(parsed.hostConfigSnippet).toContain('mcp_servers:');
  expect(parsed.hostConfigSnippet).toContain('cogmem-mcp');
  expect(existsSync(skillPath)).toBe(true);
  expect(readFileSync(skillPath, 'utf8')).toStartWith('---\nname: cogmem-memory-backend');
});

test('package exposes agent migration bins', () => {
  const packageJson = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8'));

  expect(packageJson.bin['cogmem-explain-recall']).toBe('dist/bin/explain-recall.js');
  expect(packageJson.bin['cogmem-mcp']).toBe('dist/bin/mcp.js');
  expect(packageJson.bin['cogmem-import-openclaw']).toBe('dist/bin/import-openclaw.js');
  expect(packageJson.bin['cogmem-import-hermes']).toBe('dist/bin/import-hermes.js');
  expect(packageJson.bin['cogmem-connect']).toBe('dist/bin/connect.js');
});

test('import CLI parser keeps repeated path arguments in order without duplication', () => {
  const parsed = parseArgs([
    '--session',
    'one.md',
    '--session',
    'two.md',
    '--session',
    'three.md',
  ]);

  expect(parsed.values.session).toBe('one.md');
  expect(parsed.lists.session).toEqual(['two.md', 'three.md']);
});
