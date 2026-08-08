import { describe, expect, test } from 'bun:test';
import { MemoryGraph } from '../src/core/MemoryGraph.js';
import { NeuronFactory } from '../src/core/Neuron.js';
import { GraphCommunityEngine } from '../src/engine/GraphCommunityEngine.js';
import { OrphanCleaner } from '../src/engine/OrphanCleaner.js';
import { BrainRecall } from '../src/recall/BrainRecall.js';

function add(graph: MemoryGraph, idText: string, projectId = 'p', status: 'active' | 'archived' = 'active', createdAt = Date.now() - 10_000_000, type: 'chat' | 'semantic_consolidation' | 'cross_domain_principle' = 'chat') {
  const n = NeuronFactory.create(idText, graph.getLatestNeuronSelfHash(projectId) || 'genesis', { T: createdAt, S: [0, 0, 0], V: [] }, {
    projectId, type, createdAt, updatedAt: createdAt, status, tags: ['graph'], importanceLevel: 'normal'
  });
  graph.addNeuron(n);
  return n;
}

function deps(graph: MemoryGraph, engine?: GraphCommunityEngine) {
  return { memoryGraph: graph, factStore: { listNeuronIdsByEntityIds: () => [], listFactsByNeuronIds: () => [], listFactsByEntityIds: () => [], listEventsByNeuronIds: () => [] }, entityStore: { findByCanonicalName: () => null, findByAlias: () => null, getEntityTimeline: () => [] }, beliefStore: { getActiveBeliefsForQuery: () => [] }, cursorStore: { listRecentUnprocessedSources: () => [] }, graphCommunityEngine: engine } as unknown as ConstructorParameters<typeof BrainRecall>[0];
}

describe('GraphCommunityEngine', () => {
  test('label propagation converges on simple triangle', async () => {
    const g = new MemoryGraph(); const a = add(g, 'alpha'); const b = add(g, 'beta'); const c = add(g, 'gamma');
    g.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 }); g.addSynapse(b.id, { targetId: c.id, type: 'Similar', weight: 1 }); g.addSynapse(c.id, { targetId: a.id, type: 'Similar', weight: 1 });
    expect((await new GraphCommunityEngine(g).run('p')).communitiesDetected).toBe(1);
  });
  test('small communities are merged into neighbor community', async () => {
    const g = new MemoryGraph(); const a = add(g, 'a'); const b = add(g, 'b'); g.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 });
    expect((await new GraphCommunityEngine(g, { minCommunitySize: 3 }).run('p')).communitiesDetected).toBe(1);
  });
  test('communityId is persisted on metadata', async () => {
    const g = new MemoryGraph(); const a = add(g, 'a'); const b = add(g, 'b'); g.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 });
    await new GraphCommunityEngine(g).run('p');
    expect(g.getNeuron(a.id)?.metadata.communityId).toBeTruthy();
  });
  test('archived neurons are excluded by default', async () => {
    const g = new MemoryGraph(); const a = add(g, 'a'); const b = add(g, 'b', 'p', 'archived'); g.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 });
    await new GraphCommunityEngine(g).run('p');
    expect(g.getNeuron(b.id)?.metadata.communityId).toBeUndefined();
  });
  test('getCommunityMembers returns members', async () => {
    const g = new MemoryGraph(); const a = add(g, 'a'); const b = add(g, 'b'); g.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 });
    const engine = new GraphCommunityEngine(g); await engine.run('p');
    expect(engine.getCommunityMembers(g.getNeuron(a.id)!.metadata.communityId!)).toContain(b.id);
  });
  test('BrainRecall expands by community', async () => {
    const g = new MemoryGraph(); const a = add(g, 'needle community'); const b = add(g, 'quiet neighbor'); g.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 });
    const engine = new GraphCommunityEngine(g); await engine.run('p');
    expect(new BrainRecall(deps(g, engine)).recall('needle', { projectId: 'p', limit: 1 }).rawEvidence.map((n) => n.id)).toContain(b.id);
  });
  test('BrainRecall never expands a shared community id across project scope', () => {
    const g = new MemoryGraph(); const a = add(g, 'needle scoped', 'p'); const b = add(g, 'foreign neighbor', 'q');
    g.updateNeuronMetadata(a.id, { communityId: 'legacy-shared' }); g.updateNeuronMetadata(b.id, { communityId: 'legacy-shared' });
    const evidence = new BrainRecall(deps(g, new GraphCommunityEngine(g))).recall('needle', { projectId: 'p', limit: 2 }).rawEvidence;
    expect(evidence.map((neuron) => neuron.id)).toContain(a.id);
    expect(evidence.map((neuron) => neuron.id)).not.toContain(b.id);
  });
  test('missing communityId does not expand', () => {
    const g = new MemoryGraph(); add(g, 'needle'); add(g, 'neighbor');
    expect(new BrainRecall(deps(g, new GraphCommunityEngine(g))).recall('needle', { projectId: 'p', limit: 1 }).rawEvidence).toHaveLength(1);
  });
  test('OrphanCleaner marks degree-zero active neurons suspect', async () => {
    const g = new MemoryGraph(); const n = add(g, 'orphan');
    expect((await new OrphanCleaner(g, { orphanAgeMs: 1 }).run('p')).orphansMarked).toBe(1);
    expect(g.getNeuron(n.id)?.metadata.status).toBe('suspect');
  });
  test('OrphanCleaner exempts semantic and cross-domain neurons', async () => {
    const g = new MemoryGraph(); add(g, 'semantic', 'p', 'active', Date.now() - 10_000_000, 'semantic_consolidation');
    expect((await new OrphanCleaner(g, { orphanAgeMs: 1 }).run('p')).orphansMarked).toBe(0);
  });
  test('OrphanCleaner respects age cooldown', async () => {
    const g = new MemoryGraph(); add(g, 'fresh', 'p', 'active', Date.now());
    expect((await new OrphanCleaner(g, { orphanAgeMs: 60_000 }).run('p')).orphansMarked).toBe(0);
  });
  test('OrphanCleaner does not mark important neurons', async () => {
    const g = new MemoryGraph(); const n = add(g, 'important'); g.updateNeuronMetadata(n.id, { importanceLevel: 'important' });
    expect((await new OrphanCleaner(g, { orphanAgeMs: 1 }).run('p')).orphansMarked).toBe(0);
  });
  test('community detection is project isolated', async () => {
    const g = new MemoryGraph(); const a = add(g, 'a', 'p2'); const b = add(g, 'b', 'p2'); g.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 });
    await new GraphCommunityEngine(g).run('p');
    expect(g.getNeuron(a.id)?.metadata.communityId).toBeUndefined();
  });
});
