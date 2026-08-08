import { describe, expect, test } from 'bun:test';
import { MemoryGraph } from '../src/core/MemoryGraph.js';
import { NeuronFactory } from '../src/core/Neuron.js';
import { TopicSummaryBoard } from '../src/recall/TopicSummaryBoard.js';
import { SummaryStore } from '../src/store/SummaryStore.js';
import type { Neuron } from '../src/types/index.js';

function addNeuron(graph: MemoryGraph, content: string, topicPath = 'memory/governance', projectId = 'project-a', createdAt = Date.now()): Neuron {
  const neuron = NeuronFactory.create(content, graph.getLatestNeuronSelfHash(projectId) || 'genesis', { T: createdAt, S: [0, 0, 0], V: [] }, {
    projectId,
    topicPath,
    type: 'chat',
    createdAt,
    updatedAt: createdAt,
    status: 'active',
    confidence: 1,
    tags: []
  });
  graph.addNeuron(neuron);
  return neuron;
}

function board(graph = new MemoryGraph()): TopicSummaryBoard {
  return new TopicSummaryBoard(graph, new SummaryStore());
}

describe('TopicSummaryBoard', () => {
  test('refresh returns null for empty topic path', () => {
    expect(board().refresh('', 'project-a')).toBeNull();
  });

  test('refresh returns null when topic has no source neurons', () => {
    expect(board().refresh('memory/governance', 'project-a')).toBeNull();
  });

  test('refresh creates a doc summary neuron for a topic', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'memory governance policy');
    const id = board(graph).refresh('memory/governance', 'project-a');
    const summary = graph.getNeuron(id!);
    expect(summary?.metadata.type).toBe('doc');
    expect(summary?.metadata.tags).toContain('topic_summary');
  });

  test('summary neuron keeps the normalized topicPath', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'memory governance policy');
    const id = board(graph).refresh('/memory/governance/', 'project-a');
    expect(graph.getNeuron(id!)?.metadata.topicPath).toBe('memory/governance');
  });

  test('summary content includes coverage count', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'first policy');
    addNeuron(graph, 'second policy');
    const id = board(graph).refresh('memory/governance', 'project-a');
    expect(graph.getNeuron(id!)?.content).toContain('Covers 2 memories.');
  });

  test('refresh does not compile imported summary support into active topic summaries', () => {
    const graph = new MemoryGraph();
    const support = addNeuron(graph, 'legacy imported summary: restart hermes');
    graph.updateNeuronMetadata(support.id, {
      tags: [
        'source_class:daily_memory',
        'provenance:imported_summary',
        'governance:imported_summary_support',
        'memory_layer:summary_seed',
      ],
      sourceType: 'llm_inference'
    });

    expect(board(graph).refresh('memory/governance', 'project-a')).toBeNull();
    expect(graph.getNeuronIdsByTopicPrefix('memory/governance', 'project-a')
      .some((id) => graph.getNeuron(id)?.metadata.tags?.includes('topic_summary'))).toBe(false);
  });

  test('refresh archives existing topic summaries after their sources become non-recallable', () => {
    const graph = new MemoryGraph();
    const source = addNeuron(graph, 'memory governance policy');
    const b = board(graph);
    const id = b.refresh('memory/governance', 'project-a');
    graph.updateNeuronMetadata(source.id, {
      tags: [
        'source_class:daily_memory',
        'provenance:imported_summary',
        'governance:imported_summary_support',
      ],
      sourceType: 'llm_inference'
    });

    expect(b.refresh('memory/governance', 'project-a')).toBeNull();
    expect(graph.getNeuron(id!)?.metadata.status).toBe('archived');
    expect(b.getSummaryNeuron('memory/governance', 'project-a')).toBeNull();
  });

  test('getSummaryNeuron returns latest summary for exact topic', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'runtime topic', 'skills/runtime');
    const b = board(graph);
    b.refresh('skills/runtime', 'project-a');
    expect(b.getSummaryNeuron('skills/runtime', 'project-a')?.metadata.topicPath).toBe('skills/runtime');
  });

  test('getSummaryNeuron does not cross project boundaries', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'project a policy', 'memory/governance', 'project-a');
    const b = board(graph);
    b.refresh('memory/governance', 'project-a');
    expect(b.getSummaryNeuron('memory/governance', 'project-b')).toBeNull();
  });

  test('refresh reuses existing summary neuron when unchanged', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'memory governance policy');
    const b = board(graph);
    const first = b.refresh('memory/governance', 'project-a');
    const second = b.refresh('memory/governance', 'project-a');
    expect(second).toBe(first);
  });

  test('forceRebuild creates an immutable summary revision and preserves both hashes', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'memory governance policy');
    const b = board(graph);
    const first = b.refresh('memory/governance', 'project-a');
    const second = b.refresh('memory/governance', 'project-a', { forceRebuild: true });
    expect(second).not.toBe(first);
    expect(graph.getNeuron(first!)?.metadata.status).toBe('archived');
    expect(graph.getNeuron(second!)?.metadata.tags).toContain(`supersedes:${first}`);
    expect(NeuronFactory.verify(graph.getNeuron(first!)!)).toBe(true);
    expect(NeuronFactory.verify(graph.getNeuron(second!)!)).toBe(true);
    expect(graph.getNeuronIdsByTopicPrefix('memory/governance', 'project-a').filter((id) => graph.getNeuron(id)?.metadata.tags?.includes('topic_summary')).length).toBe(2);
  });

  test('listEntries reports summary metadata', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'memory governance policy');
    const b = board(graph);
    const id = b.refresh('memory/governance', 'project-a');
    expect(b.listEntries('project-a')).toEqual([expect.objectContaining({ topicPath: 'memory/governance', summaryNeuronId: id, coveredNeuronCount: 1 })]);
  });

  test('listEntries omits topics without summaries', () => {
    const graph = new MemoryGraph();
    addNeuron(graph, 'memory governance policy');
    expect(board(graph).listEntries('project-a')).toEqual([]);
  });
});
