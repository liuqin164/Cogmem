import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import { excludeExplicitSpans } from '../context/ExplicitExclusion.js';
import { classifySocialTurn, isSocialTurn } from '../context/SocialTurn.js';
import { socialTurnResources } from '../config/LanguagePacks.js';
import type { MemoryAtlasCard, MemoryAtlasNode, MemoryAtlasRelatedCard, MemoryAtlasRelaxationStep } from '../atlas/MemoryAtlasTypes.js';
import {
  memoryEventCharRange,
  memoryEventLabel,
  memoryEventSourceRange,
  normalizeSourceContextWindow,
  type MemoryEventCharRange,
  type MemoryEventSourceRange,
  type SourceContextWindowMetadata,
} from '../recall/SourceContextMetadata.js';
import { readRedactionMarks } from '../governance/PiiRedactor.js';
import { isOperationalNoiseText, isRecallableMemoryEvidence } from '../recall/RecallGovernance.js';
import { filterSuperseded } from '../recall/SupersessionFilter.js';
import type { BeliefRecord, MemoryEvent, MemorySourceRef } from '../types/index.js';
import type { ConversationTurnInput, ConversationTurnQuery, ConversationTurnRecord } from '../conversation/index.js';
import type { KernelEvent, KernelEventFilter, KernelEventSubscription } from '../events/index.js';
import type { ProfileRecallEntry } from '../profile/index.js';
import type { SurfacingCandidatesInput, SurfacingResult } from '../surfacing/index.js';
import type {
  RegisterWakeIntentionInput,
  TemporalContext,
  WakeIntention,
  WakeIntentionAuditEntry,
  WakeIntentionListInput,
  WakeTickInput,
  WakeTickResult,
} from '../temporal/index.js';
import { eventsVisibleToAgent, isAgentRawEvent } from './AgentScopeRules.js';
import type { StrategyRetrievalPolicy } from '../strategy/StrategyCapsule.js';
import {
  compileAgentRecallQuery,
  type AgentRecallIntent,
  type AgentRecallQueryPlan,
} from './AgentRecallQueryCompiler.js';
import { extractEntityCues, inferActionKinds } from '../utils/EntityCueExtractor.js';
import { localDateFor, resolveTimeZone } from '../utils/LocalDateContext.js';
import { cliArg } from '../utils/CliArgument.js';
import { pad2 } from '../utils/Values.js';
import { projectPhaseItems } from '../recall/PhaseProjection.js';
import { secretFindingsMetadata } from '../security/SecretPatterns.js';
import { eventHoldsSecretMark } from '../security/SecretMarks.js';
import { RecallDecisionTrace, type RecallTraceSuppression } from '../observability/RecallDecisionTrace.js';
import { TraceStore } from '../observability/TraceStore.js';

export type AgentTurnIngestMode =
  | 'immediate_compile'
  | 'selective_compile'
  | 'raw_archive_only'
  | 'raw_then_dream';

export type AgentTurnCompileReason =
  | 'immediate_compile'
  | 'durable_signal_detected'
  | 'low_signal_turn'
  | 'raw_archive_only'
  | 'raw_then_dream'
  | 'duplicate_turn';

export interface AgentTurnMemory {
  agentId: string;
  projectId: string;
  collection?: string;
  workspaceId?: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  turnSeq?: number;
  userText: string;
  assistantText?: string;
  timestamp?: number;
  localDate?: string;
  timeZone?: string;
  projectTimeZone?: string;
  ingestMode?: AgentTurnIngestMode;
  metadata?: Record<string, unknown>;
}

export interface AgentTurnMemoryResult {
  mode: AgentTurnIngestMode;
  reason: AgentTurnCompileReason;
  compiled: boolean;
  rawEventIds: string[];
  compiledNeuronId?: string;
  /**
   * This turn was already recorded under the caller's turn id, so nothing was written.
   * `compiled` then reports what *this* call did — nothing — not what the first call did;
   * the first call's compilation already exists and is not repeated.
   */
  duplicate?: boolean;
  /**
   * The turn id the caller supplied, echoed back.
   *
   * Present only when the caller named the turn: it is their identity being acknowledged,
   * and echoing a synthesized one would acknowledge something they never said. Retrying
   * with this value is what makes the retry a replay (#113).
   */
  turnId?: string;
}

export interface AgentRecallQuery {
  agentId: string;
  projectId: string;
  collection?: string;
  query: string;
  workspaceId?: string;
  sessionId?: string;
  threadId?: string;
  excludeSessionId?: string;
  intent?: AgentRecallIntent;
  anchorEventId?: string;
  anchorText?: string;
  now?: number;
  localDateNow?: string;
  timeZone?: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
  retrievalPolicy?: StrategyRetrievalPolicy;
}

export interface AgentRecallSourceAnchor {
  eventId?: string;
  threadId?: string;
  sessionId?: string;
  turnId?: string;
  role?: MemoryEvent['role'];
  threadSeq?: number;
  turnSeq?: number;
  eventOrdinal?: number;
  parentEventId?: string;
  prevEventId?: string;
  nextEventId?: string;
  causalityType?: MemoryEvent['causalityType'];
  orderingConfidence?: MemoryEvent['orderingConfidence'];
}

export interface AgentRecallSourceContextEvent {
  eventId: string;
  globalSeq?: number;
  label: string;
  role?: MemoryEvent['role'];
  rawEventType?: MemoryEvent['rawEventType'];
  eventType?: MemoryEvent['eventType'];
  projectId?: string;
  workspaceId?: string;
  threadId?: string;
  sessionId?: string;
  turnId?: string;
  threadSeq?: number;
  turnSeq?: number;
  eventOrdinal?: number;
  occurredAt: number;
  localDate?: string;
  charRange?: MemoryEventCharRange;
  sourceRange?: MemoryEventSourceRange;
  textLength: number;
  text: string;
}

export interface AgentRecallSourceContext {
  event: AgentRecallSourceContextEvent;
  before: AgentRecallSourceContextEvent[];
  after: AgentRecallSourceContextEvent[];
  parent?: AgentRecallSourceContextEvent;
  children: AgentRecallSourceContextEvent[];
  window: SourceContextWindowMetadata;
  locator: {
    eventId: string;
    globalSeq?: number;
    projectId?: string;
    command: string;
    contextCommand?: string;
    threadId?: string;
    sessionId?: string;
    localDate?: string;
  };
}

