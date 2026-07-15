import type Database from 'bun:sqlite';

export interface Migration {
  version: string;
  description: string;
  up(db: Database): void;
  down(db: Database): void;
  checksum?: string;
}

export interface MigrationRecord {
  version: string;
  appliedAt: string;
  description: string;
  checksum?: string;
}

export interface BackupRecord {
  backupId: string;
  label?: string;
  createdAt: string;
  schemaVersion: string;
  dbPath: string;
  backupPath: string;
  configPath?: string;
}
