import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { PipelineMetrics } from '../src/engine/PipelineMetrics.js';
import { GraphCommunityEngine } from '../src/engine/GraphCommunityEngine.js';
import { OfflineConsolidationPipeline } from '../src/engine/OfflineConsolidationPipeline.js';
import { WorkingMemoryDelta } from '../src/engine/WorkingMemoryDelta.js';
import { MemoryGraph } from '../src/core/MemoryGraph.js';
import { NeuronFactory } from '../src/core/Neuron.js';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function add(graph: MemoryGraph, content: string, updatedAt = Date.now(), projectId = 'p') {
  const neuron = NeuronFactory.create(content, graph.getLatestNeuronSelfHash(projectId) || 'genesis', { T: updatedAt, S: [0, 0, 0], V: [] }, {
    projectId, type: 'chat', createdAt: updatedAt, updatedAt, status: 'active', tags: ['g'], importanceLevel: 'normal'
  });
  graph.addNeuron(neuron);
  return neuron;
}

describe('PipelineMetrics', () => {
  test('record writes and p99 reads', () => {
    const metrics = new PipelineMetrics(new Database(':memory:'));
    metrics.record('r1', [{ stepName: 'a', durationMs: 10, completedAt: 1 }], 10, false);
    expect(metrics.getPipelineP99()).toBe(10);
  });
  test('p99 uses recentN records', () => {
    const metrics = new PipelineMetrics(new Database(':memory:'));
    metrics.record('r1', [], 1, false); metrics.record('r2', [], 100, false);
    expect(metrics.getPipelineP99(2)).toBe(100);
  });
  test('step averages are grouped by name', () => {
    const metrics = new PipelineMetrics(new Database(':memory:'));
    metrics.record('r1', [{ stepName: 'a', durationMs: 10, completedAt: 1 }], 10, false);
    metrics.record('r2', [{ stepName: 'a', durationMs: 20, completedAt: 2 }], 20, false);
    expect(metrics.getStepAverages().a).toBe(15);
  });
  test('cleanup removes old rows', () => {
    const db = new Database(':memory:'); const metrics = new PipelineMetrics(db);
    metrics.record('r1', [], 10, false);
    db.prepare('UPDATE pipeline_runs SET completed_at = 1').run();
    metrics.cleanup(1);
    expect(metrics.getPipelineP99()).toBe(0);
  });
  test('aborted runs are included in p99', () => {
    const metrics = new PipelineMetrics(new Database(':memory:'));
    metrics.record('r1', [], 30, true);
    expect(metrics.getPipelineP99()).toBe(30);
  });
});

describe('GraphCommunityEngine incremental hardening', () => {
  test('incremental window skips old isolated neurons', async () => {
    const g = new MemoryGraph(); const old = add(g, 'old', Date.now() - 10 * 24 * 60 * 60 * 1000);
    await new GraphCommunityEngine(g, { incrementalWindowMs: -1 }).run('p');
    expect(g.getNeuron(old.id)?.metadata.communityId).toBeUndefined();
  });
  test('incremental window processes recent neurons', async () => {
    const g = new MemoryGraph(); const a = add(g, 'a'); const b = add(g, 'b'); g.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 });
    await new GraphCommunityEngine(g, { incrementalWindowMs: 60_000 }).run('p');
    expect(g.getNeuron(a.id)?.metadata.communityId).toBeTruthy();
  });
  test('incrementalWindowMs zero forces full graph recompute', async () => {
    const g = new MemoryGraph(); const old = add(g, 'old', Date.now() - 10 * 24 * 60 * 60 * 1000);
    await new GraphCommunityEngine(g, { incrementalWindowMs: 0 }).run('p');
    expect(g.getNeuron(old.id)?.metadata.communityId).toBeTruthy();
  });
  test('unchanged outside-window communityId is preserved', async () => {
    const g = new MemoryGraph(); const old = add(g, 'old', Date.now() - 10_000_000); g.updateNeuronMetadata(old.id, { communityId: 'stable' });
    await new GraphCommunityEngine(g, { incrementalWindowMs: -1 }).run('p');
    expect(g.getNeuron(old.id)?.metadata.communityId).toBe('stable');
  });
  test('project isolation still applies in incremental mode', async () => {
    const g = new MemoryGraph(); const n = add(g, 'other', Date.now(), 'p2');
    await new GraphCommunityEngine(g, { incrementalWindowMs: 60_000 }).run('p');
    expect(g.getNeuron(n.id)?.metadata.communityId).toBeUndefined();
  });
});

