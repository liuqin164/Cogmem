/**
 * Phase projection: how much of a memory the default lane shows, decided at read time (#130).
 *
 * This is a research sample, not a shipped behaviour. The switch defaults to off, and with it off every function
 * here is the identity, so a corpus behaves exactly as it did before. Nothing is written: the phase is computed
 * from the timestamp and the item, every time, which is the whole point of the design — a phase in the store
 * would be a migration, a rollback problem and a second source of truth.
 *
 * Where it sits, in the terms the ticket asks for:
 *
 *   significance    TopicDecayPolicy, at consolidation, lowers a stale topic's importance
 *   explanation     MemoryExplain reports `recencyMs` so a reader can see why something ranked as it did
 *   presentation    this file: full / gist / out of the default lane
 *
 * Three of the four phases are honest about what this repository can currently decide:
 *
 *   detail      the default for anything inside the detail window
 *   gist        the deterministic one-line projection, no model call
 *   dormant     out of the default lane; still reachable by keyword and in full by ID
 *   protected   never fades — but **no caller can currently mark it**. The ticket names three protection
 *               classes (a stated preference, an unfinished prospective link, verified attempt evidence) and
 *               this repository has a marker for none of them: `preference` exists only as a query-keyword
 *               rule, and there is no goal or attempt marker on a recall item at all. So `protected` is
 *               reachable only through an explicit argument that nothing passes, and the missing markers are
 *               recorded on the ticket rather than invented here.
 *
 * The thresholds below are **provisional and deliberately not the borrowed 7/60**. Measured on a 40,479-event
 * corpus copy (span 365.6 days): 1.3% at 7 days or less, 4.5% at 8-30, 20.8% at 31-90, 35.6% at 91-180 and
 * 37.8% beyond 180 — 73.4% of that corpus is older than 90 days, so the borrowed numbers would gist or drop
 * most of it. A number that flips the majority of a corpus is not a calibration, and the compiled-corpus
 * distribution that would settle it needs a model-driven Dream run, which is a box-phase item.
 */

export type MemoryPhase = 'protected' | 'detail' | 'gist' | 'dormant';

/** Which kind of memory the item is, as far as its own fields can say. */
type PhaseCategory = 'scenario' | 'fact' | 'relation';

export interface PhaseThresholds {
  scenarioDetailDays: number;
  scenarioDormantDays: number;
  factDetailDays: number;
  factDormantDays: number;
  relationDormantDays: number;
}

export const PROVISIONAL_PHASE_THRESHOLDS: PhaseThresholds = {
  scenarioDetailDays: 7,
  scenarioDormantDays: 60,
  factDetailDays: 30,
  factDormantDays: 180,
  relationDormantDays: 90,
};

export interface PhaseInput {
  /** When the memory happened — a number, or a date string, through `toMillis`. Absent stays detail. */
  occurredAt?: number | string;
  category: PhaseCategory;
  /** Only an explicit caller can protect; see the note above about the missing markers. */
  protection?: 'stated_preference' | 'unfinished_goal' | 'verified_attempt';
}

const DAY_MS = 86_400_000;

/**
 * A timestamp in milliseconds, from a number or a date string.
 *
 * Measured while wiring this up: an item's anchor can carry an ISO string, and `Number('2026-08-01T...')` is NaN,
 * which the phase function reads as "nothing to age against" and leaves at detail. A silent detail is the least
 * visible outcome of all, so the conversion is explicit here rather than a cast at the call site.
 */
