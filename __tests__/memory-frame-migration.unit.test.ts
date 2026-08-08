import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { installMultidimensionalMemoryGraph374 } from '../src/migrations/0032_multidimensional_memory_graph_3_7_4.js';

test('the final 3.7.4 frame and Atlas schema installer is idempotent', () => {
  const db = new Database(':memory:');
  installMultidimensionalMemoryGraph374(db);
  installMultidimensionalMemoryGraph374(db);
  expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_frames'`).get()).toBeTruthy();
  expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_atlas_supports'`).get()).toBeTruthy();
  const columns = db.prepare(`PRAGMA table_info(memory_atlas_projection_state)`).all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
    'projection_version', 'processor_prompt_version', 'frame_schema_version', 'source_fingerprint', 'last_backfill_cursor',
  ]));
  db.close();
});
