import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { MemoryGraph } from '../src/core/MemoryGraph.js';
import { NeuronFactory } from '../src/core/Neuron.js';
import type { EmbeddingProvider } from '../src/embedding/EmbeddingProvider.js';
import { NeuronEmbeddingStore } from '../src/embedding/NeuronEmbeddingStore.js';
import { ReEmbeddingPipeline } from '../src/embedding/ReEmbeddingPipeline.js';
import { createMemoryKernel } from '../src/public.js';

class SlowProvider implements EmbeddingProvider {
  readonly dimensions = 3;
  readonly modelId = 'current-model';

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await Bun.sleep(2);
    return texts.map(() => new Float32Array([1, 0, 0]));
  }

  async embed(text: string): Promise<Float32Array> {
    return (await this.embedBatch([text]))[0];
  }
}

function addNeuron(graph: MemoryGraph, idSuffix: string, projectId = 'p') {
  const neuron = NeuronFactory.create(
    `re-embedding status ${idSuffix}`,
    graph.getLatestNeuronSelfHash(projectId) || 'genesis',
    { T: Date.now(), S: [0, 0, 0], V: [1, 0, 0] },
    { projectId, type: 'chat', createdAt: Date.now(), updatedAt: Date.now(), status: 'active', tags: [] }
  );
  graph.addNeuron(neuron);
  return neuron;
}

describe('ReEmbeddingStatus v1.9.8', () => {
  test('NeuronEmbeddingStore.getProgress reports total completed failed and update time', () => {
    const db = new Database(':memory:');
    const store = new NeuronEmbeddingStore(db);
    store.upsert('n1', 'm', new Float32Array([1, 0, 0]), 'p');
    store.upsert('n2', 'm', new Float32Array([0, 1, 0]), 'p');
    db.prepare(`UPDATE neuron_embeddings SET status = 'failed' WHERE neuron_id = ?`).run('n2');

    const progress = store.getProgress();

    expect(progress.total).toBe(2);
    expect(progress.completed).toBe(1);
    expect(progress.failed).toBe(1);
    expect(progress.lastUpdatedAt).toMatch(/T/);
    db.close();
  });

  test('ReEmbeddingPipeline exposes running state and recent throughput', async () => {
    const db = new Database(':memory:');
    const graph = new MemoryGraph(':memory:');
    const store = new NeuronEmbeddingStore(db);
    const provider = new SlowProvider();
    const neuron = addNeuron(graph, 'one');
    store.upsert(neuron.id, 'old-model', new Float32Array([0, 1, 0]), 'p');
    const pipeline = new ReEmbeddingPipeline(store, provider, graph, db, { batchSize: 1 });

    const running = pipeline.run('p');
    expect(pipeline.isRunning()).toBe(true);
    const result = await running;

    expect(result.processed).toBe(1);
    expect(pipeline.isRunning()).toBe(false);
    expect(pipeline.getRecentThroughput()).toBeGreaterThan(0);
    graph.close();
    db.close();
  });

  test('MemoryKernel health includes reEmbedding status', () => {
    const kernel = createMemoryKernel({ embeddingProvider: new SlowProvider() });
    const neuron = addNeuron(kernel.memoryGraph, 'health');
    kernel.neuronEmbeddingStore.upsert(neuron.id, 'current-model', new Float32Array([1, 0, 0]), 'p');

    const status = kernel.getReEmbeddingStatus();
    const health = kernel.getHealthStatus();

    expect(status.total).toBe(1);
    expect(status.percentComplete).toBe(100);
    expect(health.reEmbedding.total).toBe(1);
    kernel.close();
  });
});
