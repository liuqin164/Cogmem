import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DreamScheduler } from '../src/dream/DreamScheduler.js';
import { EpisodeStore } from '../src/episode/EpisodeStore.js';
import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';
import { migration_0022 } from '../src/migrations/0022_episode_dream_engine.js';
import { migration_0023 } from '../src/migrations/0023_episode_dream_hardening.js';
import { migration_0024 } from '../src/migrations/0024_episode_ontology_reliability.js';

function createTestKernel(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, kernel: createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' }) };
}

test('episode provider candidates reject invalid evidence and cannot override CPU project ownership', async () => {
  const { dir, kernel } = createTestKernel('cogmem-provider-evidence-');
  try {
    const event = kernel.recordRawEvent({
      projectId: 'brain', workspaceId: 'brain', sessionId: 's1', threadId: 't1', role: 'user',
      content: 'The episode assembler belongs to Cogmem.', sourceId: 'openclaw:s1',
    });
    const invalid = await kernel.runDreamCurator({
      projectId: 'brain', eventIds: [event.eventId], sourceEpisodeId: 'episode-1', sourceEpisodeEventIds: [event.eventId],
      generateText: async () => JSON.stringify({ topicSummaryCandidates: [{ claim: 'bad', evidenceEventIds: ['missing'], projectId: 'other' }] }),
    });
    expect(invalid.candidates.some((candidate) => candidate.content.claim === 'bad')).toBe(false);

    const valid = await kernel.runDreamCurator({
      projectId: 'brain', eventIds: [event.eventId], sourceEpisodeId: 'episode-1', sourceEpisodeEventIds: [event.eventId],
      generateText: async () => JSON.stringify({ topicSummaryCandidates: [{ claim: 'good', evidenceEventIds: [event.eventId], projectId: 'other' }] }),
    });
    const provider = valid.candidates.find((candidate) => candidate.content.claim === 'good')!;
    expect(provider.content.projectId).toBe('brain');
    expect(provider.content.providerProjectIdWarning).toBe('other');
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assistant-only decision needs confirmation and summary candidates are non-durable hints', async () => {
  const { dir, kernel } = createTestKernel('cogmem-assistant-decision-');
  try {
    const event = kernel.recordRawEvent({
      projectId: 'brain', workspaceId: 'brain', sessionId: 's1', threadId: 't1', role: 'assistant',
      content: 'We decided to deploy tomorrow.', sourceId: 'openclaw:s1',
    });
    const run = await kernel.runDreamCurator({
      projectId: 'brain', eventIds: [event.eventId], sourceEpisodeId: 'episode-1', sourceEpisodeEventIds: [event.eventId],
      episodeType: 'decision', semanticSummary: {
        userPosition: '', assistantContribution: 'deploy tomorrow', decision: 'deploy tomorrow', openQuestions: [],
        candidateTypes: ['decision'], evidenceEventIds: [event.eventId], evidenceAuthority: 'raw_event_ids_only',
      },
    });
    const temporal = run.candidates.find((candidate) => candidate.candidateType === 'temporal_fact_update');
    expect(temporal?.status).toBe('needs_confirmation');
    expect(temporal?.content).toEqual(expect.objectContaining({ notDurableWithoutUserEvidence: true }));
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auto Dream mode is selected per job and failure details are returned and persisted', async () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  const modes: string[] = [];
  const scheduler = new DreamScheduler(store, {
    run: async (options: { dreamMode: string; sourceEpisodeId: string }) => {
      modes.push(options.dreamMode);
      if (options.sourceEpisodeId.endsWith('fail')) throw new Error('provider_timeout');
      return { candidates: [] };
    },
  } as never);
  try {
    const create = (episodeId: string, importance: number, type: 'decision' | 'discussion') => {
      const episode = store.createEpisode({ projectId: 'brain', sessionId: episodeId, episodeType: type, importance, eventId: `evt-${episodeId}`, occurredAt: 1 });
      store.appendEvent({ episodeId: episode.episodeId, eventId: `evt-${episodeId}`, relation: 'continues_previous', confidence: 1, occurredAt: 1 });
      store.sealEpisode(episode.episodeId, { mode: 'hard', reason: 'test', now: 2 });
      return episode;
    };
    create('micro', 0.9, 'decision');
    const fail = create('normal', 0.5, 'discussion');
    db.prepare(`UPDATE memory_episodes SET episode_id = ? WHERE episode_id = ?`).run(`${fail.episodeId}-fail`, fail.episodeId);
    db.prepare(`UPDATE memory_episode_events SET episode_id = ? WHERE episode_id = ?`).run(`${fail.episodeId}-fail`, fail.episodeId);
    db.prepare(`UPDATE episode_dream_jobs SET episode_id = ? WHERE episode_id = ?`).run(`${fail.episodeId}-fail`, fail.episodeId);
    db.prepare(`UPDATE episode_closure_receipts SET episode_id = ? WHERE episode_id = ?`).run(`${fail.episodeId}-fail`, fail.episodeId);

    const result = await scheduler.tick({ projectId: 'brain', mode: 'auto', now: 100 });
    expect(modes.sort()).toEqual(['micro', 'normal']);
    expect(result.selectedModes).toEqual({ micro: 1, normal: 1, deep: 0 });
    expect(result.failedEpisodes).toEqual([expect.objectContaining({ failureCategory: 'transient_provider', retryAfter: expect.any(Number) })]);
    const persisted = db.prepare(`SELECT failed_episode_ids_json, failure_details_json FROM episode_dream_runs WHERE run_id = ?`).get(result.runId) as Record<string, string>;
    expect(JSON.parse(persisted.failed_episode_ids_json)).toEqual(result.failedEpisodes.map((item) => item.episodeId));
    expect(JSON.parse(persisted.failure_details_json)).toHaveLength(1);
  } finally {
    db.close();
  }
});

test('auto Dream recommends deep work for a daily maintenance window', async () => {
  const db = new Database(':memory:');
  const store = new EpisodeStore(db);
  const modes: string[] = [];
  const scheduler = new DreamScheduler(store, {
    run: async (options: { dreamMode: string }) => { modes.push(options.dreamMode); return { candidates: [] }; },
  } as never);
  try {
    const episode = store.createEpisode({
      projectId: 'brain', sessionId: 'daily', episodeType: 'discussion', importance: 0.5,
      eventId: 'evt-daily', occurredAt: 1,
    });
    store.appendEvent({ episodeId: episode.episodeId, eventId: 'evt-daily', relation: 'continues_previous', confidence: 1, occurredAt: 1 });
    store.sealEpisode(episode.episodeId, { mode: 'hard', reason: 'test', now: 2 });
    const result = await scheduler.tick({ projectId: 'brain', mode: 'auto', maintenanceReason: 'daily', now: 100 });
    expect(modes).toEqual(['deep']);
    expect(result.selectedModes).toEqual({ micro: 0, normal: 0, deep: 1 });
  } finally {
    db.close();
  }
});

test('MCP import reports per-message checkpoints and warns for generated split-batch identity', async () => {
  const { dir, kernel } = createTestKernel('cogmem-mcp-import-report-');
  try {
    const result = await callCogmemMcpTool('cogmem_episode_import', {
      projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes',
      messages: [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'second', externalMessageId: 'a2' }],
    }, { kernel });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expect.objectContaining({
      processedCount: 2,
      messageResults: [expect.objectContaining({ index: 0, processed: true }), expect.objectContaining({ index: 1, processed: true })],
      warnings: ['auto_identity_not_safe_across_split_batches'],
    }));
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP append/import use the background hybrid classifier while foreground append stays CPU-only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-mcp-hybrid-'));
  let reviews = 0;
  const kernel = createMemoryKernel({
    dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec',
    turnRelationReviewer: { review: async () => { reviews += 1; return { relation: 'starts_new_topic', confidence: 0.9 }; } },
  });
  try {
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'foreground', sourceAgent: 'openclaw', role: 'user', text: '前台未知话题', externalMessageId: 'fg-1',
    });
    expect(reviews).toBe(0);
    await callCogmemMcpTool('cogmem_episode_append', {
      projectId: 'brain', sessionId: 'background', sourceAgent: 'hermes', role: 'user', text: '后台未知话题', externalMessageId: 'bg-1',
    }, { kernel });
    expect(reviews).toBe(1);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ingest keys move from reserved to committed and validate sourceAgent metadata', () => {
  const { dir, kernel } = createTestKernel('cogmem-ingest-state-');
  try {
    const result = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'user', text: 'hello', externalMessageId: 'm1',
    });
    expect(kernel.episodeStore.getIngestState('brain', 'hermes', 's1', 'm1')).toEqual(expect.objectContaining({ state: 'committed', eventId: result.eventId }));
    kernel.factStore.getDatabase().prepare(`UPDATE memory_events SET payload_json = json_set(payload_json, '$.metadata.sourceAgent', 'other') WHERE event_id = ?`).run(result.eventId);
    expect(() => kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'user', text: 'hello', externalMessageId: 'm1',
    })).toThrow('episode_ingest_identity_conflict');
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('episode split recomputes closure receipts, invalidates candidates, requeues Dream, and audits the repair', () => {
  const { dir, kernel } = createTestKernel('cogmem-episode-split-repair-');
  try {
    const first = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'repair-session', sourceAgent: 'hermes', role: 'user',
      text: '以后请把事件组装器作为独立主题。', externalMessageId: 'repair-1',
    });
    const second = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'repair-session', sourceAgent: 'hermes', role: 'assistant',
      text: '已记录这个偏好。', externalMessageId: 'repair-2',
    });
    expect(second.episodeId).toBe(first.episodeId);
    kernel.sealEpisode(first.episodeId!, { mode: 'manual', reason: 'test_before_repair', now: 10 });
    const run = kernel.deepWriteCandidateStore.insertRun({
      projectId: 'brain', sourceNeuronIds: [], mode: 'test', promptHash: 'p', outputHash: 'o', status: 'succeeded', createdAt: 11,
    });
    const candidate = kernel.deepWriteCandidateStore.insertCandidates([{
      runId: run.runId, candidateType: 'preferences', status: 'candidate', confidence: 0.9,
      content: { sourceEpisodeId: first.episodeId }, evidence: [{ eventId: first.eventId }], createdAt: 11,
    }])[0];

    const repaired = kernel.repairEpisode({
      operation: 'split', projectId: 'brain', episodeId: first.episodeId!, eventIds: [second.eventId], now: 20,
    });

    expect(repaired.staleCandidateIds).toEqual([candidate.candidateId]);
    expect(repaired.affectedEpisodeIds).toHaveLength(2);
    for (const episodeId of repaired.affectedEpisodeIds) {
      expect(kernel.getEpisode(episodeId)).toEqual(expect.objectContaining({ eventCount: 1, status: 'sealed', dreamStatus: 'queued' }));
      expect(kernel.listEpisodeClosureReceipts({ episodeId, limit: 1 })[0]).toEqual(expect.objectContaining({
        closureReasonCode: 'repair', sourceEventIds: [expect.any(String)], dreamRecommended: true,
      }));
    }
    expect(kernel.listDreamCandidates({ projectId: 'brain', statuses: ['superseded'] })).toEqual([
      expect.objectContaining({ candidateId: candidate.candidateId, statusReason: 'episode_repair_invalidated_source' }),
    ]);
    const db = kernel.factStore.getDatabase();
    expect(db.prepare(`SELECT relation FROM episode_cross_refs WHERE project_id = 'brain'`).get()).toEqual({ relation: 'SPLIT_FROM' });
    expect(db.prepare(`SELECT operation FROM episode_repair_audit WHERE repair_id = ?`).get(repaired.repairId)).toEqual({ operation: 'split' });
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EpisodeStore test bootstrap stays column-compatible with migrations 22 through 24', () => {
  const migrated = new Database(':memory:');
  const bootstrapped = new Database(':memory:');
  try {
    migration_0022.up(migrated);
    migration_0023.up(migrated);
    migration_0024.up(migrated);
    new EpisodeStore(bootstrapped);
    const columns = (db: Database, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((item) => item.name).sort();
    for (const table of [
      'memory_episodes', 'memory_episode_events', 'episode_closure_receipts', 'episode_dream_jobs',
      'episode_dream_runs', 'episode_ingest_keys', 'episode_event_dispositions', 'episode_cross_refs', 'episode_repair_audit',
    ]) {
      expect(columns(bootstrapped, table), table).toEqual(columns(migrated, table));
    }
  } finally {
    migrated.close();
    bootstrapped.close();
  }
});
