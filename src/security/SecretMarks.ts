import type { MemoryEvent } from '../types/index.js';

/**
 * Whether an event carries the secret mark (#142).
 *
 * The write path records `secretFindings` / `secretFindingsAssistant` on the ledger row, so the
 * mark travels with the evidence rather than being recomputed by each reader. Exported from here
 * because recall and surfacing both read it; a second hand-written predicate is how two read paths
 * drift into disagreeing about what a secret is.
 */
export function eventHoldsSecretMark(event: MemoryEvent): boolean {
  const metadata = (event.payload as { metadata?: { secretFindings?: { total?: number }; secretFindingsAssistant?: { total?: number } } })?.metadata;
  return Number(metadata?.secretFindings?.total ?? 0) > 0 || Number(metadata?.secretFindingsAssistant?.total ?? 0) > 0;
}
