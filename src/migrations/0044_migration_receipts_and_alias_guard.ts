import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0044: Migration = {
  version: '0044',
  description: 'track migration checksums and finalize alias availability guards',
  up(db: Database) {
    const columns = new Set((db.prepare(`PRAGMA table_info(_schema_migrations)`).all() as Array<{ name: string }>).map((row) => row.name));
    if (!columns.has('checksum')) db.exec(`ALTER TABLE _schema_migrations ADD COLUMN checksum TEXT`);
    db.exec(`
      UPDATE memory_atlas_aliases
      SET status='invalidated'
      WHERE source_frame_id IS NOT NULL AND status='active'
        AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active' AND f.status='active');
    `);
  },
  down() {},
};
