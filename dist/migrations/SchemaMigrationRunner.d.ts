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