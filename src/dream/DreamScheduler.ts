import { randomUUID } from 'node:crypto';

import type { DreamCuratorWorker } from '../engine/DreamCuratorWorker.js';
import type { EpisodeStore } from '../episode/EpisodeStore.js';

export type DreamTickMode = 'auto' | 'micro' | 'normal' | 'deep';
export type SelectedDreamMode = 'none' | 'micro' | 'normal' | 'deep';

export interface DreamTickOptions {
  projectId?: string;
  mode?: DreamTickMode;
  maxEpisodes?: number;
  now?: number;
  softSealGraceMs?: number;
  leaseMs?: number;
  maxAttempts?: number;
  maintenanceReason?: 'daily' | 'upgrade_repair';
}

export interface DreamTickResult {
  runId: string;
  projectId?: string;
  requestedMode: DreamTickMode;
  selectedMode: SelectedDreamMode;
  selectedModes: { micro: number; normal: number; deep: number };
  skipped: boolean;
  reason: string;
  processedEpisodeCount: number;
  failedEpisodeCount: number;
  candidateCount: number;
  episodeIds: string[];
  candidateIds: string[];
  durationMs: number;
  failedEpisodes: Array<{ episodeId: string; error: string; failureCategory: string; retryAfter?: number }>;
}

export class DreamScheduler {
  constructor(
    private readonly episodeStore: EpisodeStore,
    private readonly curator: DreamCuratorWorker,
  ) {}

  async tick(options: DreamTickOptions = {}): Promise<DreamTickResult> {
    const startedAt = options.now ?? Date.now();
    const requestedMode = options.mode ?? 'auto';
    const runId = `episode-dream-run-${randomUUID()}`;
    const backlogBefore = this.episodeStore.getDreamStatus(options.projectId);
    const graceMs = Math.max(0, options.softSealGraceMs ?? 5 * 60_000);
    this.episodeStore.finalizeMatureSoftSeals({
      projectId: options.projectId,
      sealedBefore: startedAt - graceMs,
      now: startedAt,
    });
    const maxEpisodes = Math.max(1, Math.min(Math.trunc(options.maxEpisodes ?? modeLimit(requestedMode)), 50));
    const jobs = this.episodeStore.claimDreamJobs({
      projectId: options.projectId,
      limit: maxEpisodes,
      now: startedAt,
      leaseMs: Math.max(5_000, options.leaseMs ?? 5 * 60_000),
      maxAttempts: Math.max(1, options.maxAttempts ?? 3),
      runId,
    });
    if (!jobs.length) {
      const result: DreamTickResult = {
        runId, projectId: options.projectId, requestedMode, selectedMode: 'none', skipped: true,
        reason: 'no_sealed_episode_backlog', processedEpisodeCount: 0, failedEpisodeCount: 0,
        candidateCount: 0, episodeIds: [], candidateIds: [], durationMs: elapsed(startedAt, options.now),
        selectedModes: { micro: 0, normal: 0, deep: 0 }, failedEpisodes: [],
      };
      this.recordRun(result, startedAt, 'skipped');
      return result;
    }

    const effectiveModes = jobs.map((job) => effectiveModeForJob({
      requestedMode, jobModeHint: job.modeHint, jobCreatedAt: job.createdAt, now: startedAt,
      backlogCount: backlogBefore.pending + backlogBefore.retryScheduled + backlogBefore.failedRetryable,
      maintenanceReason: options.maintenanceReason,
    }));
    const selectedMode = selectMode(requestedMode, effectiveModes);
    const episodeIds: string[] = [];
    const candidateIds: string[] = [];
    const selectedModes = { micro: 0, normal: 0, deep: 0 };
    const failedEpisodes: DreamTickResult['failedEpisodes'] = [];
    let failures = 0;
    for (const [jobIndex, job] of jobs.entries()) {
      const links = this.episodeStore.listEventLinks(job.episodeId);
      const episode = this.episodeStore.getEpisode(job.episodeId);
      const receipt = this.episodeStore.listClosureReceipts({ episodeId: job.episodeId, limit: 1 })[0];
      const effectiveMode = effectiveModes[jobIndex];
      selectedModes[effectiveMode] += 1;
      try {
        const limits = curatorLimits(effectiveMode);
        const run = await this.curator.run({
          projectId: job.projectId,
          eventIds: links.map((link) => link.eventId),
          sourceEpisodeId: job.episodeId,
          sourceEpisodeEventIds: links.map((link) => link.eventId),
          dreamMode: effectiveMode,
          maxCandidates: limits.maxCandidates,
          episodeType: episode?.episodeType,
          closureReason: receipt?.closureReasonCode || receipt?.closureReason,
          semanticSummary: episode?.semanticSummary,
          episodeRelations: links.map((link) => ({ eventId: link.eventId, relation: link.relation })),
          limit: limits.eventLimit,
          now: startedAt,
        });
        const ids = run.candidates.map((candidate) => candidate.candidateId);
        this.episodeStore.completeDreamJob(job.episodeId, job.leaseId, ids, startedAt);
        episodeIds.push(job.episodeId);
        candidateIds.push(...ids);
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        const failure = classifyFailure(message, job.attempts, startedAt);
        this.episodeStore.failDreamJob(job.episodeId, job.leaseId, message, failure);
        failedEpisodes.push({ episodeId: job.episodeId, error: message, failureCategory: failure.failureCategory, retryAfter: failure.retryAfter });
      }
    }
    const result: DreamTickResult = {
      runId, projectId: options.projectId, requestedMode, selectedMode, skipped: false,
      reason: failures ? 'episode_dream_completed_with_failures' : 'sealed_episode_backlog',
      processedEpisodeCount: episodeIds.length, failedEpisodeCount: failures,
      candidateCount: candidateIds.length, episodeIds, candidateIds, durationMs: elapsed(startedAt, options.now),
      selectedModes, failedEpisodes,
    };
    this.recordRun(result, startedAt, failures ? 'partial' : 'succeeded');
    return result;
  }

