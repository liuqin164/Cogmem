import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_TOOLS } from '../src/mcp/profiles.js';
import { createMemoryKernel } from '../src/factory.js';
import { parseArgs, runOpenClawImport } from '../src/bin/import-support.js';
import { KernelAgentMemoryBackend } from '../src/agent/index.js';
import { explainRecallWithKernel } from '../src/recall/RecallExplanation.js';
import { commandArguments, expectRunnableCommands } from './helpers/cli-invocation.js';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// The merged entry point: the host is its first argument.
const openClawImportBin = join(coreRoot, 'src/bin/import.ts');
const hermesImportBin = join(coreRoot, 'src/bin/import.ts');
const cogmemBin = join(coreRoot, 'src/bin/cogmem.ts');

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

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

test('OpenClaw import dry-run scans workspace sources without creating a memory database', async () => {
  const dir = makeTempDir('cogmem-openclaw-dry-');
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
    'openclaw',
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
  const dir = makeTempDir('cogmem-openclaw-import-');
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
    'openclaw',
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
  expect(firstParsed.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'project_timezone_missing_using_host_environment', severity: 'warning' }),
  ]));

  const second = await runCli([
    'bun',
    openClawImportBin,
    'openclaw',
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
  const recalled = kernel.evidenceFor('Bluetooth provisioning project', {
    projectId: 'openclaw-test',
    includeRawEvidence: true,
  });
  const emptyEpisodes = kernel.factStore.getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM memory_episodes e
    WHERE e.project_id = ?
      AND NOT EXISTS (SELECT 1 FROM memory_episode_events ee WHERE ee.episode_id = e.episode_id)
  `).get('openclaw-test') as { count: number };
  kernel.close();
  expect(recalled.rawEvidence.some((item) => item.content.includes('BLE device provisioning'))).toBe(true);
  expect(emptyEpisodes.count).toBe(0);
});

test('OpenClaw --reindex-raw backfills raw anchors for already imported legacy records', async () => {
  const dir = makeTempDir('cogmem-openclaw-reindex-raw-');
  const dbPath = join(dir, 'memory.db');
  mkdirSync(join(dir, 'memory'));
  writeFileSync(join(dir, 'memory', '2026-06-03-1310.md'), [
    '# 2026-06-03',
    '用户问 CogMem Memory Context 是否属于记忆黑盒。',
    'Agent 解释：注入摘要只能说明发生了什么，必须用 sourceContext 下钻原文。',
  ].join('\n'));

  const imported = await runCli([
    'bun',
    openClawImportBin,
    'openclaw',
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

  const db = new Database(dbPath);
  db.exec('DELETE FROM memory_events_fts');
  db.exec('DELETE FROM memory_events');
  db.close();

  const skipped = await runCli([
    'bun',
    openClawImportBin,
    'openclaw',
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'openclaw-test',
    '--json',
  ]);
  expect(skipped.stderr).toBe('');
  expect(skipped.exitCode).toBe(0);
  expect(JSON.parse(skipped.stdout).recordsIngested).toBe(0);

  const reindexed = await runCli([
    'bun',
    openClawImportBin,
    'openclaw',
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'openclaw-test',
    '--reindex-raw',
    '--json',
  ]);
  expect(reindexed.stderr).toBe('');
  expect(reindexed.exitCode).toBe(0);
  const parsed = JSON.parse(reindexed.stdout);
  expect(parsed.reindexRaw).toBe(true);
  expect(parsed.rawRecordsAnchored).toBeGreaterThan(0);

  const again = await runCli([
    'bun',
    openClawImportBin,
    'openclaw',
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'openclaw-test',
    '--reindex-raw',
    '--json',
  ]);
  expect(again.stderr).toBe('');
  expect(again.exitCode).toBe(0);
  expect(JSON.parse(again.stdout).rawRecordsAnchored).toBe(0);

  const kernel = createMemoryKernel({ dbPath });
  kernel.rebuildMemoryAtlas({ projectId: 'openclaw-test' });
  const memory = new KernelAgentMemoryBackend(kernel);
  const recalled = memory.recall({
    agentId: 'openclaw',
    projectId: 'openclaw-test',
    query: '我们之前是不是讨论过记忆黑盒和 sourceContext',
    limit: 5,
  });
  kernel.close();

  const item = recalled.items.find((candidate) => candidate.text.includes('Memory Context 黑盒') || candidate.text.includes('sourceContext'));
  expect(item).toBeDefined();
  expect(['raw_ledger', 'imported_summary']).toContain(item?.sourceType);
  expect(item?.canonicalId).toMatch(/^episode:/);
  expect(item?.matchedFacets?.some((facet) => facet.type === 'issue' && facet.value === 'memory-context-blackbox')).toBe(true);
  expect(item?.sourceAnchor?.eventId).toBeTruthy();
});

test('OpenClaw migrated records are visible through KernelAgentMemoryBackend recall', async () => {
  const dir = makeTempDir('cogmem-openclaw-backend-recall-');
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
    'openclaw',
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

test('OpenClaw legacy daily summary imports are searchable as bounded provenance support after dreaming', async () => {
  const dir = makeTempDir('cogmem-openclaw-legacy-summary-');
  const dbPath = join(dir, 'memory.db');
  mkdirSync(join(dir, 'memory'));
  writeFileSync(join(dir, 'memory', '2026-06-03-1310.md'), [
    '# 2026-06-03',
    '根据官方项目文档检查您的本地配置文件 (`~/.openclaw/openclaw.json`)，以下是符合建议的地方和可优化的地方：',
    '',
    '1. **优先级高**：添加会话重置和维护配置（防止会话文件无限增长）',
    '2. **优先级中**：配置工具允许/禁止列表（明确安全边界）',
    '3. **可选**：根据您的使用场景添加日志、沙箱或高级模型配置',
    '',
    '重启本地的hermes',
  ].join('\n'));

  const imported = await runCli([
    'bun',
    openClawImportBin,
    'openclaw',
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
  const importedSummary = kernel.memoryGraph.getAllNeurons()
    .filter((item) => (
      item.content.includes('重启本地的hermes')
      && (item.metadata.tags || []).includes('source:openclaw_daily_memory')
    ));
  expect(importedSummary.length).toBeGreaterThan(0);
  for (const item of importedSummary) {
    expect(item.metadata.tags).toContain('reliability:imported_summary');
    expect(item.metadata.tags).toContain('provenance:imported_summary');
    expect(item.metadata.tags).toContain('governance:imported_summary_support');
    expect(item.metadata.tags).toContain('memory_layer:summary_seed');
  }

  const memory = new KernelAgentMemoryBackend(kernel);
  await kernel.runDreamCurator({ projectId: 'openclaw-test', limit: 20 });
  const recalled = memory.recall({
    agentId: 'openclaw',
    projectId: 'openclaw-test',
    query: 'OpenClaw 配置 重启 hermes',
    limit: 5,
  });
  const explanation = explainRecallWithKernel(kernel, {
    agentId: 'openclaw',
    projectId: 'openclaw-test',
    query: 'OpenClaw 配置 重启 hermes',
    limit: 5,
  });
  kernel.close();

  const importedItem = recalled.items.find((item) => item.text.includes('重启本地的hermes'));
  expect(importedItem).toBeDefined();
  expect(importedItem?.sourceType).toBe('imported_summary');
  expect(importedItem?.canAnswerExactQuote).toBe(false);
  expect(importedItem?.sourceContext?.event.text).toContain('重启本地的hermes');
  expect(importedItem?.sourceContext?.locator.command).toContain('cogmem memory show --event');
  expect(explanation.filteredEvidence?.some((item) => (
    item.text?.includes('重启本地的hermes')
    && item.reason === 'status_suppressed'
    && item.governanceReason === 'imported_summary_support'
  ))).toBe(true);
});

test('Hermes import migrates profile and session markdown into core memory', async () => {
  const dir = makeTempDir('cogmem-hermes-import-');
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
    'hermes',
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
  const recalled = kernel.evidenceFor('GATT configuration service', {
    projectId: 'hermes-test',
    includeRawEvidence: true,
  });
  kernel.close();
  expect(recalled.rawEvidence.some((item) => item.content.includes('GATT configuration service'))).toBe(true);
});

test('Hermes import scans state.db messages and preserves original message timestamps', async () => {
  const dir = makeTempDir('cogmem-hermes-state-db-');
  const dbPath = join(dir, 'memory.db');
  const stateDbPath = join(dir, 'state.db');
  const stateDb = new Database(stateDbPath);
  stateDb.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT,
      content TEXT,
      occurredAt TEXT,
      InsertTime TEXT
    );
  `);
  stateDb.prepare(`
    INSERT INTO messages (id, session_id, role, content, occurredAt, InsertTime)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'm1',
    'hermes-session-sqlite',
    'user',
    '6月9日のエルビ库存 PRECIOUS FRUITS を確認した。',
    '2026-06-09T01:02:03.000Z',
    '2026-06-13T16:36:00.000Z',
  );
  stateDb.prepare(`
    INSERT INTO messages (id, session_id, role, content, occurredAt, InsertTime)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'm2',
    'hermes-session-sqlite',
    'assistant',
    'Hermes state.db import must not collapse history to InsertTime.',
    '2026-06-15T04:05:06.000Z',
    '2026-06-13T16:36:00.000Z',
  );
  stateDb.close();

  const result = await runCli([
    'bun',
    hermesImportBin,
    'hermes',
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'hermes-state-test',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.agent).toBe('hermes');
  expect(parsed.sourcesScanned).toBe(1);
  expect(parsed.sourceResults[0].adapterKind).toBe('hermes_state_db');
  expect(parsed.recordsIngested).toBe(2);

  const kernel = createMemoryKernel({ dbPath });
  const events = kernel.getThreadEvents('hermes-session-sqlite', { projectId: 'hermes-state-test' });
  const searched = kernel.searchRawEvents('エルビ 库存 PRECIOUS FRUITS', {
    projectId: 'hermes-state-test',
    limit: 5,
  });
  kernel.close();

  expect(events).toHaveLength(2);
  expect(events[0].occurredAt).toBe(Date.parse('2026-06-09T01:02:03.000Z'));
  expect(events[1].occurredAt).toBe(Date.parse('2026-06-15T04:05:06.000Z'));
  expect(events[0].localDate).toBe('2026-06-09');
  expect(events[1].localDate).toBe('2026-06-15');
  expect(searched.some((event) => String((event.payload as { text?: string }).text).includes('PRECIOUS FRUITS'))).toBe(true);
});

