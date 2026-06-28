import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel } from '../src/factory.js';
import { parseArgs } from '../src/bin/import-support.js';
import { KernelAgentMemoryBackend } from '../src/agent/index.js';
import { explainRecallWithKernel } from '../src/recall/RecallExplanation.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const openClawImportBin = join(coreRoot, 'src/bin/import-openclaw.ts');
const hermesImportBin = join(coreRoot, 'src/bin/import-hermes.ts');
const connectBin = join(coreRoot, 'src/bin/connect.ts');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');
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

test('OpenClaw --reindex-raw backfills raw anchors for already imported legacy records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-reindex-raw-'));
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
  const memory = new KernelAgentMemoryBackend(kernel);
  const recalled = memory.recall({
    agentId: 'openclaw',
    projectId: 'openclaw-test',
    query: '我们之前是不是讨论过记忆黑盒和 sourceContext',
    limit: 5,
  });
  kernel.close();

  const item = recalled.items.find((candidate) => candidate.text.includes('记忆黑盒'));
  expect(item).toBeDefined();
  expect(item?.sourceType).toBe('imported_summary');
  expect(item?.canAnswerExactQuote).toBe(false);
  expect(item?.sourceContext?.event.text).toContain('sourceContext');
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

test('OpenClaw legacy daily summary imports are searchable as bounded provenance support after dreaming', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-openclaw-legacy-summary-'));
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

test('Hermes import scans state.db messages and preserves original message timestamps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-hermes-state-db-'));
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
  expect(searched.some((event) => String((event.payload as { text?: string }).text).includes('PRECIOUS FRUITS'))).toBe(true);
});

test('Hermes import reads WAL-mode state.db and numeric timestamp seconds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-hermes-state-db-wal-'));
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
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-hermes-state-db-explicit-'));
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
  const envPath = join(dir, '.cogmem.env');
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

  expect(openclaw).toContain('cogmem init --yes --agent openclaw');
  expect(openclaw).toContain('~/.cogmem/config.toml');
  expect(openclaw).toContain('cogmem import-openclaw');
  expect(openclaw).toContain('KernelAgentMemoryBackend');
  expect(openclaw).toContain('Do not import AGENTS.md');

  expect(hermes).toContain('cogmem init --yes --agent hermes');
  expect(hermes).toContain('~/.cogmem/config.toml');
  expect(hermes).toContain('cogmem import-hermes');
  expect(hermes).toContain('KernelAgentMemoryBackend');
  expect(hermes).toContain('profile.md');
});

test('README documents complete import usage including single files, batches, and local quantized embeddings', async () => {
  const readme = await Bun.file(join(coreRoot, 'README.md')).text();

  expect(readme).toContain('## Import Existing Agent Memory');
  expect(readme).toContain('ollama pull qwen3-embedding:0.6b');
  expect(readme).toContain('provider = "openai_compatible"');
  expect(readme).toContain('model = "qwen3-embedding:0.6b"');
  expect(readme).toContain('cogmem import-openclaw');
  expect(readme).toContain('--session ./one.md --session ./two.md');
  expect(readme).toContain('--memory ./one.md --memory ./two.md');
  expect(readme).toContain('cogmem import-hermes');
  expect(readme).toContain('--state-db ./state.db');
  expect(readme).toContain('--family jsonl');
  expect(readme).toContain('--profile ./memory/profile.md --sessions ./memory/sessions');
  expect(readme).toContain('--session ./one.md --session ./two.md');
  expect(readme).toContain('dry-run');
  expect(readme).toContain('Imported records are embedded through the configured kernel embedder');
  expect(readme).toContain('<COGMEM_RECALL_CONTEXT>');
  expect(readme).toContain('<COGMEM_TURN_BRIDGE>');
  expect(readme).toContain('<COGMEM_SESSION_STATE>');
  expect(readme).toContain('selective_compile` uses user text as the durable compile signal');
});

