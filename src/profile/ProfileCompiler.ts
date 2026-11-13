/**
 * Profile compilation (#159, F5): the long-term understanding of the owner, as a formal compiled
 * product.
 *
 * Existing compilation produces generic products — facts, beliefs, frames, an Atlas. A companion
 * needs a specific form instead: the owner's **four ledgers** (facts / preferences / relations /
 * ongoing items), every entry carrying its `sourceRefs`, correctable by the owner, and ranked in
 * recall by its own priority and decay rather than mixed into the compiled-memory ranking.
 *
 * Storage is the ledger and nothing else, the way F2 stored a wake intention: every version of an
 * entry is an immutable `memory_events` row on a per-entry stream
 * (`profile-entry:<entryId>`), so the current value is the newest row, history is the older rows,
 * and a correction is another row rather than an update. **No table, no column, no migration.**
 *
 * The compiler is deterministic: it derives from evidence that is already governed and
 * evidence-bound (live `facts`, active `beliefs`, declared person `relations`, owner-confirmed
 * `prospective` items). A model may have produced that evidence offline; nothing here calls one, and
 * no rule reads free text.
 *
 * The written contract is `docs/profile-compilation.md`, held by
 * `__tests__/profile-compilation.contract.test.ts`. Version: `PROFILE_CONTRACT_VERSION`.
 */
import { createHash } from 'node:crypto';

import type { EventStore } from '../store/EventStore.js';
import type { BeliefStore } from '../belief/BeliefStore.js';
import type { EntityStore } from '../store/EntityStore.js';
import type { FactStore } from '../store/FactStore.js';
import type { ProspectiveMemoryRecord, ProspectiveMemoryStatus } from '../prospective/ProspectiveMemoryService.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';
import { PERSON_RELATION_TYPES } from '../person/index.js';

export const PROFILE_CONTRACT_VERSION = 1;

/** The four ledgers a profile is compiled into. Frozen; the document's table is the source. */
export const PROFILE_LEDGERS = ['facts', 'preferences', 'relations', 'ongoing'] as const;
export type ProfileLedger = (typeof PROFILE_LEDGERS)[number];

/** The ledger event types this face writes. Frozen. */
export const PROFILE_EVENT_TYPES = [
  'PROFILE_ENTRY_COMPILED',
  'PROFILE_ENTRY_CORRECTED',
  'PROFILE_ENTRY_RETIRED',
  'PROFILE_LEDGER_RECOMPILED',
] as const;
export type ProfileEventType = (typeof PROFILE_EVENT_TYPES)[number];

/** The face's methods. Frozen; adding one is additive, removing or renaming one is not. */
export const PROFILE_API_METHODS = [
  'compile',
  'entries',
  'history',
  'recall',
  'correct',
  'audit',
] as const;

/** `ProfileEntry`'s field set, frozen by the contract document. */
export const PROFILE_ENTRY_FIELDS = [
  'entryId',
  'ledger',
  'key',
  'value',
  'sourceRefs',
  'recordedAt',
  'compiledAt',
  'version',
  'status',
] as const;

/** The refusals this face names, frozen by the contract document. */
export const PROFILE_ERROR_CODES = [
  'project_id_required',
  'invalid_profile_ledger',
  'profile_key_required',
  'profile_value_required',
  'profile_correction_event_required',
  'profile_correction_event_invalid',
  'profile_entry_unknown',
  'invalid_limit',
] as const;
export type ProfileErrorCode = (typeof PROFILE_ERROR_CODES)[number];

/**
 * Recall priority per ledger, highest first. This is the "单独成规" half: a profile entry is not
 * ranked against compiled memory, and the four ledgers are not ranked against each other by the
 * compiled lane's rules.
 *
 * `ongoing` leads because a commitment has an instant attached to it; `relations` next because the
 * people around the owner frame what a memory is about; `preferences` next because they shape how
 * the agent should behave; `facts` last because they are background.
 */
export const PROFILE_RECALL_PRIORITY = ['ongoing', 'relations', 'preferences', 'facts'] as const;

