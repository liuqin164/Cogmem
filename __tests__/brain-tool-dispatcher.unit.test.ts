/**
 * brain-tool-dispatcher.unit.test.ts
 * Unit tests for BrainToolDispatcher and its sub-tools — Phase 48
 */

import { describe, expect, it } from 'bun:test';
import { BrainToolDispatcher, type BrainToolDispatcherDeps } from '../src/routing/BrainToolDispatcher.js';
import type { BrainToolCall } from '../src/routing/LLMToolSchema.js';
import type { BrainRecallResult } from '../src/recall/BrainRecall.js';
import type { FactRecord, EventRecord } from '../src/store/FactStore.js';
import type { EntityRecord } from '../src/store/EntityStore.js';
import type { BeliefRecord, Neuron } from '../src/types/index.js';

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeRecallResult(facts: FactRecord[] = [], events: EventRecord[] = []): BrainRecallResult {
  return {
    query: 'test',
    strategy: { primaryLevel: 'compiled_memory', fallbackUsed: false },
    compiledMemory: { beliefs: [], facts, events, entityTimeline: [] },
    rawEvidence: [],
    fallbackSnippets: [],
    profileSignals: [],
    profileSurface: { userProfile: [], agentPersona: [] },
  };
}

function makeFactRecord(id: string, neuronId = 'nrn-1'): FactRecord {
  return {
    factId: id,
    neuronId,
    unitId: 'unit-1',
    subject: 'Alice',
    predicateFamily: 'preference',
    predicateValue: 'likes',
    object: 'coffee',
    confidence: 0.9,
    status: 'verified',
    certaintyLevel: 'certain',
    sourceText: 'test source',
    validFrom: Date.now(),
    entityId: 'ent-alice',
  };
}

function makeEventRecord(id: string): EventRecord {
  return {
    eventId: id,
    neuronId: 'nrn-1',
    unitId: 'unit-1',
    eventType: 'observation',
    actor: 'user',
    target: '',
    payload: {},
    validFrom: Date.now(),
    confidence: 0.9,
    status: 'verified',
  };
}

