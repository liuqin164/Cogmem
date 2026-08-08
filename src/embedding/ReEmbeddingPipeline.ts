import type Database from 'bun:sqlite';
import type { MemoryGraph } from '../core/MemoryGraph.js';
import type { EmbeddingProvider } from './EmbeddingProvider.js';
import type { NeuronEmbeddingStore } from './NeuronEmbeddingStore.js';

export interface ReEmbeddingOptions {
  batchSize?: number;
  maxBudgetMs?: number;
}

export class ReEmbeddingPipeline {
  private running = false;
  private readonly recentThroughput: number[] = [];

  constructor(
    private readonly neuronEmbeddingStore: NeuronEmbeddingStore,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly memoryGraph: MemoryGraph,
    private readonly db: Database,
    private readonly options: ReEmbeddingOptions = {}
  ) {
    this.initSchema();
  }

  async run(projectId: string): Promise<{ processed: number; remaining: number }> {
    this.running = true;
    const runStartedAt = Date.now();
    let processed = 0;
    try {
      const modelId = this.embeddingProvider.modelId;
      if (!this.neuronEmbeddingStore.hasStaleVectors(modelId)) {
        this.clearProgress(projectId, modelId);
        return { processed: 0, remaining: 0 };
      }

      const batchSize = Math.max(1, this.options.batchSize ?? 50);
      const maxBudgetMs = this.options.maxBudgetMs ?? 60_000;
      const startedAt = Date.now();
      let cursor = this.readProgress(projectId, modelId);

      while (true) {
        const neuronIds = this.neuronEmbeddingStore.listStaleNeuronIds(modelId, projectId, cursor, batchSize);
        if (neuronIds.length === 0) {
          this.clearProgress(projectId, modelId);
          this.recordThroughput(processed, Date.now() - runStartedAt);
          return { processed, remaining: 0 };
        }

        const live = neuronIds
          .map((id) => ({ id, neuron: this.memoryGraph.getNeuron(id) }))
          .filter((item): item is { id: string; neuron: NonNullable<ReturnType<MemoryGraph['getNeuron']>> } => Boolean(item.neuron?.content));
        const missing = neuronIds.filter((id) => !live.some((item) => item.id === id));
        for (const neuronId of missing) this.neuronEmbeddingStore.deleteNeuronEmbedding(neuronId);

        if (live.length > 0) {
          const batchStartedAt = Date.now();
          const vectors = await this.embeddingProvider.embedBatch(live.map((item) => item.neuron.content));
          let batchProcessed = 0;
          for (let index = 0; index < live.length; index += 1) {
            const vector = vectors[index];
            if (!vector) continue;
            if (vector.length !== this.embeddingProvider.dimensions) {
              throw new Error(`Embedding dimension mismatch for ${modelId}: expected ${this.embeddingProvider.dimensions}, got ${vector.length}`);
            }
            if (this.neuronEmbeddingStore.upsert(live[index].id, modelId, vector, projectId)) {
              this.neuronEmbeddingStore.deleteStaleEmbeddingsForNeuron(live[index].id, modelId);
              processed += 1;
              batchProcessed += 1;
            }
          }
          this.recordThroughput(batchProcessed, Date.now() - batchStartedAt);
        }

        cursor = neuronIds[neuronIds.length - 1];
        this.saveProgress(projectId, modelId, cursor);
        if (maxBudgetMs > 0 && Date.now() - startedAt >= maxBudgetMs) {
          return { processed, remaining: this.neuronEmbeddingStore.countStaleVectors(modelId, projectId) };
        }
      }
    } finally {
      this.recordThroughput(processed, Date.now() - runStartedAt);
      this.running = false;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getRecentThroughput(): number | null {
    if (this.recentThroughput.length === 0) return null;
    return this.recentThroughput.reduce((sum, value) => sum + value, 0) / this.recentThroughput.length;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS re_embedding_progress (
        projectId TEXT NOT NULL,
        modelId TEXT NOT NULL,
        lastProcessedNeuronId TEXT NOT NULL DEFAULT '',
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (projectId, modelId)
      );
    `);
  }

  private readProgress(projectId: string, modelId: string): string {
    const row = this.db.prepare(`
      SELECT lastProcessedNeuronId FROM re_embedding_progress
      WHERE projectId = ? AND modelId = ?
    `).get(projectId, modelId) as { lastProcessedNeuronId: string } | undefined;
    return row?.lastProcessedNeuronId || '';
  }

  private saveProgress(projectId: string, modelId: string, lastProcessedNeuronId: string): void {
    this.db.prepare(`
      INSERT INTO re_embedding_progress (projectId, modelId, lastProcessedNeuronId, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(projectId, modelId) DO UPDATE SET
        lastProcessedNeuronId = excluded.lastProcessedNeuronId,
        updatedAt = excluded.updatedAt
    `).run(projectId, modelId, lastProcessedNeuronId, Date.now());
  }

  private clearProgress(projectId: string, modelId: string): void {
    this.db.prepare(`DELETE FROM re_embedding_progress WHERE projectId = ? AND modelId = ?`).run(projectId, modelId);
  }

  private recordThroughput(processed: number, durationMs: number): void {
    if (processed <= 0 || durationMs <= 0) return;
    this.recentThroughput.push(processed / durationMs);
    while (this.recentThroughput.length > 100) this.recentThroughput.shift();
  }
}
