import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0035: Migration = {
  version: '0035',
  description: 'persist complete memory frame fields and publication intent',
  up(db: Database) {
    for (const [name, declaration] of [
      ['primary_language', 'TEXT'],
      ['temporal_references_json', "TEXT NOT NULL DEFAULT '[]'"],
      ['state_transitions_json', "TEXT NOT NULL DEFAULT '[]'"],
      ['publish_status', "TEXT NOT NULL DEFAULT 'active' CHECK(publish_status IN ('active','needs_confirmation'))"],
    ] as const) {
      const columns = db.prepare('PRAGMA table_info(memory_frames)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE memory_frames ADD COLUMN ${name} ${declaration}`);
    }
  },
  down() {},
};