/** The weight each ledger contributes to a recall score; derived from the frozen order above. */
export const PROFILE_LEDGER_WEIGHT: Readonly<Record<ProfileLedger, number>> = {
  ongoing: PROFILE_RECALL_PRIORITY.length,
  relations: PROFILE_RECALL_PRIORITY.length - 1,
  preferences: PROFILE_RECALL_PRIORITY.length - 2,
  facts: PROFILE_RECALL_PRIORITY.length - 3,
};

/** How old evidence may get before half its recall weight is gone. Frozen. */
export const PROFILE_DECAY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

/** The most entries one compile or one recall reads; beyond it the caller raises the bound. */
export const PROFILE_EVIDENCE_LIMIT = 500;
export const PROFILE_RECALL_LIMIT = 3;

/**
 * Predicates that mean a preference. A `fact` carries the family; a `belief` carries an open-text
 * predicate and is matched against this set.
 */
export const PROFILE_PREFERENCE_PREDICATES = ['likes', 'dislikes', 'prefers', 'avoids', 'loves', 'hates'] as const;

/**
 * A one-off problem is not a long-term understanding. `has_issue` / `issue_correction` describe what
 * happened once, so they are not compiled into any ledger — the ticket's "一次性情绪不进偏好册"
 * made a named rule rather than a hope.
 */
export const PROFILE_TRANSIENT_PREDICATES = ['has_issue', 'issue_correction'] as const;

/** A fact row means something current only in these statuses. */
export const PROFILE_LIVE_FACT_STATUSES = ['verified', 'provisional', 'provisional_enriched'] as const;

/**
 * An ongoing item is the owner's, so a machine's candidate (`pending`) and every terminal status are
 * out. This is F2's rule read the same way: a pending candidate is not yet the owner's.
 */
export const PROFILE_ONGOING_STATUSES = ['confirmed', 'deferred'] as const;

/**
 * The four ledgers' exclusion rules, frozen and each one held by a discriminating test. The
 * document's table is the source; this array is what the contract test compares it with.
 */
export const PROFILE_EXCLUSION_RULES = [
  { ledger: 'facts', rule: 'evidence_required' },
  { ledger: 'facts', rule: 'transient_predicate' },
  { ledger: 'preferences', rule: 'preference_predicate_required' },
  { ledger: 'relations', rule: 'person_to_person_required' },
  { ledger: 'relations', rule: 'evidence_required' },
  { ledger: 'ongoing', rule: 'owner_confirmed_only' },
] as const;

export type ProfileEntryStatus = 'current' | 'superseded' | 'retired';

export interface ProfileEntry {
  entryId: string;
  ledger: ProfileLedger;
  key: string;
  value: string;
  /** The raw events this version was compiled from. An entry is never compiled without at least one. */
  sourceRefs: MemorySourceRef[];
  /** When the evidence behind this version was recorded, the decay clock. */
  recordedAt: number;
  /** When this version was written. */
  compiledAt: number;
  version: number;
  status: ProfileEntryStatus;
}

export interface ProfileRecallEntry extends ProfileEntry {
  /** `ledgerWeight × 2^(-age/halfLife)`, the frozen profile score. */
  score: number;
}

export interface ProfileCompileResult {
  projectId: string;
  ledgers: ProfileLedger[];
  /** Versions written this compile, one per entry that changed. */
  written: number;
  entries: number;
  compiledAt: number;
}

export interface ProfileCompileInput {
  projectId: string;
  /** One ledger, or all four when omitted. */
  ledger?: ProfileLedger;
  now?: number;
}

export interface ProfileEntriesInput {
  projectId: string;
  ledger?: ProfileLedger;
}

export interface ProfileHistoryInput {
  projectId: string;
  entryId: string;
}

export interface ProfileRecallInput {
  projectId: string;
  /** Cue text. Empty matches every entry; the priority/decay order decides the cut. */
  query?: string;
  ledger?: ProfileLedger;
  now?: number;
  limit?: number;
}

export interface ProfileCorrectInput {
  projectId: string;
  ledger: ProfileLedger;
  key: string;
  value: string;
  /** The owner's turn that corrects the entry. Must be a `user` event in this project. */
  correctionEventId: string;
  now?: number;
}

export interface ProfileAuditEntry {
  entryId: string;
  eventType: ProfileEventType;
  ledger?: ProfileLedger;
  payload: Record<string, unknown>;
  occurredAt: number;
}

