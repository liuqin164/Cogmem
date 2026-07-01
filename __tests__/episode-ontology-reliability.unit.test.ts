import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { CogmemBlockStripper, eventTextForMemory } from '../src/episode/CogmemBlockStripper.js';
import { EpisodeAssembler } from '../src/episode/EpisodeAssembler.js';
import { EpisodeStore } from '../src/episode/EpisodeStore.js';
import { classifyTurnRelation, classifyTurnRelationHybrid } from '../src/episode/TurnRelationClassifier.js';
import { createMemoryKernel } from '../src/factory.js';
import { migration_0024 } from '../src/migrations/0024_episode_ontology_reliability.js';
import { TopicAliasRegistry } from '../src/topic/TopicAliasRegistry.js';
import { TopicGovernance } from '../src/topic/TopicGovernance.js';
import { TopicPathRegistry } from '../src/topic/TopicPathRegistry.js';
import { TopicRelationGraph } from '../src/topic/TopicRelationGraph.js';

function topicDb() {
  const db = new Database(':memory:');
  migration_0024.up(db);
  return db;
}

test('user-defined topic operations are project isolated, audited, and reversible', () => {
  const db = topicDb();
  try {
    const paths = new TopicPathRegistry(db);
    const aliases = new TopicAliasRegistry(db);
    const relations = new TopicRelationGraph(db);
    const governance = new TopicGovernance(db, paths, aliases, relations);

    const created = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_CREATE', actor: 'user_explicit',
      payload: { topicPath: 'cogmem/episode-assembler', canonicalName: '事件组装器', ontologyClass: 'Topic' },
      evidenceEventIds: ['evt-name'], now: 100,
    });
    expect(created.status).toBe('applied');
    const topic = paths.getByPath('brain', 'cogmem/episode-assembler')!;
    expect(topic).toEqual(expect.objectContaining({ canonicalName: '事件组装器', status: 'active', createdBy: 'user_explicit' }));
    expect(aliases.resolve('brain', '事件组装器')?.topicId).toBe(topic.topicId);
    expect(paths.getByPath('other', 'cogmem/episode-assembler')).toBeUndefined();

    governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_ALIAS', actor: 'user_explicit',
      targetTopicId: topic.topicId, payload: { alias: 'Episode Assembler' }, evidenceEventIds: ['evt-alias'], now: 110,
    });
    expect(aliases.resolve('brain', 'episode assembler')?.topicId).toBe(topic.topicId);

    const rename = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_RENAME', actor: 'user_explicit',
      targetTopicId: topic.topicId, payload: { canonicalName: '事件归类器' }, evidenceEventIds: ['evt-rename'], now: 120,
    });
    expect(paths.get(topic.topicId)?.canonicalName).toBe('事件归类器');
    governance.rollback(rename.operationId, 'brain', 130);
    expect(paths.get(topic.topicId)?.canonicalName).toBe('事件组装器');
    expect(governance.listOperations({ projectId: 'brain' })).toHaveLength(3);
  } finally {
    db.close();
  }
});

test('model topics remain candidates and alias collisions fail closed', () => {
  const db = topicDb();
  try {
    const paths = new TopicPathRegistry(db);
    const aliases = new TopicAliasRegistry(db);
    const governance = new TopicGovernance(db, paths, aliases, new TopicRelationGraph(db));
    const first = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_CREATE', actor: 'user_explicit',
      payload: { topicPath: 'cogmem/dream', canonicalName: 'Dream', ontologyClass: 'Topic' }, now: 1,
    });
    const model = governance.apply({
      projectId: 'brain', operationType: 'MODEL_PROPOSED_TOPIC', actor: 'model_candidate',
      payload: { topicPath: 'cogmem/dream-v2', canonicalName: 'Dream v2', ontologyClass: 'Topic' }, now: 2,
    });
    expect(paths.get(model.targetTopicId!)?.status).toBe('candidate');
    expect(aliases.resolve('brain', 'Dream v2')).toBeUndefined();
    const second = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_CREATE', actor: 'user_explicit',
      payload: { topicPath: 'cogmem/scheduler', canonicalName: 'Scheduler', ontologyClass: 'Topic' }, now: 3,
    });
    aliases.add({ projectId: 'brain', topicId: first.targetTopicId!, alias: '调度', createdBy: 'user_explicit', confidence: 1, now: 4 });
    const collision = aliases.add({ projectId: 'brain', topicId: second.targetTopicId!, alias: '调度', createdBy: 'user_explicit', confidence: 1, now: 5 });
    expect(collision.status).toBe('needs_review');
    expect(aliases.resolve('brain', '调度')).toBeUndefined();
  } finally {
    db.close();
  }
});

