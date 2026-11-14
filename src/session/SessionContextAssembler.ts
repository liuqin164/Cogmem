/**
 * The context budget controller (#191 primitive 3).
 *
 * One turn's context is a fixed-order projection of six lanes, assembled to a target bandwidth the
 * caller reads from its model configuration. There is no overflow-triggered sawtooth: every turn
 * starts from the same lane order and the same budget.
 *
 * Over budget, the lowest-priority lane is downgraded to a pointer ("browse-only"), not deleted:
 * its ids stay in the result and the caller can fetch the text through `digest`/`recall`. Every
 * downgrade is written to `decisionTrace`. Lanes above the cut are rendered byte-for-byte the same
 * as before, which is what keeps the provider's prefix cache intact.
 *
 * The order the lanes are *rendered* in is frozen (`SESSION_CONTEXT_LANES`); the order they are
 * *filled* in is the separate priority table. They are deliberately not the same list: the tail is
 * rendered last because new turns append there, but it outranks the digest and the recall lane when
 * the budget is tight.
 */

import type { SessionDigest } from './SessionDigest.js';
import { sessionError } from './SessionErrors.js';

/** The lane order, frozen by `docs/session-context.md`. */
export const SESSION_CONTEXT_LANES = ['pinned', 'profile', 'digest', 'working_set', 'recall', 'tail'] as const;
export type SessionContextLaneName = (typeof SESSION_CONTEXT_LANES)[number];

/**
 * The fill order, highest first. `pinned` and `profile` lead because they are the stable prefix;
 * `tail` next because the recent verbatim turns are the continuity anchor; the digest, the current
 * working set and this turn's recall are the lanes that get browsed first when the budget is tight.
 */
export const SESSION_CONTEXT_LANE_PRIORITY: Readonly<Record<SessionContextLaneName, number>> = {
  pinned: 60,
  profile: 50,
  tail: 40,
  digest: 30,
  working_set: 20,
  recall: 10,
};

/** Lanes whose rendered bytes must not change between assemblies: the provider's cache prefix. */
export const SESSION_CONTEXT_STABLE_LANES = ['pinned', 'profile'] as const;

/** The decision record's field set, frozen by `docs/session-context.md`. */
export const SESSION_CONTEXT_DECISION_FIELDS = [
  'lane',
  'action',
  'reason',
  'tokensBefore',
  'tokensAfter',
  'omittedItems',
  'browseIds',
] as const;

export interface SessionContextItem {
  id: string;
  text: string;
  sourceRefs?: string[];
}

export interface AssembleSessionContextInput {
  projectId: string;
  agentId: string;
  sessionId: string;
  /** The sweet spot for this model, read from the model configuration. Never a kernel constant. */
  targetTokens: number;
  /** System / identity / rules. Never paraphrased; trimmed last. */
  pinned?: string[];
  /** The profile compiler's current entries, rendered by the caller. */
  profile?: string[];
  /** The current task's working set. */
  workingSet?: string[];
  /** F2 wake intentions and F6 candidates that must survive a restart. */
  openLoops?: SessionContextItem[];
  /** This turn's recall. */
  recall?: SessionContextItem[];
  /** How many recent turns stay verbatim. Defaults to `SESSION_DIGEST_TAIL_TURNS`. */
  tailTurns?: number;
}

export type SessionContextLaneStatus = 'included' | 'downgraded' | 'empty';

export interface SessionContextLane {
  lane: SessionContextLaneName;
  priority: number;
  stable: boolean;
  status: SessionContextLaneStatus;
  tokens: number;
  items: SessionContextItem[];
  /** Ids a downgraded lane left behind, so the caller can browse the text it did not include. */
  browseIds: string[];
  text: string;
}

export interface SessionContextDecision {
  lane: SessionContextLaneName;
  action: 'downgraded' | 'trimmed';
  reason: 'budget_exceeded';
  tokensBefore: number;
  tokensAfter: number;
  omittedItems: number;
  browseIds: string[];
}

export interface SessionContextAssembly {
  projectId: string;
  agentId: string;
  sessionId: string;
  targetTokens: number;
  usedTokens: number;
  lanes: SessionContextLane[];
  decisionTrace: SessionContextDecision[];
  /** The bytes the stable lanes rendered, in order; unchanged across assemblies at the same budget. */
  stablePrefix: string;
  /** The assembled context: lanes in frozen order. */
  text: string;
  digest: SessionDigest;
}

/** Four characters to a token, the estimate the context cortex and the evidence pack use. */
export function sessionTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const BROWSE_ID_LIMIT = 20;

