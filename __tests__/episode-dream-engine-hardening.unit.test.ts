import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DreamScheduler } from '../src/dream/DreamScheduler.js';
import { EpisodeStore } from '../src/episode/EpisodeStore.js';
import {
  classifyAssistantRelation,
  classifyTurnRelation,
  classifyTurnRelationHybrid,
} from '../src/episode/TurnRelationClassifier.js';
import { createStableImportIdentityFactory } from '../src/episode/EpisodeImportIdentity.js';
import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';
import { migration_0022, migration_0023 } from '../src/migrations/index.js';

function createTestKernel(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, kernel: createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' }) };
}

test('rich classifier resolves short user replies against assistant context', () => {
  expect(classifyTurnRelation({
    currentUserText: '第二个',
    previousAssistantText: '可以选 A 或 B，我建议第二个方案。',
  })).toEqual(expect.objectContaining({
    relation: 'accepts_assistant_proposal',
    confidence: expect.any(Number),
    needsLlmReview: false,
  }));
  expect(classifyTurnRelation({
    currentUserText: '对',
    previousAssistantText: '确认采用 3.5.1 加固方案，可以吗？',
  }).relation).toBe('accepts_assistant_proposal');
  expect(classifyTurnRelation({
    currentUserText: '不对',
    previousAssistantText: '下一版直接在线运行 Dream。',
  }).relation).toBe('rejects_assistant_proposal');
  expect(classifyTurnRelation({
    currentUserText: '继续',
    previousAssistantText: '下面解释 Episode Scheduler。',
  }).relation).toBe('continues_previous');
  expect(classifyTurnRelation({
    currentUserText: '东京',
    previousAssistantText: '部署目标区域是哪里？',
  }).relation).toBe('answers_assistant_question');
});

test('classifier distinguishes corrections and safe topic movement', () => {
  const correction = classifyTurnRelation({
    currentUserText: '不是，我不是说不跑，是不要每轮跑。',
    previousAssistantText: '你希望 Dream 完全不运行。',
    activeEpisodeTopicPath: 'PROJECT/Cogmem/episode-dream',
  });
  expect(correction).toEqual(expect.objectContaining({
    relation: 'corrects_previous',
    closureCandidate: false,
    candidateTypes: expect.arrayContaining(['correction']),
  }));

  expect(classifyTurnRelation({
    currentUserText: '另外，Hermes 的 MCP 也要兼容这个 Dream 方案。',
    activeEpisodeSummary: 'Cogmem Episode Dream scheduling design',
    activeEpisodeTopicPath: 'PROJECT/Cogmem/episode-dream',
  })).toEqual(expect.objectContaining({ relation: 'subtopic_shift', switchKind: 'subtopic' }));

  expect(classifyTurnRelation({
    currentUserText: '换个话题，我的车烧机油怎么办？',
    activeEpisodeSummary: 'Cogmem Episode Dream scheduling design',
  })).toEqual(expect.objectContaining({ relation: 'hard_topic_switch', switchKind: 'hard', closureCandidate: true }));

  expect(classifyTurnRelation({
    currentUserText: '另一个问题，这个之后再说。',
    activeEpisodeSummary: 'Cogmem Episode Dream scheduling design',
  })).toEqual(expect.objectContaining({ relation: 'ambiguous_shift', switchKind: 'ambiguous', needsLlmReview: true }));
});

test('assistant and tool events use explicit relation semantics', () => {
  expect(classifyAssistantRelation('这是问题的直接答案。')).toBe('assistant_response');
  expect(classifyAssistantRelation('建议采用第二个方案，是否确认？')).toBe('assistant_proposal');
  expect(classifyAssistantRelation('你希望我继续吗？')).toBe('assistant_question');
  expect(classifyAssistantRelation('总结：本轮只做加固。')).toBe('assistant_summary');
  expect(classifyAssistantRelation('我的意思是这里仅生成候选。')).toBe('assistant_clarification');
  expect(classifyAssistantRelation('command output', 'tool')).toBe('tool_result_context');
});

