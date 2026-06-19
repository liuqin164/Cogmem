import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { BeliefGovernanceService } from '../src/belief/BeliefGovernanceService.js';
import { TemporalMemoryService } from '../src/temporal/TemporalMemoryService.js';

const evidence = new Map([
  ['evt-old', { eventId: 'evt-old', projectId: 'brain', role: 'user' }],
  ['evt-new', { eventId: 'evt-new', projectId: 'brain', role: 'user' }],
]);

describe('temporal memory v1', () => {
  test('returns the belief version valid at a historical point', () => {
    const db = new Database(':memory:');
    const beliefs = new BeliefGovernanceService(db, (eventId) => evidence.get(eventId));
    const temporal = new TemporalMemoryService(db);
    const oldBelief = beliefs.apply({
      projectId: 'brain', ownership: 'project', beliefType: 'decision',
      canonicalKey: 'project:recall-route', statement: 'Vector recall is primary.',
      evidenceEventIds: ['evt-old'], occurredAt: 100,
    });
    const current = beliefs.apply({
      projectId: 'brain', ownership: 'project', beliefType: 'decision',
      canonicalKey: 'project:recall-route', statement: 'Graph recall precedes vector fallback.',
      evidenceEventIds: ['evt-new'], relation: 'correct', reason: 'Architecture changed.', occurredAt: 200,
    });

    expect(temporal.getBeliefAt('brain', 'project:recall-route', 150)?.beliefId).toBe(oldBelief.beliefId);
    expect(temporal.getBeliefAt('brain', 'project:recall-route', 250)?.beliefId).toBe(current.beliefId);
    expect(temporal.getBeliefHistory('brain', 'project:recall-route').map((item) => item.validFrom)).toEqual([100, 200]);
  });

  test('records ordered milestones, decisions, and corrections with evidence', () => {
    const db = new Database(':memory:');
    const temporal = new TemporalMemoryService(db);
    temporal.record({
      projectId: 'brain', entryType: 'milestone', title: 'Graph Recall shipped',
      occurredAt: 100, evidenceEventIds: ['evt-old'], canonicalKey: 'project:release',
    });
    temporal.record({
      projectId: 'brain', entryType: 'correction', title: 'Recall route corrected',
      summary: 'Graph recall now precedes vector fallback.', occurredAt: 200,
      evidenceEventIds: ['evt-new'], canonicalKey: 'project:recall-route', reason: 'User correction',
    });

    const timeline = temporal.list({ projectId: 'brain' });
    expect(timeline.map((item) => item.entryType)).toEqual(['correction', 'milestone']);
    expect(timeline[0]?.reason).toBe('User correction');
    expect(timeline[0]?.evidenceEventIds).toEqual(['evt-new']);
  });

  test('keeps timelines project isolated and supports bounded time windows', () => {
    const db = new Database(':memory:');
    const temporal = new TemporalMemoryService(db);
    temporal.record({ projectId: 'brain', entryType: 'decision', title: 'Brain decision', occurredAt: 100, evidenceEventIds: [] });
    temporal.record({ projectId: 'other', entryType: 'decision', title: 'Other decision', occurredAt: 110, evidenceEventIds: [] });
    temporal.record({ projectId: 'brain', entryType: 'milestone', title: 'Later milestone', occurredAt: 300, evidenceEventIds: [] });

    expect(temporal.list({ projectId: 'brain', startTime: 50, endTime: 200 }).map((item) => item.title)).toEqual(['Brain decision']);
    expect(temporal.list({ projectId: 'other' }).map((item) => item.title)).toEqual(['Other decision']);
  });
});
