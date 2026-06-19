import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import {
  BindingDecisionEngine,
  BrainGraphView,
  ClaimKeyGenerator,
  TopicPathRegistry,
} from '../src/binding/index.js';
import { MemoryBindingStore } from '../src/store/MemoryBindingStore.js';

describe('memory binding v1.5', () => {
  test('canonicalizes multilingual topic aliases without allowing arbitrary stable paths', () => {
    const registry = new TopicPathRegistry();

    expect(registry.resolveProjectPath('Cogmem', 'memory storage')).toBe('PROJECT/Cogmem/memory-write-pipeline');
    expect(registry.resolveProjectPath('Cogmem', '记忆写入')).toBe('PROJECT/Cogmem/memory-write-pipeline');
    expect(registry.resolveProjectPath('Cogmem', '../../unsafe path')).toBe('PROJECT/Cogmem/unsafe-path');
  });

  test('keeps distinct claims separate under the same topic', () => {
    const generator = new ClaimKeyGenerator();

    expect(generator.generate('写入时不看历史', 'diagnostic')).toBe('missing-historical-binding');
    expect(generator.generate('分类树会漂移', 'diagnostic')).toBe('classification-drift');
    expect(generator.generate('写入时不看历史', 'diagnostic')).not.toBe(
      generator.generate('分类树会漂移', 'diagnostic'),
    );
  });

  test('makes correction and reinforcement decisions from prior evidence', () => {
    const engine = new BindingDecisionEngine();

    expect(engine.decide({ bindingType: 'correction', relatedCount: 2, supportCount: 1 })).toBe('corrects_prior_memory');
    expect(engine.decide({ bindingType: 'preference', relatedCount: 1, supportCount: 2 })).toBe('strengthen_existing');
  });

  test('decays activation without weakening confidence or stability', () => {
    const db = new Database(':memory:');
    const store = new MemoryBindingStore(db);
    const edge = store.upsertEdge({
      projectId: 'brain',
      sourceType: 'event',
      sourceId: 'evt-1',
      relationType: 'SUPPORTS',
      targetType: 'cluster',
      targetId: 'cluster-1',
      confidence: 0.9,
      stability: 0.8,
      activation: 1,
      evidenceEventIds: ['evt-1'],
    });

    store.decayEdgeActivation({ projectId: 'brain', factor: 0.5, floor: 0 });
    const after = store.listEdges({ projectId: 'brain' })[0]!;

    expect(edge.confidence).toBe(0.9);
    expect(after.confidence).toBe(0.9);
    expect(after.stability).toBe(0.8);
    expect(after.activation).toBe(0.5);
    db.close();
  });

  test('exposes bounded read-only graph traversal with provenance', () => {
    const db = new Database(':memory:');
    const store = new MemoryBindingStore(db);
    store.upsertEdge({
      projectId: 'brain',
      sourceType: 'event',
      sourceId: 'evt-1',
      relationType: 'ABOUT',
      targetType: 'topic',
      targetId: 'PROJECT/Cogmem/memory-write-pipeline',
      confidence: 0.9,
      evidenceEventIds: ['evt-1'],
    });
    const graph = new BrainGraphView(store);

    const result = graph.neighbors('evt-1', { projectId: 'brain', maxHops: 2, limit: 10 });

    expect(result.edges).toHaveLength(1);
    expect(result.evidenceEventIds).toEqual(['evt-1']);
    expect('upsertEdge' in graph).toBe(false);
    db.close();
  });
});