test('hybrid classification reviews only ambiguous cases and ignores mutation-shaped model output', async () => {
  let calls = 0;
  const decision = await classifyTurnRelationHybrid({
    currentUserText: '另一个问题，这个之后再说。',
    activeEpisodeSummary: 'Cogmem episode design',
  }, {
    review: async () => {
      calls += 1;
      return {
        relation: 'subtopic_shift', confidence: 0.84, candidateTypes: ['decision', 'not_allowed'],
        rationale: 'same project subtopic', beliefWrite: { status: 'active' }, toolCalls: ['delete'],
      };
    },
  });
  expect(calls).toBe(1);
  expect(decision).toEqual(expect.objectContaining({
    relation: 'subtopic_shift', confidence: 0.84, candidateTypes: ['decision'],
    signals: expect.arrayContaining(['advisory_review_applied']),
  }));
  expect(decision).not.toHaveProperty('beliefWrite');
  expect(decision).not.toHaveProperty('toolCalls');

  await classifyTurnRelationHybrid({ currentUserText: '继续' }, { review: async () => { calls += 1; return {}; } });
  expect(calls).toBe(1);
});

test('stable generated import identities do not depend on line position', () => {
  const original = createStableImportIdentityFactory('hermes', 'session-1');
  const inserted = createStableImportIdentityFactory('hermes', 'session-1');
  const first = original({ role: 'user', timestamp: 100, text: 'first' });
  const second = original({ role: 'assistant', timestamp: 101, text: 'second' });

  inserted({ role: 'system', timestamp: 99, text: 'inserted line' });
  expect(inserted({ role: 'user', timestamp: 100, text: 'first' })).toBe(first);
  expect(inserted({ role: 'assistant', timestamp: 101, text: 'second' })).toBe(second);

  const duplicates = createStableImportIdentityFactory('hermes', 'session-1');
  const duplicateA = duplicates({ role: 'user', timestamp: 200, text: 'same' });
  const duplicateB = duplicates({ role: 'user', timestamp: 200, text: 'same' });
  expect(duplicateA).not.toBe(duplicateB);
  expect(duplicateB).toEndWith('-2');
});

