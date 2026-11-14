/**
 * Surfacing candidates (#160, F6): the kernel's half of emergence.
 *
 * The kernel answers with candidates and their reasons; the shell decides whether to speak, and
 * how. This face is a pull query — it owns no storage, holds no timer and calls no model. It reads
 * only products that already exist: F2's due wake intentions and prospective memories, F5's profile
 * entries, and the ledger's raw turns. The written contract is `docs/surfacing-candidates.md`,
 * held by `__tests__/surfacing-candidates.contract.test.ts`.
 *
 * Sensitivity is deterministic. A keychain mark is high and is hard-withheld from both channels,
 * because #142 already forbids that text from every read lane. Other high candidates are withheld
 * from `proactive` and allowed in `asked`; private candidates are withheld from `proactive` by
 * default and allowed when asked. The channel and occasion are recorded, never trusted: occasion
 * trust is F8's decision (#162), not this round's.
 */
import type { ProfileCompiler, ProfileEntry, ProfileLedger } from '../profile/ProfileCompiler.js';
import type { ProcedureCompiler, ProcedureEntry } from '../procedure/ProcedureCompiler.js';
import type { CommitmentBook } from '../commitment/CommitmentBook.js';
import type { ProspectiveMemoryRecord, ProspectiveMemoryService } from '../prospective/ProspectiveMemoryService.js';
import { eventHoldsSecretMark } from '../security/SecretMarks.js';
import type { EventStore } from '../store/EventStore.js';
import type { WakeIntention, WakeIntentionService } from '../temporal/WakeIntentionService.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';

/** Bump when a field, channel, tier, rule or error meaning changes incompatibly. Adding a tag source does not. */
export const SURFACING_CONTRACT_VERSION = 1;

/** The two channels a caller declares. Frozen; the document's table is the source. */
export const SURFACING_CHANNELS = ['proactive', 'asked'] as const;
export type SurfacingChannel = (typeof SURFACING_CHANNELS)[number];

/** The landed products a candidate may come from. Frozen. */
export const SURFACING_SOURCES = ['wake-intention', 'prospective-memory', 'profile', 'procedure', 'commitment', 'ledger'] as const;
export type SurfacingSource = (typeof SURFACING_SOURCES)[number];

/** The sensitivity tiers, lowest to highest. Frozen. */
export const SENSITIVITY_TIERS = ['daily', 'private', 'high'] as const;
export type SensitivityTier = (typeof SENSITIVITY_TIERS)[number];

/**
 * The default channel policy, frozen by the document. `proactive` is the agent speaking first;
 * `asked` is a query the owner or shell made. A keychain mark is a hard withhold in both channels
 * and is checked before this table.
 */
export const SURFACING_CHANNEL_POLICY: Readonly<Record<SensitivityTier, Readonly<Record<SurfacingChannel, boolean>>>> = {
  daily: { proactive: true, asked: true },
  private: { proactive: false, asked: true },
  high: { proactive: false, asked: true },
};

/** The face's methods. Frozen; adding one is additive, removing or renaming one is not. */
export const SURFACING_API_METHODS = ['candidates'] as const;

export const SURFACING_RESULT_FIELDS = ['projectId', 'channel', 'occasion', 'now', 'candidates', 'withheld'] as const;
export const SURFACING_CANDIDATE_FIELDS = [
  'candidateId',
  'source',
  'channel',
  'occasion',
  'content',
  'sourceRefs',
  'reason',
  'confidence',
  'freshness',
  'sensitivity',
  'decisionTrace',
] as const;
export const SURFACING_WITHHELD_FIELDS = [
  'candidateId',
  'source',
  'channel',
  'occasion',
  'sensitivity',
  'reason',
  'decisionTrace',
] as const;
export const SURFACING_FRESHNESS_FIELDS = ['observedAt', 'ageMs', 'expiresAt', 'expired'] as const;
export const SURFACING_DECISION_TRACE_FIELDS = ['version', 'reason', 'steps'] as const;
export const SURFACING_DECISION_STEP_FIELDS = ['rule', 'outcome', 'detail'] as const;
export const SENSITIVE_TAG_FIELDS = ['source', 'tier', 'reason', 'eventIds'] as const;
export const SENSITIVE_TAG_QUERY_FIELDS = ['projectId', 'eventIds', 'text', 'sourceType', 'metadata'] as const;