test('agent-facing skill files tell OpenClaw and Hermes agents how to self-install, migrate, and recall', async () => {
  const openclaw = await Bun.file(join(coreRoot, 'examples/openclaw-backend/SKILL.md')).text();
  const hermes = await Bun.file(join(coreRoot, 'examples/hermes-backend/SKILL.md')).text();

  for (const body of [openclaw, hermes]) {
    expect(body).toStartWith('---\nname: cogmem-memory-backend');
    expect(body).toContain('cogmem init --yes');
    expect(body).toContain('cogmem doctor');
    expect(body).toContain('cogmem-mcp');
    expect(body).toContain('--dry-run');
    expect(body).toContain('KernelAgentMemoryBackend');
    expect(body).toContain('createMemoryKernelFromConfig');
    expect(body).toContain('recall.narrative');
    expect(body).toContain('Do not run a separate vector search');
    expect(body).toContain('Do not create .cogmem.env');
    expect(body).toContain('ollama pull qwen3-embedding:0.6b');
    expect(body).toContain('[embedding]');
    expect(body).toContain('provider = "openai_compatible"');
    expect(body).toContain('model = "qwen3-embedding:0.6b"');
    expect(body).toContain('Imported records are embedded through the configured kernel embedder');
  }

  expect(openclaw).toContain('cogmem import-openclaw');
  expect(openclaw).toContain('memory_search');
  expect(openclaw).toContain('memory.backend');
  expect(openclaw).toContain('Do not write `plugins.slots.memory`');
  expect(openclaw).not.toContain('plugins.slots.memory = "cogmem"');
  expect(openclaw).toContain('Queued remember');
  expect(openclaw).toContain('cogmem explain-recall --query');
  expect(openclaw).toContain('cogmem memory recall --query');
  expect(openclaw).toContain('If `<COGMEM_RECALL_CONTEXT>` is absent');
  expect(openclaw).toContain('<COGMEM_TURN_BRIDGE>');
  expect(openclaw).toContain('<COGMEM_SESSION_STATE>');
  expect(openclaw).toContain('compileSignalSource = "user_only"');
  expect(openclaw).toContain('excludeCurrentSessionCompiledMemory = true');
  expect(openclaw).toContain('sourceAnchor');
  expect(openclaw).toContain('filteredEvidence');
  expect(openclaw).toContain('--session ./one.md --session ./two.md');
  expect(openclaw).toContain('--memory ./one.md --memory ./two.md');
  expect(hermes).toContain('cogmem import-hermes');
  expect(hermes).toContain('~/.hermes/config.yaml');
  expect(hermes).toContain('memory.provider');
  expect(hermes).toContain('--state-db ./state.db');
  expect(hermes).toContain('--family jsonl');
  expect(hermes).toContain('cogmem dream tick --project hermes --mode auto --json');
  expect(hermes).toContain('cogmem episode status --project hermes --json');
  expect(hermes).toContain('cogmem memory map --project hermes --json');
  expect(hermes).toContain('cogmem memory tick --project hermes --json');
  expect(hermes).toContain('cogmem_candidate_review');
  expect(hermes).toContain('cogmem_graph_touch');
  expect(hermes).toContain('--session ./one.md --session ./two.md');
});

test('cogmem-connect installs an agent skill into a workspace without migrating data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-connect-openclaw-'));
  const skillPath = join(dir, 'skills', 'cogmem-memory', 'SKILL.md');
  const operationsPath = join(dir, 'skills', 'cogmem-memory', 'references', 'operations.md');

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
  expect(dryRunParsed.skillFiles).toEqual([skillPath, operationsPath]);
  expect(existsSync(skillPath)).toBe(false);
  expect(existsSync(operationsPath)).toBe(false);

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
  expect(installedParsed.hostConfigSnippet).toContain('does not modify OpenClaw host config');
  expect(installedParsed.hostConfigSnippet).toContain('Do not write unknown OpenClaw config fields');
  expect(installedParsed.hostConfigSnippet).not.toContain('plugins.slots.memory');
  expect(existsSync(skillPath)).toBe(true);
  expect(existsSync(operationsPath)).toBe(true);
  const body = readFileSync(skillPath, 'utf8');
  const operations = readFileSync(operationsPath, 'utf8');
  expect(body).toStartWith('---\nname: cogmem-memory-backend');
  expect(body).toContain('OpenClaw');
  expect(body).toContain('references/operations.md');
  for (const command of [
    'cogmem migrate --dry-run --json',
    'cogmem import-openclaw',
    'cogmem memory review',
    'cogmem memory graph-explore',
    'cogmem episode repair',
    'cogmem snapshot export',
    'cogmem brain-eval',
  ]) {
    expect(operations).toContain(command);
  }
});