test('streaming import resume preserves occurrence identity across checkpoint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-episode-resume-'));
  const dbPath = join(dir, 'memory.db');
  const inputPath = join(dir, 'session.jsonl');
  const checkpointPath = `${inputPath}.cogmem-checkpoint.json`;
  const line = JSON.stringify({ role: 'user', text: 'same repeated message', timestamp: 100 });
  const run = async (args: string[]) => {
    const proc = Bun.spawn([process.execPath, 'src/bin/episode.ts', ...args], {
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(code, stderr).toBe(0);
    return JSON.parse(stdout) as Record<string, unknown>;
  };
  const args = [
    'import', '--db', dbPath, '--project', 'brain', '--session', 's1', '--source-agent', 'hermes',
    '--file', inputPath, '--checkpoint-file', checkpointPath, '--json',
  ];
  try {
    writeFileSync(inputPath, line);
    expect(await run(args)).toEqual(expect.objectContaining({ imported: 1, duplicates: 0 }));
    writeFileSync(inputPath, `${line}\n${line}`);
    expect(await run([...args, '--resume'])).toEqual(expect.objectContaining({ imported: 1, duplicates: 0, processed: 1 }));

    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
    try {
      expect(kernel.eventStore.getEventCount()).toBe(2);
    } finally {
      kernel.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test('Dream retry distinguishes retryable and terminal failures and exposes episode dream status', async () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  let error = new Error('provider_rate_limited');
  const scheduler = new DreamScheduler(store, { run: async () => { throw error; } } as never);
  try {
    const retryable = store.createEpisode({
      projectId: 'brain', sessionId: 'retryable', episodeType: 'discussion', importance: 0.6,
      eventId: 'evt-retryable', occurredAt: 100,
    });
    store.appendEvent({ episodeId: retryable.episodeId, eventId: 'evt-retryable', relation: 'continues_previous', confidence: 1, occurredAt: 100 });
    store.sealEpisode(retryable.episodeId, { mode: 'hard', reason: 'manual', now: 101 });
    expect(store.getEpisode(retryable.episodeId)).toEqual(expect.objectContaining({ dreamStatus: 'queued' }));

    await scheduler.tick({ projectId: 'brain', now: 200 });
    expect(store.getDreamStatus('brain')).toEqual(expect.objectContaining({ failedRetryable: 1, failedTerminal: 0 }));
    expect(store.getEpisode(retryable.episodeId)).toEqual(expect.objectContaining({ dreamStatus: 'failed', dreamError: 'provider_rate_limited' }));
    expect((await scheduler.tick({ projectId: 'brain', now: 201 })).skipped).toBe(true);

    expect(store.retryFailed('brain')).toBe(1);
    expect(store.getEpisode(retryable.episodeId)).toEqual(expect.objectContaining({ dreamStatus: 'queued' }));

    error = new Error('candidate_evidence_outside_episode');
    await scheduler.tick({ projectId: 'brain', now: 300 });
    expect(store.getDreamStatus('brain')).toEqual(expect.objectContaining({ failedRetryable: 0, failedTerminal: 1 }));
    expect(store.retryFailed('brain')).toBe(0);
  } finally {
    db.close();
  }
});

test('Dream tick skips empty mature soft seals and still processes valid sealed episodes', async () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  const processed: string[] = [];
  const scheduler = new DreamScheduler(store, {
    run: async (options: { sourceEpisodeId: string }) => {
      processed.push(options.sourceEpisodeId);
      return { candidates: [] };
    },
  } as never);
  try {
    const empty = store.createEpisode({
      projectId: 'brain', sessionId: 'empty-soft', episodeType: 'discussion', importance: 0.9,
      eventId: 'evt-empty', occurredAt: 1,
    });
    store.sealEpisode(empty.episodeId, { mode: 'soft', reason: 'batch_low_confidence_review', now: 2 });

    const valid = store.createEpisode({
      projectId: 'brain', sessionId: 'valid-sealed', episodeType: 'discussion', importance: 0.5,
      eventId: 'evt-valid', occurredAt: 10,
    });
    store.appendEvent({ episodeId: valid.episodeId, eventId: 'evt-valid', relation: 'continues_previous', confidence: 1, occurredAt: 10 });
    store.sealEpisode(valid.episodeId, { mode: 'hard', reason: 'manual', now: 11 });

    const result = await scheduler.tick({ projectId: 'brain', now: 10_000, softSealGraceMs: 0 });

    expect(result).toEqual(expect.objectContaining({ processedEpisodeCount: 1, failedEpisodeCount: 0 }));
    expect(processed).toEqual([valid.episodeId]);
    expect(store.getEpisode(empty.episodeId)).toEqual(expect.objectContaining({
      status: 'soft_sealed',
      dreamStatus: 'failed',
      dreamError: 'episode_empty_soft_seal_not_promoted',
    }));
  } finally {
    db.close();
  }
});

test('Dream claim skips legacy empty jobs without consuming the batch slot', () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  try {
    const empty = store.createEpisode({
      projectId: 'brain', sessionId: 'empty-job', episodeType: 'discussion', importance: 1,
      eventId: 'evt-empty-job', occurredAt: 1,
    });
    db.prepare(`
      INSERT INTO episode_dream_jobs (episode_id, project_id, state, priority, mode_hint, created_at, updated_at)
      VALUES (?, ?, 'pending', 100, 'normal', 1, 1)
    `).run(empty.episodeId, 'brain');

    const valid = store.createEpisode({
      projectId: 'brain', sessionId: 'valid-job', episodeType: 'discussion', importance: 0.5,
      eventId: 'evt-valid-job', occurredAt: 2,
    });
    store.appendEvent({
      episodeId: valid.episodeId, eventId: 'evt-valid-job', relation: 'continues_previous',
      confidence: 1, occurredAt: 2,
    });
    store.sealEpisode(valid.episodeId, { mode: 'hard', reason: 'manual', now: 3 });

    const claimed = store.claimDreamJobs({ projectId: 'brain', limit: 1, now: 4, leaseMs: 60_000, maxAttempts: 3 });

    expect(claimed).toEqual([expect.objectContaining({ episodeId: valid.episodeId })]);
    expect(store.getDreamStatus('brain')).toEqual(expect.objectContaining({ skipped: 1, processing: 1 }));
    expect(store.getEpisode(empty.episodeId)).toEqual(expect.objectContaining({
      dreamStatus: 'failed',
      dreamError: 'episode_empty_skipped_no_raw_evidence',
    }));
  } finally {
    db.close();
  }
});

test('migration 23 backfills episode Dream state from existing 3.5.0 jobs', () => {
  const db = new Database(':memory:');
  try {
    migration_0022.up(db);
    db.prepare(`
      INSERT INTO memory_episodes (
        episode_id, project_id, session_id, source_agent, topic_path, episode_type, status, importance,
        summary, start_event_id, end_event_id, start_seq, end_seq, event_count, started_at, updated_at, sealed_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?)
    `).run('episode-old', 'brain', 's1', 'openclaw', 'discussion', 'sealed', 0.7, 'evt-1', 'evt-1', 1, 100, 200, 150);
    db.prepare(`
      INSERT INTO episode_dream_jobs (
        episode_id, project_id, state, priority, mode_hint, attempts, lease_id, lease_until,
        last_error, candidate_ids_json, created_at, updated_at
      ) VALUES (?, ?, 'processed', 70, 'normal', 1, NULL, NULL, NULL, ?, 150, 220)
    `).run('episode-old', 'brain', JSON.stringify(['candidate-1', 'candidate-2']));

    migration_0023.up(db);
    expect(db.prepare(`
      SELECT dream_status, last_dreamed_at, dream_candidate_count, dream_error
      FROM memory_episodes WHERE episode_id = 'episode-old'
    `).get()).toEqual({
      dream_status: 'processed', last_dreamed_at: 220, dream_candidate_count: 2, dream_error: null,
    });
  } finally {
    db.close();
  }
});

test('Dream mode is passed to curator and changes the candidate limit', async () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  const calls: Array<Record<string, unknown>> = [];
  const scheduler = new DreamScheduler(store, {
    run: async (options: Record<string, unknown>) => {
      calls.push(options);
      return { candidates: [] };
    },
  } as never);
  try {
    const episode = store.createEpisode({
      projectId: 'brain', sessionId: 'mode', episodeType: 'decision', importance: 0.9,
      eventId: 'evt-mode', occurredAt: 100,
    });
    store.appendEvent({ episodeId: episode.episodeId, eventId: 'evt-mode', relation: 'continues_previous', confidence: 1, occurredAt: 100 });
    store.sealEpisode(episode.episodeId, { mode: 'hard', reason: 'manual', now: 101 });
    await scheduler.tick({ projectId: 'brain', mode: 'micro', now: 200 });
    expect(calls).toEqual([expect.objectContaining({ dreamMode: 'micro', maxCandidates: 20, limit: 20 })]);
  } finally {
    db.close();
  }
});

