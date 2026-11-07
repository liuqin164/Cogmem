/**
 * What a person writes when they mean "do not remember this" (#133).
 *
 * The secret chain is "store it, mark it, withhold it at recall". This is the other thing: the text never
 * becomes an event at all — no ledger row, no FTS row, no vector, nothing for a later forget to clean up.
 * A user who knows a passage should not be kept needs a way to say so *before* the store, because pattern
 * detection cannot see intent and an after-the-fact delete is a different promise.
 *
 * Two forms, one namespace:
 *
 *   <COGMEM_PRIVATE>…</COGMEM_PRIVATE>   an inline span; several may appear in one turn
 *   <COGMEM_PRIVATE_ALL>                 the whole user turn is not recorded
 *
 * Only the user's own text is subject to this. An assistant reply and a tool result are not the user's to
 * declare, and their secrets keep travelling the secret chain.
 *
 * The names sit in the same `COGMEM_` namespace as the injected blocks but are deliberately **not** in either
 * block stripper's list (`src/agent/ContextHygiene.ts`, `src/episode/CogmemBlockStripper.ts`): those remove
 * generated blocks, and a marker that removed itself before it was read would silently stop working. A guard
 * asserts the marker is absent from both lists.
 */
export const EXPLICIT_EXCLUSION_INLINE_OPEN = '<COGMEM_PRIVATE>';
export const EXPLICIT_EXCLUSION_INLINE_CLOSE = '</COGMEM_PRIVATE>';
export const EXPLICIT_EXCLUSION_WHOLE_TURN = '<COGMEM_PRIVATE_ALL>';

/** The one sentence the host teaching surfaces carry, so a user learns the convention exists. */
export const EXPLICIT_EXCLUSION_TEACHING = `To keep a passage out of memory entirely, the user can wrap it in ${EXPLICIT_EXCLUSION_INLINE_OPEN} … ${EXPLICIT_EXCLUSION_INLINE_CLOSE} or write ${EXPLICIT_EXCLUSION_WHOLE_TURN} to exclude the whole turn. Marked text is never stored — it does not reach the ledger, the search index or recall, so nothing has to be deleted later. Only the user's own text can be marked this way; the assistant's reply and tool results are unaffected.`;

export interface ExplicitExclusionResult {
  /** The user text with every excluded span removed. */
  text: string;
  /** How many spans were removed. Count only: the content and each span's own length are not recorded. */
  excludedSpanCount: number;
  /** Characters removed, on the same footing as the recall-block stripper's `strippedChars`. */
  excludedChars: number;
  /** True when the whole turn was excluded. */
  wholeTurn: boolean;
}

/**
 * Cut the explicitly marked spans out of a user turn.
 *
 * An inline opener with no closer runs to the end of the text: the user declared a boundary and did not say
 * where it stopped, and the reading that keeps the promise is the one that excludes more, not less. The
 * whole-turn marker wins over anything else in the turn.
 */
export function excludeExplicitSpans(text: string | undefined | null): ExplicitExclusionResult {
  const input = String(text ?? '');
  // The whole-turn marker is checked first: it is a different literal, not a longer form of the inline one.
  if (input.includes(EXPLICIT_EXCLUSION_WHOLE_TURN)) {
    return { text: '', excludedSpanCount: 1, excludedChars: input.length, wholeTurn: true };
  }
  if (!input.includes(EXPLICIT_EXCLUSION_INLINE_OPEN)) {
    return { text: input, excludedSpanCount: 0, excludedChars: 0, wholeTurn: false };
  }
  let excludedSpanCount = 0;
  let excludedChars = 0;
  let remaining = input;
  for (;;) {
    const start = remaining.indexOf(EXPLICIT_EXCLUSION_INLINE_OPEN);
    if (start < 0) break;
    const bodyStart = start + EXPLICIT_EXCLUSION_INLINE_OPEN.length;
    const close = remaining.indexOf(EXPLICIT_EXCLUSION_INLINE_CLOSE, bodyStart);
    const end = close < 0 ? remaining.length : close + EXPLICIT_EXCLUSION_INLINE_CLOSE.length;
    excludedChars += end - start;
    excludedSpanCount += 1;
    remaining = remaining.slice(0, start) + remaining.slice(end);
  }
  return { text: remaining, excludedSpanCount, excludedChars, wholeTurn: false };
}