  private recordRun(result: DreamTickResult, createdAt: number, status: string): void {
    this.episodeStore.recordDreamRun({
      runId: result.runId, projectId: result.projectId, requestedMode: result.requestedMode,
      selectedMode: result.selectedMode, reason: result.reason, episodeIds: result.episodeIds,
      candidateIds: result.candidateIds, status, durationMs: result.durationMs, createdAt,
      failedEpisodes: result.failedEpisodes,
    });
  }
}

function effectiveModeForJob(input: {
  requestedMode: DreamTickMode;
  jobModeHint: 'micro' | 'normal' | 'deep';
  jobCreatedAt: number;
  now: number;
  backlogCount: number;
  maintenanceReason?: 'daily' | 'upgrade_repair';
}): 'micro' | 'normal' | 'deep' {
  if (input.requestedMode !== 'auto') return input.requestedMode;
  if (input.jobModeHint === 'deep') return 'deep';
  if (input.maintenanceReason === 'daily' || input.maintenanceReason === 'upgrade_repair') return 'deep';
  if (input.backlogCount >= 20) return 'deep';
  if (input.now - input.jobCreatedAt >= 24 * 60 * 60_000) return 'deep';
  return input.jobModeHint;
}

function curatorLimits(mode: Exclude<SelectedDreamMode, 'none'>): { eventLimit: number; maxCandidates: number } {
  if (mode === 'micro') return { eventLimit: 20, maxCandidates: 20 };
  if (mode === 'normal') return { eventLimit: 100, maxCandidates: 100 };
  return { eventLimit: 500, maxCandidates: 500 };
}

function classifyFailure(message: string, attempts: number, now: number): {
  now: number; failureCategory: string; terminal: boolean; retryAfter?: number;
} {
  if (/(candidate_evidence|project_mismatch|validation|schema|episode_has_no_raw_events)/iu.test(message)) {
    return { now, failureCategory: 'validation', terminal: true };
  }
  const category = /(rate|429)/iu.test(message)
    ? 'rate_limit'
    : /(timeout|network|provider|busy|locked|temporar)/iu.test(message)
      ? 'transient_provider'
      : 'unknown_retryable';
  const delay = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  return { now, failureCategory: category, terminal: false, retryAfter: now + delay };
}

function modeLimit(mode: DreamTickMode): number {
  if (mode === 'micro') return 1;
  if (mode === 'normal') return 10;
  if (mode === 'deep') return 50;
  return 10;
}

function selectMode(requested: DreamTickMode, hints: Array<'micro' | 'normal' | 'deep'>): Exclude<SelectedDreamMode, 'none'> {
  if (requested !== 'auto') return requested;
  if (hints.includes('deep')) return 'deep';
  if (hints.length === 1 && hints[0] === 'micro') return 'micro';
  return 'normal';
}

function elapsed(startedAt: number, fixedNow?: number): number {
  return Math.max(0, (fixedNow ?? Date.now()) - startedAt);
}