test('cogmem-connect can install the OpenClaw automatic memory plugin wrapper', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-connect-openclaw-auto-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  const openclawConfigPath = join(dir, 'openclaw.json');
  const pluginDir = join(dir, 'extensions', 'cogmem-auto-memory');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(openclawConfigPath, JSON.stringify({ plugins: { enabled: true } }, null, 2));

  const installed = await runCli([
    'bun',
    connectBin,
    'openclaw',
    '--workspace',
    dir,
    '--config',
    configPath,
    '--openclaw-config',
    openclawConfigPath,
    '--auto',
    '--force',
    '--json',
  ]);

  expect(installed.stderr).toBe('');
  expect(installed.exitCode).toBe(0);
  const parsed = JSON.parse(installed.stdout);
  expect(parsed.autoMemory.enabled).toBe(true);
  expect(parsed.autoMemory.installed).toBe(true);
  expect(parsed.autoMemory.pluginDir).toBe(pluginDir);
  expect(existsSync(join(pluginDir, 'index.js'))).toBe(true);
  expect(existsSync(join(pluginDir, 'bridge.mjs'))).toBe(true);
  const indexBody = readFileSync(join(pluginDir, 'index.js'), 'utf8');
  expect(indexBody).toContain('function pluginConfig(api, event, ctx)');
  expect(indexBody).toContain('ctx && (ctx.config || ctx.pluginConfig || {})');
  expect(indexBody).toContain('event && event.context && event.context.pluginConfig || {}');
  expect(indexBody).toContain("api.on('before_prompt_build', async (event, ctx)");
  expect(indexBody).toContain("api.on('agent_end', async (event, ctx)");
  expect(indexBody).toContain('function classifyRecallIntent(query)');
  expect(indexBody).toContain('const intent = classifyRecallIntent(query)');
  expect(indexBody).toContain('function classifyContextIntent(query)');
  expect(indexBody).toContain("reason: 'context_cortex:greeting'");
  expect(indexBody).toContain("recallMode: 'context_cortex_short_followup'");
  expect(indexBody).toContain('anchorEventId: anchor && anchor.eventId');
  expect(indexBody).toContain('excludeSessionId: config.excludeCurrentSessionCompiledMemory === false ? undefined : sessionId');
  expect(indexBody).toContain('function stripCogmemRecallBlocks(text)');
  expect(indexBody).toContain('function shouldInjectTurnBridge(query, receipt, config)');
  expect(indexBody).toContain('COGMEM_TURN_BRIDGE');
  expect(indexBody).toContain('COGMEM_SESSION_STATE');
  expect(indexBody).toContain('COGMEM_STRATEGY_CONTEXT');
  expect(indexBody).toContain('session_bridges');
  expect(indexBody).toContain('session_state');
  expect(indexBody).toContain('cleanUser');
  expect(indexBody).toContain('cleanAssistant');
  expect(indexBody).toContain('lastRecallForSession');
  expect(indexBody).toContain('lastRecallForSession.delete(sessionId)');
  expect(indexBody).toContain('recallItems.length > 0 || recall.context');
  const cortexBridgeBody = readFileSync(join(pluginDir, 'bridge.mjs'), 'utf8');
  expect(cortexBridgeBody).toContain('KernelAgentMemoryBackend');
  expect(cortexBridgeBody).toContain('kernel.contextCortex.plan');
  expect(cortexBridgeBody).toContain('kernel.strategyCortex.plan');
  expect(cortexBridgeBody).toContain('kernel.strategyCortex.replan');
  expect(cortexBridgeBody).toContain('retrievalPolicy');
  expect(cortexBridgeBody).toContain('formatStrategyContext');
  expect(cortexBridgeBody).toContain('kernel.memoryUseJudge.judge');
  expect(cortexBridgeBody).toContain('kernel.contextOutcomeStore.record');
  expect(cortexBridgeBody).toContain('activationReceipt');
  const manifest = JSON.parse(readFileSync(join(pluginDir, 'openclaw.plugin.json'), 'utf8'));
  expect(manifest.version).toBe('0.6.1');
  expect(manifest.configSchema.type).toBe('object');
  expect(manifest.configSchema.properties.configPath.type).toBe('string');
  expect(manifest.configSchema.properties.autoRecall.type).toBe('boolean');
  expect(manifest.configSchema.properties.ingestMode.enum).toContain('selective_compile');
  expect(manifest.configSchema.properties.ingestMode.enum).toContain('raw_then_dream');
  expect(manifest.configSchema.properties.rememberStrategy.enum).toContain('queued');
  expect(manifest.configSchema.properties.rememberQueuePath.type).toBe('string');
  expect(manifest.configSchema.properties.auditLog.type).toBe('boolean');
  expect(manifest.configSchema.properties.stripRecallBlocksBeforeRemember.type).toBe('boolean');
  expect(manifest.configSchema.properties.compileSignalSource.enum).toContain('user_only');
  expect(manifest.configSchema.properties.excludeCurrentSessionCompiledMemory.type).toBe('boolean');
  expect(manifest.configSchema.properties.memoryContextMaxChars.type).toBe('number');
  expect(manifest.configSchema.properties.memoryContextMaxItems.type).toBe('number');
  expect(manifest.configSchema.properties.sourceWindowMaxChars.type).toBe('number');
  expect(manifest.configSchema.properties.includeSourceWindowByDefault.type).toBe('boolean');
  expect(manifest.configSchema.properties.contextCortexEnabled.type).toBe('boolean');
  expect(manifest.configSchema.properties.strategyCortexEnabled.type).toBe('boolean');
  expect(manifest.configSchema.properties.contextAvailableTokens.type).toBe('number');
  expect(manifest.configSchema.properties.contextMemoryMaxRatio.type).toBe('number');
  expect(manifest.configSchema.properties.turnBridgeEnabled.type).toBe('boolean');
  expect(manifest.configSchema.properties.turnBridgeMaxTurns.type).toBe('number');
  expect(manifest.configSchema.properties.turnBridgeMaxChars.type).toBe('number');
  expect(manifest.configSchema.properties.turnBridgeInjectPolicy.enum).toContain('same_topic_only');
  expect(manifest.configSchema.properties.sessionStateEnabled.type).toBe('boolean');
  expect(manifest.configSchema.properties.sessionStateMaxChars.type).toBe('number');

  const openclawConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf8'));
  expect(openclawConfig.plugins.load.paths).toContain(pluginDir);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].enabled).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].hooks.allowConversationAccess).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].hooks.allowPromptInjection).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.configPath).toBe(configPath);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.ingestMode).toBe('selective_compile');
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.rememberStrategy).toBe('queued');
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.auditLog).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.publicEntrypoint).toContain('public.js');
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.limit).toBe(3);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.maxQueryChars).toBe(1200);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.maxAssistantChars).toBe(6000);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.stripRecallBlocksBeforeRemember).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.compileSignalSource).toBe('user_only');
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.excludeCurrentSessionCompiledMemory).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.memoryContextMaxChars).toBe(3500);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.memoryContextMaxItems).toBe(3);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.sourceWindowMaxChars).toBe(1200);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.includeSourceWindowByDefault).toBe(false);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.contextCortexEnabled).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.contextMemoryMaxRatio).toBe(0.25);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.strategyCortexEnabled).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.turnBridgeEnabled).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.turnBridgeMaxTurns).toBe(3);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.turnBridgeMaxChars).toBe(1200);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.turnBridgeInjectPolicy).toBe('same_topic_only');
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.sessionStateEnabled).toBe(true);
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].config.sessionStateMaxChars).toBe(1800);
  expect(indexBody).toContain("openclaw-auto-memory.jsonl");
  expect(indexBody).toContain("action: context ? 'inject' : 'skip'");
  expect(indexBody).toContain('function enqueueRememberJob(config, payload)');
  expect(indexBody).toContain("action: 'enqueue_remember'");
  expect(indexBody).toContain("spawnBridgeDrain(config)");
  const agentEndBody = indexBody.slice(indexBody.indexOf("api.on('agent_end'"));
  expect(agentEndBody).not.toContain("runBridge('remember'");
  const bridgeBody = readFileSync(join(pluginDir, 'bridge.mjs'), 'utf8');
  expect(bridgeBody).toContain('loadCogmemApi');
  expect(bridgeBody).toContain('publicEntrypoint');
  expect(bridgeBody).toContain('rememberTurnWithResult');
  expect(bridgeBody).toContain("ingestMode: bridgeConfig.ingestMode || 'selective_compile'");
  expect(bridgeBody).toContain("command === 'drain-remember-queue'");
  expect(bridgeBody).toContain('ingestToolCall');
  expect(bridgeBody).toContain('ingestToolObservation');
  expect(bridgeBody).toContain('ingestTaskEvent');
  expect(bridgeBody).toContain('function stripCogmemRecallBlocks(text)');
  expect(bridgeBody).toContain('COGMEM_TURN_BRIDGE');
  expect(bridgeBody).toContain('COGMEM_SESSION_STATE');
  expect(bridgeBody).toContain('COGMEM_STRATEGY_CONTEXT');
  expect(bridgeBody).toContain('hygiene');
  expect(bridgeBody).toContain('<COGMEM_RECALL_CONTEXT');
  expect(bridgeBody).toContain('persistence="forbidden"');
  expect(bridgeBody).toContain('lifecycle="current_turn_only"');
  expect(bridgeBody).toContain('This block must not be persisted or re-ingested as new memory.');
  expect(bridgeBody).toContain('sourceType');
  expect(bridgeBody).toContain('canAnswerExactQuote=false');
  expect(bridgeBody).toContain('sourceContext');
  expect(bridgeBody).toContain('recallDecision=');
  expect(bridgeBody).toContain('sourceWindow');
  expect(bridgeBody).toContain('formatContextEvent');
  expect(bridgeBody).toContain('truncatedAtChar');
  expect(bridgeBody).toContain('overlapHandling');
  expect(bridgeBody).toContain('uniqueWindowEvents');
  expect(bridgeBody).toContain('cogmem memory show --event');
  expect(bridgeBody).toContain('Use it only as current-turn background memory.');
  expect(bridgeBody).toContain("intent: input.intent || 'memory_recall'");

  const indexCheck = await runCli(['node', '--check', join(pluginDir, 'index.js')]);
  expect(indexCheck.stderr).toBe('');
  expect(indexCheck.exitCode).toBe(0);
  const bridgeCheck = await runCli(['node', '--check', join(pluginDir, 'bridge.mjs')]);
  expect(bridgeCheck.stderr).toBe('');
  expect(bridgeCheck.exitCode).toBe(0);
});