test('topic alias, relation, removal, and split operations all roll back without residue', () => {
  const db = topicDb();
  try {
    const paths = new TopicPathRegistry(db);
    const aliases = new TopicAliasRegistry(db);
    const relations = new TopicRelationGraph(db);
    const governance = new TopicGovernance(db, paths, aliases, relations);
    const source = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_CREATE', actor: 'user_explicit',
      payload: { topicPath: 'cogmem/assembler', canonicalName: 'Assembler', ontologyClass: 'Topic' }, now: 1,
    });
    const target = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_CREATE', actor: 'user_explicit',
      payload: { topicPath: 'cogmem/dream', canonicalName: 'Dream', ontologyClass: 'Topic' }, now: 2,
    });
    const alias = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_ALIAS', actor: 'user_explicit', targetTopicId: source.targetTopicId,
      payload: { alias: '事件组装器' }, now: 3,
    });
    governance.rollback(alias.operationId, 'brain', 4);
    expect(aliases.resolve('brain', '事件组装器')).toBeUndefined();

    const relation = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_RELATION_ADD', actor: 'user_explicit', targetTopicId: source.targetTopicId,
      payload: { relation: 'PRECEDES', targetTopicId: target.targetTopicId }, now: 5,
    });
    governance.rollback(relation.operationId, 'brain', 6);
    expect(relations.get((relation.after as { relationId: string }).relationId)?.status).toBe('archived');

    const activeRelation = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_RELATION_ADD', actor: 'user_explicit', targetTopicId: source.targetTopicId,
      payload: { relation: 'PRECEDES', targetTopicId: target.targetTopicId }, now: 7,
    });
    const relationId = (activeRelation.after as { relationId: string }).relationId;
    const removal = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_RELATION_REMOVE', actor: 'user_explicit', targetTopicId: source.targetTopicId,
      payload: { relationId }, now: 8,
    });
    governance.rollback(removal.operationId, 'brain', 9);
    expect(relations.get(relationId)?.status).toBe('active');

    const split = governance.apply({
      projectId: 'brain', operationType: 'USER_DEFINED_TOPIC_SPLIT', actor: 'user_explicit', targetTopicId: source.targetTopicId,
      payload: { topicPath: 'cogmem/assembler/repair', canonicalName: 'Repair' }, now: 10,
    });
    governance.rollback(split.operationId, 'brain', 11);
    expect(paths.getByPath('brain', 'cogmem/assembler/repair')).toBeUndefined();
  } finally {
    db.close();
  }
});

test('classifier defaults unknown turns to review and distinguishes question answers from proposals', async () => {
  expect(classifyTurnRelation({ currentUserText: '我今天看了一个新的数据库实现。' })).toEqual(expect.objectContaining({
    relation: 'ambiguous_shift', needsLlmReview: true,
  }));
  expect(classifyTurnRelation({ currentUserText: '对', previousAssistantText: '部署完成了吗？' }).relation)
    .toBe('answers_assistant_question');
  expect(classifyTurnRelation({ currentUserText: '不对', previousAssistantText: '部署完成了吗？' }).relation)
    .toBe('corrects_previous');
  expect(classifyTurnRelation({ currentUserText: '对', previousAssistantText: '部署已经完成。' }).relation)
    .toBe('confirms_assistant_fact');
  expect(classifyTurnRelation({ currentUserText: '继续检查事件组装器', currentTopicPath: 'cogmem/episode-assembler' }))
    .toEqual(expect.objectContaining({ topicPath: 'cogmem/episode-assembler' }));

  const reviewed = await classifyTurnRelationHybrid({ currentUserText: '一个隐含的新话题。' }, {
    review: async () => ({
      relation: 'starts_new_topic', confidence: 3, topicPath: 'cogmem/new-topic', episodeType: 'planning',
      importance: 0.84, switchKind: 'hard', importanceSignals: ['semantic_topic_change'], rationale: 'semantic shift',
    }),
  });
  expect(reviewed).toEqual(expect.objectContaining({
    relation: 'starts_new_topic', confidence: 1, topicPath: 'cogmem/new-topic', episodeType: 'planning',
    importance: 0.84, switchKind: 'hard', importanceSignals: ['semantic_topic_change'],
  }));
});

