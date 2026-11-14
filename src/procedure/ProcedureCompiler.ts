/**
 * The procedure book (F15 of #192): "how the thing got done", compiled from this project's own
 * attempts and from imported guides.
 *
 * The third compiled book has the same shape as the other two: the ledger is the state. Every
 * version of an entry is a `memory_events` row on `procedure-entry:<entryId>`, a recompile leaves a
 * `PROCEDURE_BOOK_RECOMPILED` receipt, and nothing here adds a table, a column or a migration.
 *
 * The compiler is deterministic and reads structured evidence, never free text:
 *
 * - **Own experiences** are `task_event` rows whose `metadata.procedure` names the domain, the key,
 *   the steps, the tools chosen, the outcome and whether the procedure is a checklist (#192's
 *   "真实经历" — success, failure, duration and tool choice are the evidence).
 * - **User corrections** are `user` turns whose `metadata.procedureCorrection` names a domain and a
 *   key. A correction is the highest-weighted evidence and replaces the practice it corrects.
 * - **Imported guides** are rows the #143 import channel already marks `metadata.imported` and that
 *   carry the same `metadata.procedure` descriptor. They are recallable and compiled, and an own
 *   experience outranks them in recall; the imported book is not deleted, it loses the ranking.
 *
 * Confidence is support count: one experience is `tentative`, repeated success is `established`,
 * and a failed attempt is recorded and keeps the entry tentative until a success follows. A practice
 * that is disproved is not deleted — it is a retired row the next compile can revise.
 *
 * Consumption is by task description, never by a skill name: `recall({ task })` matches the task
 * text against domain, key, title, steps and tools. `assembleTask` renders the lane, and a
 * `checklist` entry whose domain the task hits is included whole — no truncation, no excerpt —
 * whichever budget the caller passes.
 *
 * The written contract is `docs/procedure-compilation.md`, held by
 * `__tests__/procedure-compilation.contract.test.ts`.
 */
import { createHash } from 'node:crypto';

import { profileCues } from '../profile/ProfileCompiler.js';
import { sessionTokens } from '../session/SessionContextAssembler.js';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';

export const PROCEDURE_CONTRACT_VERSION = 1;

/** The two confidence grades. Frozen; support count decides. */
export const PROCEDURE_GRADES = ['tentative', 'established'] as const;
export type ProcedureGrade = (typeof PROCEDURE_GRADES)[number];

/** Where an entry's practice came from, lowest weight first. Frozen. */
export const PROCEDURE_ORIGINS = ['imported', 'experience', 'correction'] as const;
export type ProcedureOrigin = (typeof PROCEDURE_ORIGINS)[number];

/** How an entry may be delivered. Frozen. */
export const PROCEDURE_DELIVERY_TIERS = ['recall', 'checklist'] as const;
export type ProcedureDeliveryTier = (typeof PROCEDURE_DELIVERY_TIERS)[number];

/**
 * The delivery policy, shaped like the surfacing channel table: a tier names whether the assembly
 * may leave the entry out under budget pressure. `checklist` is the mandatory tier — a release or
 * safety checklist hit by the task is delivered whole.
 */
export const PROCEDURE_DELIVERY_POLICY: Readonly<Record<ProcedureDeliveryTier, { downgradable: boolean }>> = {
  recall: { downgradable: true },
  checklist: { downgradable: false },
};

/** The ledger event types this face writes. Frozen. */
export const PROCEDURE_EVENT_TYPES = [
  'PROCEDURE_ENTRY_COMPILED',
  'PROCEDURE_ENTRY_RETIRED',
  'PROCEDURE_BOOK_RECOMPILED',
] as const;
export type ProcedureEventType = (typeof PROCEDURE_EVENT_TYPES)[number];

/** The face's methods. Frozen; adding one is additive, removing or renaming one is not. */
export const PROCEDURE_API_METHODS = ['compile', 'entries', 'recall', 'assembleTask', 'audit'] as const;