test('doctor --fix can repair OpenClaw automatic memory wiring', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-doctor-openclaw-fix-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  const openclawConfigPath = join(dir, 'openclaw.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(openclawConfigPath, JSON.stringify({}, null, 2));

  const fixed = await runCli([
    'bun',
    doctorBin,
    '--config',
    configPath,
    '--fix',
    '--agent',
    'openclaw',
    '--workspace',
    dir,
    '--openclaw-config',
    openclawConfigPath,
  ]);

  expect(fixed.stderr).toBe('');
  expect(fixed.exitCode).toBe(0);
  expect(fixed.stdout).toContain('OK configuration parsed');
  expect(fixed.stdout).toContain('OK openclaw auto memory integration fixed');
  const openclawConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf8'));
  expect(openclawConfig.plugins.entries['cogmem-auto-memory'].enabled).toBe(true);
});

test('unified cogmem CLI dispatches doctor and update commands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-unified-cli-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

  const doctor = await runCli(['bun', cogmemBin, 'doctor', '--config', configPath]);
  expect(doctor.stderr).toBe('');
  expect(doctor.exitCode).toBe(0);
  expect(doctor.stdout).toContain('OK kernel ready');

  const update = await runCli(
    ['bun', cogmemBin, 'update', '--dry-run', '--json'],
    coreRoot,
    { COGMEM_RELEASE_TARBALL: 'github:liuqin164/cogmem#2.0.1' },
  );
  expect(update.stderr).toBe('');
  expect(update.exitCode).toBe(0);
  const parsed = JSON.parse(update.stdout);
  expect(parsed.command).toBe('update');
  expect(parsed.dryRun).toBe(true);
  expect(parsed.from).toBe('latest');
  expect(parsed.releaseRepo).toBe('liuqin164/cogmem');
  expect(parsed.releaseAsset).toBe('github:liuqin164/cogmem#2.0.1');
  expect(parsed.targetCwd).toBe(coreRoot);
  expect(parsed.nextCommand).toContain('cogmem@github:liuqin164/cogmem#2.0.1');
  expect(parsed.nextCommand).not.toContain('releases/latest/download/cogmem.tgz');
  expect(parsed.nextCommand).not.toContain('@CognitiveOS/core');
  expect(parsed.migrationCommand).toContain('cogmem migrate --yes --backup');
});