/** The refusals this face names. Frozen. */
export const SURFACING_ERROR_CODES = [
  'project_id_required',
  'invalid_surfacing_channel',
  'invalid_surfacing_query',
  'invalid_surfacing_occasion',
  'invalid_limit',
  'invalid_surfacing_now',
] as const;
export type SurfacingErrorCode = (typeof SURFACING_ERROR_CODES)[number];

/** Text markers that make a candidate high. Frozen; the document's table is the source. */
export const SENSITIVITY_HIGH_MARKERS = [
  '病历',
  '诊断',
  '处方',
  '手术',
  '住院',
  '疾病',
  '癌症',
  '肿瘤',
  '高血压',
  '糖尿病',
  '心脏病',
  '哮喘',
  '抑郁',
  '焦虑症',
  '精神科',
  '心理治疗',
  '自杀',
  '自残',
  '家暴',
  '性侵',
  '艾滋病',
  '身份证号',
  '银行卡号',
  '信用卡号',
  '密码',
  '私钥',
  'medical record',
  'diagnosis',
  'prescription',
  'surgery',
  'hospitalized',
  'cancer',
  'depression',
  'therapy',
  'suicide',
  'self-harm',
  'domestic violence',
  'sexual assault',
  'social security',
  'bank card',
  'credit card',
  'password',
  'private key',
  'hiv',
  'aids',
] as const;

/** Text markers that make a candidate private. Frozen; the document's table is the source. */
export const SENSITIVITY_PRIVATE_MARKERS = [
  '工资',
  '薪资',
  '收入',
  '存款',
  '债务',
  '贷款',
  '房贷',
  '房租',
  '离婚',
  '吵架',
  '家庭矛盾',
  '体重',
  '过敏',
  '怀孕',
  '医院',
  '体检',
  '复查',
  'salary',
  'income',
  'debt',
  'mortgage',
  'divorce',
  'argument',
  'weight',
  'allergy',
  'pregnant',
] as const;

/** Raw event types that make a candidate private. Frozen. */
export const SOURCE_TYPE_PRIVATE_VALUES = ['tool_call', 'tool_result', 'action_result'] as const;

export const SURFACING_DEFAULT_LIMIT = 20;
export const SURFACING_MAX_LIMIT = 100;
export const SURFACING_SCAN_LIMIT = 200;
export const SURFACING_LEDGER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SURFACING_ASKED_LEDGER_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const SURFACING_DUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The one narrow interface a sensitive mark enters through.
 *
 * F10's life-information marks will be another source with this shape; adding one is additive and
 * does not bump the contract version. `eventIds` empty means the tag applies to the whole
 * candidate; a non-empty list names the source refs it applies to.
 */
export interface SensitiveTag {
  /** Where the mark came from: `keychain`, `source-type`, and later `life-info`. */
  source: string;
  tier: SensitivityTier;
  reason: string;
  eventIds: string[];
}

export interface SensitivityTagQuery {
  projectId: string;
  eventIds: string[];
  text: string;
  sourceType?: string;
  metadata?: Record<string, unknown>;
}

export interface SensitivityTagSource {
  tagsFor(query: SensitivityTagQuery): readonly SensitiveTag[];
}

export interface SensitivityClassification {
  tier: SensitivityTier;
  /** Every tag and text marker that fired, in the order it was evaluated. */
  matched: SensitiveTag[];
}

export interface SurfacingFreshness {
  /** The source's own instant: a turn's occurrence, a due item's due time, a profile entry's evidence time. */
  observedAt: number;
  /** `now - observedAt`; negative means the source is due in the future. */
  ageMs: number;
  /** When the candidate stops being timely, or `null` for a long-lived profile entry. */
  expiresAt: number | null;
  expired: boolean;
}