/** `ProcedureEntry`'s field set, frozen by the contract document. */
export const PROCEDURE_ENTRY_FIELDS = [
  'entryId',
  'domain',
  'key',
  'title',
  'steps',
  'tools',
  'grade',
  'origin',
  'delivery',
  'support',
  'sourceRefs',
  'recordedAt',
  'compiledAt',
  'version',
  'status',
] as const;

/** The refusals this face names, frozen. */
export const PROCEDURE_ERROR_CODES = [
  'project_id_required',
  'procedure_task_required',
  'invalid_limit',
  'invalid_target_tokens',
] as const;
export type ProcedureErrorCode = (typeof PROCEDURE_ERROR_CODES)[number];

/** Successful attempts needed before a practice is `established`. Frozen. */
export const PROCEDURE_ESTABLISHED_SUCCESSES = 2;
export const PROCEDURE_RECALL_LIMIT = 3;
export const PROCEDURE_RECALL_MAX = 10;
/** How old evidence may get before half its recall weight is gone. Frozen. */
export const PROCEDURE_DECAY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;
/** Origin weights in the recall score, derived from the frozen origin order. */
export const PROCEDURE_ORIGIN_WEIGHT: Readonly<Record<ProcedureOrigin, number>> = {
  correction: PROCEDURE_ORIGINS.length,
  experience: PROCEDURE_ORIGINS.length - 1,
  imported: PROCEDURE_ORIGINS.length - 2,
};

export type ProcedureEntryStatus = 'current' | 'superseded' | 'retired';

export interface ProcedureSupport {
  successes: number;
  failures: number;
  /** The latest attempt's outcome; `undefined` for imported material, which is not an attempt. */
  lastOutcome?: 'succeeded' | 'failed';
}

export interface ProcedureEntry {
  entryId: string;
  /** The task domain the practice belongs to. Recall is by task text, but the domain is the identity. */
  domain: string;
  key: string;
  title: string;
  /** The ordered steps, quoted from the evidence. Never rewritten by the compiler. */
  steps: string[];
  /** The tools the successful attempts chose, in first-use order. */
  tools: string[];
  grade: ProcedureGrade;
  origin: ProcedureOrigin;
  delivery: ProcedureDeliveryTier;
  support: ProcedureSupport;
  sourceRefs: MemorySourceRef[];
  recordedAt: number;
  compiledAt: number;
  version: number;
  status: ProcedureEntryStatus;
}

export interface ProcedureRecallEntry extends ProcedureEntry {
  score: number;
  /** True when a checklist entry's domain is hit by the task; the assembly must include it whole. */
  mandatory: boolean;
}

export interface ProcedureCompileInput {
  projectId: string;
  now?: number;
}

export interface ProcedureCompileResult {
  projectId: string;
  written: number;
  entries: number;
  compiledAt: number;
}

export interface ProcedureRecallInput {
  projectId: string;
  /** The task description. Matched against domain, key, title, steps and tools — never a skill name. */
  task: string;
  now?: number;
  limit?: number;
}

export interface ProcedureAssemblyInput extends ProcedureRecallInput {
  /** The caller's bandwidth. A checklist entry is included whole regardless. */
  targetTokens?: number;
}

export type ProcedureAssemblyKind = 'procedure' | 'preference';

export interface ProcedureAssemblyItem {
  entryId: string;
  kind: ProcedureAssemblyKind;
  text: string;
  sourceRefs: MemorySourceRef[];
  mandatory: boolean;
}

export interface ProcedureDecision {
  entryId: string;
  action: 'included' | 'dropped';
  reason: 'matched' | 'checklist_domain_match' | 'budget_exceeded';
}

export interface ProcedureAssembly {
  projectId: string;
  task: string;
  targetTokens?: number;
  usedTokens: number;
  items: ProcedureAssemblyItem[];
  decisionTrace: ProcedureDecision[];
  text: string;
}

