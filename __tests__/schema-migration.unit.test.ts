import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { SchemaMigrationRunner } from '../src/migrations/SchemaMigrationRunner.js';
import { migration_0015 } from '../src/migrations/0015_memory_governance.js';

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
});
