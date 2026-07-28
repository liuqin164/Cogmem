import type Database from 'bun:sqlite';
export declare function backupDatabase(db: Database, dbPath: string, suffix?: string): string | undefined;
export declare function snapshotDatabase(db: Database, backupPath: string): void;
//# sourceMappingURL=MigrationBackup.d.ts.map