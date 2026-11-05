import type Database from 'bun:sqlite';

export interface Migration {
  version: string;
  description: string;
  requiresBackup?: boolean;
  up(db: Database): void;
  down(db: Database): void;
  checksum?: string;
}
