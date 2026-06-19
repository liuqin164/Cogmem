import Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';
export interface SchemaMigrationRunOptions {
    dryRun?: boolean;
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
    constructor(db: Database, migrations: Migration[]);
    plan(): Migration[];
    run(options?: SchemaMigrationRunOptions): SchemaMigrationResult;
    currentVersion(): string | undefined;
    private adoptLegacyVersion;
}
//# sourceMappingURL=SchemaMigrationRunner.d.ts.map