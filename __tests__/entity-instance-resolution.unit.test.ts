// @ts-nocheck
import { describe, expect, it } from 'bun:test';
import {
  EntityInstanceDecisionSignal,
  PendingEntityFallbackStrategy,
  STRONG_NEW_SIGNAL_PHRASES,
  STRONG_UPDATE_SIGNAL_PHRASES,
  decideEntityInstanceResolution
} from '../src/engine/EntityResolutionEngine.js';
import { EntityStore } from '../src/store/EntityStore.js';
import { entityReferenceSamplesZh } from './fixtures/entityReferenceSamples.zh.js';
import { entityReferenceSamplesEn } from './fixtures/entityReferenceSamples.en.js';

describe('Entity instance resolution unit', () => {
  const bilingualCases = [
    {
      label: 'zh',
      samples: entityReferenceSamplesZh,
      entities: {
        firstName: '旧耳机',
        secondName: '新耳机',
        firstAliases: [entityReferenceSamplesZh.aliases.previous],
        secondAliases: [entityReferenceSamplesZh.aliases.latest, entityReferenceSamplesZh.aliases.genericLatest]
      }
    },
    {
      label: 'en',
      samples: entityReferenceSamplesEn,
      entities: {
        firstName: 'old-headset',
        secondName: 'new-headset',
        firstAliases: [entityReferenceSamplesEn.aliases.previous],
        secondAliases: [entityReferenceSamplesEn.aliases.latest, entityReferenceSamplesEn.aliases.genericLatest]
      }
    }
  ] as const;

  for (const testCase of bilingualCases) {
    it(`codes strong new-instance signals as explicit constants for ${testCase.label}`, () => {
      expect(STRONG_NEW_SIGNAL_PHRASES.some((phrase) => testCase.samples.strongNewSignal.toLowerCase().includes(phrase.toLowerCase()))).toBe(true);

      const decision = decideEntityInstanceResolution(testCase.samples.strongNewSignal);

      expect(decision.signal).toBe(EntityInstanceDecisionSignal.STRONG_NEW_SIGNAL);
      expect(decision.fallback).toBe(PendingEntityFallbackStrategy.ASSUME_NEW);
      expect(decision.shouldCreatePending).toBe(false);
    });

    it(`codes strong update signals as explicit constants and resolves prior/latest instances independently for ${testCase.label}`, () => {
      const store = new EntityStore(':memory:');
      const first = store.upsertEntity({
        canonicalName: testCase.entities.firstName,
        type: 'device',
        aliases: testCase.entities.firstAliases,
        metadata: { projectId: `entity-unit-${testCase.label}` },
        instanceMode: 'new_instance',
        createdAt: 1
      });
      const second = store.upsertEntity({
        canonicalName: testCase.entities.secondName,
        type: 'device',
        aliases: testCase.entities.secondAliases,
        metadata: { projectId: `entity-unit-${testCase.label}` },
        instanceMode: 'new_instance',
        createdAt: 2
      });
      store.recordMention({ entityId: first.entityId, projectId: `entity-unit-${testCase.label}`, mentionType: 'declared', createdAt: 1 });
      store.recordMention({ entityId: second.entityId, projectId: `entity-unit-${testCase.label}`, mentionType: 'declared', createdAt: 2 });

      const decision = decideEntityInstanceResolution(testCase.samples.strongUpdateSignal);

      expect(STRONG_UPDATE_SIGNAL_PHRASES.some((phrase) => testCase.samples.strongUpdateSignal.toLowerCase().includes(phrase.toLowerCase()))).toBe(true);
      expect(decision.signal).toBe(EntityInstanceDecisionSignal.STRONG_UPDATE_SIGNAL);
      expect(decision.fallback).toBe(PendingEntityFallbackStrategy.ASSUME_LATEST);
      expect(store.resolveReference(testCase.samples.aliases.previous, 'device', { projectId: `entity-unit-${testCase.label}` })?.entityId).toBe(first.entityId);
      expect(store.resolveReference(testCase.samples.aliases.latest, 'device', { projectId: `entity-unit-${testCase.label}` })?.entityId).toBe(second.entityId);

      store.close();
    });
  }

  it('routes ambiguous mentions into pending with an explicit STAY_PENDING fallback', () => {
    const store = new EntityStore(':memory:');
    const decision = decideEntityInstanceResolution(entityReferenceSamplesZh.ambiguousReference);
    const pending = store.registerPendingResolution({
      referenceText: entityReferenceSamplesZh.ambiguousReference,
      entityType: 'device',
      contextNeuronId: 'n-1',
      createdAt: 10
    });

    expect(decision.signal).toBe(EntityInstanceDecisionSignal.AMBIGUOUS);
    expect(decision.fallback).toBe(PendingEntityFallbackStrategy.STAY_PENDING);
    expect(decision.shouldCreatePending).toBe(true);
    expect(pending.status).toBe('pending');
    expect(pending.referenceText).toBe(entityReferenceSamplesZh.ambiguousReference);

    store.close();
  });

  for (const testCase of [
    { label: 'zh', samples: entityReferenceSamplesZh },
    { label: 'en', samples: entityReferenceSamplesEn }
  ] as const) {
    it(`handles self-corrections by promoting the corrected strong signal for ${testCase.label}`, () => {
      const decision = decideEntityInstanceResolution(testCase.samples.selfCorrection);

      expect(decision.signal).toBe(EntityInstanceDecisionSignal.STRONG_NEW_SIGNAL);
      expect(decision.fallback).toBe(PendingEntityFallbackStrategy.ASSUME_NEW);
      expect(decision.matchedSignal).toBeTruthy();
    });

    it(`keeps multiple same-type instances coexisting without relying on fixture order for ${testCase.label}`, () => {
      const store = new EntityStore(':memory:');
      const alpha = store.upsertEntity({
        canonicalName: `device-a-${testCase.label}`,
        type: 'device',
        aliases: [testCase.samples.aliases.genericLatest],
        metadata: { projectId: `entity-multi-${testCase.label}` },
        instanceMode: 'new_instance',
        createdAt: 100
      });
      const beta = store.upsertEntity({
        canonicalName: `device-b-${testCase.label}`,
        type: 'device',
        aliases: [testCase.samples.aliases.genericLatest, testCase.samples.aliases.latest],
        metadata: { projectId: `entity-multi-${testCase.label}` },
        instanceMode: 'new_instance',
        createdAt: 200
      });
      store.recordMention({ entityId: alpha.entityId, projectId: `entity-multi-${testCase.label}`, mentionType: 'declared', createdAt: 100 });
      store.recordMention({ entityId: beta.entityId, projectId: `entity-multi-${testCase.label}`, mentionType: 'declared', createdAt: 200 });

      const latest = store.resolveReference(testCase.samples.aliases.genericLatest, 'device', { projectId: `entity-multi-${testCase.label}` });
      const previous = store.resolveReference(testCase.samples.aliases.previous, 'device', { projectId: `entity-multi-${testCase.label}` });

      expect(latest?.entityId).toBe(beta.entityId);
      expect(previous?.entityId).toBe(alpha.entityId);
      expect(latest?.entityId).not.toBe(previous?.entityId);

      store.close();
    });
  }

  it('keeps same-name instances separated within the same project and preserves previous/latest references in zh and en aliases', () => {
    const store = new EntityStore(':memory:');
    const first = store.upsertEntity({
      canonicalName: 'monitor',
      type: 'device',
      aliases: [entityReferenceSamplesZh.aliases.displayPrevious, entityReferenceSamplesEn.aliases.displayPrevious, entityReferenceSamplesZh.aliases.displayGeneric],
      metadata: { projectId: 'entity-project-local' },
      instanceMode: 'new_instance',
      createdAt: 10
    });
    const second = store.upsertEntity({
      canonicalName: 'monitor',
      type: 'device',
      aliases: [entityReferenceSamplesZh.aliases.displayLatest, entityReferenceSamplesEn.aliases.displayLatest, entityReferenceSamplesEn.aliases.displayGeneric],
      metadata: { projectId: 'entity-project-local' },
      instanceMode: 'new_instance',
      createdAt: 20
    });
    store.recordMention({ entityId: first.entityId, projectId: 'entity-project-local', mentionType: 'declared', createdAt: 10 });
    store.recordMention({ entityId: second.entityId, projectId: 'entity-project-local', mentionType: 'declared', createdAt: 20 });

    expect(store.resolveReference(entityReferenceSamplesZh.aliases.displayPrevious, 'device', { projectId: 'entity-project-local' })?.entityId).toBe(first.entityId);
    expect(store.resolveReference(entityReferenceSamplesEn.aliases.displayPrevious, 'device', { projectId: 'entity-project-local' })?.entityId).toBe(first.entityId);
    expect(store.resolveReference(entityReferenceSamplesZh.aliases.displayLatest, 'device', { projectId: 'entity-project-local' })?.entityId).toBe(second.entityId);
    expect(store.resolveReference(entityReferenceSamplesEn.aliases.displayLatest, 'device', { projectId: 'entity-project-local' })?.entityId).toBe(second.entityId);
    expect(store.resolveReference(entityReferenceSamplesEn.aliases.displayGeneric, 'device', { projectId: 'entity-project-local' })?.entityId).toBe(second.entityId);

    store.close();
  });

  it('hardens project alias evolution and project-scoped previous/latest references without collapsing same-name projects', () => {
    const store = new EntityStore(':memory:');
    const previous = store.upsertEntity({
      canonicalName: 'Atlas project',
      type: 'project',
      aliases: ['前一个项目', 'the previous project', 'atlas-legacy'],
      metadata: { projectId: 'project-alias-v3' },
      instanceMode: 'new_instance',
      createdAt: 10
    });
    const latest = store.upsertEntity({
      canonicalName: 'Atlas project',
      type: 'project',
      aliases: ['这个项目', '新项目', 'this project', 'the new project', 'atlas-billing'],
      metadata: { projectId: 'project-alias-v3' },
      instanceMode: 'new_instance',
      createdAt: 20
    });
    store.recordMention({ entityId: previous.entityId, projectId: 'project-alias-v3', mentionType: 'declared', createdAt: 10 });
    store.recordMention({ entityId: latest.entityId, projectId: 'project-alias-v3', mentionType: 'declared', createdAt: 20 });

    expect(store.resolveReference('前一个项目', 'project', { projectId: 'project-alias-v3' })?.entityId).toBe(previous.entityId);
    expect(store.resolveReference('the previous project', 'project', { projectId: 'project-alias-v3' })?.entityId).toBe(previous.entityId);
    expect(store.resolveReference('这个项目', 'project', { projectId: 'project-alias-v3' })?.entityId).toBe(latest.entityId);
    expect(store.resolveReference('the new project', 'project', { projectId: 'project-alias-v3' })?.entityId).toBe(latest.entityId);
    expect(store.resolveReference('this project', 'project', { projectId: 'project-alias-v3' })?.entityId).toBe(latest.entityId);
    expect(store.listDisambiguationCandidates('Atlas project', 'project').length).toBeGreaterThanOrEqual(2);

    store.close();
  });

  it('keeps identical aliases, attributes, and projectless timelines inside their exact project scope', () => {
    const store = new EntityStore(':memory:');
    store.getDatabase().exec(`CREATE TABLE neurons(id TEXT PRIMARY KEY, project_id TEXT, is_deleted INTEGER NOT NULL DEFAULT 0)`);
    store.getDatabase().exec(`INSERT INTO neurons VALUES('n-a','a',0),('n-b','b',0),('n-global',NULL,0)`);
    const a = store.upsertEntity({
      canonicalName: 'Shared Alias A', type: 'person', aliases: ['shared'],
      metadata: { projectId: 'a' }, instanceMode: 'new_instance', createdAt: 1,
    });
    const b = store.upsertEntity({
      canonicalName: 'Shared Alias B', type: 'person', aliases: ['shared'],
      metadata: { projectId: 'b' }, instanceMode: 'new_instance', createdAt: 2,
    });
    const global = store.upsertEntity({
      canonicalName: 'Shared Alias Global', type: 'person', aliases: ['shared'],
      metadata: { projectId: '' }, instanceMode: 'new_instance', createdAt: 3,
    });
    store.recordMention({ entityId: a.entityId, neuronId: 'n-a', projectId: 'a', createdAt: 1 });
    store.recordMention({ entityId: b.entityId, neuronId: 'n-b', projectId: 'b', createdAt: 2 });
    store.recordMention({ entityId: global.entityId, neuronId: 'n-global', projectId: '', createdAt: 3 });
    store.addAttribute({ entityId: a.entityId, attributeKey: 'secret', attributeValue: 'a-only', sourceNeuronId: 'n-a' });
    store.addAttribute({ entityId: a.entityId, attributeKey: 'secret', attributeValue: 'b-forged', sourceNeuronId: 'n-b' });

    expect(store.findByAlias('shared', 'person', 'a')?.entityId).toBe(a.entityId);
    expect(store.findByAlias('shared', 'person', 'b')?.entityId).toBe(b.entityId);
    expect(store.findByAlias('shared', 'person', '')?.entityId).toBe(global.entityId);
    expect(store.listAttributes(a.entityId, undefined, 'a').map((item) => item.attributeValue)).toEqual(['a-only']);
    expect(store.listTimeline({ projectId: '' }).map((item) => item.entityId)).toEqual([global.entityId]);

    store.close();
  });
});