test('cogmem update targets the one-line installer home when cwd has no package dependency', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-update-home-'));
  const installHome = join(dir, 'pkg');
  const randomCwd = join(dir, 'work');
  mkdirSync(installHome, { recursive: true });
  mkdirSync(randomCwd, { recursive: true });
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
      COGMEM_INSTALL_HOME: installHome,
      COGMEM_RELEASE_TARBALL: 'github:liuqin164/cogmem#2.0.1',
    },
  );

  expect(update.stderr).toBe('');
  expect(update.exitCode).toBe(0);
  const parsed = JSON.parse(update.stdout);
  expect(parsed.targetCwd).toBe(installHome);
  expect(parsed.currentSpec).toContain('cogmem.tgz');
  expect(parsed.releaseAsset).toBe('github:liuqin164/cogmem#2.0.1');
  expect(parsed.nextCommand).toContain('cogmem@github:liuqin164/cogmem#2.0.1');
  expect(parsed.nextCommand).not.toContain('releases/latest/download/cogmem.tgz');
  expect(parsed.migrationCommand).toContain('cogmem migrate --yes --backup');
});

test('cogmem-connect installs Hermes skill into the real Hermes skills directory by default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-connect-hermes-home-'));
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  const skillPath = join(dir, '.hermes', 'skills', 'cogmem-memory', 'SKILL.md');
  const operationsPath = join(dir, '.hermes', 'skills', 'cogmem-memory', 'references', 'operations.md');

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
  expect(parsed.skillFiles).toEqual([skillPath, operationsPath]);
  expect(parsed.hostConfigSnippet).toContain('mcp_servers:');
  expect(parsed.hostConfigSnippet).toContain('cogmem-mcp');
  expect(parsed.hostConfigSnippet).toContain('cogmem_candidate_review');
  expect(parsed.hostConfigSnippet).toContain('cogmem_graph_touch');
  expect(existsSync(skillPath)).toBe(true);
  expect(existsSync(operationsPath)).toBe(true);
  expect(readFileSync(skillPath, 'utf8')).toStartWith('---\nname: cogmem-memory-backend');
  const operations = readFileSync(operationsPath, 'utf8');
  expect(operations).toContain('cogmem import-hermes');
  expect(operations).toContain('cogmem memory review');
  expect(operations).toContain('cogmem memory graph-timeline');
});