test('Hermes import reads WAL-mode state.db and numeric timestamp seconds', async () => {
  const dir = makeTempDir('cogmem-hermes-state-db-wal-');
  const dbPath = join(dir, 'memory.db');
  const stateDbPath = join(dir, 'state.db');
  const stateDb = new Database(stateDbPath);
  stateDb.exec('PRAGMA journal_mode=WAL');
  stateDb.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      timestamp REAL NOT NULL,
      InsertTime TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
  stateDb.prepare(`
    INSERT INTO messages (session_id, role, content, timestamp, InsertTime)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    '20260603_121908_8c2361',
    'user',
    'エルビ 库存 PRECIOUS FRUITS numeric state timestamp.',
    1780489158.33065,
    '2026-06-13T16:36:00.000Z',
  );
  stateDb.close();

  const result = await runCli([
    'bun',
    hermesImportBin,
    'hermes',
    '--workspace',
    dir,
    '--db',
    dbPath,
    '--project',
    'hermes-state-wal-test',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.sourceResults[0].adapterKind).toBe('hermes_state_db');
  expect(parsed.recordsParsed).toBe(1);
  expect(parsed.recordsIngested).toBe(1);

  const kernel = createMemoryKernel({ dbPath });
  const events = kernel.getThreadEvents('20260603_121908_8c2361', { projectId: 'hermes-state-wal-test' });
  kernel.close();
  expect(events).toHaveLength(1);
  expect(events[0].occurredAt).toBe(1780489158.33065 * 1000);
  expect(String((events[0].payload as { text?: string }).text)).toContain('PRECIOUS FRUITS');
});

test('Hermes import accepts an explicit --state-db path outside the workspace', async () => {
  const dir = makeTempDir('cogmem-hermes-state-db-explicit-');
  const workspace = join(dir, 'workspace');
  const dbPath = join(dir, 'memory.db');
  const stateDbPath = join(dir, 'hermes-state.db');
  mkdirSync(workspace);
  const stateDb = new Database(stateDbPath);
  stateDb.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, sessionId TEXT, role TEXT, text TEXT, timestamp TEXT)');
  stateDb.prepare('INSERT INTO messages (sessionId, role, text, timestamp) VALUES (?, ?, ?, ?)').run(
    'explicit-session',
    'user',
    'Hermes explicit state database remembered MCP wiring.',
    '2026-06-10T10:00:00.000Z',
  );
  stateDb.close();

  const result = await runCli([
    'bun',
    hermesImportBin,
    'hermes',
    '--workspace',
    workspace,
    '--state-db',
    stateDbPath,
    '--db',
    dbPath,
    '--project',
    'hermes-state-explicit-test',
    '--json',
  ]);

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.sourcesScanned).toBe(1);
  expect(parsed.recordsIngested).toBe(1);
  expect(parsed.sourceResults[0].sourcePath).toBe(stateDbPath);
});

test('Hermes import accepts repeated explicit session files for single or batch migration', async () => {
  const dir = makeTempDir('cogmem-hermes-explicit-sessions-');
  const dbPath = join(dir, 'memory.db');
  writeFileSync(join(dir, 'one.md'), 'Human: Hermes explicit session one remembered OAuth refresh.\nAI: Stored.');
  writeFileSync(join(dir, 'two.md'), 'Human: Hermes explicit session two remembered vector migration.\nAI: Stored.');

  const result = await runCli([
    'bun',
    hermesImportBin,
    'hermes',
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
  const dir = makeTempDir('cogmem-openclaw-quantized-embed-');
  const workspace = join(dir, 'workspace');
  const configDir = join(workspace, '.cogmem');
  mkdirSync(join(workspace, 'memory'), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(workspace, 'memory', '2026-05-07.md'), 'User: local quantized embedding import remembered release notes.');

  const endpoint = 'http://127.0.0.1:1/v1/embeddings';
  const originalFetch = globalThis.fetch;
  let embedCalls = 0;

  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== endpoint) return originalFetch(input, init);
      embedCalls += 1;
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { input: string; model: string };
      expect(body.model).toBe('qwen3-embedding:0.6b');
      return Response.json({
        data: [{ embedding: Array.from({ length: 16 }, (_, index) => index / 16) }],
      });
    }) as typeof globalThis.fetch;
    writeFileSync(join(configDir, 'config.toml'), [
      '[core]',
      'db_path = "memory.db"',
      'vector_backend = "sqlite-vec"',
      'vector_dimension = 16',
      '',
      '[embedding]',
      'provider = "openai_compatible"',
      'base_url = "http://127.0.0.1:1/v1"',
      'model = "qwen3-embedding:0.6b"',
    ].join('\n'));

    await runOpenClawImport([
      '--workspace',
      workspace,
      '--project',
      'openclaw-quantized-test',
      '--no-progress',
    ]);

    expect(embedCalls).toBeGreaterThanOrEqual(1);
    const db = new Database(join(configDir, 'memory.db'), { readonly: true });
    try {
      const row = db.query('SELECT COUNT(*) AS count FROM neurons').get() as { count: number };
      expect(row.count).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenClaw import auto-discovers structured cogmem config instead of env files', async () => {
  const dir = makeTempDir('cogmem-openclaw-config-import-');
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
    'openclaw',
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
  const dir = makeTempDir('cogmem-openclaw-explicit-config-');
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
    'openclaw',
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
  const dir = makeTempDir('cogmem-openclaw-envpath-reject-');
  const envPath = join(dir, '.cogmem.env');
  mkdirSync(join(dir, 'memory'));
  writeFileSync(envPath, 'COGMEM_DB=memory.db\n');
  writeFileSync(join(dir, 'USER.md'), 'User identity: env path should be rejected.');
  writeFileSync(join(dir, 'memory', '2026-05-07.md'), 'User: env path import should fail.');

  const result = await runCli([
    'bun',
    openClawImportBin,
    'openclaw',
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

test('unified cogmem CLI dispatches doctor and update commands', async () => {
  const dir = makeTempDir('cogmem-unified-cli-');
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  const doctor = await runCli(['bun', cogmemBin, 'doctor', '--config', configPath]);
  expect(doctor.stderr).toBe('');
  expect(doctor.exitCode).toBe(0);
  expect(doctor.stdout).toContain('OK kernel ready');

  const update = await runCli(
    ['bun', cogmemBin, 'update', '--dry-run', '--json', '--config', configPath],
    coreRoot,
    { COGMEM_NPM_SPEC: '3.6.5' },
  );
  expect(update.stderr).toBe('');
  expect(update.exitCode).toBe(0);
  const parsed = JSON.parse(update.stdout);
  expect(parsed.command).toBe('update');
  expect(parsed.dryRun).toBe(true);
  expect(parsed.from).toBe('latest');
  expect(parsed.source).toBe('npm');
  expect(parsed.packageSpec).toBe('3.6.5');
  expect(parsed.targetCwd).toBe(coreRoot);
  expect(parsed.installKind).toBe('source_checkout');
  expect(parsed.nextCommand).toContain('cogmem@3.6.5');
  expect(parsed.nextCommand).not.toContain('releases/latest/download/cogmem.tgz');
  expect(parsed.nextCommand).not.toContain('@CognitiveOS/core');
  // #59: update has no migration step at all, so the field is gone rather than
  // pointing at a command that no longer exists.
  expect(parsed.migrationCommand).toBeUndefined();
});

test('cogmem update targets the one-line installer home when cwd has no package dependency', async () => {
  const dir = makeTempDir('cogmem-update-home-');
  const installHome = join(dir, 'pkg');
  const randomCwd = join(dir, 'work');
  const home = join(dir, 'home');
  const configPath = join(home, '.cogmem', 'config.toml');
  mkdirSync(installHome, { recursive: true });
  mkdirSync(randomCwd, { recursive: true });
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(join(installHome, 'package.json'), JSON.stringify({
    private: true,
    dependencies: {
      cogmem: 'https://github.com/liuqin164/cogmem/releases/download/v2.0.0/cogmem.tgz',
    },
  }));

  const update = await runCli(
    ['bun', cogmemBin, 'update', '--dry-run', '--json'],
    randomCwd,
    {
      HOME: home,
      COGMEM_INSTALL_HOME: installHome,
      COGMEM_NPM_SPEC: '3.6.5',
    },
  );

  expect(update.stderr).toBe('');
  expect(update.exitCode).toBe(0);
  const parsed = JSON.parse(update.stdout);
  expect(parsed.targetCwd).toBe(installHome);
  expect(parsed.currentSpec).toContain('cogmem.tgz');
  expect(parsed.packageSpec).toBe('3.6.5');
  expect(parsed.nextCommand).toContain('cogmem@3.6.5');
  expect(parsed.nextCommand).not.toContain('releases/latest/download/cogmem.tgz');
  // The user config lives beside the installer home, not inside the package root.
  // #59: update has no migration step at all, so the field is gone rather than
  // pointing at a command that no longer exists.
  expect(parsed.migrationCommand).toBeUndefined();
});

test('cogmem update targets npm global installs without writing a local package dependency', async () => {
  const dir = makeTempDir('cogmem-update-global-');
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  const update = await runCli(
    ['bun', cogmemBin, 'update', '--dry-run', '--json'],
    dir,
    {
      COGMEM_INSTALL_KIND: 'npm_global',
      COGMEM_NPM_SPEC: '3.6.5',
      // #89: a global install must name the prefix that owns it; without one, `update`
      // refuses rather than falling back to npm's configured default. This test is about
      // the global target, so it supplies the prefix the install would have.
      COGMEM_NPM_PREFIX: join(dir, 'global'),
    },
  );

  expect(update.stderr).toBe('');
  expect(update.exitCode).toBe(0);
  const parsed = JSON.parse(update.stdout);
  expect(parsed.installKind).toBe('npm_global');
  expect(parsed.currentSpec).toBe('npm:global');
  expect(parsed.nextCommand).toBe(`npm install -g --prefix ${join(dir, 'global')} cogmem@3.6.5`);
  // #59: update has no migration step at all, so the field is gone rather than
  // pointing at a command that no longer exists.
  expect(parsed.migrationCommand).toBeUndefined();
});

test('#89 a global install updates through the prefix that owns it, not npm\'s default', async () => {
  const dir = makeTempDir('cogmem-update-global-prefix-');
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  // A global install under a custom prefix — `npm install -g --prefix <dir>` — owns a
  // package at `<dir>/lib/node_modules/cogmem`. A bare `npm install -g` resolves npm's own
  // default prefix instead and fails with EACCES on a machine where that is not writable.
  const update = await runCli(
    ['bun', cogmemBin, 'update', '--dry-run', '--json'],
    dir,
    {
      COGMEM_INSTALL_KIND: 'npm_global',
      COGMEM_NPM_SPEC: '4.0.0',
      COGMEM_NPM_PREFIX: join(dir, 'global'),
    },
  );

  expect(update.exitCode).toBe(0);
  const parsed = JSON.parse(update.stdout);
  expect(parsed.installKind).toBe('npm_global');
  // The command it would run must name the prefix, so it updates the copy that is
  // actually installed rather than a different tree.
  expect(parsed.nextCommand).toContain('--prefix');
  expect(parsed.nextCommand).toContain(join(dir, 'global'));
  expect(parsed.nextCommand).toContain('cogmem@4.0.0');
});

test('#89 a prefix it cannot determine is reported, not silently replaced by npm\'s default', async () => {
  const dir = makeTempDir('cogmem-update-global-unknown-prefix-');
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  // The install is global (COGMEM_INSTALL_KIND), but the running copy is not under a
  // `node_modules/cogmem` layout and no prefix was given — so the prefix that owns it is
  // genuinely unknown. Printing `npm install -g cogmem@…` would silently target npm's
  // configured default, which may be a different tree entirely.
  const update = await runCli(
    ['bun', cogmemBin, 'update', '--dry-run', '--json'],
    dir,
    {
      COGMEM_INSTALL_KIND: 'npm_global',
      COGMEM_NPM_SPEC: '4.0.0',
      COGMEM_NPM_PREFIX: '',
    },
  );

  const parsed = JSON.parse(update.stdout);
  expect(parsed.installKind).toBe('npm_global');
  // A dry run must not print a command it would refuse to run.
  expect(parsed.nextCommand).toBeUndefined();
  expect(parsed.prefixUnknown).toBe(true);
  // And it has to say what to do about it.
  expect(String(parsed.updateWarning)).toContain('COGMEM_NPM_PREFIX');
  expect(String(parsed.updateWarning)).toContain('--prefix');
});

test('#89 a custom prefix with a space produces a command that would run as printed', async () => {
  const dir = makeTempDir('cogmem-update-global-space-');
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  const prefix = join(dir, 'a prefix with spaces');

  const update = await runCli(
    ['bun', cogmemBin, 'update', '--dry-run', '--json'],
    dir,
    { COGMEM_INSTALL_KIND: 'npm_global', COGMEM_NPM_SPEC: '4.0.0', COGMEM_NPM_PREFIX: prefix },
  );

  const parsed = JSON.parse(update.stdout);
  // The path is quoted, so copy-pasting `nextCommand` into a shell keeps it one argument.
  expect(parsed.nextCommand).toContain(`'${prefix}'`);
  // Proof rather than appearance: run the printed command through a shell with npm stubbed,
  // and assert the prefix arrives as exactly one argument.
  const stubDir = join(dir, 'stub');
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(join(stubDir, 'npm'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n', { mode: 0o755 });
  const printed = Bun.spawnSync({
    cmd: ['bash', '-c', String(parsed.nextCommand)],
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ''}` },
    stdout: 'pipe',
  });
  const argv = String(printed.stdout).trim().split('\n');
  // npm's own argv: install -g --prefix <the prefix, one argument> cogmem@4.0.0
  expect(argv[argv.indexOf('--prefix') + 1]).toBe(prefix);
});

test('the package exposes two bins, and the migration commands come through the dispatcher', () => {
  const packageJson = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as { bin: Record<string, string> };

  // The owner removed the `cogmem-*` alias bins ahead of 4.0 rather than in a later breaking
  // release (#112), so `cogmem` is the only command entry point. `cogmem-mcp` stays because
  // host configurations name it as a server command and are not rewritten on upgrade.
  expect(Object.keys(packageJson.bin).sort()).toEqual(['cogmem', 'cogmem-mcp']);
  expect(packageJson.bin.cogmem).toBe('dist/bin/cogmem.js');
  expect(packageJson.bin['cogmem-mcp']).toBe('dist/bin/mcp.js');
  expect(existsSync(join(coreRoot, 'src', 'bin', 'alias'))).toBe(false);

  // The commands those bins used to carry are still reachable, through the dispatcher.
  const source = readFileSync(join(coreRoot, 'src', 'bin', 'cogmem.ts'), 'utf8');
  for (const command of ['explain-recall', 'import', 'memory', 'repair']) {
    expect({ command, present: new RegExp(`'?${command}'?:\\s*'`).test(source) }).toEqual({ command, present: true });
  }
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