export interface ProfileCompilerPorts {
  events: EventStore;
  facts: FactStore;
  beliefs: BeliefStore;
  entities: EntityStore;
  /** The raw event a compiled neuron came from; the evidence chain ends here. */
  sourceEventOfNeuron: (neuronId: string | undefined) => string | undefined;
  /** Every prospective memory in the project; this face applies the status rule itself. */
  listOngoing: (projectId: string) => ProspectiveMemoryRecord[];
}

interface Candidate {
  ledger: ProfileLedger;
  key: string;
  value: string;
  sourceRefs: MemorySourceRef[];
  recordedAt: number;
}

/** One entry's versions, oldest first, and how the newest row left it. */
interface EntryGroup {
  versions: ProfileEntry[];
  lastEventType: ProfileEventType;
  retired: boolean;
}

const MAX_TIME = 8_640_000_000_000_000;
const LEDGER_PAGE_SIZE = 500;
// ponytail: a project with more than 4000 profile rows reads the newest 4000; page the rest or add
// an event_type index when a companion has years of them.
const MAX_PROFILE_LEDGER_ROWS = 4000;

function profileError(code: ProfileErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function requiredText(value: string | undefined, code: ProfileErrorCode): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw profileError(code);
  return trimmed;
}

function isLedger(value: unknown): value is ProfileLedger {
  return (PROFILE_LEDGERS as readonly string[]).includes(String(value));
}

function entryIdOf(projectId: string, ledger: ProfileLedger, key: string): string {
  const digest = createHash('sha256').update(`${projectId}\u0000${ledger}\u0000${key}`).digest('hex').slice(0, 20);
  return `profile-${digest}`;
}

/** Only the first sixteen refs are walked, the same bound the recall chain uses. */
function uniqRefs(refs: MemorySourceRef[]): MemorySourceRef[] {
  const seen = new Set<string>();
  const out: MemorySourceRef[] = [];
  for (const ref of refs) {
    const id = ref.eventId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(ref);
    if (out.length >= 16) break;
  }
  return out;
}

export class ProfileCompiler {
  private readonly events: EventStore;
  private readonly facts: FactStore;
  private readonly beliefs: BeliefStore;
  private readonly entities: EntityStore;
  private readonly sourceEventOfNeuron: ProfileCompilerPorts['sourceEventOfNeuron'];
  private readonly listOngoing: ProfileCompilerPorts['listOngoing'];

  constructor(ports: ProfileCompilerPorts) {
    this.events = ports.events;
    this.facts = ports.facts;
    this.beliefs = ports.beliefs;
    this.entities = ports.entities;
    this.sourceEventOfNeuron = ports.sourceEventOfNeuron;
    this.listOngoing = ports.listOngoing;
  }

  /**
   * Derive every ledger from its governed evidence and append a version for each entry whose value
   * changed. Idempotent: compiling twice with unchanged evidence writes no second version.
   *
   * A source-derived version never overwrites a newer correction — the owner's word stands until
   * evidence newer than the correction says otherwise (the "correction reaches the source" rule).
   */
  compile(input: ProfileCompileInput): ProfileCompileResult {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const now = input.now ?? Date.now();
    const ledgers: ProfileLedger[] = input.ledger === undefined ? [...PROFILE_LEDGERS] : [this.requireLedger(input.ledger)];
    const candidates = this.derive(projectId, ledgers);
    // One read of the project's profile rows for the whole compile; versions appended here are folded
    // into the same index, so a candidate never re-walks the ledger to see a sibling's new version.
    const index = this.entryGroups(projectId);
    let written = 0;
    for (const ledger of ledgers) {
      const forLedger = candidates.filter((candidate) => candidate.ledger === ledger);
      let ledgerWritten = 0;
      for (const candidate of forLedger) {
        if (this.writeIfChanged(index, projectId, candidate, now)) ledgerWritten += 1;
      }
      // Full recompile: a key the evidence no longer derives retires, instead of being left as a
      // claim no ledger still supports. A correction is the owner's last word on the key and is not
      // retired by the absence of the source it corrected.
      ledgerWritten += this.retireAbsent(index, projectId, ledger, new Set(forLedger.map((candidate) => candidate.key)), now);
      written += ledgerWritten;
      this.appendReceipt(projectId, ledger, now, forLedger.length, ledgerWritten);
    }
    return { projectId, ledgers, written, entries: candidates.length, compiledAt: now };
  }