test('assembled episodes use previous assistant context and seal with a non-evidence semantic summary', () => {
  const { dir, kernel } = createTestKernel('cogmem-episode-context-');
  try {
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'openclaw', role: 'assistant',
      text: '建议采用第二个方案，可以吗？', externalMessageId: 'a1',
    });
    expect(kernel.listEpisodes({ projectId: 'brain' })[0]).toEqual(expect.objectContaining({
      candidateTypes: [], importanceSignals: ['non_user_context_only'],
    }));
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'openclaw', role: 'user',
      text: '对', externalMessageId: 'u1',
    });
    const episode = kernel.listEpisodes({ projectId: 'brain' })[0];
    const links = kernel.listEpisodeEventLinks(episode.episodeId);
    expect(links.map((link) => link.relation)).toEqual(['assistant_proposal', 'accepts_assistant_proposal']);

    kernel.sealEpisode(episode.episodeId, { mode: 'manual', reason: 'manual' });
    const sealed = kernel.getEpisode(episode.episodeId)!;
    expect(sealed.semanticSummary).toEqual(expect.objectContaining({
      evidenceAuthority: 'raw_event_ids_only',
      evidenceEventIds: links.map((link) => link.eventId),
    }));
    expect(sealed.semanticSummary?.userPosition).toContain('对');
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('active episode scope separates source agents and conversation threads', () => {
  const { dir, kernel } = createTestKernel('cogmem-episode-scope-');
  try {
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'shared', sourceAgent: 'openclaw', threadId: 'thread-a',
      role: 'user', text: 'OpenClaw thread', externalMessageId: 'm1',
    });
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'shared', sourceAgent: 'hermes', threadId: 'thread-a',
      role: 'user', text: 'Hermes thread', externalMessageId: 'm1',
    });
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'shared', sourceAgent: 'openclaw', threadId: 'thread-b',
      role: 'user', text: 'Second OpenClaw thread', externalMessageId: 'm2',
    });
    expect(kernel.listEpisodes({ projectId: 'brain' })).toHaveLength(3);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('active episode lookup reuses only unscoped legacy episodes after upgrade', () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  try {
    const legacy = store.createEpisode({
      projectId: 'brain', sessionId: 'legacy', episodeType: 'discussion', importance: 0.5,
      eventId: 'evt-legacy', occurredAt: 100,
    });
    const foundLegacy = store.findActiveEpisode('brain', 'legacy', 'openclaw', 'thread-a');
    expect(foundLegacy?.episodeId).toBe(legacy.episodeId);
    expect(store.claimLegacyEpisodeScope(foundLegacy!.episodeId, 'openclaw', 'thread-a')).toEqual(expect.objectContaining({
      sourceAgent: 'openclaw', conversationThreadId: 'thread-a',
    }));
    expect(store.findActiveEpisode('brain', 'legacy', 'hermes', 'thread-a')).toBeUndefined();

    const scoped = store.createEpisode({
      projectId: 'brain', sessionId: 'scoped', sourceAgent: 'openclaw', conversationThreadId: 'thread-a',
      episodeType: 'discussion', importance: 0.5, eventId: 'evt-scoped', occurredAt: 100,
    });
    expect(store.findActiveEpisode('brain', 'scoped', 'openclaw', 'thread-a')?.episodeId).toBe(scoped.episodeId);
    expect(store.findActiveEpisode('brain', 'scoped', 'hermes', 'thread-a')).toBeUndefined();
  } finally {
    db.close();
  }
});

