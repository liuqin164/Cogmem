import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { createMemoryKernel } from '../src/factory.js';
import { migration_0061, runtimeScopeAndProjectionIntegritySatisfied } from '../src/migrations/0061_runtime_scope_and_projection_integrity.js';

const migrateBin = join(import.meta.dir, '..', 'src', 'bin', 'migrate.ts');

async function migrate(dbPath: string, args: string[]): Promise<Record<string, unknown>> {
  const proc = Bun.spawn({
    cmd: ['bun', migrateBin, '--db', dbPath, ...args, '--json'],
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

test('one command upgrades a 3.5.2 database through schema 61 without changing source memory', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-atlas-migrate-')), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  const event = kernel.eventStore.append({
    eventId: 'evt-hermes-2025',
    streamId: 'thread-hermes',
    streamType: 'thread',
    eventType: 'MESSAGE',
    rawEventType: 'message',
    projectId: 'cogmem',
    sessionId: 'session-hermes',
    role: 'user',
    occurredAt: Date.UTC(2025, 5, 1),
    payload: { text: '请给 Hermes 配置 MCP 并连接 Cogmem。' },
  });
  const entity = kernel.memoryBindingStore.upsertEntity({
    projectId: 'cogmem',
    canonicalName: 'Hermes',
    entityType: 'project',
    now: event.occurredAt,
  });
  kernel.memoryBindingStore.upsertTopic({
    projectId: 'cogmem',
    topicPath: 'cogmem/hermes',
    topicType: 'project',
    summary: 'Hermes integration work',
    now: event.occurredAt,
  });
  kernel.memoryBindingStore.insertBinding({
    eventId: event.eventId,
    projectId: 'cogmem',
    role: 'user',
    rawEventType: 'message',
    entityId: entity.entityId,
    entityName: 'Hermes',
    entityType: 'project',
    topicPath: 'cogmem/hermes',
    bindingType: 'about',
    confidence: 0.95,
    source: 'deterministic',
    signal: 'Hermes',
    claimKey: 'hermes-mcp-setup',
    createdAt: event.occurredAt,
  });
  kernel.close();

  const fixture = new Database(dbPath);
  fixture.exec(`
    DROP TABLE IF EXISTS memory_atlas_projection_state;
    DROP TABLE IF EXISTS memory_atlas_activation;
    DROP TABLE IF EXISTS memory_atlas_access;
    DROP TABLE IF EXISTS memory_action_frame_evidence;
    DROP TABLE IF EXISTS memory_action_frames;
    DROP TABLE IF EXISTS memory_atlas_fts;
    DROP TABLE IF EXISTS memory_atlas_documents;
    DROP TABLE IF EXISTS topology_projection_state;
    DROP TABLE IF EXISTS deep_write_candidate_reviews;
    DELETE FROM _schema_migrations WHERE version IN ('0025','0026','0027','0028','0029','0030','0031','0032','0033','0034','0035','0036','0037','0038','0039','0040','0041','0042','0043','0044','0045','0046','0047','0048','0049','0050','0051','0052','0053','0054','0055','0056','0057','0058','0059','0060','0061');
    DROP TABLE IF EXISTS _memory_frame_integrity_markers;
    DELETE FROM _episode_integrity_markers WHERE marker = 'episode_boundary_integrity_0031';
    UPDATE _meta SET value = '24' WHERE key = 'schema_version';
  `);
  fixture.close();

  const before = new Database(dbPath, { readonly: true });
  const beforeEvents = (before.prepare('SELECT COUNT(*) AS count FROM memory_events').get() as { count: number }).count;
  const beforeBindings = (before.prepare('SELECT COUNT(*) AS count FROM memory_bindings').get() as { count: number }).count;
  before.close();

  const dryRun = await migrate(dbPath, ['--dry-run']);
  expect(dryRun.pending).toEqual(['0025', '0026', '0027', '0028', '0029', '0030', '0031', '0032', '0033', '0034', '0035', '0036', '0037', '0038', '0039', '0040', '0041', '0042', '0043', '0044', '0045', '0046', '0047', '0048', '0049', '0050', '0051', '0052', '0053', '0054', '0055', '0056', '0057', '0058', '0059', '0060', '0061']);

  const result = await migrate(dbPath, ['--yes', '--backup']);
  expect(result.applied).toEqual(['0025', '0026', '0027', '0028', '0029', '0030', '0031', '0032', '0033', '0034', '0035', '0036', '0037', '0038', '0039', '0040', '0041', '0042', '0043', '0044', '0045', '0046', '0047', '0048', '0049', '0050', '0051', '0052', '0053', '0054', '0055', '0056', '0057', '0058', '0059', '0060', '0061']);
  expect(existsSync(result.backupPath as string)).toBe(true);

  const upgraded = new Database(dbPath, { readonly: true });
  expect(upgraded.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get()).toEqual({ value: '61' });
  expect((upgraded.prepare('SELECT COUNT(*) AS count FROM memory_events').get() as { count: number }).count).toBe(beforeEvents);
  expect((upgraded.prepare('SELECT COUNT(*) AS count FROM memory_bindings').get() as { count: number }).count).toBe(beforeBindings);
  expect(upgraded.prepare(`SELECT node_id, project_id, node_type FROM memory_atlas_documents WHERE node_id = ?`).get(`entity:${entity.entityId}`)).toEqual({
    node_id: `entity:${entity.entityId}`,
    project_id: 'cogmem',
    node_type: 'entity',
  });
  expect(upgraded.prepare(`SELECT status FROM memory_atlas_projection_state WHERE project_id='cogmem' AND projection_name='memory_atlas.v1'`).get()).toEqual({
    status: 'dirty',
  });
  const eventColumns = upgraded.prepare('PRAGMA table_info(memory_events)').all() as Array<{ name: string }>;
  expect(eventColumns.map((column) => column.name)).toContain('local_date_source');
  upgraded.close();

  const repeated = await migrate(dbPath, ['--yes']);
  expect(repeated.applied).toEqual([]);
});

