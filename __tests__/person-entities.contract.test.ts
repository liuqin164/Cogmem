import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  PERSON_API_METHODS,
  PERSON_CONTRACT_VERSION,
  PERSON_ERROR_CODES,
  PERSON_FIELDS,
  PERSON_RELATION_TYPES,
} from '../src/person/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F4 person-entity contract (#158), asserted against the document it claims to implement.
 *
 * Same shape as the F1/F2/F3 contract tests: the document's frozen tables are read back and compared
 * with the code's lists. The behaviour tests below are the ticket's acceptance: nickname / full name
 * / relational term resolve to one stable id (and two relational terms stay two people), a corrected
 * attribute puts the old value in history and out of the default read, and a wrong attachment is
 * undone on the next read. Merge and split are asserted where the ticket says they live — the
 * governed entity merge with its audit log.
 */

const scratch = makeTempDir('cogmem-person-contract-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/person-entities.md', import.meta.url)), 'utf8');

/** The text of one heading's section, stopping at the next heading of the same or a higher level. */
function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

/** The backticked first column of every table row in a section, in order. */
function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_.-]*)`/gmu)].map((match) => match[1]!);
}

describe('the contract document and the frozen lists agree', () => {
  test('the face table is exactly PERSON_API_METHODS, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('## The face (frozen)'));
    expect(documented.length).toBeGreaterThan(0);
    expect(documented).toEqual([...PERSON_API_METHODS]);
  });

  test('the error table is exactly PERSON_ERROR_CODES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...PERSON_ERROR_CODES]);
  });

  test('the relation-label table is exactly PERSON_RELATION_TYPES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Relation labels (frozen)'))).toEqual([...PERSON_RELATION_TYPES]);
  });

  test('the field table is exactly PERSON_FIELDS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Person fields (frozen)'))).toEqual([...PERSON_FIELDS]);
  });

  test('every frozen method exists on the directory, and the version constant is 1', () => {
    expect(PERSON_CONTRACT_VERSION).toBe(1);
    for (const method of PERSON_API_METHODS) {
      expect(typeof (kernel.persons as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});

describe('a name finds one person and only that person', () => {
  test('小名、全名与关系称呼指向同一个人，两个关系称呼仍指向两个人', () => {
    const projectId = 'aliases';
    const wang = kernel.persons.ensurePerson({ projectId, name: '王芳', aliases: ['芳芳', '老婆'] });
    const li = kernel.persons.ensurePerson({ projectId, name: '李明', aliases: ['明明', '爸爸'] });
    const zhang = kernel.persons.ensurePerson({ projectId, name: '张秀兰', aliases: ['妈', '妈妈'] });

    // Nickname, full name and relational term: one stable id, not three.
    expect(new Set(['王芳', '芳芳', '老婆'].map((ref) => kernel.persons.resolvePerson(ref, projectId)?.personId)))
      .toEqual(new Set([wang.personId]));
    // The relational terms are different people. This is the discriminator: a face that returned
    // "the latest person" would collapse them.
    expect(kernel.persons.resolvePerson('老婆', projectId)?.personId).toBe(wang.personId);
    expect(kernel.persons.resolvePerson('妈妈', projectId)?.personId).toBe(zhang.personId);
    expect(kernel.persons.resolvePerson('爸爸', projectId)?.personId).toBe(li.personId);
    expect(kernel.persons.resolvePerson('老婆', projectId)?.personId)
      .not.toBe(kernel.persons.resolvePerson('妈妈', projectId)?.personId);

    // The person record carries the declared aliases and not the canonical name twice.
    expect(wang.canonicalName).toBe('王芳');
    expect(new Set(wang.aliases)).toEqual(new Set(['芳芳', '老婆']));
    expect(Object.keys(wang).sort()).toEqual([...PERSON_FIELDS].sort());
  });

  test('an undeclared reference is null, never the latest person — at the face and at the store', async () => {
    const projectId = 'undeclared';
    const wang = kernel.persons.ensurePerson({ projectId, name: '王芳', aliases: ['芳芳'] });
    kernel.persons.ensurePerson({ projectId, name: '李明' });
    // Give 王芳 a memory, so the store *could* answer "the latest person" — that is exactly the
    // guess this face must not make. Without a mention the old fallback returns null too, and the
    // assertion below would prove nothing.
    const memory = await kernel.ingest({ content: '王芳今天来过。', projectId });
    kernel.persons.attachMemory({ personId: wang.personId, projectId, neuronId: memory.id });

    expect(kernel.persons.resolvePerson('小芳', projectId)).toBeNull();
    // The store's own device/project rule ("a bare type noun means the newest") does not apply to a
    // person: a name nobody declared is nobody, which is what keeps a compiled fact off a stranger.
    expect(kernel.entityStore.resolveReference('小芳', 'person', { projectId })).toBeNull();
    expect(kernel.entityStore.resolveReference('未登记的称呼', 'person', { projectId })).toBeNull();
    // A declared reference still resolves, so the guard removed the guess, not the lookup.
    expect(kernel.entityStore.resolveReference('芳芳', 'person', { projectId })?.entityId).toBe(wang.personId);

    // The guard is person-specific: the device fallback still answers. (It needs a project mention
    // to be visible at all — the store's own rule, untouched here.)
    const device = kernel.entityStore.upsertEntity({ canonicalName: '降噪耳机', type: 'device', metadata: { projectId }, createdAt: 1 });
    kernel.entityStore.recordMention({ entityId: device.entityId, projectId, mentionType: 'declared' });
    expect(kernel.entityStore.resolveReference('耳机', 'device', { projectId })?.canonicalName).toBe('降噪耳机');
  });

  test('同名的人在不同项目里是两个 id，各自解析', () => {
    const a = kernel.persons.ensurePerson({ projectId: 'scope-a', name: '王芳', aliases: ['芳芳'] });
    const b = kernel.persons.ensurePerson({ projectId: 'scope-b', name: '王芳', aliases: ['芳芳'] });
    expect(a.personId).not.toBe(b.personId);
    expect(kernel.persons.resolvePerson('芳芳', 'scope-a')?.personId).toBe(a.personId);
    expect(kernel.persons.resolvePerson('芳芳', 'scope-b')?.personId).toBe(b.personId);
    // Another project's id is not readable as this project's person.
    expect(kernel.persons.getPerson(a.personId, 'scope-b')).toBeNull();
  });

  test('同一项目内共享一个称呼时报歧义，而不是挑一个', () => {
    const projectId = 'ambiguous';
    kernel.persons.ensurePerson({ projectId, name: '王芳', aliases: ['小王'] });
    kernel.persons.ensurePerson({ projectId, name: '王刚', aliases: ['小王'] });
    expect(() => kernel.persons.resolvePerson('小王', projectId)).toThrow('ambiguous_person_reference');
  });
});

describe('an attribute revision keeps the old value as history, not as recall', () => {
  test('改口后旧值进历史、不进默认召回', async () => {
    const projectId = 'attribute-revision';
    const person = kernel.persons.ensurePerson({ projectId, name: '王芳' });
    const first = await kernel.ingest({ content: '王芳对花生过敏。', projectId });
    const second = await kernel.ingest({ content: '王芳现在能吃花生了，之前是误诊。', projectId });

    kernel.persons.reviseAttribute({ personId: person.personId, projectId, key: 'diet.peanut', value: '过敏', sourceNeuronId: first.id });
    kernel.persons.reviseAttribute({ personId: person.personId, projectId, key: 'diet.peanut', value: '不过敏', sourceNeuronId: second.id });

    expect(kernel.persons.attributes(person.personId, projectId).map((attribute) => attribute.value)).toEqual(['不过敏']);
    expect(kernel.persons.recall(person.personId, { projectId }).attributes.map((attribute) => attribute.value)).toEqual(['不过敏']);
    expect(kernel.persons.attributeHistory(person.personId, 'diet.peanut', projectId).map((attribute) => attribute.value))
      .toEqual(['不过敏', '过敏']);

    // Re-recording the same value is not a revision.
    kernel.persons.reviseAttribute({ personId: person.personId, projectId, key: 'diet.peanut', value: '不过敏', sourceNeuronId: second.id });
    expect(kernel.persons.attributeHistory(person.personId, 'diet.peanut', projectId)).toHaveLength(2);

    // Two keys keep their own current values.
    kernel.persons.reviseAttribute({ personId: person.personId, projectId, key: 'city', value: '杭州', sourceNeuronId: first.id });
    expect(kernel.persons.attributes(person.personId, projectId).map((attribute) => attribute.key).sort()).toEqual(['city', 'diet.peanut']);

    // The evidence rule is the store's and is not weakened: a neuron from another project is refused.
    const elsewhere = await kernel.ingest({ content: '别的项目。', projectId: 'attribute-other-project' });
    expect(() => kernel.persons.reviseAttribute({
      personId: person.personId, projectId, key: 'diet.peanut', value: '随便', sourceNeuronId: elsewhere.id,
    })).toThrow('entity_project_scope_mismatch');
  });
});

describe('a memory is attached to a person, and a wrong attachment is undone', () => {
  test('挂错人可撤销且即刻生效，另一个人的记忆不受影响', async () => {
    const projectId = 'attachment';
    const wang = kernel.persons.ensurePerson({ projectId, name: '王芳' });
    const li = kernel.persons.ensurePerson({ projectId, name: '李明' });
    const tea = await kernel.ingest({ content: '王芳喜欢喝乌龙茶。', projectId });
    const guitar = await kernel.ingest({ content: '李明在学吉他。', projectId });

    kernel.persons.attachMemory({ personId: wang.personId, projectId, neuronId: tea.id });
    kernel.persons.attachMemory({ personId: li.personId, projectId, neuronId: guitar.id });
    // Attaching the same memory twice is one attachment.
    kernel.persons.attachMemory({ personId: wang.personId, projectId, neuronId: tea.id });

    expect(kernel.persons.memories(wang.personId, projectId).map((memory) => memory.neuronId)).toEqual([tea.id]);
    expect(kernel.persons.memories(li.personId, projectId).map((memory) => memory.neuronId)).toEqual([guitar.id]);
    // The recalled memory is the compiled one, read through the injected lookup.
    expect(kernel.persons.recall(wang.personId, { projectId }).memories[0]!.content)
      .toBe(kernel.memoryGraph.getNeuron(tea.id)?.content);

    // Filed under the wrong person: the correction is visible on the very next read.
    kernel.persons.attachMemory({ personId: wang.personId, projectId, neuronId: guitar.id });
    expect(kernel.persons.memories(wang.personId, projectId).map((memory) => memory.neuronId).sort())
      .toEqual([guitar.id, tea.id].sort());
    expect(kernel.persons.detachMemory({ personId: wang.personId, projectId, neuronId: guitar.id })).toBe(true);
    expect(kernel.persons.memories(wang.personId, projectId).map((memory) => memory.neuronId)).toEqual([tea.id]);
    expect(kernel.persons.recall(wang.personId, { projectId }).memories.map((memory) => memory.neuronId)).toEqual([tea.id]);
    // Detaching again is a no-op, not a second removal.
    expect(kernel.persons.detachMemory({ personId: wang.personId, projectId, neuronId: guitar.id })).toBe(false);
    // The other person's attachment never moved.
    expect(kernel.persons.memories(li.personId, projectId).map((memory) => memory.neuronId)).toEqual([guitar.id]);
  });

  test('the reads refuse a limit that is not a positive integer', () => {
    const projectId = 'limits';
    const person = kernel.persons.ensurePerson({ projectId, name: '王芳' });
    expect(() => kernel.persons.memories(person.personId, projectId, 0)).toThrow('invalid_limit');
  });
});

describe('the person graph is one hop of people and edges', () => {
  test('认识的人在图里，不认识的人不在；标签有词表', () => {
    const projectId = 'graph';
    const wang = kernel.persons.ensurePerson({ projectId, name: '王芳' });
    const li = kernel.persons.ensurePerson({ projectId, name: '李明' });
    const zhang = kernel.persons.ensurePerson({ projectId, name: '张秀兰' });
    const stranger = kernel.persons.ensurePerson({ projectId, name: '邻居' });

    kernel.persons.relate({ projectId, fromPersonId: wang.personId, toPersonId: li.personId, relationType: 'spouse_of' });
    kernel.persons.relate({ projectId, fromPersonId: zhang.personId, toPersonId: wang.personId, relationType: 'parent_of' });

    const graph = kernel.persons.graph(wang.personId, { projectId });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([wang, li, zhang].map((person) => person.personId).sort());
    expect(graph.nodes.every((node) => node.kind === 'person')).toBe(true);
    expect(graph.edges.map((edge) => edge.relation).sort()).toEqual(['parent_of', 'spouse_of']);
    expect(graph.nodes.map((node) => node.id)).not.toContain(stranger.personId);

    // The graph is centred: the same edges seen from the other end are one hop, not two.
    const fromLi = kernel.persons.graph(li.personId, { projectId });
    expect(fromLi.nodes.map((node) => node.id).sort()).toEqual([li, wang].map((person) => person.personId).sort());
    expect(fromLi.edges).toHaveLength(1);

    // The label vocabulary is closed, and a person is not their own relation.
    expect(() => kernel.persons.relate({ projectId, fromPersonId: wang.personId, toPersonId: li.personId, relationType: 'loves' }))
      .toThrow('invalid_person_relation_type');
    expect(() => kernel.persons.relate({ projectId, fromPersonId: wang.personId, toPersonId: wang.personId, relationType: 'related_to' }))
      .toThrow('person_relation_self');
  });
});

describe('merge is a governed action and split is its inverse', () => {
  test('没有用户证据的合并只排队；有证据才落地，且审计成行、可拆回', async () => {
    const projectId = 'merge-project';
    const source = kernel.persons.ensurePerson({ projectId, name: '王芳', aliases: ['芳芳'] });
    const target = kernel.persons.ensurePerson({ projectId, name: '王芳芳', aliases: ['小王'] });
    const evidence = kernel.recordRawEvent({
      threadId: 't-merge', projectId, role: 'user', content: '芳芳和小王其实是同一个人。',
    });
    const sourceMemory = await kernel.ingest({ content: '王芳在学做面包。', projectId });
    const targetMemory = await kernel.ingest({ content: '小王养了一只猫。', projectId });
    kernel.persons.attachMemory({ personId: source.personId, projectId, neuronId: sourceMemory.id });
    kernel.persons.attachMemory({ personId: target.personId, projectId, neuronId: targetMemory.id });
    const merge = {
      projectId, sourcePersonId: source.personId, targetPersonId: target.personId,
      alias: '王芳', confidence: 0.99,
    };

    // A model's guess with no user evidence cannot merge two humans: the candidate waits.
    const pending = kernel.persons.mergePersons({ ...merge, evidenceEventIds: [] });
    expect(pending.status).toBe('pending');
    expect(kernel.persons.resolvePerson('王芳', projectId)?.personId).toBe(source.personId);
    expect(kernel.persons.getPerson(source.personId, projectId)?.status).toBe('active');

    // With user evidence it applies: the source is archived and redirects, never deleted.
    const applied = kernel.persons.mergePersons({ ...merge, evidenceEventIds: [evidence.eventId] });
    expect(applied.status).toBe('applied');
    expect(kernel.persons.resolvePerson('王芳', projectId)?.personId).toBe(target.personId);
    expect(kernel.persons.getPerson(source.personId, projectId)?.status).toBe('archived');

    // The merge redirects the identity, not the rows: the archived source still reads its own
    // attachment, and the target does not inherit it. That ceiling is stated in the contract.
    expect(kernel.persons.memories(source.personId, projectId).map((memory) => memory.neuronId)).toEqual([sourceMemory.id]);
    expect(kernel.persons.memories(target.personId, projectId).map((memory) => memory.neuronId)).toEqual([targetMemory.id]);

    // Re-ensuring the merged-away name must not resurrect the source: that would put two active
    // people on one name and make it ambiguous again, undoing the merge from the side.
    const reEnsured = kernel.persons.ensurePerson({ projectId, name: '王芳' });
    expect(reEnsured.personId).toBe(source.personId);
    expect(reEnsured.status).toBe('archived');
    expect(kernel.persons.resolvePerson('王芳', projectId)?.personId).toBe(target.personId);

    const db = kernel.factStore.getDatabase();
    const actions = () => (db.prepare(`SELECT action FROM entity_resolution_log WHERE candidate_id = ? ORDER BY rowid`)
      .all(applied.candidateId) as Array<{ action: string }>).map((row) => row.action);
    expect(actions()).toEqual(['merge']);

    // Split restores the source and takes back the alias the merge wrote. The candidate id is
    // project-scoped: another project cannot revert this merge by id.
    expect(() => kernel.persons.splitPerson(applied.candidateId, 'some-other-project')).toThrow('unknown_person');
    const reverted = kernel.persons.splitPerson(applied.candidateId, projectId);
    expect(reverted.status).toBe('reverted');
    expect(kernel.persons.resolvePerson('王芳', projectId)?.personId).toBe(source.personId);
    expect(kernel.persons.getPerson(source.personId, projectId)?.status).toBe('active');
    expect(kernel.persons.memories(source.personId, projectId).map((memory) => memory.neuronId)).toEqual([sourceMemory.id]);
    expect(actions()).toEqual(['merge', 'revert']);
  });

  test('合并两个人以外的东西不是这个动作', () => {
    const projectId = 'merge-guard';
    const person = kernel.persons.ensurePerson({ projectId, name: '王芳' });
    const device = kernel.entityStore.upsertEntity({ canonicalName: '降噪耳机', type: 'device', metadata: { projectId }, createdAt: 1 });
    expect(() => kernel.persons.mergePersons({
      projectId, sourcePersonId: person.personId, targetPersonId: device.entityId,
      alias: '耳机', evidenceEventIds: [],
    })).toThrow('not_a_person');
  });
});
