import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MIGRATION_DIGESTS } from '../src/migrations/MigrationDigestManifest.js';
import { SchemaMigrationRunner } from '../src/migrations/SchemaMigrationRunner.js';
import { migration_0015 } from '../src/migrations/0015_memory_governance.js';

describe('schema migration runner', () => {
  test('dry run is read-only for a fresh database', () => {
    const db = new Database(':memory:');
    const runner = new SchemaMigrationRunner(db, [migration_0015], { readonly: true });

    expect(runner.plan().map((item) => item.version)).toEqual(['0015']);
    expect(runner.run({ dryRun: true }).applied).toEqual([]);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'`).get()).toBeNull();
    db.close();
  });

  test('rejects development receipts beyond the formal 0032 release boundary', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations(
      version TEXT PRIMARY KEY,description TEXT NOT NULL,applied_at TEXT NOT NULL
    )`);
    db.prepare(`INSERT INTO _schema_migrations VALUES(?,?,?)`)
      .run('0062', 'unreleased development migration', new Date(0).toISOString());

    expect(() => new SchemaMigrationRunner(db, [], { readonly: true }).run({ dryRun: true }))
      .toThrow('unsupported_development_schema:0062');
    db.close();
  });

  test('formal migration manifest contains only release history and binds 0032 to immutable install sources', () => {
    const directory = join(import.meta.dir, '..', 'src', 'migrations');
    const releaseFiles = readdirSync(directory).filter((file) => /^\d{4}_.*\.ts$/u.test(file)).sort();
    expect(Object.keys(MIGRATION_DIGESTS).sort()).toEqual(releaseFiles.map((file) => file.slice(0, 4)));

    for (const file of releaseFiles.filter((file) => !file.startsWith('0032_'))) {
      const version = file.slice(0, 4);
      const digest = createHash('sha256')
        .update(readFileSync(join(directory, file), 'utf8').replace(/\r\n/g, '\n'))
        .digest('hex');
      expect(MIGRATION_DIGESTS[version]).toBe(digest);
    }

    const digest = createHash('sha256');
    const sources = [
      '0032_multidimensional_memory_graph_3_7_4.ts',
      '../binding/MemoryBindingIdentity.ts',
      'v3_7_4/FinalSchemaDefinition.ts',
    ];
    for (const source of sources) {
      const content = readFileSync(join(directory, source), 'utf8').replace(/\r\n/g, '\n');
      digest.update(`${source}\0${Buffer.byteLength(content)}\0`).update(content);
    }
    expect(MIGRATION_DIGESTS['0032']).toBe(digest.digest('hex'));
  });
});