export interface AgentToolCallMemory {
  agentId: string;
  projectId: string;
  workspaceId?: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  turnSeq?: number;
  assistantEventId?: string;
  toolCallId?: string;
  toolName: string;
  input?: unknown;
  eventOrdinal?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentToolObservationMemory {
  agentId: string;
  projectId: string;
  workspaceId?: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  turnSeq?: number;
  toolCallEventId: string;
  toolCallId?: string;
  toolName: string;
  output: string;
  eventOrdinal?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskEventMemory {
  agentId: string;
  projectId: string;
  workspaceId?: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  turnSeq?: number;
  parentEventId?: string;
  taskId?: string;
  title?: string;
  content: string;
  eventOrdinal?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRecallItem {
  id: string;
  text: string;
  projectId?: string;
  topicPath?: string;
  canonicalId?: string;
  displayTitle?: string;
  matchedFacets?: MemoryAtlasCard['matchedFacets'];
  matchedPaths?: MemoryAtlasCard['matchedPaths'];
  tags: string[];
  source?: string;
  sourceType?: 'compiled_memory' | 'imported_summary' | 'raw_ledger' | 'raw_ledger_session';
  sourceAnchor?: AgentRecallSourceAnchor;
  sourceContext?: AgentRecallSourceContext;
  confidence?: number;
  whyMatched?: string;
  canAnswerExactQuote?: boolean;
  /**
   * Present when this item's text has been through redaction: how many values were
   * removed and how many characters they held. Without it a caller cannot tell an
   * altered text from the text that was written (#115).
   */
  redaction?: { count: number; chars: number };
  /**
   * Present when this item came from another agent's shared collection (#67). It is a reference, not
   * this agent's memory: the field is what lets a renderer separate the two with evidence, instead of
   * inferring it from the text.
   */
  shared?: { sourceHost: string; collection: string };
}

/**
 * Atlas node types worth returning as recall items.
 *
 * One list, because there were two: the two call sites kept their own copy, both named
 * dimensions the projection does not emit for a conversation, and the compiled lane
 * therefore returned nothing for every query (measured: `evidenceFor` found 4 nodes and
 * recall reported `navigation: 0` for the same text).
 *
 * `raw_event` is deliberately absent: the raw-ledger lane already answers with those, and
 * a card reading "assistant 2026-11-01" is not an answer.
 */
const ATLAS_RECALL_NODE_TYPES: readonly string[] = [
  'episode', 'entity', 'topic', 'issue', 'actor', 'event', 'task', 'object', 'location', 'state', 'project', 'time',
];

/** A recall result before the single exit adds what the kernel knows about the index. */
type RecallCoreResult = Omit<AgentRecallResult, 'semanticIndex'>;

export interface AgentRecallResult {
  recallMode: MemoryKernelNavigationResult['recallMode'] | 'raw_ledger_fallback' | 'atlas_facet_recall' | 'atlas_raw_grounded_recall' | 'social_turn_suppressed';
  /**
   * Whether a semantic index was available for this answer.
   *
   * False means `memory` is `rule_only`: nothing is vectorised, so every answer here came
   * from literal matching over the raw ledger, and a paraphrase that shares no words with
   * the memory will not find it.
   */
  semanticIndex: boolean;
  items: AgentRecallItem[];
  narrative?: NonNullable<MemoryKernelNavigationResult['navigation']>['narrative'];
  pulseTrace?: NonNullable<MemoryKernelNavigationResult['navigation']>['pulse']['trace'];
  temporalTraversal?: NonNullable<MemoryKernelNavigationResult['navigation']>['branchSearch']['temporalTraversal'];
  runtime?: NonNullable<MemoryKernelNavigationResult['navigation']>['runtime'];
  fallbackUsed: boolean;
  queryPlan?: AgentRecallQueryPlan;
  atlasCards?: MemoryAtlasCard[];
  relatedButNotSelected?: MemoryAtlasRelatedCard[];
  relaxationTrace?: MemoryAtlasRelaxationStep[];
  /** Present on all kernel-produced results. Optional for source compatibility with external result mocks. */
  decisionTrace?: AgentRecallDecisionTrace;
}

export interface AgentRecallDecisionTrace {
  version: 'agent_recall_decision.v1';
  selectedLane: 'facet_graph_raw_ledger' | 'graph' | 'compiled' | 'brain_fallback' | 'raw_ledger' | 'mixed' | 'none';
  reason:
    | 'social_query_residue_empty'
    | 'previous_session'
    | 'forensic_quote'
    | 'historical_discussion'
    | 'action_history'
    | 'graph_selected'
    | 'raw_cue_match_preferred'
    | 'compiled_cue_match'
    | 'brain_fallback_selected'
    | 'raw_ledger_only'
    | 'no_recall_evidence';
  candidateCounts: {
    graph: number;
    navigation: number;
    scopedNavigation: number;
    brainFallback: number;
    rawLedger: number;
  };
  selectedCount: number;
  /**
   * What this recall withheld and why, one entry per reason.
   *
   * A gate that only removes things is indistinguishable from a memory that was never there, so
   * every suppression names itself: the query carried nothing to look up (`residue_empty`), the
   * entry is itself a social turn (`entry_social`), a raw-lane hit rested only on high-frequency
   * words (`no_discriminative_hit`), or a grey-zone query's results fell below the relevance floor
   * (`grey_below_floor`).
   */
  suppressed?: Array<{ reason: RecallSuppressionReason; count: number }>;
  /** Shared items this recall appended, and how many the shared budget turned away (#67). Counts only. */
  sharedCount?: number;
  sharedDropped?: number;
  /**
   * Why a recall that returned nothing returned nothing.
   *
   * `scope_filtered` means the question does match stored turns, but they belong to another agent
   * identity: those turns are invisible here, and a silent 0 reads as "nothing was remembered".
   * Counts only — never another identity's content.
   */
  zeroExplanation?: ZeroExplanation;
}

export type ZeroExplanation =
  | { kind: 'scope_filtered'; thisScope: 0; otherScopes: number; agentId?: string }
  | { kind: 'no_match'; thisScope: 0; otherScopes: 0 };

export type RecallSuppressionReason =
  | 'residue_empty'
  | 'entry_social'
  | 'no_discriminative_hit'
  | 'grey_below_floor'
  // A conversation turn holding a secret: written verbatim, marked, and not injected by default.
  | 'secret_bearing_withheld'
  // Phase projection (#130), off by default: an item too old for the default lane, and one shown as a gist
  // rather than in full. Both are reported so a caller can tell "not remembered" from "not shown here".
  | 'phase_dormant'
  | 'phase_gist';

export interface AgentRecallEntityCard {
  entityId: string;
  canonicalName: string;
  type: string;
  aliases: string[];
  attributes: Array<{
    key: string;
    value: string;
    updatedAt: number;
  }>;
  recentMentions: Array<{
    neuronId?: string;
    projectId?: string;
    mentionType: string;
    createdAt: number;
  }>;
}

export interface AgentRecallBeliefTouch {
  beliefId: string;
  subject: string;
  predicate: string;
  objectValue: string;
  confidence: number;
  trustScore: number;
  status: BeliefRecord['status'];
  supportCount: number;
  conflictCount: number;
  explanation?: string;
}

export interface AgentRecallPackSlots {
  direct: AgentRecallItem[];
  associative: AgentRecallItem[];
  entityCards: AgentRecallEntityCard[];
  beliefTouches: AgentRecallBeliefTouch[];
}

export interface AgentRecallPackResult extends AgentRecallResult {
  collection?: string;
  generatedAt: number;
  slots: AgentRecallPackSlots;
  chargeVector: {
    direct: number;
    associative: number;
    entityCards: number;
    beliefTouches: number;
    activationHotspots: number;
  };
}

export class KernelAgentMemoryBackend {
  constructor(private readonly kernel: MemoryKernel) {}

  /**
   * Subscribe to the kernel's memory event stream — the host API's half of the F1 wake surface.
   *
   * The contract (frozen types, cursor semantics, filters, error codes) is written in
   * `docs/events.md` and asserted in `__tests__/event-stream.contract.test.ts`. This is a
   * pass-through so the shell binds the one interface it already has, not `kernel.events` directly.
   */
  subscribe(
    filter: KernelEventFilter,
    onEvent: (event: KernelEvent) => void,
    options: { since?: number } = {},
  ): KernelEventSubscription {
    return this.kernel.events.subscribe(filter, onEvent, options);
  }

  /**
   * The time context block for wake or turn start (F2 of #156), computed by the kernel at an
   * injected instant. The shell injects it into the turn; the agent does not query for it.
   *
   * The contract (frozen field list, field meanings) is written in `docs/time-awareness.md` and
   * asserted in `__tests__/time-awareness.contract.test.ts`.
   */
  temporalContext(input: {
    projectId: string;
    now?: number;
    densityWindowMs?: number;
    rhythmSampleDays?: number;
    rhythmActiveHourThreshold?: number;
  }): TemporalContext {
    return this.kernel.temporalContext(input);
  }

  /** Move the clock: fire due wake intentions and announce due prospective memories. */
  runWakeTick(input: WakeTickInput): WakeTickResult {
    return this.kernel.runWakeTick(input);
  }

  /** The instant a base timer should next wake for, or `null` when nothing is waiting. */
  nextWakeAt(input: { projectId: string; agentId?: string; now?: number }): number | null {
    return this.kernel.nextWakeAt(input);
  }

  /**
   * The surfacing candidate query (F6 of #160): the kernel gives candidates with their reason,
   * confidence, freshness and sensitivity; the shell decides whether to speak. The contract
   * (channels, tiers, classifier, sensitive-tag interface) is `docs/surfacing-candidates.md`.
   */
  surfacingCandidates(input: SurfacingCandidatesInput): SurfacingResult {
    return this.kernel.surfacing.candidates(input);
  }

  /** Register a self-set wake intention: a time, a reason, and what it is about. */
  registerWakeIntention(input: RegisterWakeIntentionInput): WakeIntention {
    return this.kernel.wakeIntentions.register(input);
  }

  /** Cancel a pending wake intention. */
  cancelWakeIntention(intentionId: string, input: { projectId: string; now: number; reason?: string }): WakeIntention {
    return this.kernel.wakeIntentions.cancel(intentionId, input);
  }

  /** The project's wake intentions, filtered by agent and status. */
  listWakeIntentions(input: WakeIntentionListInput): WakeIntention[] {
    return this.kernel.wakeIntentions.list(input);
  }

  /** Every transition row of one intention, or of the project's intentions, oldest first. */
  auditWakeIntentions(input: { projectId: string; intentionId?: string; agentId?: string }): WakeIntentionAuditEntry[] {
    return this.kernel.wakeIntentions.audit(input);
  }

  async rememberTurn(turn: AgentTurnMemory): Promise<void> {
    await this.rememberTurnWithResult(turn);
  }

  async rememberTurnWithResult(turn: AgentTurnMemory): Promise<AgentTurnMemoryResult> {
    // Explicit exclusion (#133) runs here, at the one place every write path inside the kernel calls, and in the
    // order the host bridge already uses: a passage the user marked is never stored, so it must not be claimed,
    // scanned, compiled or written either. The bridge strips before calling this and reports the counts; by the
    // time the text arrives here the markers are gone, which makes this pass a no-op rather than a second policy
    // (#152: the MCP tool reached the store without ever asking).
    const excludedUser = excludeExplicitSpans(turn.userText);
    const occurredAt = turn.timestamp ?? Date.now();
    const threadId = turn.threadId || turn.sessionId;
    const sourceId = `${turn.agentId}:${turn.sessionId}`;
    const mode = turn.ingestMode ?? 'immediate_compile';
    // A named turn is an identity: the same id means the same turn, so a retry returns
    // what is already recorded instead of writing it again. This runs before the turn
    // sequence is drawn, because a replay must not consume one (#113).
    const claim = turn.turnId
      ? this.kernel.claimAgentTurn({
        projectId: turn.projectId,
        agentId: turn.agentId,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        userText: excludedUser.text,
        assistantText: turn.assistantText,
      })
      : undefined;
    if (claim?.replay) {
      return {
        mode,
        reason: 'duplicate_turn',
        compiled: false,
        duplicate: true,
        rawEventIds: [claim.userEventId, claim.assistantEventId].filter((id): id is string => Boolean(id)),
        ...(turn.turnId ? { turnId: turn.turnId } : {}),
      };
    }
    const turnSeq = turn.turnSeq ?? this.kernel.eventStore.getNextTurnSeq(threadId, turn.projectId ?? '');
    const turnId = turn.turnId || `${turn.agentId}:${turn.sessionId}:${turnSeq}:${occurredAt}`;
    // ponytail: the claim and this insert are two statements, so another process writing
    // the same turn between them reaches the primary key instead of the claim. Re-asking
    // the claim turns that into the answer the caller can act on — already recorded, or
    // this id reused for different text. Forcing the interleaving in-process is not
    // possible (no await between the two), so this branch is covered by the sequential
    // conflict and replay tests plus this comment, not by a race test that would restate
    // the id derivation.
    const writeUserEvent = () => this.kernel.recordRawEvent({
      eventId: claim?.userEventId,
      projectId: turn.projectId,
      workspaceId: turn.workspaceId,
      threadId,
      sessionId: turn.sessionId,
      turnId,
      turnSeq,
      role: 'user',
      content: excludedUser.text,
      eventOrdinal: 1,
      occurredAt,
      localDate: turn.localDate,
      timeZone: turn.timeZone,
      projectTimeZone: turn.projectTimeZone,
      sourceId,
      metadata: {
        ...this.metadataWithCollection({ ...(turn.metadata || {}), sourceAgent: turn.agentId }, turn.collection),
        // The secret mark belongs to this event and is written where every write routes (#142), not only in
        // the host bridge: an MCP write used to reach the ledger unmarked and recall returned it verbatim.
        ...secretFindingsMetadata(excludedUser.text),
      },
    });
    let userEvent: ReturnType<typeof writeUserEvent>;
    try {
      userEvent = writeUserEvent();
    } catch (error) {
      const settled = turn.turnId
        ? this.kernel.claimAgentTurn({
          projectId: turn.projectId,
          agentId: turn.agentId,
          sessionId: turn.sessionId,
          turnId: turn.turnId,
          userText: excludedUser.text,
          assistantText: turn.assistantText,
        })
        : undefined;
      if (!settled?.replay) throw error;
      return {
        mode,
        reason: 'duplicate_turn',
        compiled: false,
        duplicate: true,
        rawEventIds: [settled.userEventId, settled.assistantEventId].filter((id): id is string => Boolean(id)),
        turnId: turn.turnId!,
      };
    }
    const assistantEvent = turn.assistantText
      ? this.kernel.recordRawEvent({
        eventId: claim?.assistantEventId,
        projectId: turn.projectId,
        workspaceId: turn.workspaceId,
        threadId,
        sessionId: turn.sessionId,
        turnId,
        turnSeq,
        role: 'assistant',
        content: turn.assistantText,
        eventOrdinal: 2,
        occurredAt,
        localDate: turn.localDate,
        timeZone: turn.timeZone,
        projectTimeZone: turn.projectTimeZone,
        parentEventId: userEvent.eventId,
        prevEventId: userEvent.eventId,
        causalityType: 'replies_to',
        sourceId,
        // This event carries its own findings only. The turn metadata channel is shared with the user
        // event, so spreading it would put the user's mark on the assistant turn as well, and the
        // event marks would then disagree with the hygiene summary that counts them.
        metadata: {
          ...this.metadataWithCollection({ ...omitSecretFindings(turn.metadata), sourceAgent: turn.agentId }, turn.collection),
          ...secretFindingsMetadata(turn.assistantText, 'secretFindingsAssistant'),
        },
      })
      : undefined;
    if (assistantEvent) {
      this.kernel.eventStore.updateNextEventId(userEvent.eventId, assistantEvent.eventId);
    }
    try {
      this.kernel.bindMemoryEvent(userEvent);
    } catch (error) {
      // Binding is an organizational side index; raw ledger writes must remain authoritative.
      this.kernel.pipelineMetrics.recordNonFatal('memory_binding_failed', {
        projectId: turn.projectId,
        message: error instanceof Error ? error.message : String(error),
        details: {
          eventId: userEvent.eventId,
          sessionId: turn.sessionId,
          agentId: turn.agentId,
        },
      });
    }
    try {
      this.kernel.assembleEpisodeTurn([userEvent, assistantEvent].filter((event): event is NonNullable<typeof event> => Boolean(event)), {
        projectId: turn.projectId,
        sessionId: turn.sessionId,
        sourceAgent: turn.agentId,
        now: occurredAt,
      });
    } catch (error) {
      this.kernel.pipelineMetrics.recordNonFatal('episode_assembly_failed', {
        projectId: turn.projectId,
        message: error instanceof Error ? error.message : String(error),
        details: { eventIds: [userEvent.eventId, assistantEvent?.eventId].filter(Boolean), sessionId: turn.sessionId },
      });
    }

    const sourceRefs = [userEvent, assistantEvent].filter(Boolean).map((event) => ({
      eventId: event!.eventId,
      eventType: 'message',
      sourceId,
      contentHash: event!.contentHash,
      threadId,
      sessionId: turn.sessionId,
      turnId,
      role: event!.role,
      threadSeq: event!.threadSeq,
      turnSeq: event!.turnSeq,
      eventOrdinal: event!.eventOrdinal,
      parentEventId: event!.parentEventId,
      prevEventId: event!.prevEventId,
      nextEventId: event!.nextEventId,
      causalityType: event!.causalityType,
      orderingConfidence: event!.orderingConfidence,
    }));
    const content = [
      `User: ${excludedUser.text}`,
      turn.assistantText ? `Agent: ${turn.assistantText}` : '',
    ].filter(Boolean).join('\n');
    const compileSignalText = `User: ${excludedUser.text}`;

    const decision = this.shouldCompileTurn(mode, compileSignalText);
    const rawEventIds = [userEvent, assistantEvent].filter(Boolean).map((event) => event!.eventId);
    const named = turn.turnId ? { turnId: turn.turnId } : {};
    if (!decision.compile) {
      return {
        mode,
        reason: decision.reason,
        compiled: false,
        rawEventIds,
        ...named,
      };
    }

    const neuron = await this.kernel.ingest({
      content,
      projectId: turn.projectId,
      createdAt: occurredAt,
      source: sourceId,
      sourceRefs,
      tags: [
        `agent:${turn.agentId}`,
        `session:${turn.sessionId}`,
        ...this.collectionTags(turn.collection),
      ],
    });

    return {
      mode,
      reason: decision.reason,
      compiled: true,
      rawEventIds,
      compiledNeuronId: neuron.id,
      ...named,
    };
  }

  async ingestToolCall(call: AgentToolCallMemory): Promise<MemoryEvent> {
    const threadId = call.threadId || call.sessionId;
    const event = this.kernel.recordToolCall({
      projectId: call.projectId,
      workspaceId: call.workspaceId,
      threadId,
      sessionId: call.sessionId,
      turnId: call.turnId,
      turnSeq: call.turnSeq,
      assistantEventId: call.assistantEventId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
      eventOrdinal: call.eventOrdinal,
      occurredAt: call.timestamp,
      sourceId: `${call.agentId}:${call.sessionId}`,
      metadata: call.metadata,
    });
    this.tryAppendAuxiliaryEvent(event, call.projectId, call.sessionId, call.agentId);
    return event;
  }

  async ingestToolObservation(observation: AgentToolObservationMemory): Promise<MemoryEvent> {
    const threadId = observation.threadId || observation.sessionId;
    const sourceId = `${observation.agentId}:${observation.sessionId}`;
    const event = this.kernel.recordToolResult({
      projectId: observation.projectId,
      workspaceId: observation.workspaceId,
      threadId,
      sessionId: observation.sessionId,
      turnId: observation.turnId,
      turnSeq: observation.turnSeq,
      toolCallEventId: observation.toolCallEventId,
      toolCallId: observation.toolCallId,
      toolName: observation.toolName,
      output: observation.output,
      eventOrdinal: observation.eventOrdinal,
      occurredAt: observation.timestamp,
      sourceId,
      metadata: observation.metadata,
    });
    this.tryAppendAuxiliaryEvent(event, observation.projectId, observation.sessionId, observation.agentId);

    await this.kernel.ingest({
      content: `Tool ${observation.toolName} result:\n${observation.output}`,
      projectId: observation.projectId,
      createdAt: observation.timestamp ?? event.occurredAt,
      source: sourceId,
      sourceType: 'external_tool',
      type: 'agent_observation',
      sourceRefs: [this.toSourceRef(event, sourceId)],
      tags: [
        `agent:${observation.agentId}`,
        `session:${observation.sessionId}`,
        `tool:${observation.toolName}`,
        'record:tool_result',
      ],
    });

    return event;
  }

  async ingestTaskEvent(task: AgentTaskEventMemory): Promise<MemoryEvent> {
    const threadId = task.threadId || task.sessionId;
    const sourceId = `${task.agentId}:${task.sessionId}`;
    const event = this.kernel.recordTaskEvent({
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      threadId,
      sessionId: task.sessionId,
      turnId: task.turnId,
      turnSeq: task.turnSeq,
      parentEventId: task.parentEventId,
      taskId: task.taskId,
      title: task.title,
      content: task.content,
      eventOrdinal: task.eventOrdinal,
      occurredAt: task.timestamp,
      sourceId,
      metadata: task.metadata,
    });
    this.tryAppendAuxiliaryEvent(event, task.projectId, task.sessionId, task.agentId);

    await this.kernel.ingest({
      content: `Task event${task.title ? ` (${task.title})` : ''}:\n${task.content}`,
      projectId: task.projectId,
      createdAt: task.timestamp ?? event.occurredAt,
      source: sourceId,
      sourceType: 'llm_inference',
      type: 'agent_observation',
      sourceRefs: [this.toSourceRef(event, sourceId)],
      tags: [
        `agent:${task.agentId}`,
        `session:${task.sessionId}`,
        task.taskId ? `task:${task.taskId}` : 'task:event',
        'record:task_event',
      ],
    });

    return event;
  }

  /**
   * The conversation-native capture face (#157): one turn, with the speaker, the channel, the thread
   * and the occasion written down as first-class facts rather than re-encoded by each shell.
   *
   * Contract and frozen tables: `docs/conversation-capture.md`, asserted by
   * `__tests__/conversation-capture.contract.test.ts`. The ledger row is the write; the compile pass
   * runs through the kernel's one ingest entry point (#199), and none of the existing write faces
   * changes.
   */
  captureConversationTurn(turn: ConversationTurnInput): Promise<ConversationTurnRecord> {
    return this.kernel.conversationCapture.captureTurn(turn);
  }

  /** One speaker's turns, or every speaker's. Tool rows are never in this lane. */
  listConversationTurns(query: ConversationTurnQuery): ConversationTurnRecord[] {
    return this.kernel.conversationCapture.listTurns(query);
  }

  private tryAppendAuxiliaryEvent(event: MemoryEvent, projectId: string, sessionId: string, agentId: string): void {
    try {
      this.kernel.appendRawEventToEpisode(event, { projectId, sessionId, sourceAgent: agentId, now: event.occurredAt });
    } catch (error) {
      this.kernel.pipelineMetrics.recordNonFatal('episode_assembly_failed', {
        projectId,
        message: error instanceof Error ? error.message : String(error),
        details: { eventId: event.eventId, sessionId, agentId },
      });
    }
  }

  /**
   * Recall with every item marked for what is missing from its text.
   *
   * Redaction happens when a turn is written, so by the time an item is built its text
   * is already altered — and the lane that built it decides nothing about whether the
   * caller can tell. One decoration here covers the raw ledger, compiled memory and the
   * Atlas alike; decorating the raw builder is how the raw lane got it and the compiled
   * lane did not (#115).
   */
  recall(query: AgentRecallQuery): AgentRecallResult {
    const { result, suppressedIds } = this.recallPrivate(query);
    const answered = this.withSharedLane(query, result);
    this.recordRecallTrace(query, answered, suppressedIds);
    return answered;
  }

  /**
   * The profile lane (#159). The owner's four ledgers are a compiled product with their own ranking
   * and their own budget: they are **appended** after the ordinary lanes rather than merged through
   * `mergeRecallItems`, so a profile entry never displaces the memory the question named and the
   * compiled lane's cue ranking never reorders the profile's frozen priority/decay order.
   *
   * The item anchors the raw event the entry was compiled from, so the secret and agent scope gates
   * (#142/#143, one chain) apply unchanged — the cross-identity rule stays #153's, not a second one.
   * Exact-quote and previous-session lanes stay whole: they ask for words, not for a profile.
   */
  private withProfileItems(query: AgentRecallQuery, result: RecallCoreResult): RecallCoreResult {
    if (!query.projectId) return result;
    if (!laneAllowed(query.retrievalPolicy, 'compiled')) return result;
    const intent = result.queryPlan?.intent;
    if (intent === 'forensic_quote' || intent === 'previous_session_summary') return result;
    const entries = this.kernel.profile.recall({
      projectId: query.projectId,
      query: String(query.query ?? query.anchorText ?? ''),
      now: query.now,
    });
    if (entries.length === 0) return result;
    const items = entries
      .map((entry) => this.toAgentProfileItem(entry, query))
      .filter((item): item is AgentRecallItem => Boolean(item));
    if (items.length === 0) return result;
    return { ...result, items: [...result.items, ...items] };
  }

  private toAgentProfileItem(entry: ProfileRecallEntry, query: AgentRecallQuery): AgentRecallItem | null {
    const eventId = entry.sourceRefs.find((ref) => ref.eventId)?.eventId;
    if (!eventId) return null;
    const sourceContext = this.toAgentSourceContext(eventId, query);
    const anchorEvent = sourceContext?.event;
    const allowRaw = laneAllowed(query.retrievalPolicy, 'raw_source');
    return {
      id: `profile:${entry.entryId}`,
      text: `${entry.key}: ${entry.value}`,
      projectId: query.projectId,
      canonicalId: entry.entryId,
      displayTitle: entry.key,
      tags: ['profile', `profile_ledger:${entry.ledger}`, `profile_version:${entry.version}`],
      source: eventId,
      sourceType: 'compiled_memory',
      sourceAnchor: anchorEvent ? this.toAgentSourceAnchorFromContextEvent(anchorEvent) : { eventId },
      sourceContext: allowRaw ? sourceContext : undefined,
      confidence: 0.9,
      whyMatched: `profile_${entry.ledger}`,
      canAnswerExactQuote: false,
    };
  }

  /**
   * The stored decision behind a recall: ids, reasons and the lane, never an item's text (#187).
   *
   * Written after the answer is assembled and after the shared lane has had its say, so the row names
   * what the caller actually received — and never instead of returning it: a trace that cannot be
   * written is a non-fatal pipeline event, and the recall is unaffected. The whole body is guarded,
   * including the failure report, because nothing on this path may turn a written trace into a lost
   * answer.
   */
  private recordRecallTrace(
    query: AgentRecallQuery,
    result: AgentRecallResult,
    suppressedIds: RecallTraceSuppression[],
  ): void {
    try {
      const trace = this.recallTrace(query);
      if (!trace) return;
      const decision = result.decisionTrace;
      trace.record({
        projectId: query.projectId,
        agentId: query.agentId,
        // The question only. `anchorText` is deliberately not a fallback: a caller may fill it with a
        // returned item's text (the OpenClaw plugin does), and an item's text must never reach this row.
        query: String(query.query ?? ''),
        lane: decision?.selectedLane ?? 'none',
        reason: decision?.reason ?? 'unknown',
        selectedIds: result.items.map((item) => item.id),
        suppressed: suppressionsForTrace(decision?.suppressed, suppressedIds),
      });
    } catch (error) {
      this.recordTraceFailure(query, error);
    }
  }

  /**
   * The trace table, created on the first recall rather than when the kernel opens.
   *
   * Deliberately not part of kernel setup: the 4.0 baseline schema is pinned object-for-object against
   * the installer's own output, and this table is not the installer's. It appears when there is a
   * decision to record, which is also the first moment it can have rows. `null` means "this kernel
   * cannot write one", which is not an error — recall still answers.
   */
  private recallTraceWriter: RecallDecisionTrace | null | undefined;

  private recallTrace(query: AgentRecallQuery): RecallDecisionTrace | null {
    if (this.recallTraceWriter !== undefined) return this.recallTraceWriter;
    try {
      const store = new TraceStore(this.kernel.factStore.getDatabase());
      store.initSchema();
      this.recallTraceWriter = new RecallDecisionTrace(store);
    } catch (error) {
      // Recorded, not silent: "a trace that cannot be written leaves a mark" applies to failing to
      // open the writer as much as to failing to append. Once, not per recall — there is nothing to
      // retry, and a per-recall record would be noise on the hot path.
      this.recallTraceWriter = null;
      this.recordTraceFailure(query, error);
    }
    return this.recallTraceWriter;
  }

  /** The failure record for a trace that could not be written. Never allowed to escape. */
  private recordTraceFailure(query: AgentRecallQuery, error: unknown): void {
    try {
      this.kernel.pipelineMetrics.recordNonFatal('recall_trace_failed', {
        projectId: query.projectId,
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // The answer is already built; a second failure has nowhere useful to go.
    }
  }

  /**
   * #67: shared items ride their own lane.
   *
   * Another agent's text must never arrive looking like this agent's own memory, so shared items are
   * **appended** after the private ones rather than merged into their slots: private memory keeps the
   * budget it had, and the shared lane spends only its own. Every shared item names its source host and
   * collection, which is what a renderer needs to present it as a reference rather than an instruction.
   *
   * Every shared collection appears here while sharing is enabled (#146: publishing is still explicit, reading is
   * not gated per reader), and the read goes through the adapter's `subscribeSync` — the recall path never queries
   * the shared table itself. A read-only lane: nothing here writes.
   */
  private withSharedLane(query: AgentRecallQuery, result: AgentRecallResult): AgentRecallResult {
    if (!this.kernel.sharedEnabled) return result;
    const agentId = query.agentId;
    if (!agentId) return result;
    // Reading is open to any agent that can connect (#146, Ryu 2026-11-06): the readers list is no longer a gate.
    // The registry stays in the database and is left unused on purpose — a future multi-user deployment can turn it
    // back on — but nothing here consults it, so there is no runtime branch to keep in step.
    const readable = this.kernel.listSharedCollectionsSync().map((collection) => collection.collection);
    if (readable.length === 0) return result;

    const injectionLimit = query.limit ?? 5;
    // Derived default until the fitted value is configured: a third of what this recall injects, so a
    // busy shared collection cannot crowd out the memory the agent actually owns.
    const budget = this.kernel.sharedRecallLimit ?? Math.max(1, Math.ceil(injectionLimit / 3));
    // One extra is fetched so `sharedDropped` reports a real count instead of "at least the budget".
    const available = this.kernel.subscribeSharedSync(readable, agentId, { limit: budget + 1 });
    const chosen = available.slice(0, budget);
    const shared: AgentRecallItem[] = chosen.map((item) => {
      const payload = item.payload as { text?: unknown; summary?: unknown };
      const text = typeof payload.text === 'string' ? payload.text
        : typeof payload.summary === 'string' ? payload.summary
        : JSON.stringify(item.payload);
      return {
        id: `shared:${item.itemHash}`,
        text,
        tags: ['shared_memory', `shared_host:${item.sourceHost}`, `shared_collection:${item.collection}`],
        source: 'shared_memory',
        shared: { sourceHost: item.sourceHost, collection: item.collection },
        whyMatched: `shared by ${item.sourceHost} in ${item.collection}`,
      };
    });
    return {
      ...result,
      items: [...result.items, ...shared],
      decisionTrace: result.decisionTrace
        ? { ...result.decisionTrace, sharedCount: shared.length, sharedDropped: Math.max(0, available.length - chosen.length) }
        : result.decisionTrace,
    };
  }

  /**
   * Whether a recalled item's anchor event carries the secret mark (#142).
   *
   * The mark lives on the event, so this is a lookup rather than a second judgement: the lanes differ in where
   * they read an event from, and this is the one question they must all ask before handing it to a caller.
   */
  private itemHoldsSecretMark(item: AgentRecallItem): boolean {
    const meta = item as { secretFindings?: { total?: number } };
    if (Number(meta.secretFindings?.total ?? 0) > 0) return true;
    return this.itemChainEvents(item).some((event) => eventHoldsSecretMark(event));
  }

  /**
   * The events an item's own chain points at (#142, #144, #143): its anchor, then the raw events a compile-layer
   * anchor was built from.
   *
   * A compiled item anchors an event that carries no turn of its own (measured: `turn_id` null, no mark), while
   * both the secret mark and the source agent sit on the turn's events. The link between them is in the ledger
   * already — that event's payload lists the raw events it was built from — so the questions are asked of those
   * events rather than answered by scanning text, which is what dropped a legitimate record that merely looked
   * like a key (#144). One walk, shared by the secret gate and the agent scope, because two walks would drift
   * apart; bounded by one event's own source refs.
   */
  private itemChainEvents(item: AgentRecallItem): MemoryEvent[] {
    const eventId = (item.sourceAnchor as { eventId?: string } | undefined)?.eventId;
    if (!eventId) return [];
    const context = this.kernel.getEventContext(eventId, { before: 0, after: 0 });
    // A lane may point at an event this database no longer has; absence is not a secret and says nothing about
    // who owns it. A read that *fails* is not absence and is not swallowed here: it would make the item both
    // visible and unmarked.
    if (!context) return [];
    const chain: MemoryEvent[] = [context.event];
    const sourceRefs = (context.event.payload as { sourceRefs?: unknown } | undefined)?.sourceRefs;
    if (!Array.isArray(sourceRefs)) return chain;
    for (const ref of sourceRefs.slice(0, 16)) {
      const refId = (ref as { eventId?: unknown } | undefined)?.eventId;
      if (typeof refId !== 'string') continue;
      const referenced = this.kernel.getEventContext(refId, { before: 0, after: 0 })?.event;
      if (referenced) chain.push(referenced);
    }
    return chain;
  }

  /**
   * Whether an agent may read an item, read from the same chain as the secret mark (#143).
   *
   * The rule (Ryu 2026-11-07, route 1): imported material is project-level public whatever `sourceAgent` says,
   * because making an import worth doing means the other agents in the project can read it; a turn someone had
   * is scoped to the agent that had it; material whose chain names no agent — a migration, an old row, a record
   * written by a connection that had no identity — is public too. Cross-project isolation is untouched: this
   * only ever widens within one project, and the shared lane stays the one deliberate cross-agent channel.
   */
  private itemVisibleToAgent(item: AgentRecallItem, agentId: string): boolean {
    // One composition for both surfaces (`eventsVisibleToAgent`): the chain is derived here, because
    // an item and an Atlas node reach their events differently, and the judgement is shared.
    return eventsVisibleToAgent(this.itemChainEvents(item), agentId);
  }

  /**
   * Apply the read-time phase to the default lane (#130).
   *
   * Read-time and store-free: the phase is computed from the timestamp every time, so switching it off restores
   * the previous behaviour with no migration and no data to roll back. Forensic and exact-quote lanes never
   * reach this method, and a by-ID read does not either, which is the ticket's rule that those channels always
   * return the whole thing.
   *
   * The rules live in `PhaseProjection.projectPhaseItems`, which is pure and takes the items directly, so the
   * projection has a unit test that does not need a lane to seed a timestamp (#171). This method only adds the
   * trace's suppression reasons and the off switch.
   */
  private projectPhases(items: AgentRecallItem[], query: AgentRecallQuery): { items: AgentRecallItem[]; suppressed: Array<{ reason: RecallSuppressionReason; count: number }> } {
    if (!this.kernel.phaseProjectionEnabled) return { items, suppressed: [] };
    const now = Number(query.now ?? Date.now());
    const projected = projectPhaseItems(items, String(query.query ?? query.anchorText ?? ''), now);
    const suppressed: Array<{ reason: RecallSuppressionReason; count: number }> = [];
    if (projected.dormant > 0) suppressed.push({ reason: 'phase_dormant', count: projected.dormant });
    if (projected.gist > 0) suppressed.push({ reason: 'phase_gist', count: projected.gist });
    return { items: projected.items, suppressed };
  }

  private recallPrivate(query: AgentRecallQuery): { result: AgentRecallResult; suppressedIds: RecallTraceSuppression[] } {
    SECRET_WITHHELD_EVENT_IDS.set(this, new Set());
    const queryText = String(query.query ?? '');
    const forensic = FORENSIC_SOCIAL_EXEMPT_INTENTS.has(String(query.intent ?? ''));
    // Defence 1, at the one place every caller routes through: a social turn asks nothing, so no
    // lane runs. Later in this file the same judgement removes social *entries* from the lanes a
    // real query does run (defence 2).
    if (!forensic && classifySocialTurn(queryText) === 'social') {
      const empty = this.emptyRecallResult(query, 'social_query_residue_empty');
      const trace: AgentRecallDecisionTrace = {
        ...empty.decisionTrace!,
        suppressed: [{ reason: 'residue_empty', count: 0 }],
      };
      return { result: { ...empty, decisionTrace: trace, semanticIndex: this.kernel.semanticIndexEnabled() }, suppressedIds: [] };
    }
    const result = this.withProfileItems(query, this.recallCore(query));
    const gated = this.gateSocialEntries(result.items ?? [], query, forensic);
    // The secret mark is enforced here, and not only in the raw lane's scope test (#142). Measured while fixing
    // this: with the event withheld from the raw lane, the same turn still came back as an item from another
    // lane — text and `sourceContext.event.text` both — so a caller received the key with
    // `suppressed: secret_bearing_withheld` beside it. Every lane returns through here, which is the same reason
    // the social gate sits here; the forensic and exact-quote intents never reach this method.
    // One pass, not two: the withheld entries are what the trace has to name by id (#187), and
    // `itemHoldsSecretMark` walks the ledger, so asking it twice per item would be the only cost this
    // change adds to the hot path.
    const secretWithheldItems = forensic ? [] : gated.items.filter((item) => this.itemHoldsSecretMark(item));
    const withheld = new Set(secretWithheldItems);
    const secretKept = forensic ? gated.items : gated.items.filter((item) => !withheld.has(item));
    // The raw lane records the events it dropped while it ran (#142); this second half covers items no
    // raw window owned. Both are merged here, before the trace is built: the item-level count used to be
    // written to the map after the merge, so a recall that withheld only a compiled item reported no
    // reason at all (found while deleting the read-time text rescan, #169).
    // The raw ids matter to the trace even more than to the count: an event dropped before it could
    // become an item exists nowhere else, so without them a decision that withheld a secret could not
    // name what it withheld (#187).
    const rawWithheldIds = [...(SECRET_WITHHELD_EVENT_IDS.get(this) ?? [])];
    const secretWithheld = rawWithheldIds.length + secretWithheldItems.length;
    const secretIds = [...rawWithheldIds, ...secretWithheldItems.map((item) => item.id)];
    const suppressedIds: RecallTraceSuppression[] = [
      ...gated.suppressedIds,
      ...(secretIds.length ? [{ reason: 'secret_bearing_withheld' as const, count: secretIds.length, ids: secretIds }] : []),
    ];
    if (secretWithheld > 0 && result.decisionTrace) {
      result.decisionTrace.suppressed = mergeSuppressions(result.decisionTrace.suppressed, [
        { reason: 'secret_bearing_withheld', count: secretWithheld },
      ]);
    }
    // The agent scope of compiled material (#143), in the same place and off the same chain as the secret mark.
    // The raw lane has always scoped its own events, but a compiled product — a neuron or an Atlas card — is not an
    // event, so it was readable by every agent in the project. The shared lane is skipped: it is the one
    // deliberate cross-agent channel, and its items say so.
    // Dropping an item for scope is not the same fact as withholding it for a secret, so it is not counted as one:
    // the trace's `secret_bearing_withheld` has to keep meaning what it says.
    const agentKept = query.agentId
      ? secretKept.filter((item) => Boolean((item as { shared?: unknown }).shared)
        || this.itemVisibleToAgent(item, String(query.agentId)))
      : secretKept;
    // Phase projection (#130): the third admission, next to the social and secret ones and in the same place,
    // so it cannot apply to some lanes and not others. Off by default; with it off this is the identity.
    const phased = this.projectPhases(agentKept, query);
    const zeroExplanation = phased.items.length === 0 ? this.explainZeroResult(query) : undefined;
    return {
      result: {
        ...result,
        items: phased.items.map(withRedactionMarks),
        decisionTrace: result.decisionTrace
          ? {
            ...result.decisionTrace,
            ...(gated.suppressed.length ? { suppressed: mergeSuppressions(result.decisionTrace.suppressed, gated.suppressed) } : {}),
            ...(phased.suppressed.length ? { suppressed: mergeSuppressions(result.decisionTrace.suppressed, phased.suppressed) } : {}),
            ...(zeroExplanation ? { zeroExplanation } : {}),
          }
          : result.decisionTrace,
        // One place, because every lane returns through here. A caller that needs to know
        // whether an answer came from a semantic index should not have to read the config.
        semanticIndex: this.kernel.semanticIndexEnabled(),
      },
      suppressedIds,
    };
  }


  /**
   * Which kind of zero this is, from the index rather than from a second recall.
   *
   * One bounded raw search for the same question, then the identity test the lanes already apply.
   * Nothing else runs: no vectors, no lanes, no ranking. The answer is counts only, because how many
   * turns another identity holds says nothing about what they contain.
   */
  private explainZeroResult(query: AgentRecallQuery): ZeroExplanation {
    const text = String(query.query ?? query.anchorText ?? '').trim();
    if (!text) return { kind: 'no_match', thisScope: 0, otherScopes: 0 };
    const queryPlan = compileAgentRecallQuery({ query: query.query, intent: query.intent, anchorText: query.anchorText, taxonomy: this.kernel.taxonomy });
    let events: MemoryEvent[] = [];
    try {
      events = this.kernel.searchRawEvents(text, {
        projectId: query.projectId,
        workspaceId: query.workspaceId,
        startTime: query.startTime,
        endTime: query.endTime,
        limit: ZERO_EXPLANATION_SAMPLE,
      });
    } catch {
      return { kind: 'no_match', thisScope: 0, otherScopes: 0 };
    }
    const outOfScope = events.filter((event) => !this.isRawEventInRecallScope(event, query, queryPlan.intent)).length;
    if (outOfScope === 0) return { kind: 'no_match', thisScope: 0, otherScopes: 0 };
    return {
      kind: 'scope_filtered',
      thisScope: 0,
      otherScopes: outOfScope,
      ...(query.agentId ? { agentId: query.agentId } : {}),
    };
  }

  /** An answer with no items, keeping the shape every caller already handles. */
  private emptyRecallResult(query: AgentRecallQuery, reason: AgentRecallDecisionTrace['reason']): RecallCoreResult {
    const queryPlan = compileAgentRecallQuery({ query: query.query, intent: query.intent, anchorText: query.anchorText, taxonomy: this.kernel.taxonomy });
    return {
      recallMode: 'social_turn_suppressed',
      items: [],
      fallbackUsed: false,
      queryPlan,
      decisionTrace: recallDecisionTrace('none', reason, {
        graph: 0, navigation: 0, scopedNavigation: 0, brainFallback: 0, rawLedger: 0,
      }, 0),
    };
  }

  /**
   * Defence 2: a social entry is never memory content, whatever the question is.
   *
   * The write side already classifies turns (MemoryGate drops pure thanks), but ten-thousand-event
   * databases hold turns written before that gate existed, and the ticket requires them to work
   * without a migration. So the classification is redone here at recall time with the same shared
   * rules — the ledger keeps everything, and this only stops the old pleasantries from being handed
   * back as answers.
   */
  private gateSocialEntries(
    items: AgentRecallItem[],
    query: AgentRecallQuery,
    forensic: boolean,
  ): {
    items: AgentRecallItem[];
    suppressed: Array<{ reason: RecallSuppressionReason; count: number }>;
    /** The same removals, by id, for the trace (#187). Counts alone cannot name what was dropped. */
    suppressedIds: RecallTraceSuppression[];
  } {
    if (forensic) return { items, suppressed: [], suppressedIds: [] };
    const { frequent, rare } = this.queryTermFrequencies(query);
    const measurable = frequent.size > 0 && rare.size > 0;
    const grey = classifySocialTurn(String(query.query ?? '')) === 'grey';
    const kept: AgentRecallItem[] = [];
    const entrySocialIds: string[] = [], noDiscriminativeHitIds: string[] = [], belowFloorIds: string[] = [];
    for (const item of items) {
      const text = String(item.text ?? '');
      if (isSocialTurn(text)) { entrySocialIds.push(item.id); continue; }
      if (measurable) {
        const overlap = [...frequent, ...rare].filter((term) => text.includes(term));
        // "Resting only on high-frequency words" is measured against the shared filler vocabulary as
        // well as the corpus: a hit is discarded only when every word it shares with the question is
        // both everywhere in this project and part of the pleasantry vocabulary, i.e. the whole match
        // is one turn of small talk. Frequency alone is not enough evidence — this repository's own
        // corpus holds an answer deliberately worded like seven others, and a rule that discards on
        // frequency alone suppresses exactly that answer.
        const onlyCommonWords = overlapIsOnlySmallTalk(overlap, frequent);
        if (onlyCommonWords) {
          if (grey) { belowFloorIds.push(item.id); continue; }
          if (item.sourceType === 'raw_ledger') { noDiscriminativeHitIds.push(item.id); continue; }
        }
      }
      kept.push(item);
    }
    // One shape, two projections: the trace's counts and the same removals by id. Two parallel
    // if-chains here would be the same fact written twice (#187).
    const removals: Array<{ reason: RecallSuppressionReason; ids: string[] }> = [
      { reason: 'entry_social', ids: entrySocialIds },
      { reason: 'no_discriminative_hit', ids: noDiscriminativeHitIds },
      { reason: 'grey_below_floor', ids: belowFloorIds },
    ];
    const dropped = removals.filter((removal) => removal.ids.length > 0);
    return {
      items: kept,
      suppressed: dropped.map((removal) => ({ reason: removal.reason, count: removal.ids.length })),
      suppressedIds: dropped.map((removal) => ({ reason: removal.reason, count: removal.ids.length, ids: removal.ids })),
    };
  }

  private queryTermFrequencies(query: AgentRecallQuery): { frequent: Set<string>; rare: Set<string> } {
    const text = String(query.query ?? '');
    const frequent = new Set<string>(); const rare = new Set<string>();
    if (!text.trim()) return { frequent, rare };
    const scopeKey = query.projectId ?? '*';
    let probes = 0;
    for (const probe of discriminativeProbes(text)) {
      if (probes >= DISCRIMINATIVE_TERM_BUDGET) break;
      probes += 1;
      const key = `${scopeKey}\u0000${probe}`;
      let cache = RAW_TERM_DF_CACHE.get(this);
      if (!cache) {
        cache = new Map<string, number>();
        RAW_TERM_DF_CACHE.set(this, cache);
      }
      let count = cache.get(key);
      if (count === undefined) {
        count = this.kernel.countRawEventMatches(probe, { projectId: query.projectId, cap: FREQUENT_TERM_MIN });
        cache.set(key, count);
      }
      (count >= FREQUENT_TERM_MIN ? frequent : rare).add(probe);
    }
    return { frequent, rare };
  }

  // Everything but the semantic-index answer: that is a property of the kernel, not of
  // which lane answered, so it is added once at the single exit above.
  private recallCore(query: AgentRecallQuery): RecallCoreResult {
    const queryPlan = compileAgentRecallQuery({
      query: query.query,
      intent: query.intent,
      anchorText: query.anchorText,
      taxonomy: this.kernel.taxonomy,
    });
    const limit = query.limit ?? 5;
    const allowsGraph = laneAllowed(query.retrievalPolicy, 'graph');
    const allowsCompiled = laneAllowed(query.retrievalPolicy, 'compiled');
    const allowsRawSource = laneAllowed(query.retrievalPolicy, 'raw_source');
    // Only the three intents below merge atlas items into their result. The
    // ordinary recall path reads the atlas itself (multidimensionalRecall), so
    // computing these up front made every recall pay for a second atlas read —
    // measured at half of a 1.2 s query on the year-scale corpus — and throw the
    // result away.
    const withEarlyAtlasItems = (result: RecallCoreResult): RecallCoreResult =>
      query.projectId === undefined || !allowsGraph
        ? result
        : this.withAtlasItems(result, this.atlasItemsForAgentQuery(queryPlan.primarySearchText, query, allowsRawSource), limit);
    if (queryPlan.intent === 'previous_session_summary') {
      return withEarlyAtlasItems(this.recallPreviousSession(query, queryPlan));
    }
    if (queryPlan.intent === 'forensic_quote') {
      return withEarlyAtlasItems(this.recallForensicQuote(query, queryPlan));
    }
    if (queryPlan.intent === 'historical_discussion' || queryPlan.intent === 'action_history') {
      return withEarlyAtlasItems(this.recallHistoricalDiscussion(query, queryPlan));
    }
    const retrievalLimit = Math.max(limit * 4, 24);
    const multidimensionalRecall = query.projectId !== undefined && allowsGraph
      ? this.kernel.evidenceFor(queryPlan.primarySearchText, { projectId: query.projectId, limit: retrievalLimit, includeRawEvidence: true, now: query.now, localDateNow: query.localDateNow, timeZone: query.timeZone })
      : undefined;
    const atlasItems = allowsGraph
      ? [
        ...(multidimensionalRecall?.atlas?.cards ?? []).map((card) => this.toAgentRecallItemFromAtlasCard(card, query)),
        ...(multidimensionalRecall?.atlas?.nodes ?? [])
          .filter((node) => ATLAS_RECALL_NODE_TYPES.includes(node.nodeType))
          .map((node) => this.toAgentRecallItemFromAtlasNode(node, query)),
      ]
        .filter((item): item is AgentRecallItem => Boolean(item))
        .filter((item) => item.sourceType !== 'raw_ledger' || allowsRawSource)
        .filter((item) => this.isAllowedAtlasCollection(item, query.collection))
      : [];
    const graphItems = allowsGraph ? this.memoryBindingGraphItemsForQuery(query, queryPlan, limit) : [];
    const result: MemoryKernelNavigationResult = allowsCompiled
      ? this.kernel.navigateMemory(queryPlan.primarySearchText, {
        projectId: query.projectId,
        limit: retrievalLimit,
        startTime: query.startTime,
        endTime: query.endTime,
        now: query.now,
        localDateNow: query.localDateNow,
        timeZone: query.timeZone,
      })
      : {
        query: queryPlan.primarySearchText,
        projectId: query.projectId,
        recallMode: 'brain_recall_fallback',
        fallbackUsed: true,
        rawEvidence: [],
      };
    const scopedItems = this.filterAgentEvidence([...result.rawEvidence, ...(allowsCompiled ? (multidimensionalRecall?.rawEvidence ?? []) : [])], query.agentId, query.collection, query.excludeSessionId)
      .slice(0, limit)
      .map((neuron) => this.toAgentRecallItem(neuron));
    const rawFallbackItems = allowsRawSource ? this.rawLedgerFallbackItemsForQuery(queryPlan, query, limit) : [];
    const baseCounts = {
      graph: graphItems.length,
      navigation: result.rawEvidence.length,
      scopedNavigation: scopedItems.length,
      brainFallback: 0,
      rawLedger: rawFallbackItems.length,
      atlas: atlasItems.length,
    };
    if (scopedItems.length > 0) {
      if (this.shouldPreferRawLedgerFallback(scopedItems, rawFallbackItems, queryPlan)) {
        const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(rawFallbackItems, this.mergeRecallItems(scopedItems, atlasItems, limit), limit), limit);
        return {
          recallMode: 'raw_ledger_fallback',
          items,
          narrative: result.navigation?.narrative,
          pulseTrace: result.navigation?.pulse.trace,
          temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
          runtime: result.navigation?.runtime,
          fallbackUsed: true,
          queryPlan,
          decisionTrace: recallDecisionTraceForSelection(
            graphItems,
            items,
            'raw_ledger',
            'raw_cue_match_preferred',
            baseCounts,
          ),
        };
      }
      const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(scopedItems, atlasItems, limit), limit);
      return {
        recallMode: result.recallMode,
        items,
        narrative: result.navigation?.narrative,
        pulseTrace: result.navigation?.pulse.trace,
        temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
        runtime: result.navigation?.runtime,
        fallbackUsed: result.fallbackUsed,
        queryPlan,
        decisionTrace: recallDecisionTraceForSelection(
          graphItems,
          items,
          'compiled',
          'compiled_cue_match',
          baseCounts,
        ),
      };
    }

    const fallbackItems = allowsCompiled
      ? this.filterAgentEvidence((multidimensionalRecall ?? this.kernel.evidenceFor(queryPlan.primarySearchText, {
        projectId: query.projectId,
        limit: retrievalLimit,
        now: query.now,
        localDateNow: query.localDateNow,
        timeZone: query.timeZone,
      })).rawEvidence, query.agentId, query.collection, query.excludeSessionId)
        .slice(0, limit)
        .map((neuron) => this.toAgentRecallItem(neuron))
      : [];
    const fallbackCounts = {
      ...baseCounts,
      brainFallback: fallbackItems.length,
    };
    if (fallbackItems.length > 0) {
      if (this.shouldPreferRawLedgerFallback(fallbackItems, rawFallbackItems, queryPlan)) {
        const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(rawFallbackItems, this.mergeRecallItems(fallbackItems, atlasItems, limit), limit), limit);
        return {
          recallMode: 'raw_ledger_fallback',
          items,
          narrative: result.navigation?.narrative,
          pulseTrace: result.navigation?.pulse.trace,
          temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
          runtime: result.navigation?.runtime,
          fallbackUsed: true,
          queryPlan,
          decisionTrace: recallDecisionTraceForSelection(
            graphItems,
            items,
            'raw_ledger',
            'raw_cue_match_preferred',
            fallbackCounts,
          ),
        };
      }
      const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(fallbackItems, atlasItems, limit), limit);
      return {
        recallMode: 'brain_recall_fallback',
        items,
        narrative: result.navigation?.narrative,
        pulseTrace: result.navigation?.pulse.trace,
        temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
        runtime: result.navigation?.runtime,
        fallbackUsed: true,
        queryPlan,
        decisionTrace: recallDecisionTraceForSelection(
          graphItems,
          items,
          'brain_fallback',
          'brain_fallback_selected',
          fallbackCounts,
        ),
      };
    }

    const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(rawFallbackItems, atlasItems, limit), limit);

    return {
      recallMode: 'raw_ledger_fallback',
      items,
      narrative: result.navigation?.narrative,
      pulseTrace: result.navigation?.pulse.trace,
      temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
      runtime: result.navigation?.runtime,
      fallbackUsed: true,
      queryPlan,
      decisionTrace: recallDecisionTraceForSelection(
        graphItems,
        items,
        rawFallbackItems.length > 0 ? 'raw_ledger' : 'none',
        rawFallbackItems.length > 0 ? 'raw_ledger_only' : 'no_recall_evidence',
        fallbackCounts,
      ),
    };
  }

