import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { MemoryBindingService } from '../src/binding/MemoryBindingService.js';
import { EntityGovernanceService } from '../src/entity/EntityGovernanceService.js';
import { EntityStore } from '../src/store/EntityStore.js';
import { MemoryBindingStore } from '../src/store/MemoryBindingStore.js';

function userEvidence(eventId: string) {
  return { eventId, projectId: 'brain', role: 'user' as const };
}

describe('entity governance v2', () => {
  test('applies and reverses a high-confidence project alias merge without deleting source entities', () => {
    const db = new Database(':memory:');
    const entities = new EntityStore(db);
    const target = entities.upsertEntity({ canonicalName: 'Cogmem', type: 'project', metadata: { projectId: 'brain' } });
    const source = entities.upsertEntity({ canonicalName: 'memory kernel', type: 'project', metadata: { projectId: 'brain' } });
    const service = new EntityGovernanceService(db, entities, userEvidence);

    const candidate = service.proposeMerge({
      projectId: 'brain',
      sourceEntityId: source.entityId,
      targetEntityId: target.entityId,
      alias: 'memory kernel',
      confidence: 0.96,
      evidenceEventIds: ['evt-user'],
    });

    expect(candidate.status).toBe('approved');
    expect(service.apply(candidate.candidateId).status).toBe('applied');
    expect(entities.findByEntityId(source.entityId)?.status).toBe('archived');
    expect(entities.findByAlias('memory kernel', 'project')?.entityId).toBe(target.entityId);

    expect(service.revert(candidate.candidateId).status).toBe('reverted');
    expect(entities.findByEntityId(source.entityId)?.status).toBe('active');
    expect(entities.findByAlias('memory kernel', 'project')?.entityId).toBe(source.entityId);
    entities.close();
  });

  test('keeps person merges pending without explicit user evidence', () => {
    const db = new Database(':memory:');
    const entities = new EntityStore(db);
    const target = entities.upsertEntity({ canonicalName: 'Yang Xiaoning', type: 'person', metadata: { projectId: 'brain' } });
    const source = entities.upsertEntity({ canonicalName: '老婆', type: 'person', metadata: { projectId: 'brain' } });
    const service = new EntityGovernanceService(db, entities, (eventId) => ({ eventId, projectId: 'brain', role: 'assistant' }));

    const candidate = service.proposeMerge({
      projectId: 'brain',
      sourceEntityId: source.entityId,
      targetEntityId: target.entityId,
      alias: '老婆',
      confidence: 0.995,
      evidenceEventIds: ['evt-assistant'],
    });

    expect(candidate.status).toBe('pending');
    expect(candidate.reviewReasons).toContain('person_merge_requires_explicit_user_evidence');
    entities.close();
  });

  test('rejects cross-project merge proposals', () => {
    const db = new Database(':memory:');
    const entities = new EntityStore(db);
    const target = entities.upsertEntity({ canonicalName: 'Atlas', type: 'project', metadata: { projectId: 'a' } });
    const source = entities.upsertEntity({ canonicalName: 'Atlas copy', type: 'project', metadata: { projectId: 'b' } });
    const service = new EntityGovernanceService(db, entities, userEvidence);

    const candidate = service.proposeMerge({
      projectId: 'a',
      sourceEntityId: source.entityId,
      targetEntityId: target.entityId,
      alias: 'Atlas copy',
      confidence: 0.99,
      evidenceEventIds: ['evt-user'],
    });

    expect(candidate.status).toBe('rejected');
    expect(candidate.reviewReasons).toContain('project_boundary_violation');
    entities.close();
  });

  test('binding writes EntityStore-owned entity ids into compatibility projections', () => {
    const db = new Database(':memory:');
    const entities = new EntityStore(db);
    const bindings = new MemoryBindingStore(db);
    const service = new MemoryBindingService(bindings, entities);

    const records = service.bindEvent({
      eventId: 'evt-cogmem',
      projectId: 'brain',
      role: 'user',
      rawEventType: 'message',
      text: 'Cogmem 项目的记忆写入必须关联历史。',
      occurredAt: 10,
    });
    const canonicalOwner = entities.findByCanonicalName('Cogmem', 'project');

    expect(canonicalOwner).not.toBeNull();
    expect(records[0]?.entityId).toBe(canonicalOwner?.entityId);
    expect(bindings.listBindings({ eventId: 'evt-cogmem' })[0]?.entityId).toBe(canonicalOwner?.entityId);
    entities.close();
  });
});
