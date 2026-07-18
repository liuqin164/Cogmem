import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteVecStore, VectorStore, createMemoryKernel } from '../src/public.js';

function tempDir(): string {
  const dir = join(tmpdir(), `core-vector-backend-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Vector backends v1.12', () => {
  test('SqliteVecStore filters vector rows without a canonical live neuron', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE neurons(id TEXT PRIMARY KEY,is_deleted INTEGER NOT NULL DEFAULT 0); INSERT INTO neurons VALUES('live',0)`);
    const store = new SqliteVecStore(db, 3);
    store.addVector('live', [1, 0, 0]);
    store.addVector('orphan', [1, 0, 0]);
    expect(store.search([1, 0, 0], 10).map((item) => item.id)).toEqual(['live']);
    db.close();
  });

  test('external vector outbox is replayed after restart and cleared only after indexing', async () => {
    const dir = tempDir(); const dbPath = join(dir, 'outbox.db');
    const writer = createMemoryKernel({ dbPath, vectorDimension: 3 });
    const neuron = await writer.ingest({ projectId: 'p', content: 'durable vector outbox recovery' });
    writer.factStore.getDatabase().prepare(`INSERT OR REPLACE INTO vector_write_outbox(neuron_id,vector_json,created_at) VALUES(?,?,1)`).run(neuron.id, JSON.stringify(neuron.coordinates.V));
    writer.close();
    const recovered = createMemoryKernel({ dbPath, vectorBackend: 'hnswlib', vectorDimension: 3 });
    expect(recovered.vectorStore.search(neuron.coordinates.V, 5).map((item) => item.id)).toContain(neuron.id);
    expect(recovered.factStore.getDatabase().prepare(`SELECT COUNT(*) AS count FROM vector_write_outbox`).get()).toEqual({ count: 0 });
    recovered.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('hnswlib rebuilds historical vectors after a clean restart with an empty outbox', async () => {
    const dir = tempDir(); const dbPath = join(dir, 'hnsw-restart.db');
    const writer = createMemoryKernel({ dbPath, vectorBackend: 'hnswlib', vectorDimension: 3 });
    const neuron = await writer.ingest({ projectId: 'p', content: 'persistent hnsw canonical vector' });
    expect(writer.factStore.getDatabase().prepare(`SELECT COUNT(*) AS count FROM vector_write_outbox`).get()).toEqual({ count: 0 });
    writer.close();
    const reopened = createMemoryKernel({ dbPath, vectorBackend: 'hnswlib', vectorDimension: 3 });
    expect(reopened.vectorStore.search(neuron.coordinates.V, 5).map((item) => item.id)).toContain(neuron.id);
    reopened.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('hnswlib compacts replacement tombstones and atomically validates saved generations', async () => {
    const store = new VectorStore(3, 8);
    store.addVector('stable', [0, 1, 0]);
    for (let index = 0; index < 160; index += 1) store.addVector('changing', [1, index / 1000, 0]);
    expect(store.getCurrentCount()).toBe(2);
    expect(store.getStats().tombstones).toBeLessThan(64);
    expect(store.search([1, 0, 0], 2).map((item) => item.id)).toContain('changing');

    const dir = tempDir(); const path = join(dir, 'index');
    await store.saveIndex(path);
    if (!existsSync(`${path}.current`)) { rmSync(dir, { recursive: true, force: true }); return; }
    const reopened = new VectorStore(3, 8);
    await reopened.loadIndex(path);
    expect(reopened.search([0, 1, 0], 2).map((item) => item.id)).toContain('stable');
    const pointer = JSON.parse(readFileSync(`${path}.current`, 'utf8')) as { generation: string };
    const metadataPath = `${pointer.generation}.meta.json`;
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, indexChecksum: 'tampered' }));
    await expect(new VectorStore(3, 8).loadIndex(path)).rejects.toThrow('vector_index_metadata_mismatch');
    rmSync(dir, { recursive: true, force: true });
  });

  test('SqliteVecStore persists vectors and returns cosine-ranked nearest neighbors', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'vectors.db');
    const db = new Database(dbPath);
    const store = new SqliteVecStore(db, 3);

    store.addVector('a', [1, 0, 0]);
    store.addVector('b', [0, 1, 0]);
    store.addVector('c', [0.9, 0.1, 0]);

    expect(store.search([1, 0, 0], 2).map((row) => row.id)).toEqual(['a', 'c']);
    expect(store.getStats()).toMatchObject({ backend: 'sqlite-vec', dimension: 3, size: 3 });

    store.removePoint('a');
    expect(store.search([1, 0, 0], 2).map((row) => row.id)).toEqual(['c', 'b']);
    db.close();

    const reopenedDb = new Database(dbPath);
    const reopened = new SqliteVecStore(reopenedDb, 3);
    expect(reopened.getCurrentCount()).toBe(2);
    expect(reopened.search([0, 1, 0], 1)[0]?.id).toBe('b');
    reopenedDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('MemoryKernel can use sqlite-vec as the default durable vector backend', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'kernel.db');
    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });

    await kernel.ingest({
      projectId: 'vector-user',
      content: 'SQLite vector backend should recall durable memory kernel facts.',
      sourceType: 'chat',
    });

    expect(kernel.vectorStore.getStats().backend).toBe('sqlite-vec');
    expect(kernel.vectorStore.getCurrentCount()).toBe(1);
    const recall = kernel.recall('durable memory kernel facts', { projectId: 'vector-user', limit: 5 });
    expect(recall.rawEvidence.some((item) => item.content.includes('SQLite vector backend'))).toBe(true);
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('MemoryKernel applies an explicit high vector dimension to storage and deterministic embeddings', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'kernel-4096.db');
    const kernel = createMemoryKernel({
      dbPath,
      vectorBackend: 'sqlite-vec',
      vectorDimension: 4096,
    });

    const neuron = await kernel.ingest({
      projectId: 'vector-4096',
      content: 'High-dimensional vector memory should stay configurable.',
      sourceType: 'chat',
    });

    expect(neuron.coordinates.V).toHaveLength(4096);
    expect(kernel.vectorStore.getStats()).toMatchObject({
      backend: 'sqlite-vec',
      dimension: 4096,
      size: 1,
    });
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('AB_VECTOR_DIMENSION does not change default kernel dimensions', async () => {
    const proc = Bun.spawn({
      cmd: [
        'bun',
        '--eval',
        [
          "import { createMemoryKernel } from './src/public.js';",
          'const kernel = createMemoryKernel();',
          'console.log(JSON.stringify(kernel.vectorStore.getStats()));',
          'kernel.close();',
        ].join(' '),
      ],
      cwd: join(import.meta.dir, '..'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        AB_VECTOR_DIMENSION: '4096',
      },
    });

    const output = await new Response(proc.stdout).text();
    const errorOutput = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(0);
    expect(errorOutput).toBe('');
    expect(JSON.parse(output).dimension).toBe(384);
  });

  test('MemoryKernel still supports the hnswlib backend flag for existing users', () => {
    const kernel = createMemoryKernel({ vectorBackend: 'hnswlib' });

    expect(kernel.vectorStore.getStats().backend).toBe('hnswlib');
    kernel.close();
  });
});