export interface ProcedureAuditEntry {
  entryId: string;
  eventType: ProcedureEventType;
  payload: Record<string, unknown>;
  occurredAt: number;
}

/** The owner's preference ledger, read by the same task description (F5's API, not a copy). */
export interface PreferenceForTask {
  entryId: string;
  key: string;
  value: string;
  sourceRefs: MemorySourceRef[];
  recordedAt: number;
}

export interface ProcedureCompilerPorts {
  events: EventStore;
  preferences: (input: { projectId: string; query: string; now: number; limit: number }) => PreferenceForTask[];
}

interface Descriptor {
  domain: string;
  key: string;
  title: string;
  steps: string[];
  tools: string[];
  checklist: boolean;
  outcome?: 'succeeded' | 'failed';
}

interface Experience {
  descriptor: Descriptor;
  event: MemoryEvent;
  imported: boolean;
}

interface Correction {
  domain: string;
  key: string;
  text: string;
  event: MemoryEvent;
}

interface Candidate {
  domain: string;
  key: string;
  own: boolean;
  entry: Omit<ProcedureEntry, 'entryId' | 'compiledAt' | 'version' | 'status'>;
}

/** One entry's versions, oldest first, plus how the newest row left it. */
interface EntryGroup {
  versions: ProcedureEntry[];
  retired: boolean;
}

const MAX_TIME = 8_640_000_000_000_000;
const LEDGER_PAGE_SIZE = 500;
// ponytail: a project with more than 4000 procedure rows reads the newest 4000; page the rest or add
// an event_type index when a project has years of books.
const MAX_PROCEDURE_ROWS = 4000;
const MAX_STEPS = 16;
const MAX_TOOLS = 8;

function procedureError(code: ProcedureErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function requiredText(value: string | undefined, code: ProcedureErrorCode): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw procedureError(code);
  return trimmed;
}

function entryIdOf(projectId: string, domain: string, key: string, own: boolean): string {
  const digest = createHash('sha256').update(`${projectId}\u0000${domain}\u0000${key}\u0000${own ? 'own' : 'imported'}`)
    .digest('hex').slice(0, 20);
  return `procedure-${digest}`;
}

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

function strings(value: unknown, cap: number): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: string[] = [];
  for (const item of raw) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= cap) break;
  }
  return out;
}

function metadataOf(event: MemoryEvent): Record<string, unknown> {
  const payload = event.payload as { metadata?: unknown } | undefined;
  return payload?.metadata && typeof payload.metadata === 'object'
    ? payload.metadata as Record<string, unknown>
    : {};
}

function isImported(event: MemoryEvent): boolean {
  return metadataOf(event).imported === true;
}

/**
 * The structured descriptor every experience and imported guide carries. Anything missing a domain
 * or a key is not procedural evidence; anything unreadable is ignored rather than guessed at.
 */
export function procedureDescriptorOf(metadata: Record<string, unknown>): Descriptor | null {
  const raw = metadata.procedure;
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const domain = typeof input.domain === 'string' ? input.domain.trim() : '';
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!domain || !key) return null;
  const outcome = input.outcome === 'failed' ? 'failed' : input.outcome === 'succeeded' ? 'succeeded' : undefined;
  return {
    domain,
    key,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : key,
    steps: strings(input.steps, MAX_STEPS),
    tools: strings(input.tools, MAX_TOOLS),
    checklist: input.checklist === true,
    outcome,
  };
}

function correctionOf(event: MemoryEvent): Correction | null {
  if (event.role !== 'user') return null;
  const raw = metadataOf(event).procedureCorrection;
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const domain = typeof input.domain === 'string' ? input.domain.trim() : '';
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  const text = typeof event.payload === 'object' && typeof (event.payload as { text?: unknown }).text === 'string'
    ? (event.payload as { text: string }).text.trim()
    : '';
  if (!domain || !key || !text) return null;
  return { domain, key, text, event };
}

