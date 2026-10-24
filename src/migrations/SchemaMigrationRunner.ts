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
    this.keepTemporaryDataInMemory();
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

  /**
   * Migration DDL spills to a SQLite temporary file — dropping the FTS5 virtual
   * table `memory_atlas_fts` in 0032 does — and SQLite picks its temp directory
   * from `SQLITE_TMPDIR`, then `TMPDIR`, and finally `/var/tmp`. Where that last
   * fallback is not writable, the spill fails and surfaces as the generic
   * `unable to open database file`, so creating a kernel against a brand-new
   * file path died inside `dropRebuildableProjections`. Keeping temporary data
   * in memory removes the temp file from the first-run path entirely, and it
   * cannot be fixed from JavaScript: SQLite resolves and caches the directory
   * before any user code can set the environment.
   */
  private keepTemporaryDataInMemory(): void {
    this.db.exec('PRAGMA temp_store = MEMORY');
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
      if (!digest) {
        // Receipts inherited from a pre-4.0 database (0015..0031). 4.0 no longer
        // ships those migrations, so their digests cannot be verified here; the
        // release-boundary check in assertSupportedReleaseSchema still rejects
        // anything newer than the baseline.
        if (Number(row.version) < Number(LATEST_RELEASE_VERSION)) continue;
        throw new Error(`migration_checksum_unknown:${row.version}`);
      }
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
    // A 3.7.3 release database records 0015..0031 and has 0032 pending: that is
    // the supported upgrade path into the 4.0 baseline. Accept it once the 0031
    // integrity marker proves that migration finished, so a half-applied 0031
    // cannot be laundered into a clean 0032.
    const latest = rows[rows.length - 1]?.version;
    if (latest === '0031' && this.releaseSchema31Satisfied()) {
      const legacyVersion = this.legacySchemaVersion();
      if (legacyVersion !== undefined && legacyVersion !== 31) {
        throw new Error(legacyVersion > 31
          ? `unsupported_development_schema:${String(legacyVersion).padStart(4, '0')}`
          : `unsupported_release_schema:${String(legacyVersion).padStart(4, '0')}`);
      }
      // A released database records every migration it applied. A hole means
      // receipts were deleted, so the schema cannot be trusted as the released
      // shape even though the latest receipt and marker look right.
      if (!this.hasContiguousReceipts(rows.map((row) => row.version))) {
        throw new Error('unsupported_release_schema:gap');
      }
      return;
    }
    throw new Error(latest ? `unsupported_release_schema:${latest}` : 'unsupported_database_identity');
  }

  /** True when the inherited receipt versions form one unbroken run. */
  private hasContiguousReceipts(versions: string[]): boolean {
    for (let index = 1; index < versions.length; index += 1) {
      if (Number(versions[index]) !== Number(versions[index - 1]) + 1) return false;
    }
    return true;
  }

  private releaseSchema31Satisfied(): boolean {
    if (!this.tableExists('_episode_integrity_markers')) return false;
    return Boolean(this.db.prepare(`
      SELECT 1 FROM _episode_integrity_markers WHERE marker = 'episode_boundary_integrity_0031'
    `).get());
  }

  /** `_meta.schema_version` from pre-4.0 kernels. A hint only, never a receipt. */
  private legacySchemaVersion(): number | undefined {
    if (!this.tableExists('_meta')) return undefined;
    const row = this.db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as { value?: string } | null;
    const legacyVersion = Number.parseInt(row?.value || '', 10);
    return Number.isFinite(legacyVersion) ? legacyVersion : undefined;
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