test('MCP dream tick is recommendation-only without maintenance mode and status explains hookless lag', async () => {
  const { dir, kernel } = createTestKernel('cogmem-episode-mcp-guard-');
  try {
    const emptyStatus = await callCogmemMcpTool('cogmem_episode_status', { projectId: 'hermes' }, { kernel });
    expect(emptyStatus.structuredContent).toEqual(expect.objectContaining({
      recentRawAvailable: false,
      warnings: ['no_recent_episode_ingestion_detected'],
    }));

    const oversized = await callCogmemMcpTool('cogmem_episode_append', {
      projectId: 'hermes', sessionId: 's1', sourceAgent: 'hermes', role: 'user',
      text: 'x'.repeat(16_001), externalMessageId: 'too-large',
    }, { kernel });
    expect(oversized.isError).toBe(true);

    await callCogmemMcpTool('cogmem_episode_append', {
      projectId: 'hermes', sessionId: 's1', sourceAgent: 'hermes', role: 'user',
      text: '请记住这个维护边界。', externalMessageId: 'm1',
    }, { kernel });
    const episode = kernel.listEpisodes({ projectId: 'hermes' })[0];
    kernel.sealEpisode(episode.episodeId, { mode: 'manual', reason: 'manual' });

    const dryRun = await callCogmemMcpTool('cogmem_dream_tick', { projectId: 'hermes' }, { kernel });
    expect(dryRun.structuredContent).toEqual(expect.objectContaining({ dryRun: true, maintenanceModeRequired: true }));
    expect(kernel.getEpisodeDreamStatus('hermes').pending).toBe(1);

    const run = await callCogmemMcpTool('cogmem_dream_tick', { projectId: 'hermes', maintenanceMode: true }, { kernel });
    expect(run.structuredContent).toEqual(expect.objectContaining({ skipped: false, processedEpisodeCount: 1 }));
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('decision episodes emit temporal candidates and confirmed assistant proposals keep paired evidence', async () => {
  const { dir, kernel } = createTestKernel('cogmem-episode-decision-');
  try {
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'decision', sourceAgent: 'openclaw', role: 'user',
      text: '我们决定采用 3.5.1 加固方案。', externalMessageId: 'd1',
    });
    const decisionEpisode = kernel.listEpisodes({ projectId: 'brain', sessionId: 'decision' })[0];
    kernel.sealEpisode(decisionEpisode.episodeId, { mode: 'manual', reason: 'manual' });

    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'proposal', sourceAgent: 'openclaw', role: 'assistant',
      text: '建议下一版只做 Episode Dream 加固，可以吗？', externalMessageId: 'p1',
    });
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'proposal', sourceAgent: 'openclaw', role: 'user',
      text: '对', externalMessageId: 'p2',
    });
    const proposalEpisode = kernel.listEpisodes({ projectId: 'brain', sessionId: 'proposal' })[0];
    kernel.sealEpisode(proposalEpisode.episodeId, { mode: 'manual', reason: 'manual' });

    await kernel.runDreamTick({ projectId: 'brain', mode: 'normal' });
    const candidates = kernel.listDreamCandidates({ projectId: 'brain', statuses: ['candidate'], limit: 200 });
    expect(candidates.some((candidate) => candidate.candidateType === 'temporal_fact_update'
      && (candidate.content as Record<string, unknown>).timelineType === 'decision')).toBe(true);
    const confirmed = candidates.find((candidate) => (candidate.content as Record<string, unknown>).evidenceKind === 'assistant_proposal_confirmed_by_user');
    expect(confirmed?.evidence).toEqual([
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({ role: 'user' }),
    ]);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('episode Dream rejects all-summary evidence and normalizes exact raw evidence ids', async () => {
  const { dir, kernel } = createTestKernel('cogmem-episode-exact-evidence-');
  try {
    const appended = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'evidence', sourceAgent: 'openclaw', role: 'user',
      text: 'Episode Dream 候选必须引用原始事件。', externalMessageId: 'e1',
    });
    const result = await kernel.runDreamCurator({
      projectId: 'brain', eventIds: [appended.eventId], sourceEpisodeId: appended.episodeId,
      sourceEpisodeEventIds: [appended.eventId], dreamMode: 'micro',
      generateText: async () => JSON.stringify({
        projectMemoryCandidates: [
          { statement: 'summary-only must be rejected', confidence: 0.8, evidenceEventIds: ['all'] },
          { statement: 'exact evidence survives', confidence: 0.8, evidenceEventIds: [appended.eventId] },
        ],
      }),
    });
    const providerCandidates = result.candidates.filter((candidate) =>
      JSON.stringify(candidate.content).includes('llm_dream_curator_candidate'));
    expect(providerCandidates).toHaveLength(1);
    expect(providerCandidates[0].content).toEqual(expect.objectContaining({
      statement: 'exact evidence survives', evidenceEventIds: [appended.eventId], evidenceAuthority: 'raw_event_ids_only',
    }));
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orphan correction candidates cannot be promoted without a target', async () => {
  const { dir, kernel } = createTestKernel('cogmem-episode-correction-');
  try {
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'correction', sourceAgent: 'openclaw', role: 'user',
      text: '不对，旧结论需要纠正，但这里还没有找到旧 belief。', externalMessageId: 'c1',
    });
    const episode = kernel.listEpisodes({ projectId: 'brain' })[0];
    kernel.sealEpisode(episode.episodeId, { mode: 'manual', reason: 'manual' });
    await kernel.runDreamTick({ projectId: 'brain' });
    kernel.promoteDreamCandidates({ projectId: 'brain', limit: 200 });
    const correction = kernel.listDreamCandidates({
      projectId: 'brain', candidateTypes: ['correction'], statuses: ['needs_confirmation'], limit: 20,
    })[0];
    expect(correction).toEqual(expect.objectContaining({ statusReason: 'orphan_correction_requires_target_review' }));
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
