import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const migrateBin = join(import.meta.dir, '..', 'src', 'bin', 'migrate.ts');
const distMigrateBin = join(import.meta.dir, '..', 'dist', 'bin', 'migrate.js');
const fixturePath = join(import.meta.dir, 'fixtures', 'migrations', 'main-3.7.3-schema31.sqlite.gz');

async function run(args: string[], bin = migrateBin): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ['bun', bin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function materializeFixture(directory: string): string {
  const dbPath = join(directory, 'memory.db');
  writeFileSync(dbPath, gunzipSync(readFileSync(fixturePath)));
  return dbPath;
}

test('development migration receipts fail before creating a misleading backup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-development-preflight-'));
  const dbPath = materializeFixture(directory);
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO _schema_migrations(version,description,applied_at) VALUES(?,?,?)`)
    .run('0059', 'unreleased development migration', new Date(0).toISOString());
  db.close();

  const result = await run(['--db', dbPath, '--yes', '--backup', '--json']);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('unsupported_development_schema:0059');
  expect(readdirSync(directory).filter((name) => name.includes('pre-migrate') || name.endsWith('.bak'))).toEqual([]);
  rmSync(directory, { recursive: true, force: true });
});

test('migrate dry-run exercises and then upgrades real main schema 31 with one mandatory backup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-main-migrate-'));
  const dbPath = materializeFixture(directory);

  const dryRun = await run(['--db', dbPath, '--dry-run', '--json']);
  expect({ exitCode: dryRun.exitCode, stderr: dryRun.stderr }).toEqual({ exitCode: 0, stderr: '' });
  const dryResult = JSON.parse(dryRun.stdout);
  expect(dryResult.pending).toEqual(['0032']);
  for (const field of [
    'runtimeStatesDiscardedThisRun', 'runtimeTransitionsDiscardedThisRun', 'runtimeOutboxDiscardedThisRun',
    'policyExecutionsQuarantinedThisRun', 'entityAliasesQuarantinedThisRun',
    'entityRelationsQuarantinedThisRun', 'pendingEntityResolutionsQuarantinedThisRun',
    'malformedEdgeEvidenceDiscardedThisRun',
  ]) expect(dryResult[field]).toBeNumber();
  const unchanged = new Database(dbPath);
  expect(unchanged.prepare(`SELECT MAX(version) AS version FROM _schema_migrations`).get()).toEqual({ version: '0031' });
  unchanged.close();

  const applied = await run(['--db', dbPath, '--yes', '--json']);
  expect({ exitCode: applied.exitCode, stderr: applied.stderr }).toEqual({ exitCode: 0, stderr: '' });
  const result = JSON.parse(applied.stdout);
  expect(result.applied).toEqual(['0032']);
  expect(existsSync(result.backupPath)).toBe(true);

  const migrated = new Database(dbPath);
  expect(migrated.prepare(`SELECT MAX(version) AS version FROM _schema_migrations`).get()).toEqual({ version: '0032' });
  expect(migrated.prepare(`SELECT value FROM _meta WHERE key='schema_version'`).get()).toEqual({ value: '32' });
  expect(migrated.prepare(`PRAGMA integrity_check`).get()).toEqual({ integrity_check: 'ok' });
  expect(migrated.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  migrated.close();

  const repeated = await run(['--db', dbPath, '--yes', '--json']);
  expect(JSON.parse(repeated.stdout).applied).toEqual([]);
  rmSync(directory, { recursive: true, force: true });
});

test('real schema31 upgrades through both source and built migration artifacts', async () => {
  for (const target of [migrateBin, distMigrateBin]) {
    const directory = mkdtempSync(join(tmpdir(), 'cogmem-artifact-migrate-'));
    const dbPath = materializeFixture(directory);
    const applied = await run(['--db', dbPath, '--yes', '--json'], target);
    expect({ target: target === migrateBin ? 'source' : 'dist', stderr: applied.stderr, exitCode: applied.exitCode })
      .toMatchObject({ exitCode: 0, stderr: '' });
    expect(JSON.parse(applied.stdout).applied).toEqual(['0032']);
    const migrated = new Database(dbPath);
    expect(migrated.prepare(`PRAGMA integrity_check`).get()).toEqual({ integrity_check: 'ok' });
    expect(migrated.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
