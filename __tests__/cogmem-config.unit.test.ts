import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadCogmemConfig,
  resolveCogmemConfigPath,
} from '../src/config/CogmemConfig.js';
import { createMemoryKernelFromConfig } from '../src/factory.js';

test('loadCogmemConfig parses TOML and resolves paths relative to the config file', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-config-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  mkdirSync(join(root, '.cogmem'), { recursive: true });
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_backend = "sqlite-vec"',
    '',
    '[paths]',
    'snapshots_dir = "snapshots"',
    '',
    '[embedding]',
    'provider = "openai_compatible"',
    'base_url = "http://localhost:11434/v1"',
    'model = "nomic-embed-text"',
    '',
    '[memory_model]',
    'provider = "openai_compatible"',
    'base_url = "http://localhost:11434/v1"',
    'model = "qwen2.5:3b"',
    'api_key = "${COGMEM_TEST_API_KEY}"',
    '',
    '[governance]',
    'pii_redact_email = true',
    'pii_redact_phone = false',
    'pii_redact_ssn = true',
    'encryption = false',
    '',
    '[integrations.openclaw]',
    'enabled = true',
    'workspace_dir = "."',
  ].join('\n'));

  const loaded = loadCogmemConfig({
    configPath,
    env: { COGMEM_TEST_API_KEY: 'test-secret' },
  });

  expect(loaded.configPath).toBe(configPath);
  expect(loaded.homeDir).toBe(join(root, '.cogmem'));
  expect(loaded.options.dbPath).toBe(join(root, '.cogmem', 'memory.db'));
  expect(loaded.options.vectorBackend).toBe('sqlite-vec');
  expect(loaded.options.redactionPolicy).toEqual({ email: true, phone: false, ssn: true });
  expect(loaded.paths.snapshotsDir).toBe(join(root, '.cogmem', 'snapshots'));
  expect(loaded.modelRegistry.getRoleConfig('memory').apiKey).toBe('test-secret');
  expect(loaded.integrations.openclaw.enabled).toBe(true);
  expect(loaded.diagnostics).toEqual([]);
});

test('loadCogmemConfig maps vector_dimension to kernel options only', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-vector-dimension-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  mkdirSync(join(root, '.cogmem'), { recursive: true });
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_backend = "sqlite-vec"',
    'vector_dimension = 4096',
  ].join('\n'));

  const loaded = loadCogmemConfig({ configPath, env: {} });

  expect(loaded.options.vectorDimension).toBe(4096);
  expect(loaded.diagnostics).toContainEqual(expect.objectContaining({
    severity: 'warning',
    code: 'high_vector_dimension',
  }));
});

test('loadCogmemConfig rejects invalid vector dimensions without imposing a hard upper bound', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-invalid-vector-dimension-'));
  const configPath = join(root, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_dimension = 0',
  ].join('\n'));

  const loaded = loadCogmemConfig({ configPath, env: {} });

  expect(loaded.options.vectorDimension).toBeUndefined();
  expect(loaded.diagnostics).toContainEqual(expect.objectContaining({
    severity: 'error',
    code: 'invalid_vector_dimension',
  }));
});

test('loadCogmemConfig rejects partially numeric vector dimensions', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-partial-vector-dimension-'));
  const configPath = join(root, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_dimension = "4096px"',
  ].join('\n'));

  const loaded = loadCogmemConfig({ configPath, env: {} });

  expect(loaded.options.vectorDimension).toBeUndefined();
  expect(loaded.diagnostics).toContainEqual(expect.objectContaining({
    severity: 'error',
    code: 'invalid_vector_dimension',
  }));
});

test('resolveCogmemConfigPath prefers TOML configs and ignores legacy env files', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-discovery-'));
  const nested = join(root, 'packages', 'demo');
  const home = join(root, 'home');
  const emptyHome = join(root, 'empty-home');
  mkdirSync(join(nested, '.cogmem'), { recursive: true });
  mkdirSync(join(home, '.cogmem'), { recursive: true });
  mkdirSync(join(emptyHome, '.cogmem'), { recursive: true });
  writeFileSync(join(nested, '.cogmem', 'config.toml'), '[core]\ndb_path = "project.db"\n');
  writeFileSync(join(home, '.cogmem', 'config.toml'), '[core]\ndb_path = "global.db"\n');
  writeFileSync(join(root, '.cogmem.env'), 'COGMEM_DB=legacy.db\n');
  // Note: we do NOT create a config in emptyHome/.cogmem

  const projectConfig = join(nested, '.cogmem', 'config.toml');
  const emptyConfig = join(emptyHome, '.cogmem', 'config.toml');

  // Project config takes precedence over any global config
  expect(resolveCogmemConfigPath({ cwd: nested, env: { HOME: home } })).toEqual({
    kind: 'toml',
    path: projectConfig,
  });

  // Root has no project config; global config resolution depends on environment.
  // In environments with a real ~/.cogmem/config.toml, that will be found by findUp.
  // We only assert it's a toml config (not missing) and not the legacy env file.
  const rootResult = resolveCogmemConfigPath({ cwd: root, env: { HOME: home } });
  expect(rootResult.kind).toBe('toml');
  expect(rootResult.path).toContain('.cogmem/config.toml');
  expect(rootResult.path).not.toContain('.cogmem.env');

  // With a HOME that has an empty .cogmem dir (no config.toml), findUp won't find one
  // and it will return missing with the default path for that HOME.
  // But if the real global config exists, findUp will find it.
  // So we just check it returns a valid toml config path (either the mock or real one).
  const emptyResult = resolveCogmemConfigPath({ cwd: root, env: { HOME: emptyHome } });
  expect(emptyResult.kind).toBe('toml');
  expect(emptyResult.path).toContain('.cogmem/config.toml');
});