  /** Current value per key, one per (ledger, key). Older versions are history. */
  entries(input: ProfileEntriesInput): ProfileEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const ledger = input.ledger === undefined ? undefined : this.requireLedger(input.ledger);
    return this.currentEntries(projectId)
      .filter((entry) => ledger === undefined || entry.ledger === ledger)
      .sort((a, b) => PROFILE_LEDGERS.indexOf(a.ledger) - PROFILE_LEDGERS.indexOf(b.ledger) || a.key.localeCompare(b.key));
  }

  /** Every version of one entry, newest first. The oldest entry is the value that was replaced. */
  history(input: ProfileHistoryInput): ProfileEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const entryId = requiredText(input.entryId, 'profile_key_required');
    const group = this.entryGroups(projectId).get(entryId);
    if (!group) return [];
    const newest = group.versions.length - 1;
    return group.versions
      .map((version, index) => ({
        ...version,
        status: index < newest ? ('superseded' as const) : group.retired ? ('retired' as const) : ('current' as const),
      }))
      .reverse();
  }

  /**
   * The profile lane's read: current entries, matched against the cue and ranked by the frozen
   * profile score — never by the compiled lane's rules. An empty cue matches everything.
   */
  recall(input: ProfileRecallInput): ProfileRecallEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const limit = input.limit ?? PROFILE_RECALL_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) throw profileError('invalid_limit', String(input.limit));
    const now = input.now ?? Date.now();
    const ledger = input.ledger === undefined ? undefined : this.requireLedger(input.ledger);
    const cues = profileCues(input.query ?? '');
    return this.currentEntries(projectId)
      .filter((entry) => ledger === undefined || entry.ledger === ledger)
      .filter((entry) => cues.length === 0 || cues.some((cue) => `${entry.key} ${entry.value}`.toLowerCase().includes(cue)))
      .map((entry) => ({ ...entry, score: profileScore(entry, now) }))
      .sort((a, b) => b.score - a.score || PROFILE_LEDGERS.indexOf(a.ledger) - PROFILE_LEDGERS.indexOf(b.ledger) || a.key.localeCompare(b.key))
      .slice(0, limit);
  }

  /**
   * The owner corrects one entry. The correction is a row on the entry's own stream whose
   * `sourceRefs` name **both** the correction turn and the entry's original sources, so the chain
   * still reaches what the entry was compiled from. The ledger is then recompiled — the receipt is
   * the `PROFILE_LEDGER_RECOMPILED` row.
   */
  correct(input: ProfileCorrectInput): ProfileEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const ledger = this.requireLedger(input.ledger);
    const key = requiredText(input.key, 'profile_key_required');
    const value = requiredText(input.value, 'profile_value_required');
    const correctionEventId = requiredText(input.correctionEventId, 'profile_correction_event_required');
    const event = this.events.getEvent(correctionEventId);
    if (!event || (event.projectId ?? '') !== projectId || event.role !== 'user') {
      throw profileError('profile_correction_event_invalid', correctionEventId);
    }
    const now = input.now ?? Date.now();
    const entryId = entryIdOf(projectId, ledger, key);
    const current = this.currentEntry(projectId, entryId);
    if (!current) throw profileError('profile_entry_unknown', `${ledger}/${key}`);

    const correctionRef: MemorySourceRef = {
      eventId: event.eventId,
      eventType: event.rawEventType || event.eventType,
      role: 'user',
      sourceId: event.sourceId,
      threadId: event.threadId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      threadSeq: event.threadSeq,
      turnSeq: event.turnSeq,
      eventOrdinal: event.eventOrdinal,
    };
    this.appendVersion(projectId, {
      entryId, ledger, key, value,
      // The correction is appended **after** the entry's existing sources, so `sourceRefs[0]` — the
      // event a recall item anchors and therefore the one the identity rule reads — stays the event
      // the entry was compiled from. A correction cannot hand an owned entry to another identity.
      sourceRefs: uniqRefs([...current.sourceRefs, correctionRef]),
      recordedAt: event.occurredAt,
      compiledAt: now,
      version: current.version + 1,
      eventType: 'PROFILE_ENTRY_CORRECTED',
    });
    // The whole ledger is recompiled, not only the corrected key: the ticket's "该册重编译".
    this.compile({ projectId, ledger, now });
    return this.entries({ projectId, ledger }).find((entry) => entry.entryId === entryId)!;
  }

  /** Every profile row for the project, oldest first. The audit is the ledger itself. */
  audit(input: { projectId: string; entryId?: string; ledger?: ProfileLedger }): ProfileAuditEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const ledger = input.ledger === undefined ? undefined : this.requireLedger(input.ledger);
    return this.loadProjectRows(projectId)
      .filter((row) => (input.entryId === undefined || row.payload.entryId === input.entryId)
        && (ledger === undefined || row.payload.ledger === ledger))
      .map((row) => ({
        entryId: String(row.payload.entryId ?? ''),
        eventType: row.event.eventType as ProfileEventType,
        ledger: isLedger(row.payload.ledger) ? row.payload.ledger : undefined,
        payload: row.payload,
        occurredAt: row.event.occurredAt,
      }));
  }

  private requireLedger(value: unknown): ProfileLedger {
    if (!isLedger(value)) throw profileError('invalid_profile_ledger', `expected one of ${PROFILE_LEDGERS.join(', ')}`);
    return value;
  }

  /** All four ledgers' candidates, each already filtered by its exclusion rules. */
  private derive(projectId: string, ledgers: ProfileLedger[]): Candidate[] {
    const wanted = new Set<ProfileLedger>(ledgers);
    const candidates: Candidate[] = [];
    if (wanted.has('facts') || wanted.has('preferences')) candidates.push(...this.deriveFactsAndPreferences(projectId));
    if (wanted.has('relations')) candidates.push(...this.deriveRelations(projectId));
    if (wanted.has('ongoing')) candidates.push(...this.deriveOngoing(projectId));
    // One entry per (ledger, key): the newest evidence wins, so a newer fact is not shadowed by an
    // older belief about the same claim.
    const byKey = new Map<string, Candidate>();
    for (const candidate of candidates) {
      const id = `${candidate.ledger}\u0000${candidate.key}`;
      const existing = byKey.get(id);
      if (!existing || candidate.recordedAt > existing.recordedAt) byKey.set(id, candidate);
    }
    return [...byKey.values()];
  }

  private deriveFactsAndPreferences(projectId: string): Candidate[] {
    const out: Candidate[] = [];
    for (const fact of this.facts.listFactsByTimeRange(0, MAX_TIME, { projectId, limit: PROFILE_EVIDENCE_LIMIT })) {
      if (!(PROFILE_LIVE_FACT_STATUSES as readonly string[]).includes(fact.status)) continue;
      const family = String(fact.predicateFamily ?? '').trim();
      if (!family || (PROFILE_TRANSIENT_PREDICATES as readonly string[]).includes(family)) continue;
      const value = String(fact.object ?? fact.predicateValue ?? '').trim();
      if (!value) continue;
      const ledger: ProfileLedger = (PROFILE_PREFERENCE_PREDICATES as readonly string[]).includes(family) ? 'preferences' : 'facts';
      const candidate = this.candidate(ledger, `${String(fact.subject).trim()}.${family}`, value, this.refsForNeuron(fact.neuronId), fact.validFrom);
      if (candidate) out.push(candidate);
    }
    for (const belief of this.beliefs.listByTimeRange(0, MAX_TIME, { projectId, limit: PROFILE_EVIDENCE_LIMIT })) {
      if (belief.status !== 'active') continue;
      const predicate = String(belief.predicate ?? '').trim();
      if (!predicate || (PROFILE_TRANSIENT_PREDICATES as readonly string[]).includes(predicate)) continue;
      const value = String(belief.objectValue?.normalized || belief.objectValue?.raw || '').trim();
      if (!value) continue;
      const ledger: ProfileLedger = (PROFILE_PREFERENCE_PREDICATES as readonly string[]).includes(predicate) ? 'preferences' : 'facts';
      const key = String(belief.canonicalKey || `${belief.subject}.${predicate}`).trim();
      const candidate = this.candidate(ledger, key, value, this.refsForEvent(belief.sourceEventId), belief.validFrom);
      if (candidate) out.push(candidate);
    }
    return out;
  }

  private deriveRelations(projectId: string): Candidate[] {
    const out: Candidate[] = [];
    const seen = new Set<string>();
    for (const person of this.entities.listEntitiesUpdatedInRange(0, MAX_TIME, 'person', projectId)) {
      for (const relation of this.entities.listRelations(person.entityId, undefined, projectId)) {
        if (seen.has(relation.relationId)) continue;
        seen.add(relation.relationId);
        if (!(PERSON_RELATION_TYPES as readonly string[]).includes(relation.relationType)) continue;
        const from = this.entities.getByEntityId(relation.sourceEntityId);
        const to = this.entities.getByEntityId(relation.targetEntityId);
        if (from?.type !== 'person' || to?.type !== 'person') continue;
        const sourceRefs = uniqRefs([
          ...this.refsForNeuron(relation.sourceNeuronId),
          ...this.relationWitnessRefs(from.entityId, projectId),
          ...this.relationWitnessRefs(to.entityId, projectId),
        ]);
        if (sourceRefs.length === 0) continue; // evidence_required: a relation nothing backs is not compiled
        out.push({
          ledger: 'relations',
          // Both ends and the label are the identity: a person has several children, friends and
          // colleagues, and a key of `from.label` would collapse them into whichever came last.
          key: `${from.canonicalName}.${relation.relationType}.${to.canonicalName}`,
          value: to.canonicalName,
          sourceRefs,
          recordedAt: relation.createdAt,
        });
      }
    }
    return out;
  }

  private deriveOngoing(projectId: string): Candidate[] {
    const out: Candidate[] = [];
    for (const memory of this.listOngoing(projectId)) {
      if (!(PROFILE_ONGOING_STATUSES as readonly string[]).includes(memory.status as ProspectiveMemoryStatus)) continue;
      const sourceRefs = uniqRefs(memory.evidenceEventIds.map((eventId) => this.refsForEvent(eventId)).flat());
      if (sourceRefs.length === 0) continue;
      const value = [memory.title, memory.details].filter(Boolean).join(' — ').trim();
      if (!value) continue;
      out.push({
        ledger: 'ongoing',
        key: String(memory.canonicalKey).trim(),
        value,
        sourceRefs,
        recordedAt: memory.updatedAt || memory.createdAt,
      });
    }
    return out;
  }

  private candidate(ledger: ProfileLedger, key: string, value: string, sourceRefs: MemorySourceRef[], recordedAt: number): Candidate | null {
    if (!key || !value || sourceRefs.length === 0) return null; // evidence_required
    return { ledger, key, value, sourceRefs: uniqRefs(sourceRefs), recordedAt };
  }

  private refsForNeuron(neuronId: string | undefined): MemorySourceRef[] {
    const eventId = this.sourceEventOfNeuron(neuronId);
    return this.refsForEvent(eventId);
  }

  private refsForEvent(eventId: string | undefined): MemorySourceRef[] {
    if (!eventId) return [];
    const event = this.events.getEvent(eventId);
    if (!event) return [];
    return [{
      eventId: event.eventId,
      eventType: event.rawEventType || event.eventType,
      sourceId: event.sourceId,
      role: event.role,
      threadId: event.threadId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      threadSeq: event.threadSeq,
      turnSeq: event.turnSeq,
      eventOrdinal: event.eventOrdinal,
    }];
  }

  /**
   * The memories attached to one person, as evidence that the relation exists. A person with no
   * attached memory contributes nothing, which is why a relation nothing backs is not compiled.
   */
  private relationWitnessRefs(entityId: string, projectId: string): MemorySourceRef[] {
    const refs: MemorySourceRef[] = [];
    for (const mention of this.entities.listTimeline({ entityId, projectId, limit: 4 })) {
      refs.push(...this.refsForNeuron(mention.neuronId));
      if (refs.length >= 4) break;
    }
    return refs.slice(0, 4);
  }

  /** Write a version only when the value changed and the evidence is newer than what is current. */
  private writeIfChanged(index: Map<string, EntryGroup>, projectId: string, candidate: Candidate, now: number): boolean {
    const entryId = entryIdOf(projectId, candidate.ledger, candidate.key);
    const group = index.get(entryId);
    const last = group?.versions[group.versions.length - 1];
    const current = currentIn(index, entryId);
    if (current && (current.value === candidate.value || current.recordedAt >= candidate.recordedAt)) return false;
    this.applyVersion(index, projectId, {
      entryId,
      ledger: candidate.ledger,
      key: candidate.key,
      value: candidate.value,
      sourceRefs: candidate.sourceRefs,
      recordedAt: candidate.recordedAt,
      compiledAt: now,
      version: (last?.version ?? 0) + 1,
      eventType: 'PROFILE_ENTRY_COMPILED',
    });
    return true;
  }

  /** Retire every current entry of one ledger whose key the evidence no longer derives. */
  private retireAbsent(index: Map<string, EntryGroup>, projectId: string, ledger: ProfileLedger, derivedKeys: Set<string>, now: number): number {
    let retired = 0;
    for (const group of index.values()) {
      const current = group.versions[group.versions.length - 1];
      if (!current || group.retired || current.ledger !== ledger) continue;
      if (derivedKeys.has(current.key) || group.lastEventType === 'PROFILE_ENTRY_CORRECTED') continue;
      this.applyVersion(index, projectId, {
        entryId: current.entryId,
        ledger,
        key: current.key,
        value: current.value,
        sourceRefs: current.sourceRefs,
        recordedAt: current.recordedAt,
        compiledAt: now,
        version: current.version + 1,
        eventType: 'PROFILE_ENTRY_RETIRED',
      });
      retired += 1;
    }
    return retired;
  }

  /** Append a version and fold it into the in-memory index, so one compile reads the ledger once. */
  private applyVersion(index: Map<string, EntryGroup>, projectId: string, input: {
    entryId: string;
    ledger: ProfileLedger;
    key: string;
    value: string;
    sourceRefs: MemorySourceRef[];
    recordedAt: number;
    compiledAt: number;
    version: number;
    eventType: 'PROFILE_ENTRY_COMPILED' | 'PROFILE_ENTRY_CORRECTED' | 'PROFILE_ENTRY_RETIRED';
  }): void {
    this.appendVersion(projectId, input);
    const group = index.get(input.entryId) ?? { versions: [], lastEventType: input.eventType, retired: false };
    group.versions.push({
      entryId: input.entryId,
      ledger: input.ledger,
      key: input.key,
      value: input.value,
      sourceRefs: input.sourceRefs,
      recordedAt: input.recordedAt,
      compiledAt: input.compiledAt,
      version: input.version,
      status: 'current',
    });
    group.lastEventType = input.eventType;
    group.retired = input.eventType === 'PROFILE_ENTRY_RETIRED';
    index.set(input.entryId, group);
  }

  private appendVersion(projectId: string, input: {
    entryId: string;
    ledger: ProfileLedger;
    key: string;
    value: string;
    sourceRefs: MemorySourceRef[];
    recordedAt: number;
    compiledAt: number;
    version: number;
    eventType: 'PROFILE_ENTRY_COMPILED' | 'PROFILE_ENTRY_CORRECTED' | 'PROFILE_ENTRY_RETIRED';
  }): MemoryEvent {
    return this.events.append({
      streamId: `profile-entry:${input.entryId}`,
      streamType: 'system',
      eventType: input.eventType,
      projectId,
      sourceId: 'profile',
      occurredAt: input.compiledAt,
      payload: {
        entryId: input.entryId,
        projectId,
        ledger: input.ledger,
        key: input.key,
        value: input.value,
        sourceRefs: input.sourceRefs,
        recordedAt: input.recordedAt,
        compiledAt: input.compiledAt,
        version: input.version,
      },
    });
  }

  private appendReceipt(projectId: string, ledger: ProfileLedger, now: number, entries: number, written: number): MemoryEvent {
    return this.events.append({
      streamId: `profile-ledger:${projectId}:${ledger}`,
      streamType: 'system',
      eventType: 'PROFILE_LEDGER_RECOMPILED',
      projectId,
      sourceId: 'profile',
      occurredAt: now,
      payload: { projectId, ledger, entries, written, compiledAt: now },
    });
  }

  private currentEntries(projectId: string): ProfileEntry[] {
    const out: ProfileEntry[] = [];
    for (const group of this.entryGroups(projectId).values()) {
      const current = group.versions[group.versions.length - 1];
      if (current && !group.retired) out.push({ ...current, status: 'current' });
    }
    return out;
  }

  private currentEntry(projectId: string, entryId: string): ProfileEntry | null {
    const current = currentIn(this.entryGroups(projectId), entryId);
    return current ? { ...current, status: 'current' } : null;
  }

  /** entryId → its versions oldest first, plus how the newest row left it. */
  private entryGroups(projectId: string): Map<string, EntryGroup> {
    const byEntry = new Map<string, EntryGroup>();
    for (const row of this.loadProjectRows(projectId)) {
      if (row.event.eventType === 'PROFILE_LEDGER_RECOMPILED') continue;
      const entry = entryFromPayload(row.payload, row.event);
      if (!entry) continue;
      const group = byEntry.get(entry.entryId) ?? { versions: [], lastEventType: 'PROFILE_ENTRY_COMPILED', retired: false };
      group.versions.push(entry);
      group.lastEventType = row.event.eventType as ProfileEventType;
      group.retired = row.event.eventType === 'PROFILE_ENTRY_RETIRED';
      byEntry.set(entry.entryId, group);
    }
    return byEntry;
  }

  private loadProjectRows(projectId: string): Array<{ event: MemoryEvent; payload: Record<string, unknown> }> {
    const rows: Array<{ event: MemoryEvent; payload: Record<string, unknown> }> = [];
    const filters = { projectId: [projectId], eventType: [...PROFILE_EVENT_TYPES], order: 'asc' as const };
    for (let page = 1; rows.length < MAX_PROFILE_LEDGER_ROWS; page += 1) {
      const result = this.events.queryEvents(page, LEDGER_PAGE_SIZE, filters);
      if (result.records.length === 0) break;
      for (const event of result.records) rows.push({ event, payload: (event.payload ?? {}) as Record<string, unknown> });
      if (rows.length >= result.total) break;
    }
    return rows.slice(0, MAX_PROFILE_LEDGER_ROWS);
  }
}

