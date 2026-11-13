import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import {
  PROFILE_API_METHODS,
  PROFILE_CONTRACT_VERSION,
  PROFILE_ERROR_CODES,
  PROFILE_ENTRY_FIELDS,
  PROFILE_EVENT_TYPES,
  PROFILE_EXCLUSION_RULES,
  PROFILE_LEDGERS,
  PROFILE_LIVE_FACT_STATUSES,
  PROFILE_ONGOING_STATUSES,
  PROFILE_PREFERENCE_PREDICATES,
  PROFILE_RECALL_PRIORITY,
  PROFILE_TRANSIENT_PREDICATES,
} from '../src/profile/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F5 profile-compilation contract (#159), asserted against the document it claims to implement.
 *
 * Same shape as the F1–F4 contract tests: the document's frozen tables are read back and compared
 * with the code's lists. The behaviour tests below are the ticket's acceptance: a correction reaches
 * the source event and recompiles that ledger so the profile and the next recall agree; each of the
 * four ledgers has a recorded sample of what must not enter it; and cross-identity visibility is
 * #153's rule, judged on the same chain, not a second rule.
 */

const scratch = makeTempDir('cogmem-profile-contract-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;
let backend: KernelAgentMemoryBackend;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
  backend = new KernelAgentMemoryBackend(kernel);
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/profile-compilation.md', import.meta.url)), 'utf8');

/** The text of one heading's section, stopping at the next heading of the same or a higher level. */
function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

/** The backticked first column of every table row in a section, in order. */
function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_.-]*)`/gmu)].map((match) => match[1]!);
}

describe('the contract document and the frozen lists agree', () => {
  test('the ledger table is exactly PROFILE_LEDGERS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## The ledgers (frozen)'))).toEqual([...PROFILE_LEDGERS]);
  });

  test('the face table is exactly PROFILE_API_METHODS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## The face (frozen)'))).toEqual([...PROFILE_API_METHODS]);
  });

  test('the entry-field table is exactly PROFILE_ENTRY_FIELDS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Entry fields (frozen)'))).toEqual([...PROFILE_ENTRY_FIELDS]);
  });

  test('the ledger-event table is exactly PROFILE_EVENT_TYPES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Ledger events (frozen)'))).toEqual([...PROFILE_EVENT_TYPES]);
  });

  test('the error table is exactly PROFILE_ERROR_CODES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...PROFILE_ERROR_CODES]);
  });

  test('the exclusion table is exactly PROFILE_EXCLUSION_RULES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Exclusion rules (frozen)'))).toEqual(PROFILE_EXCLUSION_RULES.map((rule) => rule.rule));
  });

  test('the recall-priority table is exactly PROFILE_RECALL_PRIORITY, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Recall priority (frozen)'))).toEqual([...PROFILE_RECALL_PRIORITY]);
  });

  test('the predicate and status tables are exactly their frozen lists, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Preference predicates (frozen)'))).toEqual([...PROFILE_PREFERENCE_PREDICATES]);
    expect(backtickedFirstColumn(sectionAfter('## Transient predicates (frozen)'))).toEqual([...PROFILE_TRANSIENT_PREDICATES]);
    expect(backtickedFirstColumn(sectionAfter('## Live fact statuses (frozen)'))).toEqual([...PROFILE_LIVE_FACT_STATUSES]);
    expect(backtickedFirstColumn(sectionAfter('## Ongoing statuses (frozen)'))).toEqual([...PROFILE_ONGOING_STATUSES]);
  });

  test('every frozen method exists on the compiler, and the version constant is 1', () => {
    expect(PROFILE_CONTRACT_VERSION).toBe(1);
    for (const method of PROFILE_API_METHODS) {
      expect(typeof (kernel.profile as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});

describe('a correction reaches the source event and the ledger recompiles', () => {
  test('纠正一条偏好后，画像与后续召回同步更新', async () => {
    const projectId = 'acceptance-correction';
    await kernel.ingest({ content: '我喜欢喝乌龙茶。', projectId });
    kernel.profile.compile({ projectId });

    const before = kernel.profile.entries({ projectId, ledger: 'preferences' });
    expect(before.map((entry) => entry.value)).toEqual(['喝乌龙茶']);
    expect(before[0]!.sourceRefs.length).toBeGreaterThan(0);
    const originalSource = before[0]!.sourceRefs[0]!.eventId;
    expect(originalSource).toBeDefined();
    // The source refs name a real ledger event, which is what makes the chain walkable.
    expect(kernel.eventStore.getEvent(originalSource!)?.eventId).toBe(originalSource);

    // The profile is in default recall before the correction.
    const seenBefore = backend.recall({ projectId, agentId: 'hermes', query: '乌龙茶', limit: 5 });
    expect(seenBefore.items.some((item) => item.id.startsWith('profile:'))).toBe(true);

    const correction = kernel.recordRawEvent({
      threadId: 't-correction', projectId, role: 'user', content: '其实我不喝乌龙茶了，现在喜欢红茶。',
    });
    const corrected = kernel.profile.correct({
      projectId, ledger: 'preferences', key: before[0]!.key, value: '喝红茶', correctionEventId: correction.eventId,
    });
    expect(corrected.value).toBe('喝红茶');
    expect(corrected.version).toBe(2);

    // The correction names the correction turn and the entry's original source — it reaches the source.
    const refIds = corrected.sourceRefs.map((ref) => ref.eventId);
    expect(refIds).toContain(correction.eventId);
    expect(refIds).toContain(originalSource!);

    // The old value is history, not the default read.
    expect(kernel.profile.entries({ projectId, ledger: 'preferences' }).map((entry) => entry.value)).toEqual(['喝红茶']);
    const history = kernel.profile.history({ projectId, entryId: before[0]!.entryId });
    expect(history.map((entry) => entry.value)).toEqual(['喝红茶', '喝乌龙茶']);
    expect(history.map((entry) => entry.status)).toEqual(['current', 'superseded']);

    // The recompile left a receipt for that ledger only.
    const receipts = kernel.profile.audit({ projectId, ledger: 'preferences' })
      .filter((entry) => entry.eventType === 'PROFILE_LEDGER_RECOMPILED');
    expect(receipts.length).toBeGreaterThanOrEqual(2);
    expect(kernel.profile.audit({ projectId, ledger: 'facts' }).every((entry) => entry.eventType !== 'PROFILE_LEDGER_RECOMPILED'
      || entry.payload.ledger === 'facts')).toBe(true);

    // The next recall carries the corrected value and not the replaced one.
    const seenAfter = backend.recall({ projectId, agentId: 'hermes', query: '红茶', limit: 5 });
    const profileText = seenAfter.items.filter((item) => item.id.startsWith('profile:')).map((item) => item.text).join(' ');
    expect(profileText).toContain('喝红茶');
    expect(profileText).not.toContain('喝乌龙茶');
  });

  test('a correction with no user turn, another project, or no entry is refused', async () => {
    const projectId = 'correction-guards';
    await kernel.ingest({ content: '我喜欢喝咖啡。', projectId });
    kernel.profile.compile({ projectId });
    const entry = kernel.profile.entries({ projectId, ledger: 'preferences' })[0]!;

    const assistant = kernel.recordRawEvent({ threadId: 't-a', projectId, role: 'assistant', content: '好的。' });
    expect(() => kernel.profile.correct({
      projectId, ledger: 'preferences', key: entry.key, value: '喝茶', correctionEventId: assistant.eventId,
    })).toThrow('profile_correction_event_invalid');

    const otherProject = kernel.recordRawEvent({ threadId: 't-b', projectId: 'correction-elsewhere', role: 'user', content: '我喜欢喝茶。' });
    expect(() => kernel.profile.correct({
      projectId, ledger: 'preferences', key: entry.key, value: '喝茶', correctionEventId: otherProject.eventId,
    })).toThrow('profile_correction_event_invalid');

    const correction = kernel.recordRawEvent({ threadId: 't-c', projectId, role: 'user', content: '其实我喜欢喝茶。' });
    expect(() => kernel.profile.correct({
      projectId, ledger: 'preferences', key: 'no.such.key', value: '喝茶', correctionEventId: correction.eventId,
    })).toThrow('profile_entry_unknown');
    expect(() => kernel.profile.entries({ projectId, ledger: 'not-a-ledger' as never })).toThrow('invalid_profile_ledger');
  });
});

describe('each ledger refuses what does not belong in it', () => {
  test('事实册：一次性问题与无出处的主张不进册', async () => {
    const projectId = 'exclude-facts';
    await kernel.ingest({ content: '耳机有杂音。', projectId }); // has_issue — transient
    kernel.profile.compile({ projectId });
    expect(kernel.profile.entries({ projectId, ledger: 'facts' })).toHaveLength(0);
    expect(kernel.profile.entries({ projectId, ledger: 'preferences' })).toHaveLength(0);

    // A belief with no source event has no evidence to stand on.
    kernel.beliefStore.upsert({
      projectId, scope: 'project', subject: 'owner', predicate: 'uses',
      objectValue: { raw: 'vim', type: 'string' }, confidence: 0.9,
      sourceType: 'user_input', extractionReason: 'explicit_user_statement', validFrom: 1000,
    });
    kernel.profile.compile({ projectId, ledger: 'facts' });
    expect(kernel.profile.entries({ projectId, ledger: 'facts' })).toHaveLength(0);
  });

  test('偏好册：一次性情绪不进册，非偏好谓词落事实册', async () => {
    const projectId = 'exclude-preferences';
    await kernel.ingest({ content: '今天好累，有点烦。', projectId }); // a one-off feeling, not a preference
    kernel.profile.compile({ projectId });
    expect(kernel.profile.entries({ projectId, ledger: 'preferences' })).toHaveLength(0);

    const mood = kernel.recordRawEvent({ threadId: 't-mood', projectId, role: 'user', content: '今天有点累。' });
    const liked = kernel.recordRawEvent({ threadId: 't-like', projectId, role: 'user', content: '我喜欢喝茶。' });
    kernel.beliefStore.upsert({
      projectId, scope: 'project', subject: 'owner', predicate: 'mood',
      objectValue: { raw: 'tired', type: 'string' }, confidence: 0.9,
      sourceType: 'user_input', extractionReason: 'explicit_user_statement', sourceEventId: mood.eventId, validFrom: 2000,
    });
    kernel.beliefStore.upsert({
      projectId, scope: 'project', subject: 'owner', predicate: 'likes',
      objectValue: { raw: 'tea', type: 'string' }, confidence: 0.9,
      sourceType: 'user_input', extractionReason: 'preference_signal', sourceEventId: liked.eventId, validFrom: 3000,
    });
    kernel.profile.compile({ projectId });
    // The mood is a fact, not a preference: only a preference predicate enters the preferences ledger.
    expect(kernel.profile.entries({ projectId, ledger: 'facts' }).map((entry) => entry.key).some((key) => key.includes('mood'))).toBe(true);
    expect(kernel.profile.entries({ projectId, ledger: 'preferences' }).map((entry) => entry.value)).toEqual(['tea']);
  });

  test('关系册：结构化边与非人物端点不进册，无出处的关系也不进册', async () => {
    const projectId = 'exclude-relations';
    const wang = kernel.persons.ensurePerson({ projectId, name: '王芳' });
    const li = kernel.persons.ensurePerson({ projectId, name: '李明' });
    const device = kernel.entityStore.upsertEntity({ canonicalName: '降噪耳机', type: 'device', metadata: { projectId }, createdAt: 1 });

    // A structural label and a non-person endpoint are both refused.
    kernel.entityStore.addRelation({ sourceEntityId: wang.personId, targetEntityId: li.personId, relationType: 'mentioned_with', projectId, createdAt: 1 });
    kernel.entityStore.addRelation({ sourceEntityId: wang.personId, targetEntityId: device.entityId, relationType: 'spouse_of', projectId, createdAt: 2 });
    kernel.profile.compile({ projectId });
    expect(kernel.profile.entries({ projectId, ledger: 'relations' })).toHaveLength(0);

    // A declared person relation with nothing behind it is not compiled either.
    kernel.persons.relate({ projectId, fromPersonId: wang.personId, toPersonId: li.personId, relationType: 'spouse_of' });
    kernel.profile.compile({ projectId });
    expect(kernel.profile.entries({ projectId, ledger: 'relations' })).toHaveLength(0);

    // Once a memory is attached to one of them, the relation has evidence and is compiled.
    const memory = await kernel.ingest({ content: '王芳和李明是夫妻。', projectId });
    kernel.persons.attachMemory({ personId: wang.personId, projectId, neuronId: memory.id });
    kernel.profile.compile({ projectId });
    const relations = kernel.profile.entries({ projectId, ledger: 'relations' });
    expect(relations).toHaveLength(1);
    expect(relations[0]!.key).toBe('王芳.spouse_of.李明');
    expect(relations[0]!.value).toBe('李明');
  });

  test('进行中册：候选不进册，确认后才进，完成后退册', async () => {
    const projectId = 'exclude-ongoing';
    const said = kernel.recordRawEvent({ threadId: 't-said', projectId, role: 'user', content: '我下周要去医院复查。' });
    const agreed = kernel.recordRawEvent({ threadId: 't-agreed', projectId, role: 'user', content: '是的，确认周三去复查。' });
    const proposed = kernel.prospectiveMemoryService.propose({
      projectId, candidateType: 'reminder', canonicalKey: 'hospital-checkup', title: '去医院复查',
      evidenceEventIds: [said.eventId], proposedBy: 'deterministic', dueAt: 1_795_000_000_000,
    });

    // A machine's pending candidate is not the owner's open item (F2's rule).
    kernel.profile.compile({ projectId });
    expect(kernel.profile.entries({ projectId, ledger: 'ongoing' })).toHaveLength(0);

    kernel.prospectiveMemoryService.resolve(proposed.candidateId, { action: 'confirm', confirmationEvidenceEventId: agreed.eventId }, projectId);
    kernel.profile.compile({ projectId });
    const ongoing = kernel.profile.entries({ projectId, ledger: 'ongoing' });
    expect(ongoing.map((entry) => entry.value)).toEqual(['去医院复查']);

    // A completed commitment is no longer ongoing: the recompile retires it.
    kernel.prospectiveMemoryService.resolve(proposed.candidateId, { action: 'complete' }, projectId);
    kernel.profile.compile({ projectId, ledger: 'ongoing' });
    expect(kernel.profile.entries({ projectId, ledger: 'ongoing' })).toHaveLength(0);
    expect(kernel.profile.history({ projectId, entryId: ongoing[0]!.entryId })[0]!.status).toBe('retired');
    expect(kernel.profile.audit({ projectId, ledger: 'ongoing' }).some((entry) => entry.eventType === 'PROFILE_ENTRY_RETIRED')).toBe(true);
  });
});

describe('cross-identity visibility follows #153, not a second rule', () => {
  test('一个身份编译出的画像，另一个身份默认召回看不到；导入材料两边都能看到', async () => {
    const projectId = 'profile-identity';
    // A turn hermes had. The source event carries `hermes:<session>`, which is what the scope rule reads.
    const owned = await kernel.appendEpisodeMessageAsync({
      projectId, sessionId: 'hermes-profile-1', sourceAgent: 'hermes', role: 'user',
      text: '我只喝手冲咖啡。',
    });
    const imported = await kernel.appendEpisodeMessageAsync({
      projectId, sessionId: 'import-profile-1', sourceAgent: 'hermes', role: 'user',
      text: 'Imported note: the owner keeps a spare key under the mat.',
      metadata: { imported: true },
    });

    kernel.beliefStore.upsert({
      projectId, scope: 'project', subject: 'owner', predicate: 'drinks',
      objectValue: { raw: '手冲咖啡', type: 'string' }, confidence: 0.9,
      sourceType: 'user_input', extractionReason: 'explicit_user_statement', sourceEventId: owned.eventId, validFrom: 4000,
    });
    kernel.beliefStore.upsert({
      projectId, scope: 'project', subject: 'owner', predicate: 'keeps',
      objectValue: { raw: '备用钥匙', type: 'string' }, confidence: 0.9,
      sourceType: 'user_input', extractionReason: 'explicit_user_statement', sourceEventId: imported.eventId, validFrom: 5000,
    });
    kernel.profile.compile({ projectId, ledger: 'facts' });

    const forHermes = backend.recall({ projectId, agentId: 'hermes', query: '咖啡 钥匙', limit: 8 });
    const hermesProfile = forHermes.items.filter((item) => item.id.startsWith('profile:'));
    expect(hermesProfile.some((item) => item.text.includes('手冲咖啡'))).toBe(true);
    expect(hermesProfile.some((item) => item.text.includes('备用钥匙'))).toBe(true);

    // pi is another identity in the same project: the owned profile entry is not its to read, while
    // the imported one is project-public (the #143/#153 rule, unchanged).
    const forPi = backend.recall({ projectId, agentId: 'pi', query: '咖啡 钥匙', limit: 8 });
    const piProfile = forPi.items.filter((item) => item.id.startsWith('profile:'));
    expect(piProfile.some((item) => item.text.includes('手冲咖啡'))).toBe(false);
    expect(piProfile.some((item) => item.text.includes('备用钥匙'))).toBe(true);

    // The project boundary is untouched: the same profile is invisible next door.
    const elsewhere = backend.recall({ projectId: 'profile-identity-elsewhere', agentId: 'hermes', query: '咖啡 钥匙', limit: 8 });
    expect(elsewhere.items.filter((item) => item.id.startsWith('profile:'))).toHaveLength(0);

    // A correction cannot widen an owned entry: the correction turn here names no agent, yet the
    // entry's anchor stays the event it was compiled from, so it is still hermes's and not pi's.
    const ownedEntry = kernel.profile.entries({ projectId, ledger: 'facts' }).find((entry) => entry.value === '手冲咖啡')!;
    const correction = kernel.recordRawEvent({ threadId: 't-profile-identity', projectId, role: 'user', content: '其实是速溶咖啡。' });
    kernel.profile.correct({ projectId, ledger: 'facts', key: ownedEntry.key, value: '速溶咖啡', correctionEventId: correction.eventId });
    const piAfterCorrection = backend.recall({ projectId, agentId: 'pi', query: '咖啡', limit: 8 });
    expect(piAfterCorrection.items.filter((item) => item.id.startsWith('profile:')).some((item) => item.text.includes('速溶咖啡'))).toBe(false);
    const hermesAfterCorrection = backend.recall({ projectId, agentId: 'hermes', query: '咖啡', limit: 8 });
    expect(hermesAfterCorrection.items.filter((item) => item.id.startsWith('profile:')).some((item) => item.text.includes('速溶咖啡'))).toBe(true);
  });
});

describe('the profile lane ranks by its own rule, not the compiled lane', () => {
  test('优先级按账册排序，衰减按出处时间减半', async () => {
    const projectId = 'profile-ranking';
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // ongoing (confirmed) is newer; facts is older than one half-life. Same project, both matched.
    const evidence = kernel.recordRawEvent({ threadId: 't-rank', projectId, role: 'user', content: '记一下：周五交报告，另外我用 vim。' });
    const agreed = kernel.recordRawEvent({ threadId: 't-rank-2', projectId, role: 'user', content: '是的，确认周五交报告。' });
    kernel.beliefStore.upsert({
      projectId, scope: 'project', subject: 'owner', predicate: 'uses',
      objectValue: { raw: 'vim', type: 'string' }, confidence: 0.9,
      sourceType: 'user_input', extractionReason: 'explicit_user_statement', sourceEventId: evidence.eventId, validFrom: now - 200 * day,
    });
    const proposed = kernel.prospectiveMemoryService.propose({
      projectId, candidateType: 'commitment', canonicalKey: 'weekly-report', title: '周五交报告',
      evidenceEventIds: [evidence.eventId], proposedBy: 'deterministic',
    });
    kernel.prospectiveMemoryService.resolve(proposed.candidateId, { action: 'confirm', confirmationEvidenceEventId: agreed.eventId }, projectId);
    kernel.profile.compile({ projectId, now });

    const ranked = kernel.profile.recall({ projectId, now, limit: 4 });
    // ongoing leads facts even though the fact's key/value also matches: the ledger order decides first.
    expect(ranked[0]!.ledger).toBe('ongoing');
    // And a 200-day-old fact has decayed below half its weight (weight 1 × 0.5^(200/90) ≈ 0.21).
    const fact = ranked.find((entry) => entry.ledger === 'facts')!;
    expect(fact.score).toBeLessThan(0.5);
    expect(fact.score).toBeGreaterThan(0);
  });
});
