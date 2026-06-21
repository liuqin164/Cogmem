import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';

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

test('one command upgrades a 3.5.2 database to schema 25 without changing source memory', async () => {
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
    DELETE FROM _schema_migrations WHERE version = '0025';
    UPDATE _meta SET value = '24' WHERE key = 'schema_version';
  `);
  fixture.close();

  const before = new Database(dbPath, { readonly: true });
  const beforeEvents = (before.prepare('SELECT COUNT(*) AS count FROM memory_events').get() as { count: number }).count;
  const beforeBindings = (before.prepare('SELECT COUNT(*) AS count FROM memory_bindings').get() as { count: number }).count;
  before.close();

  const dryRun = await migrate(dbPath, ['--dry-run']);
  expect(dryRun.pending).toEqual(['0025']);

  const result = await migrate(dbPath, ['--yes', '--backup']);
  expect(result.applied).toEqual(['0025']);
  expect(existsSync(result.backupPath as string)).toBe(true);

  const upgraded = new Database(dbPath, { readonly: true });
  expect(upgraded.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get()).toEqual({ value: '25' });
  expect((upgraded.prepare('SELECT COUNT(*) AS count FROM memory_events').get() as { count: number }).count).toBe(beforeEvents);
  expect((upgraded.prepare('SELECT COUNT(*) AS count FROM memory_bindings').get() as { count: number }).count).toBe(beforeBindings);
  expect(upgraded.prepare(`SELECT node_id, project_id, node_type FROM memory_atlas_documents WHERE node_id = ?`).get(`entity:${entity.entityId}`)).toEqual({
    node_id: `entity:${entity.entityId}`,
    project_id: 'cogmem',
    node_type: 'entity',
  });
  upgraded.close();

  const repeated = await migrate(dbPath, ['--yes']);
  expect(repeated.applied).toEqual([]);
});
