import { randomUUID } from 'node:crypto';
export class DreamScheduler {
    episodeStore;
    curator;
    constructor(episodeStore, curator) {
        this.episodeStore = episodeStore;
        this.curator = curator;
    }
    async tick(options = {}) {
        const startedAt = options.now ?? Date.now();
        const requestedMode = options.mode ?? 'auto';
        const runId = `episode-dream-run-${randomUUID()}`;
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
            const result = {
                runId, projectId: options.projectId, requestedMode, selectedMode: 'none', skipped: true,
                reason: 'no_sealed_episode_backlog', processedEpisodeCount: 0, failedEpisodeCount: 0,
                candidateCount: 0, episodeIds: [], candidateIds: [], durationMs: elapsed(startedAt, options.now),
            };
            this.recordRun(result, startedAt, 'skipped');
            return result;
        }
        const selectedMode = selectMode(requestedMode, jobs.map((job) => job.modeHint));
        const episodeIds = [];
        const candidateIds = [];
        let failures = 0;
        for (const job of jobs) {
            const links = this.episodeStore.listEventLinks(job.episodeId);
            const episode = this.episodeStore.getEpisode(job.episodeId);
            const receipt = this.episodeStore.listClosureReceipts({ episodeId: job.episodeId, limit: 1 })[0];
            try {
                const limits = curatorLimits(selectedMode);
                const run = await this.curator.run({
                    projectId: job.projectId,
                    eventIds: links.map((link) => link.eventId),
                    sourceEpisodeId: job.episodeId,
                    sourceEpisodeEventIds: links.map((link) => link.eventId),
                    dreamMode: selectedMode,
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
            }
            catch (error) {
                failures += 1;
                const message = error instanceof Error ? error.message : String(error);
                const failure = classifyFailure(message, job.attempts, startedAt);
                this.episodeStore.failDreamJob(job.episodeId, job.leaseId, message, failure);
            }
        }
        const result = {
            runId, projectId: options.projectId, requestedMode, selectedMode, skipped: false,
            reason: failures ? 'episode_dream_completed_with_failures' : 'sealed_episode_backlog',
            processedEpisodeCount: episodeIds.length, failedEpisodeCount: failures,
            candidateCount: candidateIds.length, episodeIds, candidateIds, durationMs: elapsed(startedAt, options.now),
        };
        this.recordRun(result, startedAt, failures ? 'partial' : 'succeeded');
        return result;
    }
    recordRun(result, createdAt, status) {
        this.episodeStore.recordDreamRun({
            runId: result.runId, projectId: result.projectId, requestedMode: result.requestedMode,
            selectedMode: result.selectedMode, reason: result.reason, episodeIds: result.episodeIds,
            candidateIds: result.candidateIds, status, durationMs: result.durationMs, createdAt,
        });
    }
}
function curatorLimits(mode) {
    if (mode === 'micro')
        return { eventLimit: 20, maxCandidates: 20 };
    if (mode === 'normal')
        return { eventLimit: 100, maxCandidates: 100 };
    return { eventLimit: 500, maxCandidates: 500 };
}
function classifyFailure(message, attempts, now) {
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
function modeLimit(mode) {
    if (mode === 'micro')
        return 1;
    if (mode === 'normal')
        return 10;
    if (mode === 'deep')
        return 50;
    return 10;
}
function selectMode(requested, hints) {
    if (requested !== 'auto')
        return requested;
    if (hints.includes('deep'))
        return 'deep';
    if (hints.length === 1 && hints[0] === 'micro')
        return 'micro';
    return 'normal';
}
function elapsed(startedAt, fixedNow) {
    return Math.max(0, (fixedNow ?? Date.now()) - startedAt);
}
