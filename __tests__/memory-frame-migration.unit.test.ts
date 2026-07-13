import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { migration_0032, migration_0033, migration_0034 } from '../src/migrations/index.js';

test('3.7.4 frame and Atlas V2 migrations are idempotent', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE memory_atlas_projection_state (
    project_id TEXT NOT NULL, projection_name TEXT NOT NULL, cursor_value TEXT,
    status TEXT NOT NULL, last_rebuild_at INTEGER, last_error TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(project_id, projection_name)
  );`);
  migration_0032.up(db); migration_0033.up(db); migration_0034.up(db);
  migration_0032.up(db); migration_0033.up(db); migration_0034.up(db);
  expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_frames'`).get()).toBeTruthy();
  expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_atlas_supports'`).get()).toBeTruthy();
  const columns = db.prepare(`PRAGMA table_info(memory_atlas_projection_state)`).all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
    'projection_version', 'processor_prompt_version', 'frame_schema_version', 'source_fingerprint', 'last_backfill_cursor',
  ]));
  db.close();
});
