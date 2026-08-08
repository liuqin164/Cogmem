import type Database from 'bun:sqlite';
import { renameSync, rmSync } from 'node:fs';

export function backupDatabase(db: Database, dbPath: string, suffix = 'pre-migrate'): string | undefined {
  if (dbPath === ':memory:') return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.${suffix}-${stamp}.bak`;
  snapshotDatabase(db, backupPath);
  return backupPath;
}

export function snapshotDatabase(db: Database, backupPath: string): void {
  const temporaryPath = `${backupPath}.tmp`;
  try {
    db.prepare('VACUUM INTO ?').run(temporaryPath);
    renameSync(temporaryPath, backupPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