function refOf(event: MemoryEvent): MemorySourceRef {
  return {
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
  };
}

function groupKey(domain: string, key: string): string {
  return `${domain.toLowerCase()}\u0000${key.toLowerCase()}`;
}

function sameValue(left: ProcedureEntry, right: Candidate['entry']): boolean {
  return left.title === right.title
    && left.grade === right.grade
    && left.origin === right.origin
    && left.delivery === right.delivery
    && JSON.stringify(left.steps) === JSON.stringify(right.steps)
    && JSON.stringify(left.tools) === JSON.stringify(right.tools)
    && JSON.stringify(left.support) === JSON.stringify(right.support);
}

export class ProcedureCompiler {
  private readonly events: EventStore;
  private readonly preferences: ProcedureCompilerPorts['preferences'];

  constructor(ports: ProcedureCompilerPorts) {
    this.events = ports.events;
    this.preferences = ports.preferences;
  }

  /**
   * Derive every entry from its evidence and append a version for each one that changed.
   * Idempotent: compiling twice with unchanged evidence writes no second version.
   */
  compile(input: ProcedureCompileInput): ProcedureCompileResult {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const now = input.now ?? Date.now();
    const candidates = this.derive(projectId);
    const index = this.entryGroups(projectId);
    let written = 0;
    for (const candidate of candidates) {
      if (this.writeIfChanged(index, projectId, candidate, now)) written += 1;
    }
    written += this.retireAbsent(
      index,
      projectId,
      new Set(candidates.map((candidate) => entryIdOf(projectId, candidate.entry.domain, candidate.entry.key, candidate.own))),
      now,
    );
    this.appendReceipt(projectId, now, candidates.length, written);
    return { projectId, written, entries: candidates.length, compiledAt: now };
  }