export interface SurfacingDecisionStep {
  rule: string;
  outcome: string;
  detail: Record<string, unknown>;
}

export interface SurfacingDecisionTrace {
  version: 'surfacing_candidate_decision.v1';
  /** Exactly `steps.map(step => `${step.rule}=${step.outcome}`).join('; ')`. */
  reason: string;
  steps: SurfacingDecisionStep[];
}

export interface SurfacingCandidate {
  candidateId: string;
  source: SurfacingSource;
  channel: SurfacingChannel;
  occasion?: string;
  content: string;
  sourceRefs: MemorySourceRef[];
  reason: string;
  confidence: number;
  freshness: SurfacingFreshness;
  sensitivity: SensitivityTier;
  decisionTrace: SurfacingDecisionTrace;
}

/** A candidate the channel policy withheld. Ids and reasons only; never its content. */
export interface SurfacingWithheld {
  candidateId: string;
  source: SurfacingSource;
  channel: SurfacingChannel;
  occasion?: string;
  sensitivity: SensitivityTier;
  reason: string;
  decisionTrace: SurfacingDecisionTrace;
}

export interface SurfacingResult {
  projectId: string;
  channel: SurfacingChannel;
  occasion?: string;
  now: number;
  candidates: SurfacingCandidate[];
  withheld: SurfacingWithheld[];
}

export interface SurfacingCandidatesInput {
  projectId: string;
  channel: SurfacingChannel;
  /** Declared by the caller and recorded; this round attaches no trust to it. */
  occasion?: string;
  /** Cue text for the asked channel. Empty matches everything. */
  query?: string;
  now?: number;
  limit?: number;
}

export interface SurfacingCandidatesPorts {
  events: EventStore;
  profile: ProfileCompiler;
  /** F15's procedure book. Absent until the shell passes it, so the source simply contributes none. */
  procedures?: ProcedureCompiler;
  /** F16's commitment book. Absent until the shell passes it, so the source contributes none. */
  commitments?: CommitmentBook;
  wakeIntentions: WakeIntentionService;
  prospectiveMemories: ProspectiveMemoryService;
  /**
   * Additional sources appended after the built-in keychain and source-type sources; F10 puts its
   * life-info source here. Built-ins are unconditional so no caller can drop the #142 withhold.
   */
  sensitiveTagSources?: readonly SensitivityTagSource[];
}

const TIER_RANK: Readonly<Record<SensitivityTier, number>> = { daily: 0, private: 1, high: 2 };
const KEYCHAIN_SOURCE = 'keychain';
const SOURCE_RANK: Readonly<Record<SurfacingSource, number>> = {
  'prospective-memory': 0,
  'wake-intention': 1,
  profile: 2,
  procedure: 3,
  commitment: 4,
  ledger: 5,
};
const PROFILE_CONFIDENCE: Readonly<Record<ProfileLedger, number>> = {
  ongoing: 0.9,
  relations: 0.85,
  preferences: 0.8,
  facts: 0.75,
};
const PROCEDURE_CONFIDENCE: Readonly<Record<ProcedureEntry['grade'], number>> = {
  established: 0.85,
  tentative: 0.65,
};

interface RawCandidate {
  source: SurfacingSource;
  sourceId: string;
  sourceOutcome: string;
  content: string;
  sourceRefs: MemorySourceRef[];
  observedAt: number;
  expiresAt: number | null;
  confidence: number;
  sourceType?: string;
  metadata?: Record<string, unknown>;
}

function surfacingError(code: SurfacingErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function requireProjectId(value: unknown): string {
  const projectId = typeof value === 'string' ? value.trim() : '';
  if (!projectId) throw surfacingError('project_id_required');
  return projectId;
}

function requireChannel(value: unknown): SurfacingChannel {
  if (!(SURFACING_CHANNELS as readonly unknown[]).includes(value)) {
    throw surfacingError('invalid_surfacing_channel', `expected one of ${SURFACING_CHANNELS.join(', ')}`);
  }
  return value as SurfacingChannel;
}

function containsMarker(text: string, marker: string): boolean {
  if (/^[\x00-\x7F]+$/.test(marker)) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text);
  }
  return text.includes(marker);
}

