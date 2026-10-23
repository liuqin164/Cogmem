import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MIGRATION_DIGESTS } from '../src/migrations/MigrationDigestManifest.js';
import { SchemaMigrationRunner } from '../src/migrations/SchemaMigrationRunner.js';
import { migration_0032 } from '../src/migrations/0032_multidimensional_memory_graph_3_7_4.js';
import { KERNEL_MIGRATIONS } from '../src/migrations/index.js';

describe('schema migration runner', () => {
  test('dry run is read-only for a fresh database', () => {
    const db = new Database(':memory:');
    const runner = new SchemaMigrationRunner(db, [migration_0032], { readonly: true });

    expect(runner.plan().map((item) => item.version)).toEqual(['0032']);
    expect(runner.run({ dryRun: true }).applied).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'").get()).toBeNull();
    db.close();
  });

  test('rejects development receipts beyond the formal 0032 release boundary', () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE _schema_migrations(\n      version TEXT PRIMARY KEY,description TEXT NOT NULL,applied_at TEXT NOT NULL\n    )");
    db.prepare("INSERT INTO _schema_migrations VALUES(?,?,?)")
      .run('0062', 'unreleased development migration', new Date(0).toISOString());

    expect(() => new SchemaMigrationRunner(db, [], { readonly: true }).run({ dryRun: true }))
      .toThrow('unsupported_development_schema:0062');
    db.close();
  });

  test('formal migration manifest contains only release history and binds 0032 to immutable install sources', () => {
    const directory = join(import.meta.dir, '..', 'src', 'migrations');
    const releaseFiles = readdirSync(directory).filter((file) => /^\d{4}_.*\.ts$/u.test(file)).sort();
    expect(Object.keys(MIGRATION_DIGESTS).sort()).toEqual(releaseFiles.map((file) => file.slice(0, 4)));
    expect(releaseFiles).toEqual(['0032_multidimensional_memory_graph_3_7_4.ts']);

    // Verify 0032 digest matches source files
    const digest = createHash('sha256');
    const sources = [
      '0032_multidimensional_memory_graph_3_7_4.ts',
      '../binding/MemoryBindingIdentity.ts',
      '../binding/MemoryEdgeMerge.ts',
      '../engine/CognitiveGraphIdentity.ts',
      'v3_7_4/FinalSchemaDefinition.ts',
    ];
    for (const source of sources) {
      const content = readFileSync(join(directory, source), 'utf8').replace(/\r\n/g, '\n');
      digest.update(`${source}\0${Buffer.byteLength(content)}\0`).update(content);
    }
    expect(MIGRATION_DIGESTS['0032']).toBe(digest.digest('hex'));
  });
});

describe('concurrent startup', () => {
  test('a plan that went stale while waiting for the lock is re-read, not replayed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-mig-stale-'));
    const path = join(dir, 'memory.db');
    const other = new Database(path);
    // Another process finishes the migration first.
    expect(new SchemaMigrationRunner(other, KERNEL_MIGRATIONS, { backupVerified: true }).run().applied.length).toBeGreaterThan(0);

    const db = new Database(path);
    const runner = new SchemaMigrationRunner(db, KERNEL_MIGRATIONS, { backupVerified: true });
    const realPlan = runner.plan.bind(runner);
    let planCalls = 0;
    (runner as unknown as { plan: () => ReturnType<typeof realPlan> }).plan = () => {
      planCalls += 1;
      // The first read is what run() captured before the lock: it still shows
      // 0032 as pending. The second read happens inside the transaction.
      return planCalls === 1 ? KERNEL_MIGRATIONS : realPlan();
    };

    const result = runner.run();
    expect(planCalls).toBeGreaterThanOrEqual(2);
    expect(result.applied).toEqual([]);
    expect(result.currentVersion).toBe(KERNEL_MIGRATIONS[KERNEL_MIGRATIONS.length - 1].version);

    db.close();
    other.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('two connections to one file apply a migration exactly once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-mig-once-'));
    const path = join(dir, 'memory.db');
    const a = new Database(path);
    const b = new Database(path);

    const first = new SchemaMigrationRunner(a, KERNEL_MIGRATIONS, { backupVerified: true }).run();
    const second = new SchemaMigrationRunner(b, KERNEL_MIGRATIONS, { backupVerified: true }).run();

    expect(first.applied.length).toBeGreaterThan(0);
    expect(second.applied).toEqual([]);
    expect(second.currentVersion).toBe(KERNEL_MIGRATIONS[KERNEL_MIGRATIONS.length - 1].version);

    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