it('EntityStore applies project scope before relative and same-name LIMIT clauses', () => {
  const store = new EntityStore();
  const original = store.upsertEntity({ canonicalName: 'Shared Device', type: 'device', metadata: { projectId: 'a' }, createdAt: 1 });
  store.recordMention({ entityId: original.entityId, projectId: 'a', createdAt: 1 });
  for (let index = 0; index < 13; index += 1) {
    const foreign = store.upsertEntity({ canonicalName: 'Shared Device', type: 'device', metadata: { projectId: 'b' }, instanceMode: 'new_instance', createdAt: 100 + index });
    store.recordMention({ entityId: foreign.entityId, projectId: 'b', createdAt: 100 + index });
  }
  expect(store.listReferenceCandidatesWithRelativeSupport('最新设备', 'device', { projectId: 'a' })[0]?.entity.entityId).toBe(original.entityId);
  expect(store.upsertEntity({ canonicalName: 'Shared Device', type: 'device', metadata: { projectId: 'a' }, createdAt: 1000 }).entityId).toBe(original.entityId);
  store.close();
});

it('EntityStore isolates alias conflicts and relations by exact project scope', () => {
  const store = new EntityStore();
  const make = (name: string, projectId: string) => store.upsertEntity({ canonicalName: name, type: 'device', aliases: ['same alias'], metadata: { projectId }, instanceMode: 'new_instance' });
  const a1 = make('a1', 'a'); const a2 = make('a2', 'a');
  const b1 = make('b1', 'b'); const b2 = make('b2', 'b');
  expect(store.listAliasConflicts('device', 'a')[0]?.entityIds.sort()).toEqual([a1.entityId, a2.entityId].sort());
  expect(store.listAliasConflicts('device', 'b')[0]?.entityIds.sort()).toEqual([b1.entityId, b2.entityId].sort());
  store.addRelation({ sourceEntityId: a1.entityId, targetEntityId: a2.entityId, relationType: 'same_as', projectId: 'a' });
  expect(store.listRelations(a1.entityId, undefined, 'a')).toHaveLength(1);
  expect(store.listRelations(a1.entityId, undefined, 'b')).toHaveLength(0);
  expect(() => store.addRelation({ sourceEntityId: a1.entityId, targetEntityId: b1.entityId, relationType: 'same_as', projectId: 'a' })).toThrow('entity_relation_project_scope_mismatch');
  store.close();
});
