import Database from 'bun:sqlite';

import type { Migration } from '../types/Migration.js';
import { MIGRATION_DIGESTS } from './MigrationDigestManifest.js';
import { multidimensionalMemoryGraph374Issue, multidimensionalMemoryGraph374Satisfied } from './0032_multidimensional_memory_graph_3_7_4.js';
import { installAtlasProjectionDirtyTriggersV3 } from './v3_7_4/FinalRuntimeGuards.js';

export interface SchemaMigrationRunOptions {
  dryRun?: boolean;
}

export interface SchemaMigrationRunnerOptions {
  readonly?: boolean;
  backupVerified?: boolean;
}

export interface SchemaMigrationResult {
  pending: string[];
  applied: string[];
  currentVersion?: string;
  dryRun: boolean;
}

/** Latest release schema version. Update when adding a new migration. */
const LATEST_RELEASE_VERSION = '0032';

export class SchemaMigrationRunner {
  constructor(
    private readonly db: Database,
    private readonly migrations: Migration[],
    private readonly options: SchemaMigrationRunnerOptions = {},
  ) {
    // Construction is read-only. Schema bookkeeping is created only when a
    // non-dry run is explicitly requested.
  }

  plan(): Migration[] {
    const applied = this.appliedVersions();
    return [...this.migrations]
      .sort((a, b) => a.version.localeCompare(b.version))
      .filter((migration) => !applied.has(migration.version)
        || (migration.version !== LATEST_RELEASE_VERSION && !this.migrationSchemaSatisfied(migration.version)));
  }

  preflight(): void {
    this.assertSupportedReleaseSchema();
  }

  run(options: SchemaMigrationRunOptions = {}): SchemaMigrationResult {
    this.assertSupportedReleaseSchema();
    if (options.dryRun || this.options.readonly) {
      this.assertRecordedChecksums();
      const pending = this.plan();
      return { pending: pending.map((item) => item.version), applied: [], currentVersion: this.currentVersion(), dryRun: true };
    }
    this.ensureMigrationTable();
    this.assertRecordedChecksums();
    this.repairRecordedRuntimeGuards();
    const pending = this.plan();
    const filename = (this.db as Database & { filename?: string }).filename;
    if (filename && filename !== ':memory:' && pending.some((migration) => migration.requiresBackup) && !this.options.backupVerified) {
      throw new Error('migration_backup_required');
    }
    const applied: string[] = [];
    const transaction = this.db.transaction(() => {
      // Re-plan under the write lock. Between plan() and this point another
      // process may have applied the same migrations, and re-running their DDL
      // threw mid-transaction: a second host starting against a fresh database
      // died instead of finding the schema already current.
      const remaining = this.plan();
      const recorded = new Set((this.db.prepare(`SELECT version FROM _schema_migrations`).all() as Array<{ version: string }>).map((row) => row.version));
      for (const migration of remaining) {
        migration.up(this.db);
        if (!this.migrationSchemaSatisfied(migration.version)) throw new Error(`migration_postcondition_failed:${migration.version}`);
        const appliedAt = new Date().toISOString();
        const checksum = this.migrationChecksum(migration);
        const hasChecksum = Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info('_schema_migrations') WHERE name='checksum'`).get());
        if (recorded.has(migration.version)) {
          if (hasChecksum) this.db.prepare(`UPDATE _schema_migrations SET description=?, applied_at=?, checksum=? WHERE version=?`).run(migration.description, appliedAt, checksum, migration.version);
          else this.db.prepare(`UPDATE _schema_migrations SET description=?, applied_at=? WHERE version=?`).run(migration.description, appliedAt, migration.version);
        } else if (hasChecksum) {
          this.db.prepare(`INSERT INTO _schema_migrations (version, description, applied_at, checksum) VALUES (?, ?, ?, ?)`).run(migration.version, migration.description, appliedAt, checksum);
          recorded.add(migration.version);
        } else {
          this.db.prepare(`INSERT INTO _schema_migrations (version, description, applied_at) VALUES (?, ?, ?)`).run(migration.version, migration.description, appliedAt);
          recorded.add(migration.version);
        }
        if (hasChecksum) {
          this.backfillChecksums();
        }
        if (!this.migrationSchemaSatisfied(migration.version)) throw new Error(`migration_postcondition_failed:${migration.version}`);
        applied.push(migration.version);
      }
    });
    // IMMEDIATE takes the write lock up front instead of upgrading a deferred
    // read transaction, so concurrent starters queue on busy_timeout rather
    // than failing halfway through the migration body.
    transaction.immediate();
    return { pending: pending.map((item) => item.version), applied, currentVersion: this.currentVersion(), dryRun: false };
  }

  private ensureMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  private migrationChecksum(migration: Migration): string {
    const digest = MIGRATION_DIGESTS[migration.version] ?? migration.checksum;
    if (!digest) throw new Error(`migration_digest_missing:${migration.version}`);
    return digest;
  }

  private backfillChecksums(): void {
    const update = this.db.prepare(`UPDATE _schema_migrations SET checksum=? WHERE version=? AND (checksum IS NULL OR checksum='')`);
    for (const [version, checksum] of Object.entries(MIGRATION_DIGESTS)) update.run(checksum, version);
  }

  private assertRecordedChecksums(): void {
    if (!Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info('_schema_migrations') WHERE name='checksum'`).get())) return;
    const rows = this.recordedChecksums();
    for (const row of rows) {
      const digest = MIGRATION_DIGESTS[row.version];
      if (!digest) throw new Error(`migration_checksum_unknown:${row.version}`);
      if (!row.checksum) throw new Error(`migration_checksum_missing:${row.version}`);
      if (row.checksum !== digest) throw new Error(`migration_checksum_mismatch:${row.version}`);
    }
  }