  recallPack(query: AgentRecallQuery): AgentRecallPackResult {
    const generatedAt = Date.now();
    const result = this.recall(query);
    const direct = result.items.slice(0, query.limit ?? 5);
    const directNeuronIds = direct
      .filter((item) => item.sourceType === 'compiled_memory' || item.sourceType === 'imported_summary')
      .map((item) => item.id);

    for (const item of direct.filter((candidate) => directNeuronIds.includes(candidate.id))) {
      this.kernel.activationStore.touch({
        neuronId: item.id,
        projectId: item.projectId || query.projectId,
        delta: 1,
        source: 'recall_pack:direct',
        touchedAt: generatedAt,
      });
      const neuron = this.kernel.memoryGraph.getNeuron(item.id);
      if (neuron) {
        this.kernel.memoryGraph.updateNeuronMetadata(item.id, {
          lastActivated: generatedAt,
          activationCount: (neuron.metadata.activationCount || 0) + 1,
        });
      }
    }

    const associative = this.buildAssociativeItems(query, direct, generatedAt);
    const entityCards = this.buildEntityCards(query);
    const beliefTouches = this.buildBeliefTouches(query);
    const activationHotspots = this.kernel.activationStore.getTop({
      projectId: query.projectId,
      limit: 16,
      excludeNeuronIds: direct.map((item) => item.id),
    }).filter((hotspot) => {
      const neuron = this.kernel.memoryGraph.getNeuron(hotspot.neuronId);
      return neuron
        ? this.filterAgentEvidence([neuron], query.agentId, query.collection, query.excludeSessionId).length > 0
        : false;
    }).slice(0, 8);

    return {
      ...result,
      collection: query.collection ? this.normalizeCollection(query.collection) : undefined,
      generatedAt,
      slots: {
        direct,
        associative,
        entityCards,
        beliefTouches,
      },
      chargeVector: {
        direct: direct.length,
        associative: associative.length,
        entityCards: entityCards.length,
        beliefTouches: beliefTouches.length,
        activationHotspots: activationHotspots.length,
      },
    };
  }

