import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { join } from 'node:path';
import { MemoryGraph } from '../src/core/MemoryGraph.js';
import { NeuronFactory } from '../src/core/Neuron.js';
import { NeuronEmbeddingStore } from '../src/embedding/NeuronEmbeddingStore.js';
import { ReEmbeddingPipeline } from '../src/embedding/ReEmbeddingPipeline.js';
import type { EmbeddingProvider } from '../src/embedding/EmbeddingProvider.js';
import { makeTempDir } from './helpers/tmp.js';

class FakeEmbeddingProvider implements EmbeddingProvider {
  modelId = 'model/new';
  dimensions = 2;
  calls = 0;
  fail = false;
  delayMs = 0;

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    this.calls += 1;
    if (this.delayMs > 0) await Bun.sleep(this.delayMs);
    if (this.fail) throw new Error('embedding unavailable');
    return texts.map((text) => new Float32Array([text.length, 1]));
  }

  async embed(text: string): Promise<Float32Array> {
    return (await this.embedBatch([text]))[0];
  }
}

function fixture() {
  const dbPath = join(makeTempDir('cogmem-reembed-'), 'brain.db');
  const db = new Database(dbPath);
  const graph = new MemoryGraph(dbPath);
  const store = new NeuronEmbeddingStore(db);
  const provider = new FakeEmbeddingProvider();
  return { db, graph, store, provider };
}

function add(graph: MemoryGraph, content: string, projectId = 'p') {
  const now = Date.now();
  const neuron = NeuronFactory.create(content, graph.getLatestNeuronSelfHash(projectId) || 'genesis', { T: now, S: [0, 0, 0], V: [] }, {
    projectId,
    type: 'chat',
    createdAt: now,
    updatedAt: now,
    status: 'active',
    tags: [],
    importanceLevel: 'normal'
  });
  graph.addNeuron(neuron);
  return neuron;
}