function toMillis(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** The phase of one memory. Pure: same inputs, same answer, no clock, no store, no model. */
export function phaseFor(input: PhaseInput, now: number, thresholds: PhaseThresholds = PROVISIONAL_PHASE_THRESHOLDS): MemoryPhase {
  if (input.protection) return 'protected';
  const occurredAt = toMillis(input.occurredAt);
  if (occurredAt === undefined) return 'detail';
  const ageDays = (now - occurredAt) / DAY_MS;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 'detail';
  const detailDays = input.category === 'scenario' ? thresholds.scenarioDetailDays
    : input.category === 'fact' ? thresholds.factDetailDays
    : 0;
  const dormantDays = input.category === 'scenario' ? thresholds.scenarioDormantDays
    : input.category === 'fact' ? thresholds.factDormantDays
    : thresholds.relationDormantDays;
  if (ageDays <= detailDays) return 'detail';
  return ageDays <= dormantDays ? 'gist' : 'dormant';
}

/**
 * The one-line projection of a memory: the provenance fields copied through, and nothing interpreted.
 *
 * Deterministic and model-free by construction. The whitelist is the point — a field that is not named here
 * cannot leak into the gist — and an interpretation is not summarised but named as what it is, so a reader can
 * never mistake a generated line for the record.
 */
export function phaseGist(item: Record<string, unknown>): Record<string, unknown> {
  const anchor = (item.sourceAnchor ?? {}) as Record<string, unknown>;
  const gist: Record<string, unknown> = {
    id: item.id ?? item.canonicalId ?? 'unknown',
    sourceType: item.sourceType ?? 'compiled_memory',
    phase: 'gist',
  };
  const title = item.displayTitle;
  if (typeof title === 'string' && title.trim()) gist.displayTitle = title;
  if (Number.isFinite(anchor.occurredAt)) gist.occurredAt = anchor.occurredAt;
  if (typeof anchor.eventId === 'string') gist.sourceAnchor = { eventId: anchor.eventId };
  if (typeof item.sourceLocator === 'string') gist.sourceLocator = item.sourceLocator;
  // The full text is deliberately absent: this line is a pointer to the memory, not the memory. Anything an
  // agent might have inferred about it travels separately and under a name that says so.
  gist.agent_interpretation_not_fact = typeof item.text === 'string'
    ? String(item.text).slice(0, 120)
    : undefined;
  return gist;
}

/**
 * The one-line projection of an item: the whitelist only, nothing merged over it (#171).
 *
 * `projectPhases` used to push `{ ...item, ...phaseGist(item) }`, which put the whole record back — `text`,
 * `sourceContext` and all — exactly what the whitelist exists to keep out. A gist is the gist; a field not named
 * by `phaseGist` does not travel.
 */
function gistItem<T>(item: T): T {
  return phaseGist(item as Record<string, unknown>) as unknown as T;
}

/** The fields the projection reads off an item; the rest travels untouched. */
interface PhaseProjectable {
  text?: unknown;
  displayTitle?: unknown;
  sourceType?: unknown;
  sourceAnchor?: { occurredAt?: unknown } | undefined;
}

interface PhaseProjectionOutcome<T> {
  items: T[];
  /** How many were kept out of the default lane, and how many became a gist. */
  dormant: number;
  gist: number;
}

function phaseCategory(sourceType: string): PhaseCategory {
  return sourceType.startsWith('raw_ledger') ? 'scenario'
    : sourceType === 'compiled_memory' || sourceType === 'imported_summary' ? 'fact'
    : 'relation';
}

function queryTerms(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []));
}

function searchableText(item: unknown): string {
  const value = item as PhaseProjectable;
  const text = typeof value.text === 'string' ? value.text : '';
  const title = typeof value.displayTitle === 'string' ? value.displayTitle : '';
  return `${text} ${title}`.toLowerCase();
}

/**
 * Apply the read-time phase to a lane's items (#130, #171). Pure: the same items, query and clock give the same
 * answer, and nothing is written.
 *
 * `dormant` leaves the default lane but keeps a keyword entry: a question that names the memory with a word only
 * it carries still reaches it. The test is batch-relative on purpose — a word the question shares with every
 * candidate ("deploy window" over a batch of deploys) was the retrieval that already happened, not a name.
 *
 * ponytail: substring match with a half-the-batch rarity cut, no stemming and no document-frequency table.
 * Upgrade to the term-DF cache the raw lane already keeps if dormant recall needs to be judged, not offered.
 */
export function projectPhaseItems<T>(items: readonly T[], queryText: string, now: number): PhaseProjectionOutcome<T> {
  const terms = queryTerms(queryText);
  const presence = new Map<string, number>();
  for (const item of items) {
    const text = searchableText(item);
    for (const term of terms) {
      if (text.includes(term)) presence.set(term, (presence.get(term) ?? 0) + 1);
    }
  }
  const rarityCut = Math.max(1, Math.floor(items.length / 2));
  const namesMemory = (item: T): boolean => {
    const text = searchableText(item);
    return terms.some((term) => text.includes(term) && (presence.get(term) ?? 0) <= rarityCut);
  };

  const kept: T[] = [];
  let dormant = 0;
  let gist = 0;
  for (const item of items) {
    const value = item as PhaseProjectable;
    const phase = phaseFor({ occurredAt: toMillis(value.sourceAnchor?.occurredAt), category: phaseCategory(String(value.sourceType ?? '')) }, now);
    if (phase === 'dormant') {
      if (!namesMemory(item)) { dormant += 1; continue; }
      kept.push(item);
      continue;
    }
    if (phase === 'gist') { gist += 1; kept.push(gistItem(item)); continue; }
    kept.push(item);
  }
  return { items: kept, dormant, gist };
}