describe('OfflineConsolidationPipeline checkpoints', () => {
  test('writes checkpoint after budget abort and resumes from next step', async () => {
    const db = new Database(':memory:');
    const metrics = new PipelineMetrics(db);
    let memoryRuns = 0;
    let proceduralRuns = 0;
    const input = { rawEpisodes: [], window: { projectId: 'p' } };
    const first = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      maxBudgetMs: 1,
      memoryConsolidationEngine: { run: async () => { memoryRuns += 1; await Bun.sleep(3); } } as never,
      proceduralLearningBridge: { scan: async () => { proceduralRuns += 1; } } as never
    });

    await (first as any).refreshTopicMaintenance(input);
    expect((db.prepare(`SELECT nextStep FROM pipeline_checkpoints WHERE projectId = ?`).get('p') as { nextStep: string }).nextStep).toBe('ProceduralLearningBridge');

    const second = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      maxBudgetMs: 0,
      memoryConsolidationEngine: { run: async () => { memoryRuns += 1; } } as never,
      proceduralLearningBridge: { scan: async () => { proceduralRuns += 1; } } as never
    });
    await (second as any).refreshTopicMaintenance(input);

    expect(memoryRuns).toBe(1);
    expect(proceduralRuns).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM pipeline_checkpoints`).get()).toEqual({ count: 0 });
  });

  test('expired checkpoint is discarded', async () => {
    const db = new Database(':memory:');
    const metrics = new PipelineMetrics(db);
    db.exec(`CREATE TABLE pipeline_checkpoints (projectId TEXT NOT NULL PRIMARY KEY, nextStep TEXT NOT NULL, savedAt INTEGER NOT NULL)`);
    db.prepare(`INSERT INTO pipeline_checkpoints VALUES (?, ?, ?)`).run('p', 'GraphCommunityEngine', 1);
    let memoryRuns = 0;
    const pipeline = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      checkpointExpiryMs: 1,
      maxBudgetMs: 0,
      memoryConsolidationEngine: { run: async () => { memoryRuns += 1; } } as never
    });

    await (pipeline as any).refreshTopicMaintenance({ rawEpisodes: [], window: { projectId: 'p' } });

    expect(memoryRuns).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM pipeline_checkpoints`).get()).toEqual({ count: 0 });
  });

  test('checkpoint writes aborted pipeline metrics in the same pass', async () => {
    const db = new Database(':memory:');
    const metrics = new PipelineMetrics(db);
    const pipeline = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      maxBudgetMs: 1,
      memoryConsolidationEngine: { run: async () => { await Bun.sleep(3); } } as never
    });

    await (pipeline as any).refreshTopicMaintenance({ rawEpisodes: [], window: { projectId: 'p' } });

    expect(db.prepare(`SELECT aborted FROM pipeline_runs`).get()).toEqual({ aborted: 1 });
    expect(db.prepare(`SELECT nextStep FROM pipeline_checkpoints WHERE projectId = ?`).get('p')).toEqual({ nextStep: 'ProceduralLearningBridge' });
  });

  test('missing project id records metrics without writing a checkpoint', async () => {
    const db = new Database(':memory:');
    const metrics = new PipelineMetrics(db);
    const pipeline = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      maxBudgetMs: 1,
      memoryConsolidationEngine: { run: async () => { await Bun.sleep(3); } } as never
    });

    await (pipeline as any).refreshTopicMaintenance({ rawEpisodes: [], window: {} });

    expect(db.prepare(`SELECT COUNT(*) AS count FROM pipeline_runs`).get()).toEqual({ count: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM pipeline_checkpoints`).get()).toEqual({ count: 0 });
  });

  test('unknown checkpoint step falls back to the first step and clears on completion', async () => {
    const db = new Database(':memory:');
    const metrics = new PipelineMetrics(db);
    db.exec(`CREATE TABLE pipeline_checkpoints (projectId TEXT NOT NULL PRIMARY KEY, nextStep TEXT NOT NULL, savedAt INTEGER NOT NULL)`);
    db.prepare(`INSERT INTO pipeline_checkpoints VALUES (?, ?, ?)`).run('p', 'MissingStep', Date.now());
    let memoryRuns = 0;
    const pipeline = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      maxBudgetMs: 0,
      memoryConsolidationEngine: { run: async () => { memoryRuns += 1; } } as never
    });

    await (pipeline as any).refreshTopicMaintenance({ rawEpisodes: [], window: { projectId: 'p' } });

    expect(memoryRuns).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM pipeline_checkpoints`).get()).toEqual({ count: 0 });
  });

  test('resumes from a graph-community checkpoint without rerunning earlier engines', async () => {
    const db = new Database(':memory:');
    const metrics = new PipelineMetrics(db);
    db.exec(`CREATE TABLE pipeline_checkpoints (projectId TEXT NOT NULL PRIMARY KEY, nextStep TEXT NOT NULL, savedAt INTEGER NOT NULL)`);
    db.prepare(`INSERT INTO pipeline_checkpoints VALUES (?, ?, ?)`).run('p', 'GraphCommunityEngine', Date.now());
    let memoryRuns = 0;
    let graphRuns = 0;
    const pipeline = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      maxBudgetMs: 0,
      memoryConsolidationEngine: { run: async () => { memoryRuns += 1; } } as never,
      graphCommunityEngine: { run: async () => { graphRuns += 1; } } as never
    });

    await (pipeline as any).refreshTopicMaintenance({ rawEpisodes: [], window: { projectId: 'p' } });

    expect(memoryRuns).toBe(0);
    expect(graphRuns).toBe(1);
  });

  test('records executed maintenance step timings by step name', async () => {
    const db = new Database(':memory:');
    const metrics = new PipelineMetrics(db);
    const pipeline = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      maxBudgetMs: 0,
      proceduralLearningBridge: { scan: async () => {} } as never,
      crossTopicSynthesizer: { run: async () => {} } as never
    });

    await (pipeline as any).refreshTopicMaintenance({ rawEpisodes: [], window: { projectId: 'p' } });

    const steps = db.prepare(`SELECT step_name FROM pipeline_step_timings ORDER BY step_name`).all() as Array<{ step_name: string }>;
    expect(steps.map((row) => row.step_name)).toContain('ProceduralLearningBridge');
    expect(steps.map((row) => row.step_name)).toContain('CrossTopicSynthesizer');
  });

  test('projectless scope runs every project maintenance stage with the empty-string scope', async () => {
    const db = new Database(':memory:');
    const calls: string[] = [];
    const pipeline = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: new PipelineMetrics(db),
      maxBudgetMs: 0,
      memoryConsolidationEngine: { run: async (projectId: string) => { calls.push(`memory:${projectId}`); } } as never,
      proceduralLearningBridge: { scan: async (projectId: string) => { calls.push(`procedural:${projectId}`); } } as never,
      crossTopicSynthesizer: { run: async (projectId: string) => { calls.push(`cross-topic:${projectId}`); } } as never,
      principleDecayPolicy: { run: async (projectId: string) => { calls.push(`principle:${projectId}`); } } as never,
      graphCommunityEngine: { run: async (projectId: string) => { calls.push(`community:${projectId}`); } } as never,
    });

    await (pipeline as any).refreshTopicMaintenance({ rawEpisodes: [], window: { projectId: '' } });

    expect(calls).toEqual(['memory:', 'procedural:', 'cross-topic:', 'principle:', 'community:']);
  });
});

