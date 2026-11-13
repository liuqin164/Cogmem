/**
 * "你不在时发生了什么": the attach-time broadcast, built from durable ledgers only.
 *
 * Every line here is read back from something that already existed while the user was gone — the
 * trace's completed dreams, the runtime's accumulated emergence queue, the kernel's completed
 * commitments. Nothing is reconstructed from the TUI's memory, because the TUI was not running.
 */
import type { MemoryKernel } from 'cogmem';
import type { ShellRuntimeState } from './state/checkpoint.ts';
import type { TraceRecord } from './trace.ts';
import type { PresenceReport } from './tui/view.ts';

export interface AwayReportInput {
  projectId: string;
  runtime: ShellRuntimeState;
  trace: TraceRecord[];
  kernel: MemoryKernel;
  now: number;
  /** How many emergence items to report; the queue itself is bounded at enqueue time. */
  limit?: number;
}

export function buildAwayReport(input: AwayReportInput): PresenceReport {
  const since = input.runtime.lastDetachAt;
  const limit = input.limit ?? 20;
  return {
    awaySince: since,
    awayMs: since === undefined ? undefined : Math.max(0, input.now - since),
    dreams: completedDreams(input),
    emergence: (input.runtime.awayQueue ?? []).slice(-limit).map((item) => ({ id: item.id, text: item.text, reason: item.reason })),
    commitments: completedCommitments(input),
  };
}

/** A dream is durable in the trace (`dream_complete`); its summary is read back from the kernel. */
function completedDreams(input: AwayReportInput): PresenceReport['dreams'] {
  const since = input.runtime.lastDetachAt;
  const dreams: PresenceReport['dreams'] = [];
  const seen = new Set<string>();
  for (const record of input.trace) {
    if (record.kind !== 'dream_complete') continue;
    if (since !== undefined && record.at < since) continue;
    const localDate = String(record.localDate ?? '');
    if (localDate === '' || seen.has(localDate)) continue;
    seen.add(localDate);
    dreams.push({
      localDate,
      eventCount: Number(record.eventCount ?? 0),
      summary: dreamSummary(input.kernel, input.projectId, localDate) ?? `夜间整合 ${localDate}`,
    });
  }
  return dreams;
}

function dreamSummary(kernel: MemoryKernel, projectId: string, localDate: string): string | undefined {
  try {
    const events = kernel.getThreadEvents(`companion-dream:${localDate}`, { projectId, limit: 50 });
    const product = events.find((event) => {
      const metadata = (event.payload as { metadata?: { kind?: unknown } } | undefined)?.metadata;
      return metadata?.kind === 'dream-integration';
    });
    const text = (product?.payload as { text?: unknown } | undefined)?.text;
    return typeof text === 'string' ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A fulfilled commitment is a kernel row whose status became `completed` while the user was away.
 * The away window is what makes this "while you were gone" rather than "ever".
 */
function completedCommitments(input: AwayReportInput): PresenceReport['commitments'] {
  const since = input.runtime.lastDetachAt ?? 0;
  try {
    return input.kernel.prospectiveMemoryService
      .list({ projectId: input.projectId, statuses: ['completed'], limit: 100 })
      .filter((record) => record.updatedAt >= since)
      .map((record) => ({ candidateId: record.candidateId, title: record.title, status: record.status, updatedAt: record.updatedAt }));
  } catch {
    // An older kernel without the prospective service degrades to "nothing to report", not a crash.
    return [];
  }
}

export const AWAY_QUEUE_LIMIT = 50;

export function enqueueAway(runtime: ShellRuntimeState, entry: { id: string; text: string; reason: string; at: number }): Array<{ id: string; text: string; reason: string; at: number }> {
  const queue = [...(runtime.awayQueue ?? []), entry];
  return queue.slice(-AWAY_QUEUE_LIMIT);
}