  private recordedChecksums(): Array<{ version: string; description: string; checksum: string | null }> {
    return this.db.prepare(`SELECT version, description, checksum FROM _schema_migrations ORDER BY version`).all() as Array<{ version: string; description: string; checksum: string | null }>;
  }

  private assertSupportedReleaseSchema(): void {
    const userTables = (this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as Array<{ name: string }>).map((row) => row.name);
    if (userTables.length === 0 || userTables.includes('_cogmem_bootstrap_state')) return;

    if (!this.schemaMigrationsTableExists()) {
      throw new Error('unsupported_database_identity');
    }
    const rows = this.db.prepare(`SELECT version FROM _schema_migrations ORDER BY version`).all() as Array<{ version: string }>;
    const unsupported = rows.find((row) => row.version > LATEST_RELEASE_VERSION);
    if (unsupported) throw new Error(`unsupported_development_schema:${unsupported.version}`);
    const releaseLatest = rows.some((row) => row.version === LATEST_RELEASE_VERSION);
    if (releaseLatest) {
      if (!this.hasColumns('_schema_migrations', ['checksum'])) throw new Error('unsupported_development_schema:0032');
      const row = this.db.prepare(`SELECT checksum FROM _schema_migrations WHERE version=?`).get(LATEST_RELEASE_VERSION) as { checksum?: string } | null;
      if (row?.checksum !== MIGRATION_DIGESTS[LATEST_RELEASE_VERSION]) throw new Error('unsupported_development_schema:0032');
      const issue = multidimensionalMemoryGraph374Issue(this.db);
      if (!issue) return;
      if (issue.startsWith('trigger_definition:trg_memory_atlas_dirty_')
        || issue.startsWith('trigger_missing:trg_memory_atlas_dirty_')) return;
      throw new Error(`final_schema_postcondition_failed:0032:${issue}`);
    }
    throw new Error('unsupported_database_identity');
  }

  currentVersion(): string | undefined {
    if (!this.schemaMigrationsTableExists()) {
      return undefined;
    }
    const row = this.db.prepare(`
      SELECT version FROM _schema_migrations ORDER BY version DESC LIMIT 1
    `).get() as { version?: string } | null;
    return row?.version;
  }

  private appliedVersions(): Set<string> {
    const applied = new Set<string>();
    if (!this.schemaMigrationsTableExists()) {
      return applied;
    }
    for (const row of this.db.prepare(`SELECT version FROM _schema_migrations`).all() as Array<{ version: string }>) {
      if (row.version === LATEST_RELEASE_VERSION || this.migrationSchemaSatisfied(row.version)) applied.add(row.version);
    }
    return applied;
  }

  private schemaMigrationsTableExists(): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_schema_migrations'
    `).get());
  }

  private repairRecordedRuntimeGuards(): void {
    if (!this.schemaMigrationsTableExists()) return;
    const recorded = this.db.prepare(`SELECT 1 FROM _schema_migrations WHERE version=?`).get(LATEST_RELEASE_VERSION);
    if (!recorded) return;
    const issue = multidimensionalMemoryGraph374Issue(this.db);
    if (issue?.startsWith('trigger_definition:trg_memory_atlas_dirty_')
      || issue?.startsWith('trigger_missing:trg_memory_atlas_dirty_')) {
      installAtlasProjectionDirtyTriggersV3(this.db);
    }
  }

  private migrationSchemaSatisfied(version: string): boolean {
    if (version === LATEST_RELEASE_VERSION) {
      return multidimensionalMemoryGraph374Satisfied(this.db);
    }
    return true;
  }

  private tableExists(name: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
  }

  private hasColumns(table: string, names: string[]): boolean {
    if (!this.tableExists(table)) return false;
    const columns = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
    return names.every((name) => columns.has(name));
  }
}