describe('WorkingMemoryDelta cleanup', () => {
  test('deletes expired consumed deltas and keeps fresh rows', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-delta-')), 'brain.db');
    const db = new Database(dbPath);
    const graph = new MemoryGraph(dbPath);
    const delta = new WorkingMemoryDelta(db, graph);
    const neuron = add(graph, 'consumed');
    delta.append({ deltaId: 'old', neuronId: neuron.id, createdAt: 1, consumed: true });
    delta.append({ deltaId: 'fresh', neuronId: neuron.id, createdAt: Date.now() + 60_000, consumed: true });

    expect(delta.cleanup(1).deleted).toBe(1);
    expect(db.prepare(`SELECT delta_id FROM working_memory_deltas`).all()).toEqual([{ delta_id: 'fresh' }]);
  });

  test('keeps expired missing unconsumed deltas for in-flight writes', () => {
    const db = new Database(':memory:');
    const graph = new MemoryGraph();
    const delta = new WorkingMemoryDelta(db, graph);
    delta.append({ deltaId: 'pending', neuronId: 'missing', createdAt: 1, consumed: false });

    expect(delta.cleanup(1).deleted).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM working_memory_deltas`).get()).toEqual({ count: 1 });
  });

  test('deletes expired existing unconsumed deltas after neuron is durable', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-delta-')), 'brain.db');
    const db = new Database(dbPath);
    const graph = new MemoryGraph(dbPath);
    const delta = new WorkingMemoryDelta(db, graph);
    const neuron = add(graph, 'durable');
    delta.append({ deltaId: 'old', neuronId: neuron.id, createdAt: 1, consumed: false });

    expect(delta.cleanup(1).deleted).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM working_memory_deltas`).get()).toEqual({ count: 0 });
  });

  test('markConsumed allows expired missing deltas to be deleted', () => {
    const db = new Database(':memory:');
    const graph = new MemoryGraph();
    const delta = new WorkingMemoryDelta(db, graph);
    delta.append({ deltaId: 'pending', neuronId: 'missing', createdAt: 1, consumed: false });
    delta.markConsumed('pending');

    expect(delta.cleanup(1).deleted).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM working_memory_deltas`).get()).toEqual({ count: 0 });
  });

  test('cleanup is idempotent after expired rows are removed', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-delta-')), 'brain.db');
    const db = new Database(dbPath);
    const graph = new MemoryGraph(dbPath);
    const delta = new WorkingMemoryDelta(db, graph);
    const neuron = add(graph, 'consumed');
    delta.append({ deltaId: 'old', neuronId: neuron.id, createdAt: 1, consumed: true });

    expect(delta.cleanup(1).deleted).toBe(1);
    expect(delta.cleanup(1).deleted).toBe(0);
  });

  test('pipeline invokes working memory delta cleanup as the final unbudgeted step', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-delta-')), 'brain.db');
    const db = new Database(dbPath);
    const graph = new MemoryGraph(dbPath);
    const delta = new WorkingMemoryDelta(db, graph);
    const metrics = new PipelineMetrics(db);
    const neuron = add(graph, 'consumed');
    delta.append({ deltaId: 'old', neuronId: neuron.id, createdAt: 1, consumed: true });
    const pipeline = new OfflineConsolidationPipeline({
      db,
      pipelineMetrics: metrics,
      maxBudgetMs: 0,
      workingMemoryDelta: delta
    });

    await (pipeline as any).refreshTopicMaintenance({ rawEpisodes: [], window: { projectId: 'p' } });

    expect(db.prepare(`SELECT COUNT(*) AS count FROM working_memory_deltas`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT step_name FROM pipeline_step_timings WHERE step_name = ?`).get('WorkingMemoryDeltaCleanup')).toEqual({ step_name: 'WorkingMemoryDeltaCleanup' });
  });
});