  /** Current entries, one per (domain, key, origin class). */
  entries(input: { projectId: string }): ProcedureEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    return this.currentEntries(projectId)
      .sort((a, b) => a.domain.localeCompare(b.domain) || a.key.localeCompare(b.key) || a.origin.localeCompare(b.origin));
  }

  /**
   * The procedure lane's read. Cue-matched against the task description and ranked by origin,
   * grade, support and evidence age. A checklist entry whose domain the task hits is always
   * returned, even when the limit would cut it — the assembly must carry it whole.
   */
  recall(input: ProcedureRecallInput): ProcedureRecallEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const task = requiredText(input.task, 'procedure_task_required');
    const limit = input.limit ?? PROCEDURE_RECALL_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) throw procedureError('invalid_limit', String(input.limit));
    const now = input.now ?? Date.now();
    const cues = profileCues(task);
    const scored = this.currentEntries(projectId)
      .filter((entry) => cues.length === 0 || cues.some((cue) => this.searchText(entry).includes(cue)))
      .map((entry) => ({
        ...entry,
        score: procedureScore(entry, now),
        mandatory: entry.delivery === 'checklist' && domainHit(task, entry.domain, cues),
      }))
      .sort(compareRecall);
    const bounded = Math.min(limit, PROCEDURE_RECALL_MAX);
    const picked = scored.slice(0, bounded);
    for (const entry of scored) {
      if (entry.mandatory && !picked.some((candidate) => candidate.entryId === entry.entryId)) picked.push(entry);
    }
    return picked;
  }

  /**
   * The start-of-work projection: procedures recalled by the task (checklist entries whole) plus
   * the owner's preference entries on the same task. Over budget, a `recall` entry may be dropped;
   * a `checklist` entry is never dropped and its text is never truncated.
   */
  assembleTask(input: ProcedureAssemblyInput): ProcedureAssembly {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const task = requiredText(input.task, 'procedure_task_required');
    const now = input.now ?? Date.now();
    if (input.targetTokens !== undefined && (!Number.isInteger(input.targetTokens) || input.targetTokens <= 0)) {
      throw procedureError('invalid_target_tokens', String(input.targetTokens));
    }
    const items: ProcedureAssemblyItem[] = [];
    const decisionTrace: ProcedureDecision[] = [];
    for (const entry of this.recall({ projectId, task, now, limit: PROCEDURE_RECALL_MAX })) {
      items.push({
        entryId: entry.entryId,
        kind: 'procedure',
        text: renderProcedure(entry),
        sourceRefs: entry.sourceRefs,
        mandatory: entry.mandatory,
      });
      decisionTrace.push({
        entryId: entry.entryId,
        action: 'included',
        reason: entry.mandatory ? 'checklist_domain_match' : 'matched',
      });
    }
    for (const preference of this.preferences({ projectId, query: task, now, limit: 2 })) {
      items.push({
        entryId: preference.entryId,
        kind: 'preference',
        text: `${preference.key}: ${preference.value}`,
        sourceRefs: preference.sourceRefs,
        mandatory: false,
      });
      decisionTrace.push({ entryId: preference.entryId, action: 'included', reason: 'matched' });
    }

    const kept: ProcedureAssemblyItem[] = [];
    const dropped: string[] = [];
    let usedTokens = 0;
    for (const item of items) {
      const cost = sessionTokens(`- ${item.text}\n`);
      if (item.mandatory || input.targetTokens === undefined || usedTokens + cost <= input.targetTokens) {
        kept.push(item);
        usedTokens += cost;
      } else {
        dropped.push(item.entryId);
      }
    }
    for (const entryId of dropped) {
      const decision = decisionTrace.find((entry) => entry.entryId === entryId && entry.action === 'included');
      if (decision) {
        decision.action = 'dropped';
        decision.reason = 'budget_exceeded';
      }
    }
    const text = kept.length > 0
      ? ['[procedures]', ...kept.map((item) => `- ${item.text}`)].join('\n')
      : '';
    return {
      projectId,
      task,
      targetTokens: input.targetTokens,
      usedTokens: sessionTokens(text),
      items: kept,
      decisionTrace,
      text,
    };
  }

  /** Every procedure row for the project, oldest first. The audit is the ledger itself. */
  audit(input: { projectId: string }): ProcedureAuditEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    return this.loadProjectRows(projectId).map((row) => ({
      entryId: String(row.payload.entryId ?? ''),
      eventType: row.event.eventType as ProcedureEventType,
      payload: row.payload,
      occurredAt: row.event.occurredAt,
    }));
  }

  private searchText(entry: ProcedureEntry): string {
    return `${entry.domain} ${entry.key} ${entry.title} ${entry.steps.join(' ')} ${entry.tools.join(' ')}`.toLowerCase();
  }

  /** Every descriptor and correction in the project, folded into one candidate per (domain, key, class). */
  private derive(projectId: string): Candidate[] {
    const experiences = new Map<string, Experience[]>();
    const imported = new Map<string, Experience[]>();
    const corrections = new Map<string, Correction>();
    for (const event of this.projectEvidence(projectId)) {
      const correction = correctionOf(event);
      if (correction) {
        const id = groupKey(correction.domain, correction.key);
        const existing = corrections.get(id);
        if (!existing || correction.event.occurredAt >= existing.event.occurredAt) corrections.set(id, correction);
        continue;
      }
      const descriptor = procedureDescriptorOf(metadataOf(event));
      if (!descriptor) continue;
      const item: Experience = { descriptor, event, imported: isImported(event) };
      const bucket = item.imported ? imported : experiences;
      const id = groupKey(descriptor.domain, descriptor.key);
      const list = bucket.get(id) ?? [];
      list.push(item);
      bucket.set(id, list);
    }

    const candidates: Candidate[] = [];
    for (const [id, list] of experiences) {
      const candidate = this.ownCandidate(list, corrections.get(id));
      if (candidate) candidates.push(candidate);
    }
    for (const [id, list] of imported) {
      // An imported guide is the book it was read from; a correction to that key is the owner's
      // word and becomes its own entry, so the imported text stays recallable as what was read.
      const candidate = this.importedCandidate(list);
      if (candidate) candidates.push(candidate);
    }
    for (const [id, correction] of corrections) {
      if (experiences.has(id)) continue;
      const title = imported.get(id)?.[0]?.descriptor.title;
      candidates.push(this.correctionCandidate(correction, title));
    }
    return candidates;
  }

  private ownCandidate(list: Experience[], correction: Correction | undefined): Candidate | null {
    const ordered = [...list].sort((a, b) => a.event.occurredAt - b.event.occurredAt);
    const successes = ordered.filter((item) => item.descriptor.outcome !== 'failed');
    const failures = ordered.filter((item) => item.descriptor.outcome === 'failed');
    if (successes.length === 0 && failures.length === 0) return null;
    const last = ordered[ordered.length - 1]!;
    const steps = correction
      ? [correction.text]
      : dedupe(successes.flatMap((item) => item.descriptor.steps), MAX_STEPS);
    const tools = correction ? [] : dedupe(successes.flatMap((item) => item.descriptor.tools), MAX_TOOLS);
    const title = (successes[successes.length - 1] ?? last).descriptor.title;
    const recordedAt = Math.max(last.event.occurredAt, correction?.event.occurredAt ?? 0);
    const entry: Candidate['entry'] = {
      domain: last.descriptor.domain,
      key: last.descriptor.key,
      title,
      steps,
      tools,
      // Repeated success establishes a practice; a correction establishes the owner's word at once.
      grade: correction || successes.length >= PROCEDURE_ESTABLISHED_SUCCESSES ? 'established' : 'tentative',
      origin: correction ? 'correction' : 'experience',
      delivery: list.some((item) => item.descriptor.checklist) ? 'checklist' : 'recall',
      support: { successes: successes.length, failures: failures.length, lastOutcome: last.descriptor.outcome },
      sourceRefs: uniqRefs([
        ...(correction ? [correction.event] : []),
        ...ordered.map((item) => item.event),
      ].map(refOf)),
      recordedAt,
    };
    return { domain: entry.domain, key: entry.key, own: true, entry };
  }

  private correctionCandidate(correction: Correction, title: string | undefined): Candidate {
    const entry: Candidate['entry'] = {
      domain: correction.domain,
      key: correction.key,
      title: title ?? correction.key,
      steps: [correction.text],
      tools: [],
      grade: 'established',
      origin: 'correction',
      delivery: 'recall',
      support: { successes: 0, failures: 0 },
      sourceRefs: [refOf(correction.event)],
      recordedAt: correction.event.occurredAt,
    };
    return { domain: entry.domain, key: entry.key, own: true, entry };
  }

  private importedCandidate(list: Experience[]): Candidate | null {
    const ordered = [...list].sort((a, b) => a.event.occurredAt - b.event.occurredAt);
    const latest = ordered[ordered.length - 1];
    if (!latest) return null;
    const entry: Candidate['entry'] = {
      domain: latest.descriptor.domain,
      key: latest.descriptor.key,
      title: latest.descriptor.title,
      steps: dedupe(ordered.flatMap((item) => item.descriptor.steps), MAX_STEPS),
      tools: dedupe(ordered.flatMap((item) => item.descriptor.tools), MAX_TOOLS),
      // Imported material is read, not attempted: it never reaches `established` on its own.
      grade: 'tentative',
      origin: 'imported',
      delivery: ordered.some((item) => item.descriptor.checklist) ? 'checklist' : 'recall',
      support: { successes: 0, failures: 0 },
      sourceRefs: uniqRefs(ordered.map((item) => item.event).map(refOf)),
      recordedAt: latest.event.occurredAt,
    };
    return { domain: entry.domain, key: entry.key, own: false, entry };
  }

  private projectEvidence(projectId: string): MemoryEvent[] {
    const out: MemoryEvent[] = [];
    const filters = { projectId: [projectId], eventType: ['RAW_EVENT_RECORDED' as const], order: 'asc' as const };
    for (let page = 1; out.length < MAX_PROCEDURE_ROWS; page += 1) {
      const result = this.events.queryEvents(page, LEDGER_PAGE_SIZE, filters);
      if (result.records.length === 0) break;
      out.push(...result.records);
      if (out.length >= result.total) break;
    }
    return out.slice(0, MAX_PROCEDURE_ROWS);
  }

  private writeIfChanged(index: Map<string, EntryGroup>, projectId: string, candidate: Candidate, now: number): boolean {
    const entryId = entryIdOf(projectId, candidate.entry.domain, candidate.entry.key, candidate.own);
    const group = index.get(entryId);
    const current = group?.versions[group.versions.length - 1];
    if (current && !group?.retired && sameValue(current, candidate.entry)) return false;
    if (current && candidate.entry.recordedAt < current.recordedAt) return false;
    const version = (current?.version ?? 0) + 1;
    const entry: ProcedureEntry = {
      ...candidate.entry,
      entryId,
      compiledAt: now,
      version,
      status: 'current',
    };
    this.appendVersion(projectId, entry, 'PROCEDURE_ENTRY_COMPILED');
    const next = index.get(entryId) ?? { versions: [], retired: false };
    next.versions.push(entry);
    next.retired = false;
    index.set(entryId, next);
    return true;
  }

  private retireAbsent(index: Map<string, EntryGroup>, projectId: string, derived: Set<string>, now: number): number {
    let retired = 0;
    for (const [entryId, group] of index) {
      if (group.retired || derived.has(entryId)) continue;
      const current = group.versions[group.versions.length - 1];
      if (!current) continue;
      const entry: ProcedureEntry = { ...current, compiledAt: now, version: current.version + 1, status: 'retired' };
      this.appendVersion(projectId, entry, 'PROCEDURE_ENTRY_RETIRED');
      group.versions.push(entry);
      group.retired = true;
      retired += 1;
    }
    return retired;
  }

  private appendVersion(projectId: string, entry: ProcedureEntry, eventType: ProcedureEventType): void {
    this.events.append({
      streamId: `procedure-entry:${entry.entryId}`,
      streamType: 'system',
      eventType,
      projectId,
      sourceId: 'procedure',
      occurredAt: entry.compiledAt,
      payload: { ...entry, projectId },
    });
  }

  private appendReceipt(projectId: string, now: number, entries: number, written: number): void {
    this.events.append({
      streamId: `procedure-book:${projectId}`,
      streamType: 'system',
      eventType: 'PROCEDURE_BOOK_RECOMPILED',
      projectId,
      sourceId: 'procedure',
      occurredAt: now,
      payload: { projectId, entries, written, compiledAt: now },
    });
  }

  private currentEntries(projectId: string): ProcedureEntry[] {
    const out: ProcedureEntry[] = [];
    for (const group of this.entryGroups(projectId).values()) {
      const current = group.versions[group.versions.length - 1];
      if (current && !group.retired) out.push({ ...current, status: 'current' });
    }
    return out;
  }

  private entryGroups(projectId: string): Map<string, EntryGroup> {
    const byEntry = new Map<string, EntryGroup>();
    for (const row of this.loadProjectRows(projectId)) {
      if (row.event.eventType === 'PROCEDURE_BOOK_RECOMPILED') continue;
      const entry = entryFromPayload(row.payload, row.event);
      if (!entry) continue;
      const group = byEntry.get(entry.entryId) ?? { versions: [], retired: false };
      group.versions.push(entry);
      group.retired = row.event.eventType === 'PROCEDURE_ENTRY_RETIRED';
      byEntry.set(entry.entryId, group);
    }
    return byEntry;
  }

  private loadProjectRows(projectId: string): Array<{ event: MemoryEvent; payload: Record<string, unknown> }> {
    const rows: Array<{ event: MemoryEvent; payload: Record<string, unknown> }> = [];
    const filters = { projectId: [projectId], eventType: [...PROCEDURE_EVENT_TYPES], order: 'asc' as const };
    for (let page = 1; rows.length < MAX_PROCEDURE_ROWS; page += 1) {
      const result = this.events.queryEvents(page, LEDGER_PAGE_SIZE, filters);
      if (result.records.length === 0) break;
      for (const event of result.records) rows.push({ event, payload: (event.payload ?? {}) as Record<string, unknown> });
      if (rows.length >= result.total) break;
    }
    return rows.slice(0, MAX_PROCEDURE_ROWS);
  }
}

