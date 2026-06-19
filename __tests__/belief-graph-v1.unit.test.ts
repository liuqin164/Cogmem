import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { BeliefGovernanceService } from '../src/belief/BeliefGovernanceService.js';
import { createMemoryKernel } from '../src/factory.js';

const evidence = new Map([
  ['evt-user-1', { eventId: 'evt-user-1', projectId: 'brain', role: 'user' }],
  ['evt-user-2', { eventId: 'evt-user-2', projectId: 'brain', role: 'user' }],
  ['evt-assistant', { eventId: 'evt-assistant', projectId: 'brain', role: 'assistant' }],
  ['evt-tool', { eventId: 'evt-tool', projectId: 'brain', role: 'tool' }],
  ['evt-other', { eventId: 'evt-other', projectId: 'other', role: 'user' }],
]);

function service() {
  return new BeliefGovernanceService(new Database(':memory:'), (eventId) => evidence.get(eventId));
}

describe('belief graph v1', () => {
  test('creates user-owned beliefs only from explicit user evidence', () => {
    const beliefs = service();
    const belief = beliefs.apply({
      projectId: 'brain',
      ownership: 'user',
      beliefType: 'preference',
      canonicalKey: 'user:local-first',
      statement: 'The user prefers local-first systems.',
      evidenceEventIds: ['evt-user-1'],
    });

    expect(belief.status).toBe('active');
    expect(belief.sourceRoles).toEqual(['user']);
    expect(() => beliefs.apply({
      projectId: 'brain',
      ownership: 'user',
      beliefType: 'preference',
      canonicalKey: 'user:cloud-first',
      statement: 'The user prefers cloud-only systems.',
      evidenceEventIds: ['evt-assistant'],
    })).toThrow('user_ownership_requires_user_evidence');
  });

  test('assistant and tool evidence can create project observations but not user facts', () => {
    const beliefs = service();
    const observation = beliefs.apply({
      projectId: 'brain',
      ownership: 'project',
      beliefType: 'observation',
      canonicalKey: 'project:build-state',
      statement: 'The build completed in the observed tool run.',
      evidenceEventIds: ['evt-assistant', 'evt-tool'],
    });

    expect(observation.status).toBe('active');
    expect(observation.sourceRoles).toEqual(['assistant', 'tool']);
  });

  test('reinforces the same belief without duplicating the current node', () => {
    const beliefs = service();
    const first = beliefs.apply({
      projectId: 'brain', ownership: 'user', beliefType: 'boundary',
      canonicalKey: 'user:transient-memory', statement: 'Transient context must not become durable memory.',
      evidenceEventIds: ['evt-user-1'],
    });
    const reinforced = beliefs.apply({
      projectId: 'brain', ownership: 'user', beliefType: 'boundary',
      canonicalKey: 'user:transient-memory', statement: 'Transient context must not become durable memory.',
      evidenceEventIds: ['evt-user-2'], relation: 'reinforce',
    });

    expect(reinforced.beliefId).toBe(first.beliefId);
    expect(reinforced.version).toBe(2);
    expect(reinforced.evidenceEventIds).toEqual(['evt-user-1', 'evt-user-2']);
    expect(beliefs.getCurrent('brain', 'user:transient-memory')).toHaveLength(1);
  });

  test('user correction supersedes the old belief and preserves history', () => {
    const beliefs = service();
    const oldBelief = beliefs.apply({
      projectId: 'brain', ownership: 'user', beliefType: 'decision',
      canonicalKey: 'project:recall-strategy', statement: 'Use vector recall as the primary route.',
      evidenceEventIds: ['evt-user-1'],
    });
    const corrected = beliefs.apply({
      projectId: 'brain', ownership: 'user', beliefType: 'decision',
      canonicalKey: 'project:recall-strategy', statement: 'Use graph recall before vector fallback.',
      evidenceEventIds: ['evt-user-2'], relation: 'correct', reason: 'User changed the architecture decision.',
    });

    expect(corrected.supersedesBeliefId).toBe(oldBelief.beliefId);
    expect(beliefs.getCurrent('brain', 'project:recall-strategy')[0]?.beliefId).toBe(corrected.beliefId);
    const history = beliefs.getHistory('brain', 'project:recall-strategy');
    expect(history.map((item) => item.status)).toEqual(['active', 'superseded']);
    expect(history[1]?.supersededByBeliefId).toBe(corrected.beliefId);
  });

  test('keeps unsupported contradictions pending and enforces project isolation', () => {
    const beliefs = service();
    beliefs.apply({
      projectId: 'brain', ownership: 'project', beliefType: 'fact',
      canonicalKey: 'project:release-state', statement: 'Release is ready.', evidenceEventIds: ['evt-user-1'],
    });
    const conflict = beliefs.apply({
      projectId: 'brain', ownership: 'project', beliefType: 'fact',
      canonicalKey: 'project:release-state', statement: 'Release is not ready.',
      evidenceEventIds: ['evt-assistant'], relation: 'contradict',
    });

    expect(conflict.status).toBe('possible_conflict');
    expect(beliefs.getCurrent('brain', 'project:release-state')).toHaveLength(1);
    expect(() => beliefs.apply({
      projectId: 'brain', ownership: 'project', beliefType: 'fact', canonicalKey: 'bad',
      statement: 'Cross-project claim.', evidenceEventIds: ['evt-other'],
    })).toThrow('project_boundary_violation');
  });

  test('kernel exposes belief governance against Raw Ledger evidence', () => {
    const kernel = createMemoryKernel();
    const event = kernel.recordRawEvent({
      threadId: 'thread-belief', projectId: 'brain', role: 'user',
      content: 'Please remember that local-first is a durable boundary.',
    });
    const belief = kernel.beliefGovernanceService.apply({
      projectId: 'brain', ownership: 'user', beliefType: 'boundary',
      canonicalKey: 'user:local-first-boundary', statement: 'Local-first is a durable user boundary.',
      evidenceEventIds: [event.eventId],
    });

    expect(belief.status).toBe('active');
    expect(belief.evidenceEventIds).toEqual([event.eventId]);
    kernel.close();
  });
});
