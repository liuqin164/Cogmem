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
    maxEvents: -1,
    maxDurationMs: Infinity,
    maxIdleGapMs: 1,
    timezone: 'Not/AZone',
  });
  expect(diagnostics.map((item) => item.code).sort()).toEqual([
    'invalid_episode_boundary_max_duration_ms',
    'invalid_episode_boundary_max_events',
    'invalid_episode_boundary_max_idle_gap_ms',
    'invalid_episode_boundary_timezone',
  ]);
  expect(config.maxEvents).toBe(100);

  const policy = new EpisodeBoundaryPolicy({ maxEvents: 20, maxDurationMs: 300_000, maxIdleGapMs: 300_000 });
  const active = { eventCount: 20, startedAt: 1_000, updatedAt: 301_000, localDates: ['2026-07-04'] };
  expect(policy.evaluate({ active, primaryEvent: { role: 'user', occurredAt: 1_700, localDate: '2026-07-04' } }).guardCodes)
    .toContain('max_events_exceeded');
  expect(policy.evaluate({ active, primaryEvent: { role: 'user', occurredAt: 700_000, localDate: '2026-07-04' } }).guardCodes)
    .toEqual(expect.arrayContaining(['max_events_exceeded', 'max_duration_exceeded', 'max_idle_gap_exceeded']));
  expect(policy.evaluate({ active, primaryEvent: { role: 'user', occurredAt: 1_700, localDate: '2026-07-05' } }).guardCodes)
    .toEqual(expect.arrayContaining(['max_events_exceeded', 'trusted_local_date_changed']));
  expect(policy.evaluate({ active, primaryEvent: { role: 'user', occurredAt: 900 } }).warnings.map((item) => item.code))
    .toContain('trusted_local_date_unavailable');
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
    expect(guardDecision?.finalDecision.relation).toBe('starts_new_topic');
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
    expect(shadow.kernel.episodeStore.listBoundaryDecisions({ projectId: 'brain' })[0].guardAction).toBe('shadow_new_episode');
    expect(noImports.kernel.listEpisodes({ projectId: 'brain' })).toHaveLength(1);
  } finally {
    off.kernel.close(); shadow.kernel.close(); noImports.kernel.close();
    rmSync(off.dir, { recursive: true, force: true });
    rmSync(shadow.dir, { recursive: true, force: true });
    rmSync(noImports.dir, { recursive: true, force: true });
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