function dedupe(values: string[], cap: number): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
    if (out.length >= cap) break;
  }
  return out;
}

function domainHit(task: string, domain: string, cues: string[]): boolean {
  const lowered = task.toLowerCase();
  const target = domain.toLowerCase();
  return lowered.includes(target) || cues.includes(target);
}

function compareRecall(a: ProcedureRecallEntry, b: ProcedureRecallEntry): number {
  return Number(b.mandatory) - Number(a.mandatory)
    || b.score - a.score
    || a.domain.localeCompare(b.domain)
    || a.entryId.localeCompare(b.entryId);
}

/** The frozen procedure score: origin × grade × support, halved every half-life of evidence age. */
export function procedureScore(entry: ProcedureEntry, now: number): number {
  const age = Math.max(0, now - entry.recordedAt);
  const support = 1 + Math.min(entry.support.successes, 3) * 0.1;
  const grade = entry.grade === 'established' ? 1 : 0.6;
  return PROCEDURE_ORIGIN_WEIGHT[entry.origin] * grade * support * Math.pow(0.5, age / PROCEDURE_DECAY_HALF_LIFE_MS);
}

/** The one rendering the model sees: title, steps and tools — no skill name, no wrapper vocabulary. */
export function renderProcedure(entry: ProcedureEntry): string {
  const head = entry.steps.length > 0 ? `${entry.title}: ${entry.steps.join(' → ')}` : entry.title;
  return entry.tools.length > 0 ? `${head} (tools: ${entry.tools.join(', ')})` : head;
}

