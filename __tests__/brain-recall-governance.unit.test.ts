import { describe, expect, test } from 'bun:test';

import { BrainRecall } from '../src/recall/BrainRecall.js';
import type { Neuron, NeuronMetadata, NeuronStatus, NeuronType } from '../src/types/index.js';

function makeNeuron(
  id: string,
  content: string,
  status: NeuronStatus,
  type: NeuronType = 'chat',
  metadata: Partial<NeuronMetadata> = {},
): Neuron {
  return {
    id,
    content,
    prev_hash: '',
    self_hash: id,
    coordinates: { T: 1, S: [0, 0, 0], V: [] },
    synapses: [],
    metadata: {
      projectId: 'project-a',
      topicPath: 'memory/governance',
      type,
      createdAt: 1,
      updatedAt: 1,
      status,
      tags: ['topic:memory/governance'],
      ...metadata,
    },
  };
}

function recallDeps(neurons: Record<string, Neuron>, fullTextIds: string[]) {
  return {
    memoryGraph: {
      fullTextSearch: () => fullTextIds,
      getNeuron: (id: string) => neurons[id] ?? null,
      findNeuronsByType: (
        type: NeuronType,
        options: { projectId?: string; topicPath?: string; limit?: number } = {},
      ) => Object.values(neurons)
        .filter((neuron) => neuron.metadata.type === type)
        .filter((neuron) => !options.projectId || neuron.metadata.projectId === options.projectId)
        .filter((neuron) => !options.topicPath || neuron.metadata.topicPath === options.topicPath)
        .slice(0, options.limit ?? 10),
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
    beliefStore: { getActiveBeliefsForQuery: () => [] },
    cursorStore: { listRecentUnprocessedSources: () => [] },
  } as unknown as ConstructorParameters<typeof BrainRecall>[0];
}

describe('BrainRecall governance filtering', () => {
  test('suppresses archived and suspect neurons before raw evidence budgeting and durable prepend', () => {
    const neurons = {
      archived: makeNeuron('archived', 'memory governance archived stale evidence', 'archived'),
      suspect: makeNeuron('suspect', 'memory governance suspect disputed evidence', 'suspect'),
      active: makeNeuron('active', 'memory governance active evidence', 'active'),
      archivedSemantic: makeNeuron(
        'archived-semantic',
        'memory governance archived semantic consolidation',
        'archived',
        'semantic_consolidation',
      ),
      activePrinciple: makeNeuron(
        'active-principle',
        'memory governance active cross-domain principle',
        'active',
        'cross_domain_principle',
      ),
    };

    const result = new BrainRecall(recallDeps(neurons, ['archived', 'suspect', 'active']))
      .recall('memory governance evidence', {
        projectId: 'project-a',
        topicPath: 'memory/governance',
        limit: 1,
        includeRawEvidence: true,
      });

    const ids = result.rawEvidence.map((neuron) => neuron.id);

    expect(ids).toContain('active');
    expect(ids).toContain('active-principle');
    expect(ids).not.toContain('archived');
    expect(ids).not.toContain('suspect');
    expect(ids).not.toContain('archived-semantic');
    expect(JSON.stringify(result.rawEvidence)).not.toContain('archived stale evidence');
    expect(JSON.stringify(result.rawEvidence)).not.toContain('suspect disputed evidence');
  });

  test('allows suspect raw user utterances as provenance evidence while suppressing suspect agent utterances', () => {
    const neurons = {
      'user-raw': makeNeuron(
        'user-raw',
        'Bluetooth protocol project used BLE device provisioning.',
        'suspect',
        'chat',
        {
          sourceType: 'user_input',
          tags: [
            'topic:memory/governance',
            'reliability:raw_utterance',
            'role:user',
            'record:raw_utterance',
          ],
        },
      ),
      'agent-raw': makeNeuron(
        'agent-raw',
        'Agent inferred Bluetooth provisioning was complete.',
        'suspect',
        'chat',
        {
          sourceType: 'llm_inference',
          tags: [
            'topic:memory/governance',
            'reliability:raw_utterance',
            'role:agent',
            'record:raw_utterance',
          ],
        },
      ),
    };

    const result = new BrainRecall(recallDeps(neurons, ['agent-raw', 'user-raw']))
      .recall('Bluetooth provisioning project', {
        projectId: 'project-a',
        limit: 2,
        includeRawEvidence: true,
      });

    const ids = result.rawEvidence.map((neuron) => neuron.id);

    expect(ids).toContain('user-raw');
    expect(ids).not.toContain('agent-raw');
    expect(JSON.stringify(result.rawEvidence)).not.toContain('provisioning was complete');
  });
});
