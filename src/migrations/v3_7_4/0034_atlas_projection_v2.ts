import type Database from 'bun:sqlite';
// Internal atomic 3.7.4 installation step; never receives its own migration receipt.
import type { Migration } from '../../types/Migration.js';

export const migration_0034: Migration = {
  version: '0034',
  description: 'Atlas V2 projection provenance metadata',
  up(db: Database) {
    const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_atlas_projection_state'`).get();
    if (!exists) throw new Error('migration_0034_requires_memory_atlas_projection_state');
    addColumn(db, 'memory_atlas_projection_state', 'projection_version', `TEXT NOT NULL DEFAULT 'v1'`);
    addColumn(db, 'memory_atlas_projection_state', 'processor_prompt_version', `TEXT`);
    addColumn(db, 'memory_atlas_projection_state', 'frame_schema_version', `TEXT`);
    addColumn(db, 'memory_atlas_projection_state', 'source_fingerprint', `TEXT`);
    addColumn(db, 'memory_atlas_projection_state', 'last_backfill_cursor', `TEXT`);
  },
  down() {},
};

function addColumn(db: Database, table: string, column: string, declaration: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
