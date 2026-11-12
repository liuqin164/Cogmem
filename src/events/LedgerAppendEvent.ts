import { candidateAgentsForEvent } from '../agent/AgentScopeRules.js';
import type { MemoryEvent } from '../types/index.js';
import type { KernelEvent } from './KernelEventStream.js';

/**
 * The `ledger-append` envelope for one committed row.
 *
 * Ids and counts only: a turn's text stays in the ledger, and an event stream that repeated it would
 * be a second read path with its own leak surface (#142).
 */
export function ledgerAppendEvent(event: MemoryEvent): Omit<KernelEvent, 'cursor'> {
  return {
    type: 'ledger-append',
    at: event.createdAt,
    projectId: event.projectId,
    agentIds: candidateAgentsForEvent(event),
    topic: topicOfLedgerEvent(event),
    payload: {
      eventId: event.eventId,
      streamId: event.streamId,
      streamType: event.streamType,
      eventType: event.eventType,
      globalSeq: event.globalSeq,
    },
  };
}

/**
 * The topic a ledger row belongs to, when it carries one.
 *
 * `memory_events` has no topic column, and on the measured corpus every `topic_path` is null — so a
 * topic filter is honest about matching only rows that name one. Two payload places already name
 * one: the top-level `topicPath` the Dream curator reads back, and `metadata.topicPath`, which the
 * turn writers use. A row with neither has no topic and a topic-scoped subscription does not see it.
 */
function topicOfLedgerEvent(event: MemoryEvent): string | undefined {
  const payload = event.payload as { topicPath?: unknown; metadata?: { topicPath?: unknown } } | undefined;
  for (const value of [payload?.topicPath, payload?.metadata?.topicPath]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