function makeEntityRecord(id: string, name: string): EntityRecord {
  return {
    entityId: id,
    canonicalName: name,
    type: 'person',
    aliases: [],
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeNeuron(id: string, content = 'test content'): Neuron {
  return {
    id,
    content,
    prev_hash: 'abc',
    self_hash: 'def',
    coordinates: { T: Date.now(), S: [0, 0, 0], V: [] },
    synapses: [],
    metadata: {
      type: 'chat',
      createdAt: Date.now(),
      tags: ['test'],
      projectId: 'proj-1',
    },
  };
}

// ---------------------------------------------------------------------------
// Mock dep builders
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<BrainToolDispatcherDeps> = {}): BrainToolDispatcherDeps {
  return {
    recallFn: (_q, _o) => makeRecallResult(),
    memoryGraph: {
      getNeuron: (_id: string) => null,
    } as unknown as BrainToolDispatcherDeps['memoryGraph'],
    factStore: {
      listFactsByEntityIds: (_ids: string[], _opts?: unknown) => [],
      listEventsByNeuronIds: (_ids: string[], _limit?: number) => [],
    } as unknown as BrainToolDispatcherDeps['factStore'],
    entityStore: {
      findByCanonicalName: (_name: string, _type?: string) => null,
      findByAlias: (_alias: string, _type?: string) => null,
    } as unknown as BrainToolDispatcherDeps['entityStore'],
    beliefStore: {
      getActiveBeliefsForQuery: (_input: unknown) => [],
    } as unknown as BrainToolDispatcherDeps['beliefStore'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// brain_recall
// ---------------------------------------------------------------------------

describe('BrainToolDispatcher — brain_recall', () => {
  it('dispatches brain_recall and returns success with facts/events', async () => {
    const facts = [makeFactRecord('f1'), makeFactRecord('f2')];
    const events = [makeEventRecord('e1')];
    const deps = makeDeps({
      recallFn: (_q, _o) => makeRecallResult(facts, events),
    });
    const dispatcher = new BrainToolDispatcher(deps);
    const call: BrainToolCall = { action: 'brain_recall', query: '蓝牙耳机' };

    const result = await dispatcher.dispatch(call);

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('brain_recall');
    expect(result.callId).toBeTruthy();
    expect(typeof result.durationMs).toBe('number');
    const output = result.result as { facts: FactRecord[]; events: EventRecord[] };
    expect(output.facts).toHaveLength(2);
    expect(output.events).toHaveLength(1);
  });

  it('returns error when query is missing', async () => {
    const dispatcher = new BrainToolDispatcher(makeDeps());
    const call = { action: 'brain_recall' } as BrainToolCall;

    const result = await dispatcher.dispatch(call);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });

  it('respects entity_hint option', async () => {
    let capturedOpts: unknown;
    const deps = makeDeps({
      recallFn: (_q, opts) => { capturedOpts = opts; return makeRecallResult(); },
    });
    const dispatcher = new BrainToolDispatcher(deps);
    await dispatcher.dispatch({ action: 'brain_recall', query: 'test', entity_hint: 'Alice' });

    expect((capturedOpts as { entityHint?: string }).entityHint).toBe('Alice');
  });

  it('each call gets a unique callId', async () => {
    const dispatcher = new BrainToolDispatcher(makeDeps());
    const r1 = await dispatcher.dispatch({ action: 'brain_recall', query: 'q1' });
    const r2 = await dispatcher.dispatch({ action: 'brain_recall', query: 'q2' });
    expect(r1.callId).not.toBe(r2.callId);
  });
});

// ---------------------------------------------------------------------------
// get_neuron_context
// ---------------------------------------------------------------------------

describe('BrainToolDispatcher — get_neuron_context', () => {
  it('returns neuron content and neighbors when neuron exists', async () => {
    const neuron = makeNeuron('nrn-001', 'This is the full neuron content');
    const deps = makeDeps({
      memoryGraph: {
        getNeuron: (id: string) => (id === 'nrn-001' ? neuron : null),
      } as unknown as BrainToolDispatcherDeps['memoryGraph'],
    });
    const dispatcher = new BrainToolDispatcher(deps);
    const result = await dispatcher.dispatch({
      action: 'get_neuron_context',
      neuron_id: 'nrn-001',
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('get_neuron_context');
    const output = result.result as { neuron: { neuronId: string; content: string } };
    expect(output.neuron.neuronId).toBe('nrn-001');
    expect(output.neuron.content).toBe('This is the full neuron content');
  });

  it('returns success:false when neuron does not exist', async () => {
    const dispatcher = new BrainToolDispatcher(makeDeps());
    const result = await dispatcher.dispatch({
      action: 'get_neuron_context',
      neuron_id: 'nrn-does-not-exist',
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('not found');
  });

  it('returns error when neuron_id is missing', async () => {
    const dispatcher = new BrainToolDispatcher(makeDeps());
    const call = { action: 'get_neuron_context' } as BrainToolCall;
    const result = await dispatcher.dispatch(call);
    expect(result.success).toBe(false);
  });

  it('truncates content longer than 2000 chars (SI-16)', async () => {
    const longContent = 'x'.repeat(3000);
    const neuron = makeNeuron('nrn-long', longContent);
    const deps = makeDeps({
      memoryGraph: {
        getNeuron: (id: string) => (id === 'nrn-long' ? neuron : null),
      } as unknown as BrainToolDispatcherDeps['memoryGraph'],
    });
    const dispatcher = new BrainToolDispatcher(deps);
    const result = await dispatcher.dispatch({ action: 'get_neuron_context', neuron_id: 'nrn-long' });
    const output = result.result as { neuron: { content: string } };
    expect(output.neuron.content.length).toBe(2000);
  });

  it('includes synapse-linked neighbors', async () => {
    const neighbor = makeNeuron('nrn-neighbor', 'neighbor content');
    const neuron = { ...makeNeuron('nrn-root'), synapses: [{ targetId: 'nrn-neighbor', type: 'Similar' as const, weight: 1 }] };
    const deps = makeDeps({
      memoryGraph: {
        getNeuron: (id: string) => {
          if (id === 'nrn-root') return neuron;
          if (id === 'nrn-neighbor') return neighbor;
          return null;
        },
      } as unknown as BrainToolDispatcherDeps['memoryGraph'],
    });
    const dispatcher = new BrainToolDispatcher(deps);
    const result = await dispatcher.dispatch({ action: 'get_neuron_context', neuron_id: 'nrn-root' });
    const output = result.result as { neighbors: Array<{ neuronId: string }> };
    expect(output.neighbors.some((n) => n.neuronId === 'nrn-neighbor')).toBe(true);
  });

  it('rejects direct neuron IDs outside named and projectless scopes', async () => {
    const neuron = makeNeuron('nrn-private');
    const dispatcher = new BrainToolDispatcher(makeDeps({
      memoryGraph: { getNeuron: () => neuron } as unknown as BrainToolDispatcherDeps['memoryGraph'],
    }));
    expect((await dispatcher.dispatch({ action: 'get_neuron_context', neuron_id: neuron.id }, { projectId: 'other' })).success).toBe(false);
    expect((await dispatcher.dispatch({ action: 'get_neuron_context', neuron_id: neuron.id }, { projectId: '' })).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// expand_entity
// ---------------------------------------------------------------------------

describe('BrainToolDispatcher — expand_entity', () => {
  it('returns entity profile when entity exists', async () => {
    const entity = makeEntityRecord('ent-alice', 'Alice');
    const facts = [makeFactRecord('f1'), makeFactRecord('f2')];
    const deps = makeDeps({
      entityStore: {
        findByCanonicalName: (name: string) => name === 'Alice' ? entity : null,
        findByAlias: () => null,
      } as unknown as BrainToolDispatcherDeps['entityStore'],
      factStore: {
        listFactsByEntityIds: () => facts,
        listEventsByNeuronIds: () => [],
      } as unknown as BrainToolDispatcherDeps['factStore'],
    });
    const dispatcher = new BrainToolDispatcher(deps);
    const result = await dispatcher.dispatch({ action: 'expand_entity', entity_name: 'Alice' });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('expand_entity');
    const output = result.result as { entityId: string; canonicalName: string; facts: FactRecord[] };
    expect(output.entityId).toBe('ent-alice');
    expect(output.canonicalName).toBe('Alice');
    expect(output.facts).toHaveLength(2);
  });

  it('keeps store-validated facts and events for an explicit project', async () => {
    const entity = makeEntityRecord('ent-a', 'Alice');
    const fact = makeFactRecord('f-a');
    const event = makeEventRecord('e-a');
    const deps = makeDeps({
      entityStore: {
        findByCanonicalName: () => entity,
        findByAlias: () => null,
      } as unknown as BrainToolDispatcherDeps['entityStore'],
      factStore: {
        listFactsByEntityIds: (_ids: string[], options: { projectId?: string }) => options.projectId === 'a' ? [fact] : [],
        listEventsByNeuronIds: (_ids: string[], _limit: number, projectId?: string) => projectId === 'a' ? [event] : [],
      } as unknown as BrainToolDispatcherDeps['factStore'],
    });
    const result = await new BrainToolDispatcher(deps).dispatch(
      { action: 'expand_entity', entity_name: 'Alice' },
      { projectId: 'a' },
    );
    const output = result.result as { facts: FactRecord[]; events: EventRecord[] };
    expect(output.facts).toEqual([fact]);
    expect(output.events).toEqual([event]);
  });

  it('falls back to alias lookup when canonical name not found', async () => {
    const entity = makeEntityRecord('ent-bob', 'Robert');
    const deps = makeDeps({
      entityStore: {
        findByCanonicalName: () => null,
        findByAlias: (alias: string) => alias === 'Bob' ? entity : null,
      } as unknown as BrainToolDispatcherDeps['entityStore'],
      factStore: {
        listFactsByEntityIds: () => [],
        listEventsByNeuronIds: () => [],
      } as unknown as BrainToolDispatcherDeps['factStore'],
    });
    const dispatcher = new BrainToolDispatcher(deps);
    const result = await dispatcher.dispatch({ action: 'expand_entity', entity_name: 'Bob' });

    expect(result.success).toBe(true);
    const output = result.result as { entityId: string };
    expect(output.entityId).toBe('ent-bob');
  });

  it('returns success:false when entity not found', async () => {
    const dispatcher = new BrainToolDispatcher(makeDeps());
    const result = await dispatcher.dispatch({ action: 'expand_entity', entity_name: 'Unknown Entity' });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('not found');
  });

  it('returns error when entity_name is missing', async () => {
    const dispatcher = new BrainToolDispatcher(makeDeps());
    const call = { action: 'expand_entity' } as BrainToolCall;
    const result = await dispatcher.dispatch(call);
    expect(result.success).toBe(false);
  });

  it('caps facts at 20 (SI-16)', async () => {
    const entity = makeEntityRecord('ent-alice', 'Alice');
    const manyFacts = Array.from({ length: 30 }, (_, i) => makeFactRecord(`f${i}`));
    const deps = makeDeps({
      entityStore: {
        findByCanonicalName: () => entity,
        findByAlias: () => null,
      } as unknown as BrainToolDispatcherDeps['entityStore'],
      factStore: {
        listFactsByEntityIds: () => manyFacts,
        listEventsByNeuronIds: () => [],
      } as unknown as BrainToolDispatcherDeps['factStore'],
    });
    const dispatcher = new BrainToolDispatcher(deps);
    const result = await dispatcher.dispatch({ action: 'expand_entity', entity_name: 'Alice' });
    const output = result.result as { facts: FactRecord[] };
    expect(output.facts.length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// Unknown action
// ---------------------------------------------------------------------------

describe('BrainToolDispatcher — unknown action', () => {
  it('returns success:false for an unknown action', async () => {
    const dispatcher = new BrainToolDispatcher(makeDeps());
    const call = { action: 'delete_everything' } as unknown as BrainToolCall;
    const result = await dispatcher.dispatch(call);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });
});
