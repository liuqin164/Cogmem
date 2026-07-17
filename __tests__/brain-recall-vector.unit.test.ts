/**
 * brain-recall-vector.unit.test.ts
 * Unit tests for BrainRecall vector search path — Phase 49
 *
 * Strategy: we test via BrainRecall.recall() by injecting a mock vectorSearchFn
 * and controlling candidateNeuronIds count through fullTextSearch mock.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { BrainRecall, type BrainRecallOptions } from '../src/recall/BrainRecall.js';
import { config } from '../src/utils/Config.js';

// ---------------------------------------------------------------------------
// Minimal stub factories
// ---------------------------------------------------------------------------

function makeMinimalDeps(overrides: Record<string, unknown> = {}) {
  return {
    memoryGraph: {
      fullTextSearch: (_q: string, _pid: string | undefined, _limit: number): string[] => [],
      getNeuron: (_id: string) => null,
      getNeuronIdsByProject: () => [],
    },
    factStore: {
      listNeuronIdsByEntityIds: () => [],
      listFactsByNeuronIds: () => [],
      listFactsByEntityIds: () => [],
      listEventsByNeuronIds: () => [],
    },
    entityStore: {
      findByCanonicalName: () => null,
      findByAlias: () => null,
      findByEntityId: () => null,
      getEntityTimeline: () => [],
    },
    beliefStore: {
      getActiveBeliefsForQuery: () => [],
    },
    cursorStore: {
      list: () => [],
      listRecentUnprocessedSources: () => [],
    },
    graphEdgeStore: undefined,
    vectorSearchFn: undefined,
    ...overrides,
  } as unknown as ConstructorParameters<typeof BrainRecall>[0];
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function withVectorConfig(
  enabled: boolean,
  threshold: number,
  fn: () => void
): void {
  const prev = { ...config.recall };
  config.set('recall.vectorEnabled', enabled);
  config.set('recall.vectorFallbackThreshold', threshold);
  try {
    fn();
  } finally {
    config.set('recall.vectorEnabled', prev.vectorEnabled);
    config.set('recall.vectorFallbackThreshold', prev.vectorFallbackThreshold);
  }
}

async function withVectorConfigAsync(
  enabled: boolean,
  threshold: number,
  fn: () => Promise<void>
): Promise<void> {
  const prev = { ...config.recall };
  config.set('recall.vectorEnabled', enabled);
  config.set('recall.vectorFallbackThreshold', threshold);
  try {
    await fn();
  } finally {
    config.set('recall.vectorEnabled', prev.vectorEnabled);
    config.set('recall.vectorFallbackThreshold', prev.vectorFallbackThreshold);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrainRecall vector search — not triggered when FTS results sufficient', () => {
  it('vectorSearchUsed = false when FTS returns enough candidates', () => {
    // FTS returns 15 neurons → above default threshold (12) → vector not triggered
    const ftsIds = Array.from({ length: 15 }, (_, i) => `nrn-fts-${i}`);
    let vectorCalled = false;

    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => ftsIds,
        getNeuron: () => null,
        getNeuronIdsByProject: () => [],
      },
      vectorSearchFn: (_q: string) => {
        vectorCalled = true;
        return ['nrn-vec-1'];
      },
    });

    withVectorConfig(true, 12, () => {
      const brain = new BrainRecall(deps);
      const result = brain.recall('test query');
      expect(result.strategy.vectorSearchUsed).toBe(false);
      expect(vectorCalled).toBe(false);
    });
  });
});

describe('BrainRecall vector search — triggered when FTS results sparse', () => {
  it('vectorSearchUsed = true when FTS returns fewer candidates than threshold', () => {
    // FTS returns 3 neurons → below default threshold (12) → vector triggered
    const ftsIds = ['nrn-fts-0', 'nrn-fts-1', 'nrn-fts-2'];
    let vectorCalled = false;

    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => ftsIds,
        getNeuron: () => null,
        getNeuronIdsByProject: () => [],
      },
      vectorSearchFn: (_q: string) => {
        vectorCalled = true;
        return ['nrn-vec-1', 'nrn-vec-2'];
      },
    });

    withVectorConfig(true, 12, () => {
      const brain = new BrainRecall(deps);
      const result = brain.recall('test query');
      expect(result.strategy.vectorSearchUsed).toBe(true);
      expect(vectorCalled).toBe(true);
    });
  });

  it('vector results are merged into raw evidence (via neuronIds)', () => {
    const ftsIds: string[] = []; // empty FTS → definitely sparse

    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => ftsIds,
        getNeuron: (id: string) => id === 'nrn-vec-A'
          ? { id, content: 'vec content', prev_hash: '', self_hash: '',
              coordinates: { T: 0, S: [0,0,0] as [number,number,number], V: [] },
              synapses: [],
              metadata: { type: 'chat' as const, createdAt: 0, tags: [] } }
          : null,
        getNeuronIdsByProject: () => [],
      },
      vectorSearchFn: () => ['nrn-vec-A'],
    });

    withVectorConfig(true, 12, () => {
      const brain = new BrainRecall(deps);
      const result = brain.recall('test query', { includeRawEvidence: true });
      expect(result.rawEvidence.some((n) => n.id === 'nrn-vec-A')).toBe(true);
    });
  });

  it('vector results are deduplicated with FTS results', () => {
    // nrn-overlap appears in both FTS and vector
    const ftsIds = ['nrn-overlap', 'nrn-fts-1'];

    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => ftsIds,
        getNeuron: () => null,
        getNeuronIdsByProject: () => [],
      },
      vectorSearchFn: () => ['nrn-overlap', 'nrn-vec-new'],
    });

    // Set threshold high to ensure vector is triggered
    withVectorConfig(true, 100, () => {
      const brain = new BrainRecall(deps);
      const capturedIds: string[] = [];
      // We verify dedup by checking rawEvidence doesn't have duplicates
      const result = brain.recall('test query', { includeRawEvidence: true });
      // All neuronIds should be unique (no duplicates)
      const ids = result.rawEvidence.map((n) => n.id);
      expect(ids).toEqual([...new Set(ids)]);
    });
  });

  it('recallAsync uses async embedding providers without requiring embedSync', async () => {
    let embedCalled = false;
    let nearestCalled = false;

    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => [],
        getNeuron: (id: string) => id === 'nrn-async-vec'
          ? { id, content: 'async vector content', prev_hash: '', self_hash: '',
              coordinates: { T: 0, S: [0,0,0] as [number,number,number], V: [] },
              synapses: [],
              metadata: { type: 'chat' as const, createdAt: 0, projectId: 'project-a', tags: [] } }
          : null,
        getNeuronIdsByProject: () => [],
      },
      embeddingProvider: {
        dimensions: 3,
        modelId: 'async-test-model',
        embed: async () => {
          embedCalled = true;
          return new Float32Array([1, 0, 0]);
        },
        embedBatch: async () => [new Float32Array([1, 0, 0])],
      },
      neuronEmbeddingStore: {
        findNearest: (vector: Float32Array, projectId: string | undefined, topK: number, modelId?: string) => {
          nearestCalled = true;
          expect(Array.from(vector)).toEqual([1, 0, 0]);
          expect(projectId).toBe('project-a');
          expect(topK).toBe(24);
          expect(modelId).toBe('async-test-model');
          return [{ neuronId: 'nrn-async-vec', score: 0.99 }];
        },
      },
    });

    await withVectorConfigAsync(true, 12, async () => {
      const brain = new BrainRecall(deps);
      const result = await brain.recallAsync('test query', {
        projectId: 'project-a',
        includeRawEvidence: true,
      });
      expect(result.strategy.vectorSearchUsed).toBe(true);
      expect(embedCalled).toBe(true);
      expect(nearestCalled).toBe(true);
      expect(result.rawEvidence.some((n) => n.id === 'nrn-async-vec')).toBe(true);
    });
  });
});

describe('BrainRecall vector search — vectorEnabled = false', () => {
  it('never triggers vector search when vectorEnabled = false', () => {
    let vectorCalled = false;

    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => [], // empty → would normally trigger vector
        getNeuron: () => null,
        getNeuronIdsByProject: () => [],
      },
      vectorSearchFn: () => {
        vectorCalled = true;
        return ['nrn-vec-1'];
      },
    });

    withVectorConfig(false, 12, () => {
      const brain = new BrainRecall(deps);
      const result = brain.recall('test query');
      expect(result.strategy.vectorSearchUsed).toBeFalsy();
      expect(vectorCalled).toBe(false);
    });
  });

  it('vectorSearchUsed is false when no vectorSearchFn provided', () => {
    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => [],
        getNeuron: () => null,
        getNeuronIdsByProject: () => [],
      },
      // vectorSearchFn not provided
    });

    withVectorConfig(true, 12, () => {
      const brain = new BrainRecall(deps);
      const result = brain.recall('test query');
      expect(result.strategy.vectorSearchUsed).toBeFalsy();
    });
  });
});

describe('BrainRecall vector search — threshold boundary', () => {
  it('exactly at threshold: vector not triggered', () => {
    // threshold = 5, FTS returns exactly 5 → not triggered
    const ftsIds = ['a', 'b', 'c', 'd', 'e'];
    let vectorCalled = false;

    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => ftsIds,
        getNeuron: () => null,
        getNeuronIdsByProject: () => [],
      },
      vectorSearchFn: () => { vectorCalled = true; return []; },
    });

    withVectorConfig(true, 5, () => {
      const brain = new BrainRecall(deps);
      brain.recall('test query');
      expect(vectorCalled).toBe(false);
    });
  });

  it('one below threshold: vector triggered', () => {
    // threshold = 5, FTS returns 4 → triggered
    const ftsIds = ['a', 'b', 'c', 'd'];
    let vectorCalled = false;

    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => ftsIds,
        getNeuron: () => null,
        getNeuronIdsByProject: () => [],
      },
      vectorSearchFn: () => { vectorCalled = true; return ['vec-1']; },
    });

    withVectorConfig(true, 5, () => {
      const brain = new BrainRecall(deps);
      brain.recall('test query');
      expect(vectorCalled).toBe(true);
    });
  });

  it('vector returning empty list results in vectorSearchUsed = false', () => {
    const deps = makeMinimalDeps({
      memoryGraph: {
        fullTextSearch: () => [],
        getNeuron: () => null,
        getNeuronIdsByProject: () => [],
      },
      vectorSearchFn: () => [], // vector returns nothing
    });

    withVectorConfig(true, 12, () => {
      const brain = new BrainRecall(deps);
      const result = brain.recall('test query');
      // Vector was called but returned nothing → vectorSearchUsed = false
      expect(result.strategy.vectorSearchUsed).toBe(false);
    });
  });
});
