import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EpisodeBoundaryPolicy, normalizeEpisodeBoundaryConfig } from '../src/episode/EpisodeBoundaryPolicy.js';
import { createMemoryKernel, type MemoryKernelOptions } from '../src/factory.js';

function createTestKernel(prefix: string, options: MemoryKernelOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec', ...options });
  return { dir, kernel };
}

test('EpisodeBoundaryPolicy validates config and detects max events, duration, idle, and trusted date guards', () => {
  const { config, diagnostics } = normalizeEpisodeBoundaryConfig({
    mode: 'enforced' as never,
    maxEvents: -1,
    maxDurationMs: Infinity,
    maxIdleGapMs: 1,
    timezone: 'Not/AZone',
  });
  expect(diagnostics.map((item) => item.code).sort()).toEqual([
    'invalid_episode_boundary_max_duration_ms',
    'invalid_episode_boundary_max_events',
    'invalid_episode_boundary_max_idle_gap_ms',
    'invalid_episode_boundary_mode',
    'invalid_episode_boundary_timezone',
  ]);
  expect(config.maxEvents).toBe(100);
  expect(config.mode).toBe('shadow');

  const policy = new EpisodeBoundaryPolicy({ maxEvents: 20, maxDurationMs: 300_000, maxIdleGapMs: 300_000 });
  const active = { eventCount: 20, startedAt: 1_000, updatedAt: 301_000, localDates: ['2026-07-04'], lastTrustedLocalDate: '2026-07-04' };
  expect(policy.evaluate({ active, primaryEvent: { role: 'user', occurredAt: 1_700, localDate: '2026-07-04' } }).guardCodes)
    .toContain('max_events_exceeded');
  expect(policy.evaluate({ active, primaryEvent: { role: 'user', occurredAt: 700_000, localDate: '2026-07-04' } }).guardCodes)
    .toEqual(expect.arrayContaining(['max_events_exceeded', 'max_duration_exceeded', 'max_idle_gap_exceeded']));
  expect(policy.evaluate({ active, primaryEvent: { role: 'user', occurredAt: 1_700, localDate: '2026-07-05' } }).guardCodes)
    .toEqual(expect.arrayContaining(['max_events_exceeded', 'trusted_local_date_changed']));
  expect(policy.evaluate({ primaryEvent: { role: 'user', occurredAt: 900 } }).warnings).toHaveLength(0);
  expect(policy.evaluate({ active, primaryEvent: { role: 'assistant', occurredAt: 900 } }).warnings).toHaveLength(0);
  expect(policy.evaluate({ active, primaryEvent: { role: 'user', occurredAt: 900 } }).warnings.map((item) => item.code))
    .toEqual(expect.arrayContaining(['trusted_local_date_unavailable', 'out_of_order_timestamp']));
  expect(policy.evaluate({ active: { ...active, localDates: ['2026-07-04', '2026-07-05'], lastTrustedLocalDate: '2026-07-05' }, primaryEvent: { role: 'user', occurredAt: 400_000, localDate: '2026-07-04' } }).guardCodes)
    .toContain('trusted_local_date_changed');
});