export function assembleSessionContext(input: AssembleSessionContextInput, digest: SessionDigest): SessionContextAssembly {
  if (!Number.isInteger(input.targetTokens) || input.targetTokens <= 0) {
    throw sessionError('invalid_target_tokens');
  }
  const lanes = buildLanes(input, digest);
  const decisions: SessionContextDecision[] = [];
  let total = lanes.reduce((sum, lane) => sum + lane.tokens, 0);

  // Downgrade from the lowest priority up. A downgraded lane keeps its ids and loses its text.
  while (total > input.targetTokens) {
    // The stable lanes are trimmed, never stubbed: their bytes are the cache prefix, and a stub
    // would change them for every later turn.
    const lane = lanes
      .filter((candidate) => candidate.status === 'included' && !candidate.stable)
      .sort((left, right) => left.priority - right.priority || SESSION_CONTEXT_LANES.indexOf(left.lane) - SESSION_CONTEXT_LANES.indexOf(right.lane))[0];
    if (!lane) break;
    const before = lane.tokens;
    const stub = renderStub(lane.lane, lane.items.length);
    const after = sessionTokens(stub) <= input.targetTokens - (total - before) ? stub : '';
    decisions.push({
      lane: lane.lane,
      action: 'downgraded',
      reason: 'budget_exceeded',
      tokensBefore: before,
      tokensAfter: sessionTokens(after),
      omittedItems: lane.items.length,
      browseIds: lane.items.slice(0, BROWSE_ID_LIMIT).map((item) => item.id),
    });
    lane.browseIds = lane.items.map((item) => item.id);
    lane.items = [];
    lane.status = 'downgraded';
    lane.text = after;
    lane.tokens = sessionTokens(after);
    total = lanes.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  // If the stable lanes alone exceed the budget, trim their items from the end. Never rewrite an
  // item's text: a verbatim lane that cannot fit is browsed, not paraphrased.
  while (total > input.targetTokens) {
    const lane = lanes
      .filter((candidate) => candidate.status === 'included' && candidate.items.length > 0)
      .sort((left, right) => left.priority - right.priority || SESSION_CONTEXT_LANES.indexOf(left.lane) - SESSION_CONTEXT_LANES.indexOf(right.lane))[0];
    if (!lane) break;
    const before = lane.tokens;
    const dropped = lane.items.pop()!;
    lane.text = renderLane(lane.lane, lane.items);
    lane.tokens = sessionTokens(lane.text);
    if (lane.items.length === 0) lane.status = lane.text ? 'included' : 'empty';
    decisions.push({
      lane: lane.lane,
      action: 'trimmed',
      reason: 'budget_exceeded',
      tokensBefore: before,
      tokensAfter: lane.tokens,
      omittedItems: 1,
      browseIds: [dropped.id],
    });
    total = lanes.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  const ordered = SESSION_CONTEXT_LANES.map((name) => lanes.find((lane) => lane.lane === name)!);
  return {
    projectId: input.projectId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    targetTokens: input.targetTokens,
    usedTokens: total,
    lanes: ordered,
    decisionTrace: decisions,
    stablePrefix: ordered
      .filter((lane) => lane.stable && lane.status === 'included')
      .map((lane) => lane.text)
      .filter(Boolean)
      .join('\n'),
    text: ordered.map((lane) => lane.text).filter(Boolean).join('\n'),
    digest,
  };
}

function buildLanes(input: AssembleSessionContextInput, digest: SessionDigest): SessionContextLane[] {
  const working: SessionContextItem[] = [
    ...(input.workingSet ?? []).map((text, index) => ({ id: `working:${index}`, text })),
    ...(input.openLoops ?? []),
  ];
  const seen = new Set<string>();
  const workingItems = working.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  const itemsByLane: Record<SessionContextLaneName, SessionContextItem[]> = {
    pinned: (input.pinned ?? []).map((text, index) => ({ id: `pinned:${index}`, text })),
    profile: (input.profile ?? []).map((text, index) => ({ id: `profile:${index}`, text })),
    digest: digest.entries.map((entry) => ({ id: entry.entryId, text: entry.text, sourceRefs: entry.sourceRefs })),
    working_set: workingItems,
    recall: input.recall ?? [],
    tail: digest.tail.map((turn) => ({ id: turn.eventId, text: turn.text, sourceRefs: [turn.eventId] })),
  };
  return SESSION_CONTEXT_LANES.map((lane) => {
    const items = itemsByLane[lane];
    const text = renderLane(lane, items);
    return {
      lane,
      priority: SESSION_CONTEXT_LANE_PRIORITY[lane],
      stable: (SESSION_CONTEXT_STABLE_LANES as readonly string[]).includes(lane),
      status: items.length > 0 ? 'included' : 'empty',
      tokens: sessionTokens(text),
      items,
      browseIds: [],
      text,
    };
  });
}

function renderLane(lane: SessionContextLaneName, items: SessionContextItem[]): string {
  if (items.length === 0) return '';
  return [`[${lane}]`, ...items.map((item) => `- ${item.text}`)].join('\n');
}

function renderStub(lane: SessionContextLaneName, count: number): string {
  return count > 0 ? `[${lane}: browse-only, ${count} item(s)]` : '';
}
