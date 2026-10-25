import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

test('MemoryKernel closes every owned SQLite connection and close is idempotent', () => {
  const dbPath = join(makeTempDir('cogmem-close-owned-'), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  kernel.close();
  expect(() => kernel.beliefStore.countActive('demo')).toThrow();
  expect(() => kernel.cursorStore.listRegisteredSources()).toThrow();
  expect(() => kernel.close()).not.toThrow();
});

test('a live Kernel reader and an independent WAL writer complete without lock timeout', async () => {
  const dbPath = join(makeTempDir('cogmem-concurrent-wal-'), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  try {
    const writer = new Database(dbPath);
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;');
    const writes = Array.from({ length: 20 }, (_, index) => Promise.resolve().then(() => {
      writer.prepare(`INSERT OR REPLACE INTO _meta(key,value) VALUES(?,?)`).run(`concurrency-${index}`, String(index));
      return kernel.eventStore.queryEvents(1, 1).total;
    }));
    const completed = await Promise.race([
      Promise.all(writes),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sqlite_concurrency_timeout')), 3000)),
    ]);
    expect(completed).toHaveLength(20);
    writer.close();
  } finally { kernel.close(); }
});