test('background assembler invokes hybrid review while foreground remains synchronous', async () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  let reviews = 0;
  const assembler = new EpisodeAssembler(store, undefined, 30 * 60_000, {
    review: async () => { reviews += 1; return { relation: 'starts_new_topic', confidence: 0.9, switchKind: 'hard' }; },
  });
  const event = {
    eventId: 'evt-user', eventType: 'RAW_EVENT_RECORDED', rawEventType: 'message', projectId: 'brain',
    sessionId: 's1', threadId: 't1', role: 'user', occurredAt: 100, payload: { text: '未知话题' },
  } as never;
  try {
    assembler.appendTurn([event], { projectId: 'brain', sessionId: 's1' });
    expect(reviews).toBe(0);
    const other = { ...event, eventId: 'evt-user-2', occurredAt: 200, payload: { text: '完全不同的隐含话题' } } as never;
    await assembler.appendTurnAsync([other], { projectId: 'brain', sessionId: 's1' });
    expect(reviews).toBe(1);
  } finally {
    db.close();
  }
});

test('Cogmem block stripping handles case, nesting, unclosed blocks, and payload whitelists', () => {
  const stripper = new CogmemBlockStripper({ maxBlockChars: 128 });
  expect(stripper.strip('keep <cogmem_recall_context>secret</COGMEM_RECALL_CONTEXT> end')).toBe('keep end');
  expect(stripper.strip('a <COGMEM_TURN_BRIDGE>x <COGMEM_SESSION_STATE>y</COGMEM_SESSION_STATE> z</COGMEM_TURN_BRIDGE> b')).toBe('a b');
  expect(stripper.strip('before <COGMEM_STRATEGY_CONTEXT>never closed')).toBe('before');
  expect(eventTextForMemory({ payload: { summary: 'safe summary', secret: 'must not leak' } } as never)).toBe('safe summary');
  expect(eventTextForMemory({ payload: { secret: 'must not leak' } } as never)).toBe('');
});

test('manual reseal creates an audit receipt and empty normal seals fail', () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  try {
    const empty = store.createEpisode({
      projectId: 'brain', sessionId: 'empty', episodeType: 'discussion', importance: 0.2,
      eventId: 'evt-empty', occurredAt: 1,
    });
    expect(() => store.sealEpisode(empty.episodeId, { mode: 'manual', reason: 'manual' })).toThrow('episode_empty');
    const review = store.sealEpisode(empty.episodeId, { mode: 'soft', reason: 'idle' });
    expect(review).toEqual(expect.objectContaining({ requiresReview: true, dreamRecommended: false }));

    const episode = store.createEpisode({
      projectId: 'brain', sessionId: 'non-empty', episodeType: 'discussion', importance: 0.5,
      eventId: 'evt-1', occurredAt: 10,
    });
    store.appendEvent({ episodeId: episode.episodeId, eventId: 'evt-1', relation: 'continues_previous', confidence: 1, occurredAt: 10 });
    const first = store.sealEpisode(episode.episodeId, { mode: 'manual', reason: 'first', now: 11 });
    const second = store.sealEpisode(episode.episodeId, { mode: 'manual', reason: 'repair', reasonCode: 'repair', now: 12 });
    expect(second.receiptId).not.toBe(first.receiptId);
    expect(store.listClosureReceipts({ episodeId: episode.episodeId })).toHaveLength(2);
  } finally {
    db.close();
  }
});

test('import batch sealing rejects empty episodes before they enter Dream backlog', () => {
  const kernel = createMemoryKernel({ dbPath: ':memory:', vectorBackend: 'sqlite-vec' });
  try {
    const empty = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'empty-import', episodeType: 'discussion', importance: 0.2,
      eventId: 'evt-empty-import', occurredAt: 1,
    });

    expect(() => kernel.sealImportedEpisode(empty.episodeId, { reason: 'openclaw_import_batch_boundary' }))
      .toThrow('episode_empty');
    expect(kernel.getEpisode(empty.episodeId)).toEqual(expect.objectContaining({
      status: 'open',
      dreamStatus: 'none',
    }));
    expect(kernel.getEpisodeDreamStatus('brain').pending).toBe(0);
  } finally {
    kernel.close();
  }
});
