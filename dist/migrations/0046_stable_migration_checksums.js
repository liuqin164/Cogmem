export const migration_0046 = {
    version: '0046',
    description: 'normalize migration receipts to source and dist stable checksums',
    up(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS _memory_frame_integrity_markers (
        marker TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      INSERT OR REPLACE INTO _memory_frame_integrity_markers(marker, created_at)
        VALUES ('memory_frame_integrity_0046', CAST(strftime('%s','now') AS INTEGER) * 1000);
    `);
    },
    down() { },
};
