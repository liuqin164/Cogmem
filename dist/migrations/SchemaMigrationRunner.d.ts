import Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';
export interface SchemaMigrationRunOptions {
    dryRun?: boolean;
}
export interface SchemaMigrationRunnerOptions {
    readonly?: boolean;
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
    run(options?: SchemaMigrationRunOptions): SchemaMigrationResult;
    private ensureMigrationTable;
    private migrationChecksum;
    private legacyStableChecksum;
    /**
     * Versions 0044/0045 were released before the build-independent manifest.
     * Accept only the exact function-text receipt produced by that release, and
     * convert it before strict checksum validation. Unknown receipts remain
     * fatal; this is deliberately narrower than a general checksum bypass.
     */
    private repairKnownLegacyFunctionChecksums;
    private backfillChecksums;
    private rewriteChecksums;
    private assertRecordedChecksums;
    currentVersion(): string | undefined;
    private appliedVersions;
    private schemaMigrationsTableExists;
    private legacySchemaVersion;
    private legacyCurrentVersion;
    private adoptLegacyVersion;
    private migrationSchemaSatisfied;
    private tableExists;
    private hasColumns;
}
//# sourceMappingURL=SchemaMigrationRunner.d.ts.map