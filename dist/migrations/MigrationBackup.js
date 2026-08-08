import { renameSync, rmSync } from 'node:fs';
export function backupDatabase(db, dbPath, suffix = 'pre-migrate') {
    if (dbPath === ':memory:')
        return undefined;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbPath}.${suffix}-${stamp}.bak`;
    snapshotDatabase(db, backupPath);
    return backupPath;
}
export function snapshotDatabase(db, backupPath) {
    const temporaryPath = `${backupPath}.tmp`;
    try {
        db.prepare('VACUUM INTO ?').run(temporaryPath);
        renameSync(temporaryPath, backupPath);
    }
    finally {
        rmSync(temporaryPath, { force: true });
    }
}
