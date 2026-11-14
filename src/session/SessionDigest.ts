/**
 * The session digest: the compiled document the context window is a view of (#191).
 *
 * Two feeds, and only one of them exists this round:
 *
 * - **Mechanical, at the turn boundary.** A turn that slides out of the verbatim tail becomes a
 *   digest entry. No model, no summary: the entry quotes the ledger row exactly. The entry's
 *   `sourceRefs` point back at the row, so the digest is an index rather than a claim to trust.
 * - **Deep, at the DREAMING boundary.** Declared as {@link SessionDeepCompiler}; no caller wires a
 *   model this round. The interface is the shape the night worker will implement.
 *
 * Anchor discipline: a decision, a number or a name may appear in a digest entry only as the exact
 * text the ledger holds. The mechanical builder cannot paraphrase because it never rewrites the
 * text; the anchor list below is how a reader (and the contract test) checks that the risky
 * fragments are still there verbatim.
 */

import type { ConversationSpeaker } from '../conversation/index.js';
import type { SessionTurn } from './SessionLedger.js';

/** The entry's field set, frozen by `docs/session-context.md`. */
export const SESSION_DIGEST_ENTRY_FIELDS = [
  'entryId',
  'kind',
  'sessionId',
  'occurredAt',
  'speaker',
  'text',
  'sourceRefs',
  'anchor',
] as const;

/** The two ways an entry can be produced. `deep` is declared, not wired this round. */
export const SESSION_DIGEST_ENTRY_KINDS = ['turn', 'deep'] as const;
export type SessionDigestEntryKind = (typeof SESSION_DIGEST_ENTRY_KINDS)[number];

/** How many recent turns stay verbatim when the caller does not say. */
export const SESSION_DIGEST_TAIL_TURNS = 8;

export interface SessionDigestEntry {
  entryId: string;
  kind: SessionDigestEntryKind;
  sessionId: string;
  occurredAt: number;
  speaker: ConversationSpeaker;
  /** The ledger's exact text. Never a summary, never a re-rendering. */
  text: string;
  sourceRefs: string[];
  /** True when `text` contains a number, a quoted span or a named person. */
  anchor: boolean;
}

export interface SessionDigest {
  sessionId: string;
  entries: SessionDigestEntry[];
  /** The most recent turns, kept verbatim rather than folded into the digest. */
  tail: SessionTurn[];
  /** True when the ledger read itself was truncated before the digest was built. */
  truncated: boolean;
}

export interface SessionDeepCompileInput {
  projectId: string;
  agentId: string;
  sessionId: string;
  /** The mechanical entries the deep compiler may enrich; it must keep their sourceRefs. */
  entries: SessionDigestEntry[];
  now: number;
}

/**
 * The DREAMING-boundary deep compiler's shape. Declared for the night worker; no implementation and
 * no caller this round, so the mechanical path stays model-free.
 */
export interface SessionDeepCompiler {
  compile(input: SessionDeepCompileInput): Promise<SessionDigestEntry[]>;
}

/**
 * The risky fragments that must survive verbatim: numbers (with their separators), quoted spans,
 * and a person introduced by 叫/名叫/名字是. A hit means the entry is an anchor and the contract
 * test can compare it against the ledger text.
 */
export function digestAnchors(text: string): string[] {
  const anchors = new Set<string>();
  for (const match of text.matchAll(/[0-9][0-9.,:%+\-/]*/gu)) anchors.add(match[0]!);
  for (const match of text.matchAll(/[「“"]([^」”"\n]{1,40})[」”"]/gu)) anchors.add(match[1]!);
  for (const match of text.matchAll(/(?:叫|名叫|名字是)([\u4e00-\u9fa5]{2,4})/gu)) anchors.add(match[1]!);
  return [...anchors];
}

export function buildSessionDigest(
  turns: readonly SessionTurn[],
  input: { sessionId?: string; tailTurns?: number; truncated?: boolean } = {},
): SessionDigest {
  const tailTurns = input.tailTurns ?? SESSION_DIGEST_TAIL_TURNS;
  if (!Number.isInteger(tailTurns) || tailTurns < 0) throw new Error('invalid_tail_turns');
  const split = Math.max(0, turns.length - tailTurns);
  const old = turns.slice(0, split);
  const tail = turns.slice(split);
  return {
    sessionId: input.sessionId ?? turns[0]?.sessionId ?? '',
    entries: old.map((turn) => ({
      entryId: `digest:${turn.eventId}`,
      kind: 'turn',
      sessionId: turn.sessionId,
      occurredAt: turn.occurredAt,
      speaker: turn.speaker,
      text: turn.text,
      sourceRefs: [turn.eventId],
      anchor: digestAnchors(turn.text).length > 0,
    })),
    tail,
    truncated: input.truncated === true,
  };
}