  private recallPreviousSession(query: AgentRecallQuery, queryPlan: AgentRecallQueryPlan): RecallCoreResult {
    const limit = query.limit ?? 5;
    const previousSessionId = this.findPreviousSessionId(query);
    const events = previousSessionId
      ? this.getSessionEvents(previousSessionId, query, Math.max(limit * 3, 24))
      : [];
    const items = events
      .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
      .filter((event) => !this.isOperationalNoiseRawEvent(event))
      .filter((event) => this.hasReadableEventText(event))
      .slice(0, limit)
      .map((event) => this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger_session',
        whyMatched: 'previous_session_summary',
        canAnswerExactQuote: true,
      }));

    return {
      recallMode: 'raw_ledger_fallback',
      items,
      fallbackUsed: true,
      queryPlan,
      decisionTrace: recallDecisionTrace(items.length > 0 ? 'raw_ledger' : 'none', 'previous_session', {
        graph: 0,
        navigation: 0,
        scopedNavigation: 0,
        brainFallback: 0,
        rawLedger: items.length,
      }, items.length),
    };
  }

  private recallForensicQuote(query: AgentRecallQuery, queryPlan: AgentRecallQueryPlan): RecallCoreResult {
    const limit = query.limit ?? 5;
    const anchorItems = this.recallForensicAnchor(query, queryPlan, limit);
    const rawEvents = anchorItems.length > 0 && (queryPlan.anchorUsed || !!query.anchorEventId)
      ? []
      : [
        ...this.rawEventsForLocalDateCue(query, Math.max(limit * 4, 20)),
        ...this.searchRawEventsByQueryPlan(queryPlan, query, Math.max(limit * 4, 20)),
      ];
    const facetQuoteItems = anchorItems.length === 0 ? this.facetGraphQuoteItemsForQuery(query, queryPlan, limit) : [];
    const items = [
      ...anchorItems,
      ...rawEvents
      .filter((event) => isAgentRawEvent(event, query.agentId))
      .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
      .filter((event) => this.isQuoteSourceEvent(event))
      .filter((event) => this.hasReadableEventText(event))
      .sort((a, b) => this.quoteEventPriority(a, queryPlan) - this.quoteEventPriority(b, queryPlan))
      .slice(0, limit)
      .map((event) => this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger',
        whyMatched: 'forensic_quote_raw_event',
        canAnswerExactQuote: true,
      })),
      ...facetQuoteItems,
    ].filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, limit);

    return {
      recallMode: 'raw_ledger_fallback',
      items,
      fallbackUsed: true,
      queryPlan,
      decisionTrace: recallDecisionTrace(
        items.length > 0 ? 'raw_ledger' : 'none',
        'forensic_quote',
        {
          graph: 0,
          navigation: 0,
          scopedNavigation: 0,
          brainFallback: 0,
          rawLedger: items.length,
        },
        items.length,
      ),
    };
  }

  private recallHistoricalDiscussion(query: AgentRecallQuery, queryPlan: AgentRecallQueryPlan): RecallCoreResult {
    const limit = query.limit ?? 5;
    const allowsGraph = laneAllowed(query.retrievalPolicy, 'graph');
    const allowsCompiled = laneAllowed(query.retrievalPolicy, 'compiled');
    const allowsRawSource = laneAllowed(query.retrievalPolicy, 'raw_source');
    const facetResult = allowsGraph ? this.facetGraphItemsForQuery(query, limit) : { items: [], cards: [], relatedButNotSelected: [], relaxationTrace: [] };
    const facetItems = allowsRawSource ? facetResult.items : [];
    const graphItems = allowsGraph ? this.memoryBindingGraphItemsForQuery(query, queryPlan, limit) : [];
    const rawItems = allowsRawSource ? this.rawLedgerFallbackItemsForQuery(queryPlan, query, Math.max(limit * 2, 10)) : [];
    const compiledItems = allowsCompiled
      ? this.compiledItemsForHistoricalQuery(queryPlan, query, limit)
      : [];
    const relevantCompiledItems = this.filterCompiledItemsByQueryCues(compiledItems, queryPlan);
    const items = this.mergeHistoricalRecallItems(facetItems, rawItems, graphItems, relevantCompiledItems, limit);
    const selectedLane = facetItems.length > 0
      ? 'facet_graph_raw_ledger'
      : rawItems.length > 0
        ? 'raw_ledger'
        : graphItems.length > 0
        ? 'graph'
        : relevantCompiledItems.length > 0
          ? 'compiled'
          : 'none';
    return {
      recallMode: facetItems.length > 0
        ? (rawItems.length > 0 ? 'atlas_raw_grounded_recall' : 'atlas_facet_recall')
        : rawItems.length > 0 ? 'raw_ledger_fallback' : 'brain_recall_fallback',
      items,
      fallbackUsed: facetItems.length === 0,
      queryPlan,
      atlasCards: facetResult.cards,
      relatedButNotSelected: facetResult.relatedButNotSelected,
      relaxationTrace: facetResult.relaxationTrace,
      decisionTrace: recallDecisionTrace(
        selectedLane,
        queryPlan.intent === 'action_history' ? 'action_history' : 'historical_discussion',
        {
          graph: graphItems.length + facetItems.length,
          navigation: relevantCompiledItems.length,
          scopedNavigation: relevantCompiledItems.length,
          brainFallback: 0,
          rawLedger: rawItems.length + facetItems.length,
        },
        items.length,
      ),
    };
  }

  private facetGraphQuoteItemsForQuery(
    query: AgentRecallQuery,
    queryPlan: AgentRecallQueryPlan,
    limit: number,
  ): AgentRecallItem[] {
    try {
      const atlas = this.kernel.graphExplore(query.query, {
        projectId: query.projectId,
        limit: Math.max(limit * 2, 6),
        includeEvidence: true,
        evidenceLimit: 2,
        now: query.now,
        localDateNow: query.localDateNow,
        timeZone: query.timeZone,
        refresh: false,
        staleOk: true,
      } as any);
      const cards = (atlas.cards ?? []).slice(0, Math.max(limit * 2, 6));
      const events = cards
        .map((card) => card.sourceLocator?.eventId ?? card.evidenceEventIds[0])
        .filter((eventId): eventId is string => Boolean(eventId))
        .map((eventId) => this.kernel.getEventContext(eventId, { before: 0, after: 0 })?.event)
        .filter((event): event is MemoryEvent => Boolean(event))
        .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
        .filter((event) => this.isQuoteSourceEvent(event))
        .filter((event) => this.hasReadableEventText(event));
      return this.dedupeRawEventsByTurnPreferUser(events)
        .slice(0, limit)
        .map((event) => this.toAgentRawRecallItem(event, {
          sourceType: 'raw_ledger',
          whyMatched: 'forensic_quote_atlas_source_locator',
          canAnswerExactQuote: true,
        }));
    } catch {
      return [];
    }
  }

  private facetGraphItemsForQuery(query: AgentRecallQuery, limit: number): {
    items: AgentRecallItem[];
    cards: MemoryAtlasCard[];
    relatedButNotSelected: MemoryAtlasRelatedCard[];
    relaxationTrace: MemoryAtlasRelaxationStep[];
  } {
    try {
      const recall = this.kernel.evidenceFor(query.query, { projectId: query.projectId, limit, includeRawEvidence: true, now: query.now, localDateNow: query.localDateNow, timeZone: query.timeZone });
      const atlas = recall.atlas;
      const plannedCards = atlas?.cards ?? [];
      const legacyAtlas = this.kernel.graphExplore(query.query, {
        projectId: query.projectId,
        limit,
        includeEvidence: true,
        evidenceLimit: 2,
        now: query.now,
        localDateNow: query.localDateNow,
        timeZone: query.timeZone,
        refresh: false,
        staleOk: true,
      } as any);
      const cards = [...plannedCards, ...(legacyAtlas.cards ?? [])]
        .filter((card, index, all) => all.findIndex((candidate) => candidate.canonicalId === card.canonicalId) === index)
        .slice(0, limit);
      if (cards.length === 0) return { items: [], cards: [], relatedButNotSelected: [], relaxationTrace: [] };
      const items = cards.map((card) => this.toAgentRecallItemFromAtlasCard(card, query)).filter((item): item is AgentRecallItem => Boolean(item));
      const relatedButNotSelected = cards.flatMap((card) => card.relatedButNotSelected ?? []).slice(0, 8);
      return { items, cards, relatedButNotSelected, relaxationTrace: [...(atlas?.relaxationTrace ?? []), ...(legacyAtlas.relaxationTrace ?? [])] };
    } catch {
      return { items: [], cards: [], relatedButNotSelected: [], relaxationTrace: [] };
    }
  }

  private toAgentRecallItemFromAtlasCard(card: MemoryAtlasCard, query: AgentRecallQuery): AgentRecallItem | null {
    const eventIds = [...new Set([card.sourceLocator?.eventId, ...card.evidenceEventIds].filter((id): id is string => Boolean(id)))];
    const scopedAnchor = eventIds.map((id) => this.kernel.eventStore.getEvent(id)).find((event): event is MemoryEvent => Boolean(event && isAgentRawEvent(event, query.agentId) && this.isRawEventInRecallScope(event, query, query.intent)));
    const eventId = scopedAnchor?.eventId;
    if (!eventId || !scopedAnchor) return null;
    const sourceContext = this.toAgentSourceContext(eventId, query);
    const anchorEvent = sourceContext?.event;
    if (!scopedAnchor || !isAgentRawEvent(scopedAnchor, query.agentId) || !this.isRawEventInRecallScope(scopedAnchor, query, query.intent)) return null;
    const allowRaw = laneAllowed(query.retrievalPolicy, 'raw_source');
    return {
      id: `facet:${card.canonicalId}`,
      text: [card.displayTitle, card.oneLineSummary].filter(Boolean).join(': '),
      projectId: query.projectId,
      topicPath: card.parentTopics[0],
      canonicalId: card.canonicalId,
      displayTitle: card.displayTitle,
      matchedFacets: card.matchedFacets,
      matchedPaths: card.matchedPaths,
      tags: ['facet_graph', card.eventKind, card.issueType].filter((tag): tag is string => Boolean(tag)),
      source: 'memory_atlas',
      sourceType: card.origin === 'legacy_facet' ? 'raw_ledger' : 'compiled_memory',
      sourceAnchor: allowRaw ? (anchorEvent ? this.toAgentSourceAnchorFromContextEvent(anchorEvent) : eventId ? { eventId } : undefined) : undefined,
      sourceContext: allowRaw ? sourceContext : undefined,
      confidence: Math.min(1, 0.7 + card.matchedFacets.length * 0.08),
      whyMatched: card.whyMatched,
      canAnswerExactQuote: Boolean(sourceContext),
    };
  }

  private toAgentRecallItemFromAtlasNode(node: MemoryAtlasNode, query: AgentRecallQuery): AgentRecallItem | null {
    const scopedEvidence = (node.evidence ?? [])
      .map((evidence) => this.kernel.eventStore.getEvent(evidence.eventId))
      .filter((event): event is MemoryEvent => Boolean(event))
      .filter((event) => isAgentRawEvent(event, query.agentId) && this.isRawEventInRecallScope(event, query, query.intent));
    const event = scopedEvidence[0];
    const eventId = event?.eventId;
    if (!event || !eventId) return null;
    const allowRaw = laneAllowed(query.retrievalPolicy, 'raw_source');
    return {
      id: `atlas-node:${node.id}`,
      text: [node.label, node.summary].filter(Boolean).join(': '),
      projectId: query.projectId,
      canonicalId: node.id,
      displayTitle: node.label,
      tags: ['atlas_node', node.nodeType],
      source: 'memory_atlas',
      sourceType: 'compiled_memory',
      sourceAnchor: allowRaw ? this.toAgentSourceAnchor(event) : undefined,
      sourceContext: allowRaw ? this.toAgentSourceContext(eventId, query) : undefined,
      confidence: node.confidence,
      whyMatched: `atlas_${node.nodeType}`,
      canAnswerExactQuote: false,
    };
  }

  private isAllowedAtlasCollection(item: AgentRecallItem, collection?: string): boolean {
    const eventId = item.sourceAnchor?.eventId;
    if (!eventId) return item.sourceType === 'compiled_memory' || item.sourceType === 'imported_summary' || !collection;
    const event = this.kernel.eventStore.getEvent(eventId);
    return event ? this.isAllowedRawEventCollection(event, collection) : !collection;
  }

  private recallForensicAnchor(query: AgentRecallQuery, queryPlan: AgentRecallQueryPlan, limit: number): AgentRecallItem[] {
    if (!query.anchorEventId) return [];
    const context = this.kernel.getEventContext(query.anchorEventId, { before: 4, after: 4 });
    if (!context) return [];
    const candidates = [context.event, ...context.before.slice().reverse(), ...context.after];
    return candidates
      .filter((event) => isAgentRawEvent(event, query.agentId))
      .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
      .filter((event) => !this.isOperationalNoiseRawEvent(event))
      .filter((event) => this.isQuoteSourceEvent(event))
      .filter((event) => this.hasReadableEventText(event))
      .sort((a, b) => {
        const anchorDelta = (a.eventId === query.anchorEventId ? 0 : 1) - (b.eventId === query.anchorEventId ? 0 : 1);
        if (anchorDelta !== 0) return anchorDelta;
        return this.quoteEventPriority(a, queryPlan) - this.quoteEventPriority(b, queryPlan);
      })
      .slice(0, limit)
      .map((event) => this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger',
        whyMatched: 'forensic_quote_anchor_event',
        canAnswerExactQuote: true,
      }));
  }

  private searchRawEventsByQueryPlan(
    queryPlan: AgentRecallQueryPlan,
    query: AgentRecallQuery,
    limit: number,
  ): MemoryEvent[] {
    const seen = new Set<string>();
    const out: MemoryEvent[] = [];
    const searchTexts = this.expandRawSearchTexts(queryPlan);
    for (const searchText of searchTexts) {
      const events = this.kernel.searchRawEvents(searchText, {
        projectId: query.projectId,
        workspaceId: query.workspaceId,
        threadId: query.threadId,
        startTime: query.startTime,
        endTime: query.endTime,
        limit,
        // Recall wants the event that answers the question. Chronological order
        // here made the oldest match the best match, so the answer a query had
        // found was ranked behind whatever happened first.
        orderBy: 'relevance',
      });
      for (const event of events) {
        if (seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        out.push(event);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  private rawEventsForLocalDateCue(query: AgentRecallQuery, limit: number): MemoryEvent[] {
    const localDate = localDateCue(query.query, query);
    if (!localDate) return [];
    const [year, month, day] = localDate.split('-').map(Number);
    const byLocalDate = this.kernel.eventStore.queryEvents(1, 1000, {
      projectId: query.projectId !== undefined ? [query.projectId] : undefined,
      workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
    }).records.filter((event) => event.localDate === localDate).slice(0, limit);
    if (byLocalDate.length) return byLocalDate;
    const startTime = Date.UTC(year!, month! - 1, day!);
    const endTime = Date.UTC(year!, month! - 1, day! + 1);
    const byTime = this.kernel.eventStore.queryEvents(1, Math.max(1, Math.min(limit, 200)), {
      projectId: query.projectId !== undefined ? [query.projectId] : undefined,
      workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
      startTime,
      endTime,
    }).records;
    if (byTime.length) return byTime;
    return this.kernel.eventStore.queryEvents(1, 1000, {
      projectId: query.projectId !== undefined ? [query.projectId] : undefined,
      workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
    }).records.filter((event) => event.localDate === localDate).slice(0, limit);
  }

  private rawLedgerFallbackItemsForQuery(
    queryPlan: AgentRecallQueryPlan,
    query: AgentRecallQuery,
    limit: number
  ): AgentRecallItem[] {
    const scoped = this.collectRawLedgerItems(queryPlan, query, limit);
    if (scoped.length > 0 || !query.threadId) return scoped;
    // A thread is one conversation, and recall exists to reach across them. A
    // thread with no evidence of its own falls back to the whole project
    // instead of answering nothing.
    return this.collectRawLedgerItems(queryPlan, { ...query, threadId: undefined }, limit)
      .map((item) => ({ ...item, tags: [...(item.tags ?? []), 'cross_thread'] }));
  }

  private collectRawLedgerItems(
    queryPlan: AgentRecallQueryPlan,
    query: AgentRecallQuery,
    limit: number
  ): AgentRecallItem[] {
    const searchedEvents = this.searchRawEventsByQueryPlan(queryPlan, query, Math.max(limit * 2, 10));
    const rawEvents = queryPlan.intent === 'forensic_quote'
      ? this.dedupeRawEventsByTurnPreferUser(searchedEvents)
      : this.dedupeRawEventsByTurnPreferCue(searchedEvents, queryPlan);
    return rawEvents
      .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
      .filter((event) => !this.isOperationalNoiseRawEvent(event))
      .slice(0, limit)
      .map((event) => this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger',
        whyMatched: 'raw_ledger_text_fallback',
        canAnswerExactQuote: true,
      }));
  }

  private memoryBindingGraphItemsForQuery(
    query: AgentRecallQuery,
    queryPlan: AgentRecallQueryPlan,
    limit: number
  ): AgentRecallItem[] {
    const anchors = this.kernel.recallMemoryBindingGraph(
      [query.query, queryPlan.primarySearchText, ...queryPlan.searchTexts].join('\n'),
      {
        projectId: query.projectId,
        limit: Math.max(limit * 2, 8),
      },
    );
    const items: AgentRecallItem[] = [];
    const seen = new Set<string>();

    for (const anchor of anchors) {
      if (seen.has(anchor.eventId)) continue;
      const event = this.kernel.getEventContext(anchor.eventId, { before: 0, after: 0 })?.event;
      if (!event) continue;
      if (!this.isRawEventInRecallScope(event, query, queryPlan.intent)) continue;
      if (this.isOperationalNoiseRawEvent(event)) continue;
      if (!this.hasReadableEventText(event)) continue;

      const item = this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger',
        whyMatched: 'memory_binding_graph',
        canAnswerExactQuote: true,
      });
      items.push({
        ...item,
        topicPath: anchor.topicPath,
        confidence: anchor.confidence,
        tags: [
          ...item.tags,
          `topic:${anchor.topicPath}`,
          anchor.clusterId ? `cluster:${anchor.clusterId}` : '',
        ].filter(Boolean),
      });
      seen.add(anchor.eventId);
    }

    return items
      .sort((a, b) => this.graphRecallTextScore(b, query) - this.graphRecallTextScore(a, query))
      .slice(0, limit);
  }

  private graphRecallTextScore(item: AgentRecallItem, query: AgentRecallQuery): number {
    const queryTerms = uniqueNonEmpty(query.query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff_-]+/))
      .filter((term) => term.length >= 2 && !/^(cogmem|memory|project|之前|什么|问题|why|did|say)$/i.test(term));
    const haystack = this.itemSearchableText(item).toLowerCase();
    const overlap = queryTerms.filter((term) => haystack.includes(term)).length;
    return overlap + (item.confidence || 0);
  }

  private shouldPreferRawLedgerFallback(
    candidateItems: AgentRecallItem[],
    rawFallbackItems: AgentRecallItem[],
    queryPlan: AgentRecallQueryPlan
  ): boolean {
    if (rawFallbackItems.length === 0) return false;
    const rawHasCue = this.itemsContainRecallCue(rawFallbackItems, queryPlan);
    if (!rawHasCue) return false;

    // Ask which lane holds the better match, not whether each lane holds a match.
    // The compiled lane is a broad sample of the whole project, so it contains any
    // common word and "does this set mention the query" is true for every query —
    // measured: of eleven questions whose raw lane carried the cues, the compiled
    // lane carried them eleven times too, so the preference below never fired and
    // the compiled lane won by default while the raw lane held the record.
    const rawMatch = this.bestRecallCueMatch(rawFallbackItems, queryPlan);
    const candidateMatch = this.bestRecallCueMatch(candidateItems, queryPlan);
    if (rawMatch > candidateMatch) return true;

    if (queryPlan.temporalHints.includes('past')) {
      const rawLead = rawFallbackItems.find((item) => this.itemsContainRecallCue([item], queryPlan));
      const candidateLead = candidateItems.find((item) => this.itemsContainRecallCue([item], queryPlan));
      if (rawLead?.sourceAnchor?.role === 'user' && candidateLead?.sourceAnchor?.role !== 'user') {
        return true;
      }
    }

    return false;
  }

  /**
   * How many of the query's cues the best item in this set carries.
   *
   * A set-wide yes/no cannot compare two lanes of different sizes: a large diverse
   * set answers yes to everything. Counting the best single item's coverage says
   * which lane actually has the memory being asked about.
   */
  private bestRecallCueMatch(items: AgentRecallItem[], queryPlan: AgentRecallQueryPlan): number {
    const cues = this.recallCueTerms(queryPlan);
    if (cues.length === 0) return 0;
    let best = 0;
    for (const item of items) {
      const haystack = this.itemSearchableText(item).toLowerCase();
      const matched = cues.filter((cue) => haystack.includes(cue.toLowerCase())).length;
      if (matched > best) best = matched;
    }
    return best;
  }

  private itemsContainRecallCue(items: AgentRecallItem[], queryPlan: AgentRecallQueryPlan): boolean {
    const cues = this.recallCueTerms(queryPlan);
    if (cues.length === 0) return true;
    // One shared word is not evidence of relevance. "CI" appears in nearly every
    // review comment, so a single-word match marked the whole compiled lane as an
    // answer and kept the raw lane — which held the record — from ever being read.
    // An item carries the query when it holds more than one of its cues, or when
    // the query named only one thing and that thing is present.
    const required = cues.length === 1 ? 1 : 2;
    return items.some((item) => {
      const haystack = this.itemSearchableText(item).toLowerCase();
      const matched = cues.filter((cue) => haystack.includes(cue.toLowerCase())).length;
      return matched >= required;
    });
  }

  private recallCueTerms(queryPlan: AgentRecallQueryPlan): string[] {
    const terms = [
      ...queryPlan.keywords,
      ...queryPlan.semanticCuePhrases.flatMap((phrase) => phrase.split(/\s+/)),
    ]
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !/^(hermes|openclaw|cogmem)$/i.test(term));
    return uniqueNonEmpty(terms);
  }

  private queryHasStructuredCue(queryPlan: AgentRecallQueryPlan): boolean {
    return /hermes|openclaw|cogmem|启动|安装|配置|重启|停止|操作|处理|执行|start|launch|install|configure|restart|stop|run/i.test(queryPlan.originalQuery)
      || queryPlan.intent === 'action_history';
  }

  private structuredCueTerms(queryPlan: AgentRecallQueryPlan): string[] {
    const terms = [
      ...queryPlan.keywords,
      ...queryPlan.semanticCuePhrases.flatMap((phrase) => phrase.split(/\s+/)),
    ]
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .filter((term) => !/^(之前|什么|做过|做了|让你|我的|原话|精确|完整|the|what|did|you|to)$/i.test(term));
    if (/启动|start|launch/i.test(queryPlan.originalQuery)) terms.push('启动', 'start', 'launch');
    if (/安装|install|setup/i.test(queryPlan.originalQuery)) terms.push('安装', 'install', 'setup');
    if (/配置|修改|config/i.test(queryPlan.originalQuery)) terms.push('配置', '修改', 'config');
    if (/操作|处理|执行|run|ran/i.test(queryPlan.originalQuery)) terms.push('操作', '执行', 'run');
    return uniqueNonEmpty(terms);
  }

  private itemSearchableText(item: AgentRecallItem): string {
    return [
      item.text,
      item.source || '',
      item.tags.join(' '),
    ].join('\n');
  }

  private mergeRecallItems(primary: AgentRecallItem[], secondary: AgentRecallItem[], limit: number): AgentRecallItem[] {
    const semanticAtlas = secondary.find((item) => item.source === 'memory_atlas' && (item.tags.includes('atlas_node') || item.tags.includes('facet_graph') || item.tags.includes('atlas_path')));
    const hasSemanticAtlas = primary.some((item) => item.source === 'memory_atlas' && (item.tags.includes('atlas_node') || item.tags.includes('facet_graph') || item.tags.includes('atlas_path')));
    const hasScopedPrimary = primary.some((item) => item.tags.some((tag) => tag.startsWith('agent:')));
    const prioritizedPrimary = semanticAtlas && !hasSemanticAtlas && !hasScopedPrimary && primary.length >= limit
      ? [...primary.slice(0, Math.max(0, limit - 1)), semanticAtlas]
      : primary;
    const merged: AgentRecallItem[] = [];
    const seen = new Set<string>();
    const keptByKey = new Map<string, AgentRecallItem>();
    for (const item of [...prioritizedPrimary, ...secondary.filter((candidate) => candidate !== semanticAtlas)]) {
      const keys = [item.canonicalId, item.sourceAnchor?.eventId, item.id].filter((value): value is string => Boolean(value));
      const duplicate = keys.map((key) => keptByKey.get(key)).find((candidate): candidate is AgentRecallItem => Boolean(candidate));
      if (keys.some((key) => seen.has(key))) {
        // A compiled card that cites the same event as an answer already kept is not a
        // second answer — it says what that answer is. Dropping it silently is what made
        // the compiled layer invisible: `evidenceFor` returned four atlas nodes and every
        // recall answer was raw text with no trace of them (#119).
        if (duplicate && item.source === 'memory_atlas' && duplicate.source !== 'memory_atlas') {
          duplicate.displayTitle ??= item.displayTitle;
          duplicate.whyMatched ??= item.whyMatched;
          for (const tag of item.tags) if (!duplicate.tags.includes(tag)) duplicate.tags.push(tag);
        }
        continue;
      }
      for (const key of keys) { seen.add(key); keptByKey.set(key, item); }
      merged.push(item);
    }
    // Supersession is decided before the list is cut: a stale statement that
    // occupies a slot is a stale statement the statement replacing it cannot
    // take (#72, measured at 95.8% leakage when nothing tagged the old value).
    return filterSuperseded(merged, (item) => ({
      id: item.id,
      content: item.text,
      createdAt: item.sourceAnchor?.eventOrdinal ?? item.sourceAnchor?.turnSeq ?? 0,
      // Deliberately no `topicPath`: on this path many unrelated records share
      // one, and grouping by it collapsed the recall floor from 4/18 to 2/18.
      // The subject phrase is the signature the rule is stated in.
      tags: item.tags,
      projectId: item.projectId,
    })).slice(0, limit);
  }

  private withAtlasItems(result: RecallCoreResult, atlasItems: AgentRecallItem[], limit: number): RecallCoreResult {
    if (!atlasItems.length) return result;
    return { ...result, items: this.mergeRecallItems(result.items, atlasItems, limit) };
  }

  private atlasItemsForAgentQuery(searchText: string, query: AgentRecallQuery, allowsRawSource: boolean): AgentRecallItem[] {
    const recall = this.kernel.evidenceFor(searchText, { projectId: query.projectId, limit: Math.max((query.limit ?? 5) * 4, 24), includeRawEvidence: true, now: query.now, localDateNow: query.localDateNow, timeZone: query.timeZone });
    const cards = (recall.atlas?.cards ?? []).map((card) => this.toAgentRecallItemFromAtlasCard(card, query));
    const nodes = (recall.atlas?.nodes ?? [])
      .filter((node) => ATLAS_RECALL_NODE_TYPES.includes(node.nodeType))
      .map((node) => this.toAgentRecallItemFromAtlasNode(node, query));
    return [...cards, ...nodes]
      .filter((item): item is AgentRecallItem => Boolean(item))
      .filter((item) => item.sourceType !== 'raw_ledger' || allowsRawSource)
      .filter((item) => this.isAllowedAtlasCollection(item, query.collection));
  }

  private mergeHistoricalRecallItems(
    facetItems: AgentRecallItem[],
    rawItems: AgentRecallItem[],
    graphItems: AgentRecallItem[],
    compiledItems: AgentRecallItem[],
    limit: number,
  ): AgentRecallItem[] {
    const merged = this.mergeRecallItems(facetItems, this.mergeRecallItems(rawItems, this.mergeRecallItems(graphItems, compiledItems, limit), limit), limit);
    if (merged.some((item) => item.sourceType === 'imported_summary')) return merged;
    const importedSupport = compiledItems.find((item) => item.sourceType === 'imported_summary');
    if (!importedSupport) return merged;
    const withoutDuplicate = merged.filter((item) => item.id !== importedSupport.id && item.sourceAnchor?.eventId !== importedSupport.sourceAnchor?.eventId);
    if (withoutDuplicate.length < limit) return [...withoutDuplicate, importedSupport];
    return [...withoutDuplicate.slice(0, Math.max(0, limit - 1)), importedSupport];
  }

  private compiledItemsForHistoricalQuery(queryPlan: AgentRecallQueryPlan, query: AgentRecallQuery, limit: number): AgentRecallItem[] {
    const retrievalLimit = Math.max(limit * 4, 24);
    const out: AgentRecallItem[] = [];
    const seen = new Set<string>();
    for (const searchText of uniqueNonEmpty([queryPlan.primarySearchText, ...queryPlan.searchTexts, queryPlan.originalQuery])) {
      const rawEvidence = this.kernel.navigateMemory(searchText, {
        projectId: query.projectId,
        limit: retrievalLimit,
        startTime: query.startTime,
        endTime: query.endTime,
        now: query.now,
        localDateNow: query.localDateNow,
        timeZone: query.timeZone,
      }).rawEvidence;
      const items = this.filterAgentEvidence(rawEvidence, query.agentId, query.collection, query.excludeSessionId)
        .map((neuron) => this.toAgentRecallItem(neuron));
      for (const item of items) {
        const key = item.id || item.sourceAnchor?.eventId;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        out.push(item);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  private filterCompiledItemsByQueryCues(items: AgentRecallItem[], queryPlan: AgentRecallQueryPlan): AgentRecallItem[] {
    if (!this.queryHasStructuredCue(queryPlan)) return items;
    const cues = this.structuredCueTerms(queryPlan);
    if (!cues.length) return items;
    return items.filter((item) => {
      const haystack = this.itemSearchableText(item).toLowerCase();
      if (queryPlan.intent === 'action_history') {
        const entityTerms = extractEntityCues(queryPlan.originalQuery).map((entity) => entity.label.toLowerCase());
        const entityMatched = entityTerms.length === 0 || entityTerms.some((term) => haystack.includes(term));
        const queryKinds = inferActionKinds(queryPlan.originalQuery, this.kernel.taxonomy);
        // A query that names no action still means "any action": that is the project's whole vocabulary, not a
        // hand-copied shipped subset that had already lost reviewed/decided/debugged (#183).
        const allowedKinds = queryKinds.length ? queryKinds : this.kernel.taxonomy.actionKinds.map((rule) => rule.kind);
        const itemKinds = inferActionKinds(haystack, this.kernel.taxonomy);
        const actionMatched = itemKinds.some((kind) => allowedKinds.includes(kind));
        return entityMatched && actionMatched;
      }
      return cues.some((cue) => haystack.includes(cue.toLowerCase()));
    });
  }

  private dedupeRawEventsByTurnPreferUser(events: MemoryEvent[]): MemoryEvent[] {
    const byTurn = new Map<string, MemoryEvent>();
    for (const event of events) {
      const key = event.turnId || event.eventId;
      const existing = byTurn.get(key);
      if (!existing) {
        byTurn.set(key, event);
        continue;
      }
      if (event.role === 'user' && existing.role !== 'user') {
        byTurn.set(key, event);
      }
    }
    return [...byTurn.values()].sort((a, b) => (
      (a.globalSeq || 0) - (b.globalSeq || 0)
      || this.quoteEventPriority(a) - this.quoteEventPriority(b)
      || a.eventId.localeCompare(b.eventId)
    ));
  }

  private expandRawSearchTexts(queryPlan: AgentRecallQueryPlan): string[] {
    const hostNeutralKeywords = queryPlan.keywords.filter((keyword) => !/^(hermes|openclaw|cogmem)$/i.test(keyword));
    return uniqueNonEmpty([
      queryPlan.originalQuery,
      queryPlan.keywords.join(' '),
      ...queryPlan.searchTexts,
      hostNeutralKeywords.join(' '),
      ...hostNeutralKeywords.filter((keyword) => keyword.length >= 2),
    ]);
  }

  private findPreviousSessionId(query: AgentRecallQuery): string | undefined {
    const page = this.kernel.eventStore.queryEvents(1, 1000, {
      projectId: query.projectId !== undefined ? [query.projectId] : undefined,
      workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
      startTime: query.startTime,
      endTime: query.endTime,
    });
    const currentSessionIds = new Set([query.sessionId, query.excludeSessionId].filter((value): value is string => !!value));
    const sessionIds = new Set<string>();
    for (const event of page.records) {
      if (!event.sessionId || currentSessionIds.has(event.sessionId)) continue;
      if (!isAgentRawEvent(event, query.agentId)) continue;
      if (this.isOperationalNoiseRawEvent(event)) continue;
      sessionIds.add(event.sessionId);
    }
    return sessionIds.values().next().value;
  }

  private getSessionEvents(sessionId: string, query: AgentRecallQuery, limit: number): MemoryEvent[] {
    const page = this.kernel.eventStore.queryEvents(1, Math.max(limit, 1), {
      projectId: query.projectId !== undefined ? [query.projectId] : undefined,
      workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
      sessionId: [sessionId],
      startTime: query.startTime,
      endTime: query.endTime,
    });
    return page.records
      .slice()
      .sort((a, b) => (
        (a.globalSeq || 0) - (b.globalSeq || 0)
        || (a.threadSeq || 0) - (b.threadSeq || 0)
        || (a.eventOrdinal || 0) - (b.eventOrdinal || 0)
      || a.eventId.localeCompare(b.eventId)
    ));
  }

  private dedupeRawEventsByTurnPreferCue(events: MemoryEvent[], queryPlan: AgentRecallQueryPlan): MemoryEvent[] {
    const byTurn = new Map<string, MemoryEvent>();
    for (const event of events) {
      const key = event.turnId || event.eventId;
      const existing = byTurn.get(key);
      if (!existing) {
        byTurn.set(key, event);
        continue;
      }
      const eventScore = this.rawEventCueScore(event, queryPlan);
      const existingScore = this.rawEventCueScore(existing, queryPlan);
      const rolePriority = this.quoteEventPriority(event) - this.quoteEventPriority(existing);
      if (eventScore > existingScore || (
        eventScore === existingScore
        && (
          rolePriority < 0
          || (rolePriority === 0 && this.rawEventTextLength(event) > this.rawEventTextLength(existing))
        )
      )) {
        byTurn.set(key, event);
      }
    }
    // Deliberately re-ranked. The search orders by BM25 relevance, which alone
    // ranks a second-hand retelling above the conversation it retells — this sort
    // by cue coverage is what makes the original user turn win (pinned by
    // `agent-nerve-system`: "prefers the original user anchor"). Removing it
    // raises raw-lane delivery from 2 to 4 on the evaluation corpus and changes
    // the end-to-end score not at all, because searching by relevance and
    // preferring a primary source are different questions and this ordering only
    // answers the second. A fix has to combine them — preference first, the
    // search's rank within a preference class — rather than drop one.
    // Preference first, the search's ranking within it.
    //
    // Ranking by cue coverage alone discards the BM25 order the search produced,
    // and ranking by relevance alone puts a second-hand retelling above the
    // conversation it retells. They are different questions — which source is
    // trustworthy, and which event is relevant — so the order answers them in that
    // order and keeps the search's ranking inside each class rather than throwing
    // it away.
    const searchRank = new Map(events.map((event, index) => [event.eventId, index]));
    return [...byTurn.values()].sort((a, b) => (
      this.quoteEventPriority(a, queryPlan) - this.quoteEventPriority(b, queryPlan)
      || (searchRank.get(a.eventId) ?? Number.MAX_SAFE_INTEGER) - (searchRank.get(b.eventId) ?? Number.MAX_SAFE_INTEGER)
      || a.eventId.localeCompare(b.eventId)
    ));
  }

  private rawEventCueScore(event: MemoryEvent, queryPlan: AgentRecallQueryPlan): number {
    const haystack = this.rawEventText(event).toLowerCase();
    return this.recallCueTerms(queryPlan)
      .reduce((score, cue) => score + (haystack.includes(cue.toLowerCase()) ? 1 : 0), 0);
  }

  private rawEventTextLength(event: MemoryEvent): number {
    return this.rawEventText(event).length;
  }

  private rawEventText(event: MemoryEvent): string {
    const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.output === 'string') return payload.output;
    if (typeof payload.title === 'string') return payload.title;
    return JSON.stringify(event.payload);
  }

  private filterAgentEvidence(
    neurons: MemoryKernelNavigationResult['rawEvidence'],
    agentId: string,
    collection?: string,
    excludeSessionId?: string,
  ): MemoryKernelNavigationResult['rawEvidence'] {
    return neurons.filter((neuron) => {
      if (!isRecallableMemoryEvidence(neuron)) return false;
      const tags = neuron.metadata.tags || [];
      if (excludeSessionId && tags.includes(`session:${excludeSessionId}`)) return false;
      if (!this.isAllowedCollectionTags(tags, collection)) return false;
      const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
      if (explicitAgentTags.length === 0) return true;
      return explicitAgentTags.includes(`agent:${agentId}`) || tags.includes(agentId);
    });
  }

  private toAgentRecallItem(neuron: MemoryKernelNavigationResult['rawEvidence'][number]): AgentRecallItem {
    const tags = neuron.metadata.tags || [];
    const importedSummary = tags.includes('reliability:imported_summary')
      || tags.includes('provenance:imported_summary')
      || tags.includes('memory_layer:summary_seed');
    const sourceEventId = this.preferredRawSourceEventId(neuron) || neuron.metadata.sourceEventId;
    const sourceContext = sourceEventId ? this.toAgentSourceContext(sourceEventId) : undefined;
    const sourceAnchor = sourceContext?.event
      ? this.toAgentSourceAnchorFromContextEvent(sourceContext.event)
      : neuron.metadata.sourceEventId ? { eventId: neuron.metadata.sourceEventId } : undefined;
    return {
      id: neuron.id,
      text: neuron.content,
      projectId: neuron.metadata.projectId,
      topicPath: neuron.metadata.topicPath,
      tags,
      source: neuron.metadata.filePath || sourceEventId || neuron.metadata.sourceEventId,
      sourceType: importedSummary ? 'imported_summary' : 'compiled_memory',
      sourceAnchor,
      sourceContext,
      confidence: importedSummary ? 0.35 : 0.75,
      whyMatched: importedSummary ? 'imported_summary_support_only' : 'governed_compiled_memory',
      canAnswerExactQuote: false,
    };
  }

  private isRawEventInRecallScope(event: MemoryEvent, query: AgentRecallQuery, effectiveIntent?: AgentRecallIntent): boolean {
    // A turn that holds a secret is stored verbatim and marked, never redacted, so the default lanes
    // do not hand it back. A question about the words someone used still may — that is the caller's
    // explicit intent — and both outcomes are counted for the trace.
    if (eventHoldsSecretMark(event) && !FORENSIC_SOCIAL_EXEMPT_INTENTS.has(String(effectiveIntent ?? ''))) {
      SECRET_WITHHELD_EVENT_IDS.set(this, (SECRET_WITHHELD_EVENT_IDS.get(this) ?? new Set()).add(event.eventId));
      return false;
    }
    if (query.projectId !== undefined && (event.projectId ?? '') !== query.projectId) return false;
    if (query.workspaceId && event.workspaceId !== query.workspaceId) return false;
    if (query.threadId && event.threadId !== query.threadId) return false;
    if (!isAgentRawEvent(event, query.agentId)) return false;
    if (!this.isAllowedSession(event, query, effectiveIntent)) return false;
    if (!this.isAllowedRawEventCollection(event, query.collection)) return false;
    return true;
  }

  private isOperationalNoiseRawEvent(event: MemoryEvent): boolean {
    const payload = event.payload as { text?: unknown; metadata?: Record<string, unknown> };
    const tags = Array.isArray(payload.metadata?.tags) ? payload.metadata.tags : [];
    if (tags.some((tag) => (
      tag === 'operational_noise'
      || tag === 'record:heartbeat'
      || tag === 'system:heartbeat'
      || tag === 'routine:heartbeat'
    ))) {
      return true;
    }
    return isOperationalNoiseText(typeof payload.text === 'string' ? payload.text : JSON.stringify(event.payload));
  }

  private isAllowedSession(event: MemoryEvent, query: AgentRecallQuery, effectiveIntent: AgentRecallIntent | undefined = query.intent): boolean {
    if (query.excludeSessionId && event.sessionId === query.excludeSessionId) return false;
    if (query.sessionId && effectiveIntent && effectiveIntent !== 'memory_recall' && event.sessionId === query.sessionId) return false;
    return true;
  }

  private hasReadableEventText(event: MemoryEvent): boolean {
    const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
    return typeof payload.text === 'string'
      || typeof payload.output === 'string'
      || typeof payload.title === 'string';
  }

  private quoteEventPriority(event: MemoryEvent, queryPlan?: AgentRecallQueryPlan): number {
    const cuePenalty = queryPlan && this.rawEventCueScore(event, queryPlan) > 0 ? 0 : queryPlan ? 10 : 0;
    if (event.role === 'user') return cuePenalty;
    if (event.role === 'assistant') return cuePenalty + 1;
    return cuePenalty + 2;
  }

  private isQuoteSourceEvent(event: MemoryEvent): boolean {
    return event.role === 'user' || (!event.role && event.rawEventType === 'message');
  }

  private toAgentRawRecallItem(
    event: MemoryEvent,
    options: {
      sourceType: NonNullable<AgentRecallItem['sourceType']>;
      whyMatched: string;
      canAnswerExactQuote: boolean;
    }
  ): AgentRecallItem {
    const payload = event.payload as { text?: unknown; metadata?: Record<string, unknown> };
    const metadata = payload.metadata || {};
    const metadataTags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    const importedSummary = metadataTags.includes('governance:imported_summary_support')
      || metadataTags.includes('provenance:imported_summary')
      || metadataTags.includes('memory_layer:summary_seed')
      || metadata.reliabilityClass === 'imported_summary'
      || metadata.importedSummarySupport === true;
    const tags = [
      'raw_ledger',
      event.rawEventType ? `raw:${event.rawEventType}` : '',
      event.role ? `role:${event.role}` : '',
      event.sessionId ? `session:${event.sessionId}` : '',
      ...metadataTags,
    ].filter(Boolean);
    const sourceRef = metadata.sourceRef && typeof metadata.sourceRef === 'object'
      ? metadata.sourceRef as { sourcePath?: string }
      : undefined;
    return {
      id: event.eventId,
      text: typeof payload.text === 'string' ? payload.text : JSON.stringify(event.payload),
      projectId: event.projectId,
      tags,
      source: importedSummary ? (sourceRef?.sourcePath || event.sourceId || event.eventId) : event.eventId,
      sourceType: importedSummary ? 'imported_summary' : options.sourceType,
      sourceAnchor: this.toAgentSourceAnchor(event),
      sourceContext: this.toAgentSourceContext(event.eventId),
      confidence: importedSummary ? 0.45 : 1,
      whyMatched: importedSummary ? 'imported_summary_raw_source_fallback' : options.whyMatched,
      canAnswerExactQuote: importedSummary ? false : options.canAnswerExactQuote,
    };
  }

  private preferredRawSourceEventId(neuron: MemoryKernelNavigationResult['rawEvidence'][number]): string | undefined {
    if (!neuron.metadata.sourceEventId) return undefined;
    const context = this.kernel.getEventContext(neuron.metadata.sourceEventId, { before: 0, after: 0 });
    const payload = context?.event.payload as { sourceRefs?: unknown } | undefined;
    if (!payload || !Array.isArray(payload.sourceRefs)) return undefined;
    const refs = payload.sourceRefs.filter((item): item is MemorySourceRef => Boolean(item && typeof item === 'object'));
    const userRef = refs.find((ref) => ref.eventId && ref.role === 'user');
    return userRef?.eventId || refs.find((ref) => ref.eventId)?.eventId;
  }

  private toAgentSourceContext(eventId: string, scope?: AgentRecallQuery): AgentRecallSourceContext | undefined {
    const beforeCount = 2;
    const afterCount = 2;
    const context = this.kernel.getEventContext(eventId, { before: beforeCount, after: afterCount });
    if (!context) return undefined;
    const normalized = normalizeSourceContextWindow(context.event, context.before, context.after, {
      before: beforeCount,
      after: afterCount,
    });
    // The anchor was never checked and the scope test passes everything when no scope is given, which is how a
    // marked turn came back inside another item's window with its text intact (#142, second measurement) — the
    // key arrived even though the raw lane had already withheld the event itself. A marked event is therefore
    // excluded from a window by default, and only an exempt (forensic / exact-quote) intent may see it; the by-id
    // read does not come through here at all, so it stays whole.
    const secretExempt = Boolean(scope && FORENSIC_SOCIAL_EXEMPT_INTENTS.has(String(scope.intent ?? '')));
    if (eventHoldsSecretMark(context.event) && !secretExempt) return undefined;
    const event = this.toAgentSourceContextEvent(context.event);
    const inScope = (candidate: MemoryEvent) => {
      if (!secretExempt && eventHoldsSecretMark(candidate)) return false;
      return !scope || (isAgentRawEvent(candidate, scope.agentId) && this.isRawEventInRecallScope(candidate, scope, scope.intent));
    };
    return {
      event,
      before: normalized.before.filter(inScope).map((item) => this.toAgentSourceContextEvent(item)),
      after: normalized.after.filter(inScope).map((item) => this.toAgentSourceContextEvent(item)),
      parent: context.parent && inScope(context.parent) ? this.toAgentSourceContextEvent(context.parent) : undefined,
      children: context.children.filter(inScope).map((item) => this.toAgentSourceContextEvent(item)),
      window: normalized.window,
      locator: {
        eventId: event.eventId,
        globalSeq: event.globalSeq,
        projectId: event.projectId,
        command: `cogmem memory show --event ${cliArg(event.eventId)}${event.projectId ? ` --project ${cliArg(event.projectId)}` : ''} --before 2 --after 2 --json`,
        contextCommand: `cogmem memory show --event ${cliArg(event.eventId)}${event.projectId ? ` --project ${cliArg(event.projectId)}` : ''} --before 3 --after 3 --json`,
        threadId: event.threadId,
        sessionId: event.sessionId,
        localDate: event.localDate,
      },
    };
  }

  private toAgentSourceContextEvent(event: MemoryEvent): AgentRecallSourceContextEvent {
    const text = this.eventText(event);
    return {
      eventId: event.eventId,
      globalSeq: event.globalSeq,
      label: memoryEventLabel(event),
      role: event.role,
      rawEventType: event.rawEventType,
      eventType: event.eventType,
      projectId: event.projectId,
      workspaceId: event.workspaceId,
      threadId: event.threadId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      threadSeq: event.threadSeq,
      turnSeq: event.turnSeq,
      eventOrdinal: event.eventOrdinal,
      occurredAt: event.occurredAt,
      localDate: event.localDate,
      charRange: memoryEventCharRange(event),
      sourceRange: memoryEventSourceRange(event),
      textLength: text.length,
      text,
    };
  }

  private toAgentSourceAnchorFromContextEvent(event: AgentRecallSourceContextEvent): AgentRecallSourceAnchor {
    return {
      eventId: event.eventId,
      threadId: event.threadId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      role: event.role,
      threadSeq: event.threadSeq,
      turnSeq: event.turnSeq,
      eventOrdinal: event.eventOrdinal,
    };
  }

  private toAgentSourceAnchor(event: MemoryEvent): AgentRecallSourceAnchor {
    return {
      eventId: event.eventId,
      threadId: event.threadId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      role: event.role,
      threadSeq: event.threadSeq,
      turnSeq: event.turnSeq,
      eventOrdinal: event.eventOrdinal,
      parentEventId: event.parentEventId,
      prevEventId: event.prevEventId,
      nextEventId: event.nextEventId,
      causalityType: event.causalityType,
      orderingConfidence: event.orderingConfidence,
    };
  }

  private toSourceRef(event: MemoryEvent, sourceId: string): MemorySourceRef {
    return {
      eventId: event.eventId,
      eventType: event.rawEventType || event.eventType,
      sourceId,
      contentHash: event.contentHash,
      threadId: event.threadId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      role: event.role,
      threadSeq: event.threadSeq,
      turnSeq: event.turnSeq,
      eventOrdinal: event.eventOrdinal,
      parentEventId: event.parentEventId,
      prevEventId: event.prevEventId,
      nextEventId: event.nextEventId,
      causalityType: event.causalityType,
      orderingConfidence: event.orderingConfidence,
    };
  }

  private eventText(event: MemoryEvent): string {
    const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.output === 'string') return payload.output;
    if (typeof payload.title === 'string') return payload.title;
    return JSON.stringify(event.payload);
  }

  private buildAssociativeItems(query: AgentRecallQuery, direct: AgentRecallItem[], touchedAt: number): AgentRecallItem[] {
    const seen = new Set<string>();
    const out: AgentRecallItem[] = [];
    const directNeuronIds = direct
      .filter((item) => item.sourceType === 'compiled_memory' || item.sourceType === 'imported_summary')
      .map((item) => item.id);

    for (const neuronId of directNeuronIds) {
      const synapses = this.kernel.memoryGraph.getSynapses(neuronId).sort((a, b) => b.weight - a.weight);
      for (const synapse of synapses) {
        if (synapse.targetId === neuronId) continue;
        if (seen.has(synapse.targetId)) continue;
        const neuron = this.kernel.memoryGraph.getNeuron(synapse.targetId);
        if (!neuron) continue;
        if (this.filterAgentEvidence([neuron], query.agentId, query.collection, query.excludeSessionId).length === 0) continue;
        this.kernel.activationStore.touch({
          neuronId: neuron.id,
          projectId: neuron.metadata.projectId || query.projectId,
          delta: Math.max(0.1, synapse.weight * 0.5),
          source: `recall_pack:${synapse.type}`,
          touchedAt,
        });
        out.push(this.toAgentRecallItem(neuron));
        seen.add(neuron.id);
        if (out.length >= 4) return out;
      }
    }

    const hotspots = this.kernel.activationStore.getTop({
      projectId: query.projectId,
      limit: 8,
      excludeNeuronIds: uniqueNonEmpty([...direct.map((item) => item.id), ...seen]),
    });
    for (const hotspot of hotspots) {
      const neuron = this.kernel.memoryGraph.getNeuron(hotspot.neuronId);
      if (!neuron) continue;
      if (this.filterAgentEvidence([neuron], query.agentId, query.collection, query.excludeSessionId).length === 0) continue;
      out.push(this.toAgentRecallItem(neuron));
      seen.add(neuron.id);
      if (out.length >= 4) return out;
    }

    return out;
  }

  private buildEntityCards(query: AgentRecallQuery): AgentRecallEntityCard[] {
    const cards = new Map<string, AgentRecallEntityCard>();
    for (const candidate of this.entityLookupCandidates(query.query)) {
      const entity = this.kernel.entityStore.findByAlias(candidate, undefined, query.projectId);
      if (!entity || cards.has(entity.entityId)) continue;
      const mentions = this.kernel.entityStore.listTimeline({
        entityId: entity.entityId,
        projectId: query.projectId,
        limit: 6,
      });
      const attributes = this.kernel.entityStore.listAttributes(entity.entityId, undefined, query.projectId).slice(0, 8);
      cards.set(entity.entityId, {
        entityId: entity.entityId,
        canonicalName: entity.canonicalName,
        type: entity.type,
        aliases: entity.aliases,
        attributes: attributes.map((attribute) => ({
          key: attribute.attributeKey,
          value: attribute.attributeValue,
          updatedAt: attribute.updatedAt,
        })),
        recentMentions: mentions.map((mention) => ({
          neuronId: mention.neuronId,
          projectId: mention.projectId,
          mentionType: mention.mentionType,
          createdAt: mention.createdAt,
        })),
      });
      if (cards.size >= 4) break;
    }
    return Array.from(cards.values());
  }

  private buildBeliefTouches(query: AgentRecallQuery): AgentRecallBeliefTouch[] {
    const beliefs = this.kernel.beliefStore.getActiveBeliefsForQuery({
      query: query.query,
      projectId: query.projectId,
      limit: 6,
      intent: 'recall',
    });
    const history = this.kernel.beliefStore.getBeliefHistoryForCanonicalKeys(
      beliefs.map((belief) => belief.canonicalKey),
      { projectId: query.projectId, limitPerCanonical: 8 },
    );
    return beliefs.map((belief) => {
      const alternatives = history.get(belief.canonicalKey) || [];
      return {
        beliefId: belief.id,
        subject: belief.subject,
        predicate: belief.predicate,
        objectValue: belief.objectValue.normalized || belief.objectValue.raw,
        confidence: belief.confidence,
        trustScore: belief.trustScore,
        status: belief.status,
        supportCount: alternatives.filter((item) => item.status === 'active' || item.status === 'superseded').length,
        conflictCount: alternatives.filter((item) => item.status === 'suspect' || item.contradictionGroup).length,
        explanation: belief.explanation,
      };
    });
  }

  private entityLookupCandidates(query: string): string[] {
    const tokens = query
      .split(/[\s,，。！？、:：?？!！/]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    return uniqueNonEmpty([
      query.trim(),
      ...tokens,
      ...tokens.flatMap((token, index) => {
        const next = tokens[index + 1];
        return next ? [`${token} ${next}`] : [];
      }),
    ]);
  }

  private metadataWithCollection(
    metadata: Record<string, unknown> | undefined,
    collection: string | undefined
  ): Record<string, unknown> | undefined {
    const collectionTags = this.collectionTags(collection);
    if (collectionTags.length === 0) return metadata;
    const existingTags = Array.isArray(metadata?.tags)
      ? metadata!.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    return {
      ...(metadata || {}),
      collection: this.normalizeCollection(collection),
      tags: uniqueNonEmpty([...existingTags, ...collectionTags]),
    };
  }

  private collectionTags(collection: string | undefined): string[] {
    const normalized = this.normalizeCollection(collection);
    return normalized ? [`collection:${normalized}`] : [];
  }

  private normalizeCollection(collection: string | undefined): string | undefined {
    const normalized = String(collection || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
    return normalized || undefined;
  }

  private isAllowedRawEventCollection(event: MemoryEvent, collection: string | undefined): boolean {
    const payload = event.payload && typeof event.payload === 'object'
      ? event.payload as { metadata?: Record<string, unknown> }
      : {};
    const tags = Array.isArray(payload.metadata?.tags)
      ? payload.metadata.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    return this.isAllowedCollectionTags(tags, collection);
  }

  private isAllowedCollectionTags(tags: string[], collection: string | undefined): boolean {
    const collectionTags = tags.filter((tag) => tag.startsWith('collection:'));
    const requested = this.normalizeCollection(collection);
    if (requested) {
      if (requested === 'anchor' && collectionTags.length === 0) return true;
      return collectionTags.includes(`collection:${requested}`);
    }
    return collectionTags.length === 0 || collectionTags.includes('collection:anchor');
  }

  private shouldCompileTurn(
    mode: AgentTurnIngestMode,
    content: string,
  ): { compile: boolean; reason: AgentTurnCompileReason } {
    if (mode === 'immediate_compile') return { compile: true, reason: 'immediate_compile' };
    if (mode === 'raw_archive_only') return { compile: false, reason: 'raw_archive_only' };
    if (mode === 'raw_then_dream') return { compile: false, reason: 'raw_then_dream' };
    if (this.hasDurableTurnSignal(content)) return { compile: true, reason: 'durable_signal_detected' };
    return { compile: false, reason: 'low_signal_turn' };
  }

  private hasDurableTurnSignal(content: string): boolean {
    const normalized = content.toLowerCase();
    const durableSignals = [
      /重要/,
      /记住/,
      /以后/,
      /长期/,
      /偏好/,
      /不要/,
      /禁止/,
      /必须/,
      /约束/,
      /边界/,
      /目标/,
      /纠正/,
      /更正/,
      /推翻/,
      /失败/,
      /成功/,
      /教训/,
      /流程/,
      /决定/,
      /架构/,
      /原则/,
      /preference/,
      /remember/,
      /important/,
      /always/,
      /never/,
      /must/,
      /do not/,
      /constraint/,
      /goal/,
      /correction/,
      /supersede/,
      /failure/,
      /lesson/,
      /decision/,
      /architecture/,
      /boundary/,
    ];
    return durableSignals.some((signal) => signal.test(normalized));
  }
}

/**
 * Per backend instance, never global: document frequency describes one database, and a daemon serving
 * two of them must not answer the second with the first one's counts.
 */
const RAW_TERM_DF_CACHE = new WeakMap<object, Map<string, number>>();
const FREQUENT_TERM_MIN = 3;
const DISCRIMINATIVE_TERM_BUDGET = 8;

function discriminativeProbesOf(text: string): string[] {
  const probes = new Set<string>();
  for (const run of text.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let index = 0; index + 1 < run.length; index += 1) probes.add(run.slice(index, index + 2));
    if (run.length > 1) probes.add(run);
  }
  for (const word of text.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? []) probes.add(word.toLowerCase());
  for (const digits of text.match(/\d+/g) ?? []) probes.add(digits);
  return [...probes];
}

/**
 * Whether every word an item shares with the question is small talk.
 *
 * This is defence 3's decision, and defence 4's for a grey query. Frequency alone is not evidence: an
 * answer deliberately worded like seven others overlaps its question only through common words, and
 * discarding on frequency alone suppressed exactly that answer. So a hit is dropped only when the
 * whole overlap is both frequent in this project and part of the shared pleasantry vocabulary.
 */
export function overlapIsOnlySmallTalk(overlap: string[], frequent: Set<string>): boolean {
  return overlap.length > 0 && overlap.every((term) => frequent.has(term) && isFillerProbe(term));
}

/**
 * The probes a question is reduced to for the discriminator check: CJK bigrams and whole runs, latin
 * words, numbers. The index matches consecutive characters, so a bigram is a valid probe.
 */
export function discriminativeProbes(text: string): string[] {
  return discriminativeProbesOf(text);
}

/**
 * The characters a pack's pleasantry vocabulary is made of, built once per pack.
 *
 * Keyed by the token array itself, so switching languages does not rebuild the set and the two packs cannot
 * collide.
 */
const FILLER_CHARACTERS_BY_PACK = new WeakMap<readonly string[], Set<string>>();
function fillerCharacters(tokens: readonly string[]): Set<string> {
  let characters = FILLER_CHARACTERS_BY_PACK.get(tokens);
  if (!characters) {
    characters = new Set(tokens.join(''));
    FILLER_CHARACTERS_BY_PACK.set(tokens, characters);
  }
  return characters;
}

/**
 * Whether a probe is made only of pleasantry characters — the shape a social overlap has.
 *
 * Character-level rather than token-level because the probes are n-grams: 「的收」 is a bigram of
 * 「好的收到」 and every character in it comes from the pleasantry vocabulary. A content character never
 * qualifies, which is what keeps an answer out of this rule.
 *
 * The vocabulary is read here, at call time (#174), not frozen into a module constant at import. The constant
 * was built before `MemoryKernel`'s constructor called `setConfiguredLanguage`, so in an `en` project this half
 * of the judgement token-checked against the Chinese pack while `classifySocialTurn` — which reads the pack per
 * call — used English.
 */
function isFillerProbe(probe: string): boolean {
  if (probe.length === 0) return false;
  const tokens = socialTurnResources().fillerTokens;
  // Token coverage first, which is what keeps a latin word safe: 「later」 and 「ty」 contribute the
  // letters of 「retry」 to the character set, so a character test alone would call a content word
  // small talk.
  let rest = probe;
  for (const token of tokens) {
    while (rest.includes(token)) rest = rest.split(token).join('');
  }
  if (rest.length === 0) return true;
  // Then CJK n-grams, where the probes are bigrams of pleasantries like 「好的收到」 and the individual
  // characters are what can be checked. Never applied to a probe holding a non-CJK character.
  return /^\p{Script=Han}+$/u.test(probe) && [...probe].every((character) => fillerCharacters(tokens).has(character));
}

/**
 * The raw events a running recall withheld because they carry the secret mark (#142), by id.
 *
 * A set rather than a counter: the trace has to name the withheld entries (#187), and the lane can
 * reach the same event through more than one search text. Reset at the top of every recall, so it
 * never describes a previous one.
 */
const SECRET_WITHHELD_EVENT_IDS = new WeakMap<object, Set<string>>();

/** How many index hits a zero-result explanation samples: enough to tell scope from absence. */
const ZERO_EXPLANATION_SAMPLE = 25;

/** Turn metadata without the conversation-text secret marks: those belong to their own event. */
function omitSecretFindings(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const { secretFindings, secretFindingsAssistant, ...rest } = metadata as Record<string, unknown> & {
    secretFindings?: unknown; secretFindingsAssistant?: unknown;
  };
  if (secretFindingsAssistant !== undefined) rest.secretFindings = secretFindingsAssistant;
  return rest;
}

/** Intents that explicitly ask for words as they were said: those may reach social entries. */
const FORENSIC_SOCIAL_EXEMPT_INTENTS = new Set(['forensic_quote', 'exact_quote']);

/** Fold a new suppression breakdown into whatever the lane trace already carried. */
function mergeSuppressions(
  existing: Array<{ reason: RecallSuppressionReason; count: number }> | undefined,
  added: Array<{ reason: RecallSuppressionReason; count: number }>,
): Array<{ reason: RecallSuppressionReason; count: number }> {
  const merged = [...(existing ?? [])];
  for (const entry of added) {
    const found = merged.find((item) => item.reason === entry.reason);
    if (found) found.count += entry.count;
    else merged.push({ ...entry });
  }
  return merged;
}

/**
 * The trace's suppression list: the lane trace's counts, with the ids the gates kept (#187).
 *
 * A reason can be counted without an id — the raw lane drops secret-marked events before any item
 * exists — so an entry with a count and no ids is the honest answer, not a missing one. Ids are only
 * ever added, never turned into a second count.
 */
function suppressionsForTrace(
  suppressed: Array<{ reason: RecallSuppressionReason; count: number }> | undefined,
  byId: RecallTraceSuppression[],
): RecallTraceSuppression[] | undefined {
  const merged = new Map<string, RecallTraceSuppression>();
  for (const entry of suppressed ?? []) merged.set(entry.reason, { reason: entry.reason, count: entry.count });
  for (const entry of byId) {
    if (entry.ids?.length) {
      const existing = merged.get(entry.reason);
      if (existing) existing.ids = [...(existing.ids ?? []), ...entry.ids];
      else merged.set(entry.reason, { reason: entry.reason, count: entry.ids.length, ids: [...entry.ids] });
    }
  }
  return merged.size ? [...merged.values()] : undefined;
}

function recallDecisionTrace(
  selectedLane: AgentRecallDecisionTrace['selectedLane'],
  reason: AgentRecallDecisionTrace['reason'],
  candidateCounts: AgentRecallDecisionTrace['candidateCounts'],
  selectedCount: number,
): AgentRecallDecisionTrace {
  return {
    version: 'agent_recall_decision.v1',
    selectedLane,
    reason,
    candidateCounts,
    selectedCount,
  };
}

function recallDecisionTraceForSelection(
  graphItems: AgentRecallItem[],
  selectedItems: AgentRecallItem[],
  nonGraphLane: AgentRecallDecisionTrace['selectedLane'],
  nonGraphReason: AgentRecallDecisionTrace['reason'],
  candidateCounts: AgentRecallDecisionTrace['candidateCounts'],
): AgentRecallDecisionTrace {
  const graphIds = new Set(graphItems.map((item) => item.id));
  const graphSelected = selectedItems.filter((item) => graphIds.has(item.id)).length;
  if (graphSelected > 0 && graphSelected === selectedItems.length) {
    return recallDecisionTrace('graph', 'graph_selected', candidateCounts, selectedItems.length);
  }
  if (graphSelected > 0) {
    return recallDecisionTrace('mixed', nonGraphReason, candidateCounts, selectedItems.length);
  }
  return recallDecisionTrace(nonGraphLane, nonGraphReason, candidateCounts, selectedItems.length);
}

function uniqueNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function laneAllowed(policy: StrategyRetrievalPolicy | undefined, lane: StrategyRetrievalPolicy['allowedLanes'][number]): boolean {
  return !policy || policy.allowedLanes.includes(lane);
}

function localDateCue(query: string, options: Pick<AgentRecallQuery, 'now' | 'localDateNow' | 'timeZone'> = {}): string | undefined {
  const currentYear = localYear(options);
  const iso = query.match(/(20\d{2})[-年\/.](\d{1,2})[-月\/.](\d{1,2})日?/);
  if (iso) return `${iso[1]}-${padDatePart(Number(iso[2]))}-${padDatePart(Number(iso[3]))}`;
  const cn = query.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})(?:号|日)?/);
  if (cn) return `${cn[1] || currentYear}-${padDatePart(Number(cn[2]))}-${padDatePart(Number(cn[3]))}`;
  return undefined;
}

function localYear(options: Pick<AgentRecallQuery, 'now' | 'localDateNow' | 'timeZone'>): number {
  const explicit = options.localDateNow?.match(/^(20\d{2})-\d{2}-\d{2}$/u)?.[1];
  if (explicit) return Number(explicit);
  return Number(localDateFor(options.now ?? Date.now(), resolveTimeZone(options.timeZone)).slice(0, 4));
}

function padDatePart(value: number): string {
  return pad2(value);
}

/**
 * Mark an item whose text has been through redaction, without touching the text.
 * A caller that cannot see the difference between what was written and what it was
 * given will quote the marker back as if it were the value (#115).
 */
function withRedactionMarks(item: AgentRecallItem): AgentRecallItem {
  const redaction = readRedactionMarks(item.text);
  return redaction.count > 0 ? { ...item, redaction } : item;
}