test('episode boundary hard guard beats continuation and reviewer while preserving turn integrity', async () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-policy-', {
    episodeBoundary: { maxEvents: 20, mode: 'enforce' },
    turnRelationReviewer: { review: async () => ({ relation: 'continues_previous', confidence: 1 }) },
  });
  try {
    const first = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'user',
      text: '我们讨论第一个主题。', externalMessageId: 'm1', timestamp: 1_000,
    });
    for (let index = 1; index < 20; index += 1) {
      const assistant = kernel.appendEpisodeMessage({
        projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'assistant',
        text: `收到第一个主题 ${index}。`, externalMessageId: `m${index + 1}`, timestamp: 1_000 + index,
      });
      expect(assistant.episodeId).toBe(first.episodeId);
    }

    const guarded = await kernel.appendEpisodeMessageAsync({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'user',
      text: '继续，但超过边界后必须新开 episode。', externalMessageId: 'm21', timestamp: 2_000,
    });
    expect(guarded.episodeId).not.toBe(first.episodeId);
    expect(guarded.boundaryTriggered).toBe(true);
    expect(guarded.boundaryDetected).toBe(true);
    expect(guarded.boundaryApplied).toBe(true);
    expect(guarded.boundaryMode).toBe('enforce');
    expect(guarded.boundaryGuardCodes).toContain('max_events_exceeded');
    expect(guarded.boundaryAuditRecorded).toBe(true);
    expect(kernel.getEpisode(first.episodeId!)?.status).toBe('sealed');

    const decisions = kernel.episodeStore.listBoundaryDecisions({ projectId: 'brain', limit: 100 });
    const guardDecision = decisions.find((item) => item.guardAction === 'enforce_new_episode');
    expect(guardDecision).toEqual(expect.objectContaining({
      primaryEventId: guarded.eventId,
      previousEpisodeId: first.episodeId,
      resultingEpisodeId: guarded.episodeId,
      reviewerInvoked: false,
      guardAction: 'enforce_new_episode',
    }));
    expect(guardDecision?.finalDecision.relation).toBe('continues_previous');
    expect(kernel.listEpisodeEventLinks(guarded.episodeId!)[0].relation).toBe('continues_previous');
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('boundary mode off and applyToImports=false preserve legacy grouping, while shadow records without splitting', async () => {
  const off = createTestKernel('cogmem-boundary-off-', { episodeBoundary: { maxEvents: 20, mode: 'off' } });
  const shadow = createTestKernel('cogmem-boundary-shadow-', { episodeBoundary: { maxEvents: 20, mode: 'shadow' } });
  const noImports = createTestKernel('cogmem-boundary-no-imports-', { episodeBoundary: { maxEvents: 20, applyToImports: false } });
  try {
    for (let index = 0; index < 21; index += 1) {
      const role = index === 0 || index === 20 ? 'user' : 'assistant';
      off.kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 's1', sourceAgent: 'live', role: role as 'user', text: `继续 ${index}`, externalMessageId: `off-${index}` });
      shadow.kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 's1', sourceAgent: 'live', role: role as 'user', text: `继续 ${index}`, externalMessageId: `shadow-${index}` });
      await noImports.kernel.appendEpisodeMessageAsync({
        projectId: 'brain', sessionId: 's1', sourceAgent: 'import', role: role as 'user', text: `继续 ${index}`,
        externalMessageId: `import-${index}`, metadata: { imported: true },
      });
    }
    expect(off.kernel.listEpisodes({ projectId: 'brain' })).toHaveLength(1);
    expect(shadow.kernel.listEpisodes({ projectId: 'brain' })).toHaveLength(1);
    const shadowResult = shadow.kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 's1', sourceAgent: 'live', role: 'user', text: '继续 shadow', externalMessageId: 'shadow-extra' });
    expect(shadowResult.boundaryDetected).toBe(true);
    expect(shadowResult.boundaryApplied).toBe(false);
    expect(shadowResult.boundaryTriggered).toBe(false);
    expect(shadowResult.boundaryMode).toBe('shadow');
    expect(shadow.kernel.episodeStore.listBoundaryDecisions({ projectId: 'brain' })[0].guardAction).toBe('shadow_new_episode');
    expect(noImports.kernel.listEpisodes({ projectId: 'brain' })).toHaveLength(1);
  } finally {
    off.kernel.close(); shadow.kernel.close(); noImports.kernel.close();
    rmSync(off.dir, { recursive: true, force: true });
    rmSync(shadow.dir, { recursive: true, force: true });
    rmSync(noImports.dir, { recursive: true, force: true });
  }
});

test('assistant/tool assignments do not write boundary audit, noise does, and turn writes rollback atomically', () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-audit-scope-', { episodeBoundary: { maxEvents: 20 } });
  try {
    const first = kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'user', text: 'real topic', externalMessageId: 'u1' });
    kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'assistant', text: 'ok', externalMessageId: 'a1' });
    kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'tool', text: 'tool output', externalMessageId: 't1' });
    expect(kernel.episodeStore.listBoundaryDecisions({ projectId: 'brain', limit: 100 })).toHaveLength(1);

    const noise = kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 'noise', sourceAgent: 'hermes', role: 'user', text: '谢谢', externalMessageId: 'n1' });
    expect(noise.ignored).toBe(true);
    expect(kernel.episodeStore.listBoundaryDecisions({ projectId: 'brain', primaryEventId: noise.eventId })).toHaveLength(1);

    const events = ['u2', 'a2', 't2'].map((id, index) => kernel.recordRawEvent({
      projectId: 'brain', workspaceId: 'brain', threadId: 's1', sessionId: 's1',
      role: index === 0 ? 'user' : index === 1 ? 'assistant' : 'tool',
      content: `atomic ${id}`, sourceId: 'test', occurredAt: 10_000 + index, eventOrdinal: index,
    }));
    const original = kernel.episodeStore.appendEvent.bind(kernel.episodeStore);
    let calls = 0;
    (kernel.episodeStore as unknown as { appendEvent: typeof kernel.episodeStore.appendEvent }).appendEvent = ((input) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated_mid_turn_failure');
      return original(input);
    }) as typeof kernel.episodeStore.appendEvent;
    expect(() => kernel.assembleEpisodeTurn(events, { projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', conversationThreadId: 's1' })).toThrow('simulated_mid_turn_failure');
    expect(kernel.episodeStore.getEventLink(events[0].eventId)).toBeUndefined();
    (kernel.episodeStore as unknown as { appendEvent: typeof kernel.episodeStore.appendEvent }).appendEvent = original;
    expect(first.episodeId).toBeDefined();
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate externalMessageId retry does not duplicate boundary audit', async () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-retry-', { episodeBoundary: { maxEvents: 20 } });
  try {
    kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'user', text: 'first', externalMessageId: 'm1' });
    for (let index = 2; index <= 20; index += 1) {
      kernel.appendEpisodeMessage({ projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'assistant', text: `tail ${index}`, externalMessageId: `m${index}` });
    }
    const first = await kernel.appendEpisodeMessageAsync({ projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'user', text: 'continue', externalMessageId: 'm21' });
    await kernel.appendEpisodeMessageAsync({ projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', role: 'user', text: 'continue', externalMessageId: 'm21' });
    expect(kernel.episodeStore.listBoundaryDecisions({ projectId: 'brain', primaryEventId: first.eventId })).toHaveLength(1);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