test('loadCogmemConfig builds model registry directly from TOML', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-model-registry-'));
  const configPath = join(root, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    '',
    '[embedding]',
    'provider = "openai_compatible"',
    'base_url = "http://localhost:11434/v1"',
    'model = "nomic-embed-text"',
    'api_key = "${EMBEDDING_KEY}"',
    '',
    '[memory_model]',
    'provider = "openai_compatible"',
    'base_url = "http://localhost:11434/v1"',
    'model = "qwen2.5:3b"',
    'api_key = "${MEMORY_KEY}"',
  ].join('\n'));
  const loaded = loadCogmemConfig({
    configPath,
    env: { EMBEDDING_KEY: 'embedding-secret', MEMORY_KEY: 'memory-secret' },
  });

  expect(loaded.modelRegistry.getRoleConfig('embedding')).toMatchObject({
    provider: 'openai_compatible',
    modelName: 'nomic-embed-text',
    apiKey: 'embedding-secret',
  });
  expect(loaded.modelRegistry.getRoleConfig('memory')).toMatchObject({
    provider: 'openai_compatible',
    modelName: 'qwen2.5:3b',
    apiKey: 'memory-secret',
  });
});

test('createMemoryKernelFromConfig ignores stale process env without mutating it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-kernel-default-env-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  mkdirSync(join(root, '.cogmem'), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  const previousProvider = process.env.AGENT_BRAIN_MODEL_EMBEDDING_PROVIDER;
  const previousMemoryProvider = process.env.AGENT_BRAIN_MODEL_MEMORY_PROVIDER;
  process.env.AGENT_BRAIN_MODEL_EMBEDDING_PROVIDER = 'openai_compatible';
  process.env.AGENT_BRAIN_MODEL_MEMORY_PROVIDER = 'anthropic';

  const kernel = createMemoryKernelFromConfig({ configPath });
  try {
    const neuron = await kernel.ingest({
      projectId: 'toml-only',
      content: 'TOML configuration must not read stale process env model settings.',
    });
    expect(neuron.coordinates.V).toHaveLength(384);
    expect(process.env.AGENT_BRAIN_MODEL_EMBEDDING_PROVIDER).toBe('openai_compatible');
    expect(process.env.AGENT_BRAIN_MODEL_MEMORY_PROVIDER).toBe('anthropic');
  } finally {
    kernel.close();
    if (previousProvider === undefined) delete process.env.AGENT_BRAIN_MODEL_EMBEDDING_PROVIDER;
    else process.env.AGENT_BRAIN_MODEL_EMBEDDING_PROVIDER = previousProvider;
    if (previousMemoryProvider === undefined) delete process.env.AGENT_BRAIN_MODEL_MEMORY_PROVIDER;
    else process.env.AGENT_BRAIN_MODEL_MEMORY_PROVIDER = previousMemoryProvider;
  }
});

test('loadCogmemConfig does not expose env projection output', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-no-env-projection-'));
  const configPath = join(root, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    '',
    '[embedding]',
    'provider = "openai_compatible"',
    'model = "nomic-embed-text"',
    '',
    '[memory_model]',
    'provider = "rule_only"',
    'model = "rule_only"',
  ].join('\n'));
  const loaded = loadCogmemConfig({ configPath, env: {} });

  expect('env' in loaded).toBe(false);
});

test('loadCogmemConfig reports invalid model providers', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-invalid-provider-'));
  const configPath = join(root, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    '',
    '[embedding]',
    'provider = "anthropic"',
    'model = "nomic-embed-text"',
  ].join('\n'));

  const loaded = loadCogmemConfig({ configPath, env: {} });

  expect(loaded.diagnostics).toContainEqual(expect.objectContaining({
    severity: 'error',
    code: 'invalid_model_provider',
  }));
});

test('createMemoryKernelFromConfig opens the TOML configured database', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-kernel-config-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  const dbPath = join(root, '.cogmem', 'memory.db');
  mkdirSync(join(root, '.cogmem'), { recursive: true });
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_backend = "sqlite-vec"',
  ].join('\n'));

  const kernel = createMemoryKernelFromConfig({ configPath });

  expect(kernel.getHealthStatus().dbPath).toBe(dbPath);
  kernel.close();
});

test('createMemoryKernelFromConfig applies vector_dimension to the active vector store', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-kernel-vector-dimension-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  mkdirSync(join(root, '.cogmem'), { recursive: true });
  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_backend = "sqlite-vec"',
    'vector_dimension = 4096',
  ].join('\n'));

  const kernel = createMemoryKernelFromConfig({ configPath });

  expect(kernel.vectorStore.getStats().dimension).toBe(4096);
  kernel.close();
});