describe('ReEmbeddingPipeline', () => {
  test('returns immediately when no stale vectors exist', async () => {
    const { db, graph, store, provider } = fixture();
    const result = await new ReEmbeddingPipeline(store, provider, graph, db).run('p');
    expect(result).toEqual({ processed: 0, remaining: 0 });
    expect(provider.calls).toBe(0);
  });

  test('re-embeds stale vectors and clears stale state', async () => {
    const { db, graph, store, provider } = fixture();
    const a = add(graph, 'alpha');
    const b = add(graph, 'beta');
    store.upsert(a.id, 'model/old', new Float32Array([1]), 'p');
    store.upsert(b.id, 'model/old', new Float32Array([1]), 'p');

    const result = await new ReEmbeddingPipeline(store, provider, graph, db, { batchSize: 1 }).run('p');

    expect(result).toEqual({ processed: 2, remaining: 0 });
    expect(store.hasStaleVectors(provider.modelId)).toBe(false);
    expect(provider.calls).toBe(2);
  });

  test('persists cursor after budget abort and resumes without repeating completed neurons', async () => {
    const { db, graph, store, provider } = fixture();
    const neurons = [add(graph, 'a'), add(graph, 'bb'), add(graph, 'ccc')].sort((a, b) => a.id.localeCompare(b.id));
    for (const neuron of neurons) store.upsert(neuron.id, 'model/old', new Float32Array([1]), 'p');
    provider.delayMs = 3;

    const first = await new ReEmbeddingPipeline(store, provider, graph, db, { batchSize: 1, maxBudgetMs: 1 }).run('p');
    const cursor = db.prepare(`SELECT lastProcessedNeuronId FROM re_embedding_progress WHERE projectId = ? AND modelId = ?`).get('p', provider.modelId) as { lastProcessedNeuronId: string };

    provider.delayMs = 0;
    const second = await new ReEmbeddingPipeline(store, provider, graph, db, { batchSize: 10, maxBudgetMs: 0 }).run('p');

    expect(first.processed).toBeGreaterThan(0);
    expect(cursor.lastProcessedNeuronId).toBe(neurons[0].id);
    expect(second.remaining).toBe(0);
    expect(store.hasStaleVectors(provider.modelId)).toBe(false);
  });

  test('deletes stale vector for missing consumed neuron content', async () => {
    const { db, graph, store, provider } = fixture();
    store.upsert('missing-neuron', 'model/old', new Float32Array([1]), 'p');

    const result = await new ReEmbeddingPipeline(store, provider, graph, db).run('p');

    expect(result).toEqual({ processed: 0, remaining: 0 });
    expect(store.countStaleVectors(provider.modelId, 'p')).toBe(0);
    expect(provider.calls).toBe(0);
  });

  test('preserves cursor when embedding provider fails', async () => {
    const { db, graph, store, provider } = fixture();
    const neuron = add(graph, 'alpha');
    store.upsert(neuron.id, 'model/old', new Float32Array([1]), 'p');
    provider.fail = true;

    await expect(new ReEmbeddingPipeline(store, provider, graph, db).run('p')).rejects.toThrow('embedding unavailable');
    expect(store.countStaleVectors(provider.modelId, 'p')).toBe(1);
  });

  test('project cursors are isolated', async () => {
    const { db, graph, store, provider } = fixture();
    const a = add(graph, 'alpha', 'p1');
    const b = add(graph, 'beta', 'p2');
    store.upsert(a.id, 'model/old', new Float32Array([1]), 'p1');
    store.upsert(b.id, 'model/old', new Float32Array([1]), 'p2');

    await new ReEmbeddingPipeline(store, provider, graph, db).run('p1');

    expect(store.countStaleVectors(provider.modelId, 'p1')).toBe(0);
    expect(store.countStaleVectors(provider.modelId, 'p2')).toBe(1);
  });

  test('multi-project budget cursors are isolated after partial runs', async () => {
    const { db, graph, store, provider } = fixture();
    const p1 = [add(graph, 'a', 'p1'), add(graph, 'bb', 'p1')].sort((a, b) => a.id.localeCompare(b.id));
    const p2 = [add(graph, 'ccc', 'p2'), add(graph, 'dddd', 'p2')].sort((a, b) => a.id.localeCompare(b.id));
    for (const neuron of [...p1, ...p2]) store.upsert(neuron.id, 'model/old', new Float32Array([1]), neuron.metadata.projectId);
    provider.delayMs = 3;

    await new ReEmbeddingPipeline(store, provider, graph, db, { batchSize: 1, maxBudgetMs: 1 }).run('p1');
    await new ReEmbeddingPipeline(store, provider, graph, db, { batchSize: 1, maxBudgetMs: 1 }).run('p2');

    const rows = db.prepare(`SELECT projectId, lastProcessedNeuronId FROM re_embedding_progress ORDER BY projectId`).all() as Array<{ projectId: string; lastProcessedNeuronId: string }>;
    expect(rows).toEqual([
      { projectId: 'p1', lastProcessedNeuronId: p1[0].id },
      { projectId: 'p2', lastProcessedNeuronId: p2[0].id }
    ]);
  });

  test('same-project cursors are isolated by current model id', async () => {
    const { db, graph, store, provider } = fixture();
    const neurons = [add(graph, 'a'), add(graph, 'bb')].sort((a, b) => a.id.localeCompare(b.id));
    for (const neuron of neurons) store.upsert(neuron.id, 'model/old', new Float32Array([1]), 'p');
    provider.delayMs = 3;

    provider.modelId = 'model/new-a';
    await new ReEmbeddingPipeline(store, provider, graph, db, { batchSize: 1, maxBudgetMs: 1 }).run('p');
    provider.modelId = 'model/new-b';
    await new ReEmbeddingPipeline(store, provider, graph, db, { batchSize: 1, maxBudgetMs: 1 }).run('p');

    const rows = db.prepare(`SELECT modelId FROM re_embedding_progress WHERE projectId = ? ORDER BY modelId`).all('p') as Array<{ modelId: string }>;
    expect(rows.map((row) => row.modelId)).toEqual(['model/new-a', 'model/new-b']);
  });

  test('clears only the completed project cursor when another project remains stale', async () => {
    const { db, graph, store, provider } = fixture();
    const p1 = add(graph, 'alpha', 'p1');
    const p2 = add(graph, 'beta', 'p2');
    store.upsert(p1.id, 'model/old', new Float32Array([1]), 'p1');
    store.upsert(p2.id, 'model/old', new Float32Array([1]), 'p2');
    const pipeline = new ReEmbeddingPipeline(store, provider, graph, db);
    db.prepare(`INSERT INTO re_embedding_progress (projectId, modelId, lastProcessedNeuronId, updatedAt) VALUES (?, ?, ?, ?)`).run('p2', provider.modelId, 'existing', Date.now());

    await pipeline.run('p1');

    expect(db.prepare(`SELECT COUNT(*) AS count FROM re_embedding_progress WHERE projectId = ?`).get('p1')).toEqual({ count: 0 });
    expect(db.prepare(`SELECT lastProcessedNeuronId FROM re_embedding_progress WHERE projectId = ?`).get('p2')).toEqual({ lastProcessedNeuronId: 'existing' });
  });

  test('dimension mismatch keeps stale vectors for retry', async () => {
    const { db, graph, store, provider } = fixture();
    const neuron = add(graph, 'alpha');
    store.upsert(neuron.id, 'model/old', new Float32Array([1]), 'p');
    provider.dimensions = 3;

    await expect(new ReEmbeddingPipeline(store, provider, graph, db).run('p')).rejects.toThrow('Embedding dimension mismatch');
    expect(store.countStaleVectors(provider.modelId, 'p')).toBe(1);
  });
});
