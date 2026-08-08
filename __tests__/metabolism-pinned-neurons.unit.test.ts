import { describe, expect, test } from 'bun:test';
import { MemoryGraph } from '../src/core/MemoryGraph.js';
import { Metabolism } from '../src/core/Metabolism.js';
import { NeuronFactory } from '../src/core/Neuron.js';

describe('Metabolism pinned neurons', () => {
  test('synapses and similarity candidates stay inside their exact project', () => {
    const graph = new MemoryGraph(':memory:');
    const make = (content: string, projectId: string) => NeuronFactory.create(content, 'genesis', {
      T: 1, S: [0, 0, 0], V: [1, 0, 0],
    }, {
      type: 'chat', createdAt: 1, status: 'active', stability: 1,
      repetitions: 0, projectId,
    });
    const a = make('a', 'a');
    const b = make('b', 'b');
    graph.addNeuron(a);
    graph.addNeuron(b);

    expect(() => graph.addSynapse(a.id, { targetId: b.id, type: 'Similar', weight: 1 }))
      .toThrow('synapse_project_scope_mismatch');
    expect(graph.findSimilarNeurons([1, 0, 0], 10, 'a').map((item) => item.id)).toEqual([a.id]);
  });

  test('keeps pinned neurons active and restores vector index membership', () => {
    const graph = new MemoryGraph(':memory:');
    const createdAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const neuron = NeuronFactory.create('must stay hot', 'genesis', {
      T: createdAt,
      S: [0, 0, 0],
      V: [0.1, 0.2, 0.3]
    }, {
      type: 'chat',
      createdAt,
      status: 'archived',
      stability: 9999,
      repetitions: 0,
      importanceLevel: 'permanent',
      isPinned: true
    });
    graph.addNeuron(neuron);

    const added: string[] = [];
    const removed: string[] = [];
    const metabolism = new Metabolism(graph, {
      addVector(id: string) { added.push(id); },
      removePoint(id: string) { removed.push(id); },
      search() { return []; }
    });

    (metabolism as any).batchTransitionStates();

    expect(graph.getNeuron(neuron.id)?.metadata.status).toBe('active');
    expect(added).toContain(neuron.id);
    expect(removed).not.toContain(neuron.id);
  });
});
