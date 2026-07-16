import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { SchemaMigrationRunner } from '../src/migrations/SchemaMigrationRunner.js';
import { migration_0015 } from '../src/migrations/0015_memory_governance.js';
import { MIGRATION_DIGESTS } from '../src/migrations/MigrationDigestManifest.js';

describe('schema migration runner', () => {
  test('plans pending migrations without mutating during dry run', () => {
    const db = new Database(':memory:');
    const runner = new SchemaMigrationRunner(db, [migration_0015], { readonly: true });

    expect(runner.plan().map((item) => item.version)).toEqual(['0015']);
    expect(runner.run({ dryRun: true }).applied).toEqual([]);
    expect(runner.plan().map((item) => item.version)).toEqual(['0015']);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'`).get()).toBeNull();
    db.close();
  });

  test('readonly planning adopts legacy meta version without writing migration rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta (key, value) VALUES ('schema_version', '15');
    `);
    const runner = new SchemaMigrationRunner(db, [migration_0015], { readonly: true });

    expect(runner.plan()).toEqual([]);
    expect(runner.currentVersion()).toBe('0015');
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'`).get()).toBeNull();
    db.close();
  });

  test('applies migrations transactionally and remains idempotent', () => {
    const db = new Database(':memory:');
    const runner = new SchemaMigrationRunner(db, [migration_0015]);

    expect(runner.run().applied).toEqual(['0015']);
    expect(runner.run().applied).toEqual([]);
    expect(runner.currentVersion()).toBe('0015');
    const columns = db.prepare('PRAGMA table_info(memory_governance_operations)').all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'idempotency_key')).toBe(true);
    db.close();
  });

  test('accepts globally known receipts when this runner executes a kernel subset', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`).run('0001', 'initial schema', new Date(0).toISOString(), MIGRATION_DIGESTS['0001']);
    const runner = new SchemaMigrationRunner(db, [migration_0015], { readonly: true });
    expect(() => runner.run({ dryRun: true })).not.toThrow();
    db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`).run('9999', 'unknown', new Date(0).toISOString(), 'not-a-digest');
    expect(() => runner.run({ dryRun: true })).toThrow('migration_checksum_unknown:9999');
    db.close();
  });
});
