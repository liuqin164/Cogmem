import Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';
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
export declare class SchemaMigrationRunner {
    private readonly db;
    private readonly migrations;
    private readonly options;
    constructor(db: Database, migrations: Migration[], options?: SchemaMigrationRunnerOptions);
    plan(): Migration[];
    preflight(): void;
    run(options?: SchemaMigrationRunOptions): SchemaMigrationResult;
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
    private keepTemporaryDataInMemory;
    private ensureMigrationTable;
    private migrationChecksum;
    private backfillChecksums;
    private assertRecordedChecksums;
    private recordedChecksums;
    private assertSupportedReleaseSchema;
    /** True when the inherited receipt versions form one unbroken run. */
    private hasContiguousReceipts;
    private releaseSchema31Satisfied;
    /** `_meta.schema_version` from pre-4.0 kernels. A hint only, never a receipt. */
    private legacySchemaVersion;
    currentVersion(): string | undefined;
    private appliedVersions;
    private schemaMigrationsTableExists;
    private repairRecordedRuntimeGuards;
    private migrationSchemaSatisfied;
    private tableExists;
    private hasColumns;
}
//# sourceMappingURL=SchemaMigrationRunner.d.ts.map