test('cogmem-connect hermes --auto patches Hermes MCP config without claiming native memory provider', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-connect-hermes-auto-'));
  const workspace = join(dir, 'workspace');
  const hermesConfig = join(dir, '.hermes', 'config.yaml');
  mkdirSync(workspace);
  mkdirSync(dirname(hermesConfig), { recursive: true });
  writeFileSync(hermesConfig, 'model:\n  provider: test\nmcp_servers: {}\n');

  const installed = await runCli([
    'bun',
    connectBin,
    'hermes',
    '--workspace',
    workspace,
    '--auto',
    '--hermes-config',
    hermesConfig,
    '--json',
  ], coreRoot, { HOME: dir });

  expect(installed.stderr).toBe('');
  expect(installed.exitCode).toBe(0);
  const parsed = JSON.parse(installed.stdout);
  expect(parsed.hermesMcp.configPath).toBe(hermesConfig);
  expect(parsed.hermesMcp.configUpdated).toBe(true);
  const config = readFileSync(hermesConfig, 'utf8');
  expect(config).toContain('mcp_servers:');
  expect(config).toContain('cogmem:');
  expect(config).toContain('cogmem-mcp');
  expect(config).toContain('cogmem_memory_map');
  expect(config).toContain('cogmem_maintenance_tick');
  expect(config).toContain('cogmem_prospective');
  expect(config).toContain('cogmem_strategy_plan');
  expect(config).not.toContain('memory:\n  provider: cogmem');
});