/**
 * The deterministic classifier. It consumes the tags a source supplied and its own frozen text
 * markers; the highest tier wins. No model, no clock, no I/O.
 */
export function classifySensitivity(input: { text: string; tags?: readonly SensitiveTag[] }): SensitivityClassification {
  const matched: SensitiveTag[] = [...(input.tags ?? [])];
  for (const marker of SENSITIVITY_HIGH_MARKERS) {
    if (containsMarker(input.text, marker)) {
      matched.push({ source: 'text', tier: 'high', reason: `matched high marker: ${marker}`, eventIds: [] });
    }
  }
  for (const marker of SENSITIVITY_PRIVATE_MARKERS) {
    if (containsMarker(input.text, marker)) {
      matched.push({ source: 'text', tier: 'private', reason: `matched private marker: ${marker}`, eventIds: [] });
    }
  }
  let tier: SensitivityTier = 'daily';
  for (const tag of matched) {
    if (TIER_RANK[tag.tier] > TIER_RANK[tier]) tier = tag.tier;
  }
  return { tier, matched };
}

/** The built-in keychain source: a secret-marked event is high, and the service hard-withholds it. */
export function keychainTagSource(events: Pick<EventStore, 'getEvent'>): SensitivityTagSource {
  return {
    tagsFor(query) {
      const marked = query.eventIds.filter((eventId) => {
        const event = events.getEvent(eventId);
        return event ? eventHoldsSecretMark(event) : false;
      });
      return marked.length > 0
        ? [{ source: KEYCHAIN_SOURCE, tier: 'high', reason: 'event carries the secret mark (#142)', eventIds: marked }]
        : [];
    },
  };
}

/** The built-in source-type source: tool calls and results are at least private. */
export const sourceTypeTagSource: SensitivityTagSource = {
  tagsFor(query) {
    const sourceType = query.sourceType;
    if (!sourceType || !(SOURCE_TYPE_PRIVATE_VALUES as readonly string[]).includes(sourceType)) return [];
    return [{
      source: 'source-type',
      tier: 'private',
      reason: `source type ${sourceType} is a personal observation`,
      eventIds: [],
    }];
  },
};

function freshnessOf(observedAt: number, expiresAt: number | null, now: number): SurfacingFreshness {
  return { observedAt, ageMs: now - observedAt, expiresAt, expired: expiresAt !== null && now > expiresAt };
}

function candidateIdOf(source: SurfacingSource, sourceId: string): string {
  return `surfacing:${source}:${sourceId}`;
}

function matchesQuery(text: string, query: string): boolean {
  return query.length === 0 || text.toLowerCase().includes(query.toLowerCase());
}