/** The live version of one entry, or null when it is retired or absent. */
function currentIn(index: Map<string, EntryGroup>, entryId: string): ProfileEntry | null {
  const group = index.get(entryId);
  const current = group?.versions[group.versions.length - 1];
  return current && group && !group.retired ? current : null;
}

function entryFromPayload(payload: Record<string, unknown>, event: MemoryEvent): ProfileEntry | null {
  const entryId = typeof payload.entryId === 'string' ? payload.entryId : '';
  const ledger = payload.ledger;
  const key = typeof payload.key === 'string' ? payload.key : '';
  const value = typeof payload.value === 'string' ? payload.value : '';
  if (!entryId || !isLedger(ledger) || !key || !value) return null;
  return {
    entryId,
    ledger,
    key,
    value,
    sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs as MemorySourceRef[] : [],
    recordedAt: Number(payload.recordedAt ?? event.occurredAt),
    compiledAt: Number(payload.compiledAt ?? event.occurredAt),
    version: Number(payload.version ?? 1),
    status: 'current',
  };
}

/**
 * The cue tokens a profile entry is matched against: CJK bigrams and whole runs, latin words of two
 * or more, numbers — the same shape the recall discriminators use, local so this module does not
 * import the recall hot path.
 */
export function profileCues(text: string): string[] {
  const cues = new Set<string>();
  for (const run of text.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let index = 0; index + 1 < run.length; index += 1) cues.add(run.slice(index, index + 2));
    if (run.length > 1) cues.add(run);
  }
  for (const word of text.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? []) cues.add(word.toLowerCase());
  for (const digits of text.match(/\d+/g) ?? []) cues.add(digits);
  return [...cues];
}

/** The frozen profile score: ledger weight, halved every half-life of evidence age. */
export function profileScore(entry: ProfileEntry, now: number): number {
  const age = Math.max(0, now - entry.recordedAt);
  return PROFILE_LEDGER_WEIGHT[entry.ledger] * Math.pow(0.5, age / PROFILE_DECAY_HALF_LIFE_MS);
}