test('cogmem-connect hermes --auto updates existing Cogmem MCP tool allow-list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-connect-hermes-existing-'));
  const workspace = join(dir, 'workspace');
  const hermesConfig = join(dir, '.hermes', 'config.yaml');
  mkdirSync(workspace);
  mkdirSync(dirname(hermesConfig), { recursive: true });
  writeFileSync(hermesConfig, [
    'model:',
    '  provider: test',
    'mcp_servers:',
    '  cogmem:',
    '    command: "cogmem-mcp"',
    '    args: []',
    '    enabled: true',
    '    tools:',
    '      include:',
    '        - cogmem_remember_turn',
    '        - cogmem_recall',
    '        - cogmem_explain_recall',
    '',
  ].join('\n'));

  const installed = await runCli([
    'bun',
    connectBin,
    'hermes',
    '--workspace',
    workspace,
    '--auto',
    '--hermes-config',
    hermesConfig,
    '--json',
  ], coreRoot, { HOME: dir });

  expect(installed.stderr).toBe('');
  expect(installed.exitCode).toBe(0);
  const parsed = JSON.parse(installed.stdout);
  expect(parsed.hermesMcp.configUpdated).toBe(true);
  const config = readFileSync(hermesConfig, 'utf8');
  expect(config).toContain('cogmem_memory_map');
  expect(config).toContain('cogmem_maintenance_tick');
  expect(config).toContain('cogmem_prospective');
  expect(config).toContain('cogmem_strategy_plan');
  expect(config.match(/cogmem_recall/g)?.length).toBe(1);
});

test('package exposes agent migration bins', () => {
  const packageJson = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8'));

  expect(packageJson.bin['cogmem-explain-recall']).toBe('dist/bin/explain-recall.js');
  expect(packageJson.bin['cogmem-mcp']).toBe('dist/bin/mcp.js');
  expect(packageJson.bin['cogmem-import-openclaw']).toBe('dist/bin/import-openclaw.js');
  expect(packageJson.bin['cogmem-import-hermes']).toBe('dist/bin/import-hermes.js');
  expect(packageJson.bin['cogmem-connect']).toBe('dist/bin/connect.js');
  expect(packageJson.bin.cogmem).toBe('dist/bin/cogmem.js');
  expect(packageJson.bin['cogmem-update']).toBe('dist/bin/update.js');
  expect(packageJson.bin['cogmem-memory']).toBe('dist/bin/memory.js');
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