function ledgerText(event: MemoryEvent): string {
  const text = (event.payload as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text.trim() : '';
}

function compareCandidates(a: SurfacingCandidate, b: SurfacingCandidate): number {
  return SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    || b.confidence - a.confidence
    || b.freshness.observedAt - a.freshness.observedAt
    || a.candidateId.localeCompare(b.candidateId);
}

function compareWithheld(a: SurfacingWithheld, b: SurfacingWithheld): number {
  return SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.candidateId.localeCompare(b.candidateId);
}

export class SurfacingCandidates {
  private readonly events: EventStore;
  private readonly profile: ProfileCompiler;
  private readonly procedures: ProcedureCompiler | undefined;
  private readonly commitments: CommitmentBook | undefined;
  private readonly wakeIntentions: WakeIntentionService;
  private readonly prospectiveMemories: ProspectiveMemoryService;
  private readonly tagSources: readonly SensitivityTagSource[];

  constructor(ports: SurfacingCandidatesPorts) {
    this.events = ports.events;
    this.profile = ports.profile;
    this.procedures = ports.procedures;
    this.commitments = ports.commitments;
    this.wakeIntentions = ports.wakeIntentions;
    this.prospectiveMemories = ports.prospectiveMemories;
    this.tagSources = [keychainTagSource(ports.events), sourceTypeTagSource, ...(ports.sensitiveTagSources ?? [])];
  }

  /**
   * The candidate query. `proactive` is the agent speaking first; `asked` is a query the owner or
   * shell made. Channel and occasion are recorded, not trusted.
   */
  candidates(input: SurfacingCandidatesInput): SurfacingResult {
    const projectId = requireProjectId(input.projectId);
    const channel = requireChannel(input.channel);
    if (input.query !== undefined && typeof input.query !== 'string') {
      throw surfacingError('invalid_surfacing_query');
    }
    if (input.occasion !== undefined && typeof input.occasion !== 'string') {
      throw surfacingError('invalid_surfacing_occasion');
    }
    const now = input.now ?? Date.now();
    if (!Number.isFinite(now)) throw surfacingError('invalid_surfacing_now');
    const limit = input.limit ?? SURFACING_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) throw surfacingError('invalid_limit', String(input.limit));
    const bounded = Math.min(limit, SURFACING_MAX_LIMIT);
    const occasion = input.occasion?.trim() || undefined;
    const query = input.query?.trim() ?? '';

    const candidates: SurfacingCandidate[] = [];
    const withheld: SurfacingWithheld[] = [];
    for (const item of this.collect({ projectId, channel, now, query })) {
      const eventIds = [...new Set(item.sourceRefs.map((ref) => ref.eventId).filter((id): id is string => Boolean(id)))];
      const eventIdSet = new Set(eventIds);
      const tags = this.tagSources.flatMap((source) => source.tagsFor({
        projectId,
        eventIds,
        text: item.content,
        sourceType: item.sourceType,
        metadata: item.metadata,
      })).filter((tag) => tag.eventIds.length === 0 || tag.eventIds.some((id) => eventIdSet.has(id)));
      const classification = classifySensitivity({ text: item.content, tags });
      const freshness = freshnessOf(item.observedAt, item.expiresAt, now);
      // A keychain mark is the one hard withhold: #142 already keeps that text out of every read
      // lane, and surfacing must not become the exception.
      const hardWithhold = tags.some((tag) => tag.source === KEYCHAIN_SOURCE);
      const policy = SURFACING_CHANNEL_POLICY[classification.tier];
      const allowed = !hardWithhold
        && policy[channel]
        && !(channel === 'proactive' && freshness.expired);

      const steps: SurfacingDecisionStep[] = [
        {
          rule: 'source',
          outcome: item.sourceOutcome,
          detail: { source: item.source, sourceId: item.sourceId, sourceRefs: item.sourceRefs.length },
        },
        {
          rule: 'freshness',
          outcome: freshness.expired ? 'expired' : freshness.ageMs < 0 ? 'upcoming' : 'fresh',
          detail: { ...freshness },
        },
        {
          rule: 'sensitivity',
          outcome: classification.tier,
          detail: { matched: classification.matched },
        },
        {
          rule: 'channel',
          outcome: allowed ? 'allowed' : 'withheld',
          detail: { channel, tier: classification.tier, policy, hardWithhold, expired: freshness.expired },
        },
      ];
      if (occasion) {
        steps.push({ rule: 'occasion', outcome: 'recorded', detail: { occasion } });
      }
      const reason = steps.map((step) => `${step.rule}=${step.outcome}`).join('; ');
      const decisionTrace: SurfacingDecisionTrace = { version: 'surfacing_candidate_decision.v1', reason, steps };
      const candidateId = candidateIdOf(item.source, item.sourceId);

      if (allowed) {
        candidates.push({
          candidateId,
          source: item.source,
          channel,
          occasion,
          content: item.content,
          sourceRefs: item.sourceRefs,
          reason,
          confidence: item.confidence,
          freshness,
          sensitivity: classification.tier,
          decisionTrace,
        });
      } else {
        withheld.push({
          candidateId,
          source: item.source,
          channel,
          occasion,
          sensitivity: classification.tier,
          reason,
          decisionTrace,
        });
      }
    }

    candidates.sort(compareCandidates);
    withheld.sort(compareWithheld);
    return {
      projectId,
      channel,
      occasion,
      now,
      candidates: candidates.slice(0, bounded),
      withheld: withheld.slice(0, bounded),
    };
  }

  private collect(input: {
    projectId: string;
    channel: SurfacingChannel;
    now: number;
    query: string;
  }): RawCandidate[] {
    return [
      ...this.wakeCandidates(input),
      ...this.prospectiveCandidates(input),
      ...this.profileCandidates(input),
      ...this.procedureCandidates(input),
      ...this.commitmentCandidates(input),
      ...this.ledgerCandidates(input),
    ];
  }

  private wakeCandidates(input: {
    projectId: string;
    channel: SurfacingChannel;
    now: number;
    query: string;
  }): RawCandidate[] {
    const out: RawCandidate[] = [];
    for (const intention of this.wakeIntentions.list({ projectId: input.projectId, statuses: ['pending'] })) {
      if (input.channel === 'proactive' && intention.at > input.now) continue;
      if (!matchesQuery(intention.reason, input.query)) continue;
      out.push({
        source: 'wake-intention',
        sourceId: intention.intentionId,
        sourceOutcome: 'wake-intention:pending',
        content: intention.reason,
        sourceRefs: intention.sourceRefs,
        observedAt: intention.at,
        expiresAt: intention.at + SURFACING_DUE_WINDOW_MS,
        confidence: 0.85,
        sourceType: 'wake-intention',
      });
    }
    return out;
  }

  private prospectiveCandidates(input: {
    projectId: string;
    channel: SurfacingChannel;
    now: number;
    query: string;
  }): RawCandidate[] {
    const out: RawCandidate[] = [];
    for (const memory of this.prospectiveMemories.list({ projectId: input.projectId, statuses: ['confirmed', 'deferred'] })) {
      const at = memory.status === 'deferred' ? memory.deferredUntil : memory.dueAt;
      if (at === undefined) continue;
      if (input.channel === 'proactive' && at > input.now) continue;
      const content = [memory.title, memory.details].filter((part): part is string => Boolean(part)).join(' — ');
      if (!content || !matchesQuery(content, input.query)) continue;
      out.push({
        source: 'prospective-memory',
        sourceId: memory.candidateId,
        sourceOutcome: `prospective-memory:${memory.status}`,
        content,
        sourceRefs: memory.evidenceEventIds.map((eventId) => this.refForEventId(eventId)),
        observedAt: at,
        expiresAt: at + SURFACING_DUE_WINDOW_MS,
        confidence: memory.status === 'confirmed' ? 0.9 : 0.8,
        sourceType: 'prospective-memory',
      });
    }
    return out;
  }

  private profileCandidates(input: {
    projectId: string;
    query: string;
  }): RawCandidate[] {
    const out: RawCandidate[] = [];
    for (const entry of this.profile.entries({ projectId: input.projectId })) {
      const content = `${entry.key}: ${entry.value}`;
      if (!matchesQuery(content, input.query)) continue;
      out.push({
        source: 'profile',
        sourceId: entry.entryId,
        sourceOutcome: `profile:${entry.ledger}`,
        content,
        sourceRefs: entry.sourceRefs,
        observedAt: entry.recordedAt,
        expiresAt: null,
        confidence: PROFILE_CONFIDENCE[entry.ledger],
      });
    }
    return out;
  }

  /**
   * The procedure lane. A procedure is recalled by the task description, so it contributes only
   * when the caller supplied a cue — a proactive moment with no stated task has nothing to match.
   * The candidate's text is the book's own steps; no skill name is added anywhere.
   */
  private procedureCandidates(input: {
    projectId: string;
    query: string;
  }): RawCandidate[] {
    if (!this.procedures || !input.query) return [];
    return this.procedures.recall({ projectId: input.projectId, task: input.query, limit: 5 }).map((entry) => ({
      source: 'procedure',
      sourceId: entry.entryId,
      sourceOutcome: `procedure:${entry.grade}:${entry.delivery}`,
      content: `${entry.title}${entry.steps.length > 0 ? `: ${entry.steps.join(' → ')}` : ''}`,
      sourceRefs: entry.sourceRefs,
      observedAt: entry.recordedAt,
      expiresAt: null,
      confidence: PROCEDURE_CONFIDENCE[entry.grade],
    }));
  }

  /**
   * The commitment lane. Only the proactive channel announces an arrived commitment, and the
   * book's `SURFACED` mark is what makes the announcement once per due instant — a second query is
   * silent. The shell still decides whether to speak.
   */
  private commitmentCandidates(input: {
    projectId: string;
    channel: SurfacingChannel;
    now: number;
  }): RawCandidate[] {
    if (!this.commitments || input.channel !== 'proactive') return [];
    return this.commitments.surfaceDue({ projectId: input.projectId, now: input.now, limit: 5 }).map((item) => ({
      source: 'commitment',
      sourceId: item.commitmentId,
      sourceOutcome: `commitment:${item.status}:${item.owner}`,
      content: item.content,
      sourceRefs: item.sourceRefs,
      observedAt: item.dueAt,
      expiresAt: item.dueAt + SURFACING_DUE_WINDOW_MS,
      confidence: 0.9,
    }));
  }

  private ledgerCandidates(input: {
    projectId: string;
    channel: SurfacingChannel;
    now: number;
    query: string;
  }): RawCandidate[] {
    const out: RawCandidate[] = [];
    for (const event of this.ledgerEvents(input)) {
      const content = ledgerText(event);
      if (!content || !matchesQuery(content, input.query)) continue;
      if (input.channel === 'proactive' && event.occurredAt < input.now - SURFACING_LEDGER_WINDOW_MS) continue;
      out.push({
        source: 'ledger',
        sourceId: event.eventId,
        sourceOutcome: `ledger:${event.role ?? 'unknown'}`,
        content,
        sourceRefs: [this.refForEvent(event)],
        observedAt: event.occurredAt,
        expiresAt: event.occurredAt + SURFACING_LEDGER_WINDOW_MS,
        confidence: event.role === 'user' ? 0.7 : event.role === 'assistant' ? 0.6 : 0.5,
        sourceType: event.rawEventType,
        metadata: (event.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata,
      });
    }
    return out;
  }

  private ledgerEvents(input: {
    projectId: string;
    channel: SurfacingChannel;
    now: number;
    query: string;
  }): MemoryEvent[] {
    const windowMs = input.channel === 'proactive'
      ? SURFACING_LEDGER_WINDOW_MS
      : SURFACING_ASKED_LEDGER_WINDOW_MS;
    const recent = this.recentRawEvents(input.projectId, input.now, windowMs);
    if (!input.query) return recent;
    const searched = this.events.searchRawEvents(input.query, {
      projectId: input.projectId,
      limit: SURFACING_SCAN_LIMIT,
      orderBy: 'relevance',
    });
    const byId = new Map<string, MemoryEvent>();
    for (const event of [...searched, ...recent]) byId.set(event.eventId, event);
    return [...byId.values()];
  }

  private recentRawEvents(projectId: string, now: number, windowMs: number): MemoryEvent[] {
    return this.events.queryEvents(1, SURFACING_SCAN_LIMIT, {
      projectId: [projectId],
      eventType: ['RAW_EVENT_RECORDED'],
      startTime: now - windowMs,
      endTime: now + 1,
      order: 'desc',
    }).records;
  }

  private refForEventId(eventId: string): MemorySourceRef {
    const event = this.events.getEvent(eventId);
    return event ? this.refForEvent(event) : { eventId };
  }

  private refForEvent(event: MemoryEvent): MemorySourceRef {
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
}