test('real 3.5.2 tag database upgrades before EventStore construction through CLI and Kernel paths', async () => {
  const fixture = gunzipSync(readFileSync(join(import.meta.dir, 'fixtures', 'migrations', '3.5.2-real.sqlite.gz')));

  const kernelDir = mkdtempSync(join(tmpdir(), 'cogmem-real-352-kernel-'));
  const kernelPath = join(kernelDir, 'memory.db');
  writeFileSync(kernelPath, fixture);
  const kernel = createMemoryKernel({ dbPath: kernelPath, projectTimeZone: 'Asia/Tokyo' });
  expect(kernel.eventStore.getEvent('legacy-event')?.projectId).toBe('legacy-project');
  kernel.close();
  expect(readdirSync(kernelDir).some((name) => name.includes('.pre-migrate-') && name.endsWith('.bak'))).toBe(true);
  const kernelDb = new Database(kernelPath, { readonly: true });
  expect(kernelDb.prepare(`SELECT MAX(version) AS version FROM _schema_migrations`).get()).toEqual({ version: '0061' });
  expect((kernelDb.prepare(`PRAGMA table_info(memory_events)`).all() as Array<{ name: string }>)
    .some((column) => column.name === 'project_scope')).toBe(true);
  expect(kernelDb.prepare(`SELECT legacy_status,reason FROM policy_execution_legacy_tombstones
    WHERE legacy_execution_id='legacy-policy'`).get()).toEqual({
    legacy_status: 'executed', reason: 'legacy_execution_scope_ambiguous',
  });
  kernelDb.close();

  const cliDir = mkdtempSync(join(tmpdir(), 'cogmem-real-352-cli-'));
  const cliPath = join(cliDir, 'memory.db');
  writeFileSync(cliPath, fixture);
  const dryRun = await migrate(cliPath, ['--dry-run']);
  expect(dryRun.pending).toContain('0059');
  const applied = await migrate(cliPath, ['--yes']);
  expect(applied.applied).toContain('0059');
  expect(existsSync(applied.backupPath as string)).toBe(true);
  const cliDb = new Database(cliPath, { readonly: true });
  expect(cliDb.prepare(`SELECT MAX(version) AS version FROM _schema_migrations`).get()).toEqual({ version: '0061' });
  cliDb.close();
});

test('0061 quarantines unscoped runtime rows and rebuilds canonical projection identities', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE runtime_states(
      runtime_id TEXT,entity_type TEXT,entity_key TEXT,status TEXT,metadata_json TEXT,updated_at INTEGER
    );
    INSERT INTO runtime_states VALUES('legacy','step','one','ready','{"secret":"not-copied"}',1);
    CREATE TABLE policy_execution_read_model(
      execution_id TEXT,project_scope TEXT,idempotency_key TEXT,policy TEXT,action TEXT,status TEXT,
      attempt_count INTEGER,created_at INTEGER,updated_at INTEGER,source_global_seq INTEGER
    );
  `);

  migration_0061.up(db);

  expect(runtimeScopeAndProjectionIntegritySatisfied(db)).toBe(true);
  expect(db.prepare(`SELECT source_table,reason FROM runtime_scope_quarantine`).all()).toContainEqual({
    source_table: 'runtime_states',
    reason: 'legacy_runtime_scope_unproven',
  });
  expect(db.prepare(`SELECT COUNT(*) AS count FROM runtime_states`).get()).toEqual({ count: 0 });
  expect(db.prepare(`PRAGMA integrity_check`).get()).toEqual({ integrity_check: 'ok' });
  expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  db.close();
});