function entryFromPayload(payload: Record<string, unknown>, event: MemoryEvent): ProcedureEntry | null {
  const entryId = typeof payload.entryId === 'string' ? payload.entryId : '';
  const domain = typeof payload.domain === 'string' ? payload.domain : '';
  const key = typeof payload.key === 'string' ? payload.key : '';
  const title = typeof payload.title === 'string' ? payload.title : '';
  if (!entryId || !domain || !key || !title) return null;
  const grade = (PROCEDURE_GRADES as readonly string[]).includes(String(payload.grade))
    ? payload.grade as ProcedureGrade : 'tentative';
  const origin = (PROCEDURE_ORIGINS as readonly string[]).includes(String(payload.origin))
    ? payload.origin as ProcedureOrigin : 'experience';
  const delivery = (PROCEDURE_DELIVERY_TIERS as readonly string[]).includes(String(payload.delivery))
    ? payload.delivery as ProcedureDeliveryTier : 'recall';
  const support = payload.support && typeof payload.support === 'object'
    ? payload.support as ProcedureSupport : { successes: 0, failures: 0 };
  return {
    entryId,
    domain,
    key,
    title,
    steps: Array.isArray(payload.steps) ? payload.steps.filter((step): step is string => typeof step === 'string') : [],
    tools: Array.isArray(payload.tools) ? payload.tools.filter((tool): tool is string => typeof tool === 'string') : [],
    grade,
    origin,
    delivery,
    support,
    sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs as MemorySourceRef[] : [],
    recordedAt: Number(payload.recordedAt ?? event.occurredAt),
    compiledAt: Number(payload.compiledAt ?? event.occurredAt),
    version: Number(payload.version ?? 1),
    status: 'current',
  };
}
