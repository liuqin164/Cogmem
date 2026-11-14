/**
 * Delivery routing (#195, F18): the last mile between F6's candidates and F12's channels.
 *
 * The router is deterministic. It reads only signals that already exist — F6's candidate freshness
 * and sensitivity, F8's resolved occasion, F2's user state, F12's reachability/interruptibility and
 * F7's feedback level — and returns one decision with a readable trace. It holds no queue and no
 * timer: a shell calls `route`/`routeBatch` at the moment it is deciding, and the batch result names
 * what a morning summary would contain.
 *
 * The contract is `docs/delivery-routing.md`, held by
 * `__tests__/delivery-routing.contract.test.ts`.
 */
import {
  CHANNEL_INTERRUPTIBILITY,
  CHANNEL_REACHABILITY_STATES,
  CHANNEL_SURFACING_STRENGTHS,
  type ChannelInterruptibility,
  type ChannelReachability,
  type ChannelSurfacingStrength,
} from '../channel/index.js';
import { OCCASIONS, type Occasion } from '../occasion/index.js';
import {
  SENSITIVITY_TIERS,
  SURFACING_SOURCES,
  type SensitivityTier,
  type SurfacingCandidate,
  type SurfacingFeedback,
  type SurfacingSource,
} from '../surfacing/index.js';

/** Bump when a field, rule, destination or error meaning changes incompatibly. */
export const DELIVERY_CONTRACT_VERSION = 1;
export const DELIVERY_DECISION_VERSION = 'delivery_route_decision.v1';

/** The urgency grades the router derives from F6's existing fields. Frozen. */
export const DELIVERY_URGENCY_TIERS = ['high', 'normal', 'low'] as const;
export type DeliveryUrgency = (typeof DELIVERY_URGENCY_TIERS)[number];

/** F2's user state at the decision instant. Frozen. */
export const DELIVERY_USER_STATES = ['in-conversation', 'idle', 'night-dnd'] as const;
export type DeliveryUserState = (typeof DELIVERY_USER_STATES)[number];

/** What the router decided. Frozen. */
export const DELIVERY_DECISIONS = ['deliver', 'accumulate', 'suppress'] as const;
export type DeliveryDecisionKind = (typeof DELIVERY_DECISIONS)[number];

/** Where an accumulated candidate is held. Frozen. */
export const DELIVERY_DESTINATIONS = ['current-channel', 'next-contact', 'morning-summary', 'none'] as const;
export type DeliveryDestination = (typeof DELIVERY_DESTINATIONS)[number];

/** The readable reason codes. Frozen; the document's rules table is the source. */
export const DELIVERY_REASONS = [
  'feedback_stopped',
  'high_sensitivity_shared_surface',
  'channel_offline',
  'night_quiet',
  'urgent_in_conversation',
  'natural_contact',
  'idle_no_active_channel',
  'night_highest_urgency',
  'channel_not_interruptible',
  'not_urgent',
] as const;
export type DeliveryReason = (typeof DELIVERY_REASONS)[number];

/** F6 sources whose arrival is a reason to speak. Frozen. */
export const DELIVERY_URGENT_SOURCES = ['wake-intention', 'prospective-memory', 'commitment'] as const;

/** A candidate at or above this confidence is `normal` when its source is not urgent. Frozen. */
export const DELIVERY_NORMAL_CONFIDENCE = 0.85;

/** F7's level cap. Frozen by `docs/surfacing-feedback.md`. */
export const DELIVERY_FEEDBACK_MAX_LEVEL = 3;

/**
 * F7's downgrade, read only on the proactive path. Level 0 leaves the derived urgency alone; each
 * further level lowers it, and level 2 or 3 bottoms out at `low`.
 */
export const DELIVERY_URGENCY_DOWNGRADE: Readonly<
  Record<number, Readonly<Record<DeliveryUrgency, DeliveryUrgency>>>
> = {
  0: { high: 'high', normal: 'normal', low: 'low' },
  1: { high: 'normal', normal: 'low', low: 'low' },
  2: { high: 'low', normal: 'low', low: 'low' },
  3: { high: 'low', normal: 'low', low: 'low' },
};

export const DELIVERY_DECISION_FIELDS = [
  'candidateId',
  'decision',
  'destination',
  'strength',
  'urgency',
  'effectiveUrgency',
  'reason',
  'reasonCode',
  'decisionTrace',
] as const;
export const DELIVERY_INPUT_FIELDS = [
  'candidate.urgency',
  'candidate.sensitivity',
  'occasion',
  'userState',
  'channel.reachability',
  'channel.interruptibility',
  'feedback.level',
  'feedback.stopped',
] as const;
export const DELIVERY_TRACE_FIELDS = ['version', 'reason', 'steps'] as const;
export const DELIVERY_STEP_FIELDS = ['rule', 'outcome', 'detail'] as const;
export const DELIVERY_BATCH_FIELDS = ['decisions', 'accumulated', 'nextContact', 'morningSummary'] as const;

/** The face's methods. Frozen. */
export const DELIVERY_API_METHODS = ['route', 'routeBatch'] as const;

/** The refusals this face names. Frozen. */
export const DELIVERY_ERROR_CODES = [
  'invalid_delivery_candidate',
  'invalid_delivery_user_state',
  'invalid_delivery_occasion',
  'invalid_delivery_channel',
  'invalid_delivery_feedback',
  'invalid_delivery_now',
] as const;
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

export type DeliveryCandidateInput = Pick<
  SurfacingCandidate,
  'candidateId' | 'source' | 'sensitivity' | 'freshness' | 'confidence'
>;

export interface DeliveryChannelInput {
  reachability: ChannelReachability;
  interruptibility: ChannelInterruptibility;
}

export interface DeliveryFeedbackInput {
  level: number;
  stopped: boolean;
}

export interface DeliveryRouteInput {
  candidate: DeliveryCandidateInput;
  occasion: Occasion;
  userState: DeliveryUserState;
  channel: DeliveryChannelInput;
  feedback?: DeliveryFeedbackInput;
  now?: number;
}

export interface DeliveryRouteQuery extends DeliveryRouteInput {
  projectId: string;
}

export interface DeliveryDecisionStep {
  rule: string;
  outcome: string;
  detail: Record<string, unknown>;
}

export interface DeliveryDecisionTrace {
  version: typeof DELIVERY_DECISION_VERSION;
  reason: string;
  steps: DeliveryDecisionStep[];
}

export interface DeliveryDecision {
  candidateId: string;
  decision: DeliveryDecisionKind;
  destination: DeliveryDestination;
  strength: ChannelSurfacingStrength;
  urgency: DeliveryUrgency;
  effectiveUrgency: DeliveryUrgency;
  /** The decision trace's reason string. */
  reason: string;
  reasonCode: DeliveryReason;
  decisionTrace: DeliveryDecisionTrace;
}

export interface DeliveryBatchInput {
  candidates: readonly DeliveryCandidateInput[];
  occasion: Occasion;
  userState: DeliveryUserState;
  channel: DeliveryChannelInput;
  feedbackFor?: (candidate: DeliveryCandidateInput) => DeliveryFeedbackInput | undefined;
  now?: number;
}

export interface DeliveryBatchQuery extends DeliveryBatchInput {
  projectId: string;
}

export interface DeliveryBatchResult {
  decisions: DeliveryDecision[];
  accumulated: string[];
  nextContact: string[];
  morningSummary: string[];
}

function deliveryError(code: DeliveryErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return (values as readonly unknown[]).includes(value);
}

function validateCandidate(candidate: DeliveryCandidateInput): void {
  if (!candidate || typeof candidate !== 'object') {
    throw deliveryError('invalid_delivery_candidate');
  }
  if (typeof candidate.candidateId !== 'string' || candidate.candidateId.trim() === '') {
    throw deliveryError('invalid_delivery_candidate', 'candidateId must be non-empty');
  }
  if (!isOneOf(SURFACING_SOURCES, candidate.source)) {
    throw deliveryError('invalid_delivery_candidate', `source must be one of ${SURFACING_SOURCES.join(', ')}`);
  }
  if (!isOneOf(SENSITIVITY_TIERS, candidate.sensitivity)) {
    throw deliveryError('invalid_delivery_candidate', `sensitivity must be one of ${SENSITIVITY_TIERS.join(', ')}`);
  }
  if (!candidate.freshness || !Number.isFinite(candidate.freshness.ageMs) || typeof candidate.freshness.expired !== 'boolean') {
    throw deliveryError('invalid_delivery_candidate', 'freshness must carry ageMs and expired');
  }
  if (!Number.isFinite(candidate.confidence)) {
    throw deliveryError('invalid_delivery_candidate', 'confidence must be finite');
  }
}

function validateInput(input: DeliveryRouteInput): void {
  validateCandidate(input.candidate);
  if (!isOneOf(OCCASIONS, input.occasion)) {
    throw deliveryError('invalid_delivery_occasion', `occasion must be one of ${OCCASIONS.join(', ')}`);
  }
  if (!isOneOf(DELIVERY_USER_STATES, input.userState)) {
    throw deliveryError('invalid_delivery_user_state', `userState must be one of ${DELIVERY_USER_STATES.join(', ')}`);
  }
  if (!input.channel || !isOneOf(CHANNEL_REACHABILITY_STATES, input.channel.reachability)) {
    throw deliveryError('invalid_delivery_channel', `reachability must be one of ${CHANNEL_REACHABILITY_STATES.join(', ')}`);
  }
  if (!isOneOf(CHANNEL_INTERRUPTIBILITY, input.channel.interruptibility)) {
    throw deliveryError('invalid_delivery_channel', `interruptibility must be one of ${CHANNEL_INTERRUPTIBILITY.join(', ')}`);
  }
  if (input.feedback !== undefined) {
    if (!Number.isInteger(input.feedback.level) || input.feedback.level < 0) {
      throw deliveryError('invalid_delivery_feedback', 'level must be a non-negative integer');
    }
    if (typeof input.feedback.stopped !== 'boolean') {
      throw deliveryError('invalid_delivery_feedback', 'stopped must be a boolean');
    }
  }
  if (input.now !== undefined && !Number.isFinite(input.now)) {
    throw deliveryError('invalid_delivery_now');
  }
}

/**
 * F6's existing fields decide urgency. A due/arrived intention, prospective memory or commitment
 * is `high`; an upcoming one, or a candidate at the normal-confidence line, is `normal`; everything
 * else is `low`. No new judgement is introduced.
 */
export function deriveDeliveryUrgency(candidate: DeliveryCandidateInput): DeliveryUrgency {
  const urgentSource = (DELIVERY_URGENT_SOURCES as readonly string[]).includes(candidate.source);
  const due = candidate.freshness.ageMs >= 0 && !candidate.freshness.expired;
  if (urgentSource && due) return 'high';
  if (urgentSource || candidate.confidence >= DELIVERY_NORMAL_CONFIDENCE) return 'normal';
  return 'low';
}

/** F7's level lowers the derived urgency. Frozen by the downgrade table above. */
export function downgradeDeliveryUrgency(urgency: DeliveryUrgency, level: number): DeliveryUrgency {
  const bounded = Math.max(0, Math.min(DELIVERY_FEEDBACK_MAX_LEVEL, Math.trunc(level)));
  return DELIVERY_URGENCY_DOWNGRADE[bounded]![urgency];
}

function traceOf(steps: DeliveryDecisionStep[]): DeliveryDecisionTrace {
  return {
    version: DELIVERY_DECISION_VERSION,
    reason: steps.map((step) => `${step.rule}=${step.outcome}`).join('; '),
    steps,
  };
}

/**
 * The whole routing rule. Precedence is the document's rules table: feedback stop, high-sensitivity
 * shared surface, channel reachability, the night window, then the user state.
 */
export function routeDelivery(input: DeliveryRouteInput): DeliveryDecision {
  validateInput(input);
  const { candidate, occasion, userState, channel } = input;
  const urgency = deriveDeliveryUrgency(candidate);
  const level = input.feedback?.level ?? 0;
  const stopped = input.feedback?.stopped ?? false;
  const effectiveUrgency = downgradeDeliveryUrgency(urgency, level);

  let decision: DeliveryDecisionKind;
  let destination: DeliveryDestination;
  let strength: ChannelSurfacingStrength;
  let reasonCode: DeliveryReason;

  if (stopped) {
    decision = 'suppress';
    destination = 'none';
    strength = 'silence';
    reasonCode = 'feedback_stopped';
  } else if (candidate.sensitivity === 'high' && occasion !== 'private') {
    decision = 'suppress';
    destination = 'none';
    strength = 'silence';
    reasonCode = 'high_sensitivity_shared_surface';
  } else if (channel.reachability === 'offline') {
    decision = 'accumulate';
    destination = 'next-contact';
    strength = 'incidental';
    reasonCode = 'channel_offline';
  } else if (userState === 'night-dnd' && effectiveUrgency !== 'high') {
    decision = 'accumulate';
    destination = 'morning-summary';
    strength = 'incidental';
    reasonCode = 'night_quiet';
  } else if (userState === 'in-conversation') {
    if (effectiveUrgency === 'high' && channel.interruptibility !== 'low') {
      decision = 'deliver';
      destination = 'current-channel';
      strength = 'proactive';
      reasonCode = 'urgent_in_conversation';
    } else if (effectiveUrgency === 'normal' && channel.interruptibility !== 'low') {
      decision = 'deliver';
      destination = 'current-channel';
      strength = 'incidental';
      reasonCode = 'natural_contact';
    } else if (effectiveUrgency === 'high') {
      decision = 'accumulate';
      destination = 'next-contact';
      strength = 'incidental';
      reasonCode = 'channel_not_interruptible';
    } else {
      decision = 'accumulate';
      destination = 'next-contact';
      strength = 'incidental';
      reasonCode = 'not_urgent';
    }
  } else if (userState === 'idle') {
    decision = 'accumulate';
    destination = 'next-contact';
    strength = 'incidental';
    reasonCode = effectiveUrgency === 'high' ? 'idle_no_active_channel' : 'not_urgent';
  } else if (channel.interruptibility !== 'low') {
    decision = 'deliver';
    destination = 'current-channel';
    strength = 'proactive';
    reasonCode = 'night_highest_urgency';
  } else {
    decision = 'accumulate';
    destination = 'morning-summary';
    strength = 'incidental';
    reasonCode = 'channel_not_interruptible';
  }

  const steps: DeliveryDecisionStep[] = [
    {
      rule: 'sensitivity',
      outcome: candidate.sensitivity,
      detail: {
        tier: candidate.sensitivity,
        occasion,
        sharedSurface: occasion !== 'private',
        highSensitivityShared: candidate.sensitivity === 'high' && occasion !== 'private',
      },
    },
    {
      rule: 'feedback',
      outcome: stopped ? 'stopped' : level > 0 ? 'downgraded' : 'none',
      detail: { level, stopped, urgency, effectiveUrgency },
    },
    {
      rule: 'reachability',
      outcome: channel.reachability,
      detail: { reachability: channel.reachability, interruptibility: channel.interruptibility },
    },
    {
      rule: 'user_state',
      outcome: userState,
      detail: { userState },
    },
    {
      rule: 'route',
      outcome: decision,
      detail: {
        decision,
        destination,
        strength,
        reason: reasonCode,
        urgency,
        effectiveUrgency,
      },
    },
  ];
  const decisionTrace = traceOf(steps);
  return {
    candidateId: candidate.candidateId,
    decision,
    destination,
    strength,
    urgency,
    effectiveUrgency,
    reason: decisionTrace.reason,
    reasonCode,
    decisionTrace,
  };
}

/** Route a batch and name what a next contact or the morning summary would carry. */
export function routeDeliveryBatch(input: DeliveryBatchInput): DeliveryBatchResult {
  const decisions = input.candidates.map((candidate) => routeDelivery({
    candidate,
    occasion: input.occasion,
    userState: input.userState,
    channel: input.channel,
    feedback: input.feedbackFor?.(candidate),
    now: input.now,
  }));
  return {
    decisions,
    accumulated: decisions.filter((entry) => entry.decision === 'accumulate').map((entry) => entry.candidateId),
    nextContact: decisions.filter((entry) => entry.destination === 'next-contact').map((entry) => entry.candidateId),
    morningSummary: decisions.filter((entry) => entry.destination === 'morning-summary').map((entry) => entry.candidateId),
  };
}

/**
 * The kernel face. It reads F7's state for the candidate's source type; a caller may pass an
 * explicit `feedback` override, which is what a pure routing test uses.
 */
export class DeliveryRouter {
  constructor(private readonly feedback?: SurfacingFeedback) {}

  route(input: DeliveryRouteQuery): DeliveryDecision {
    return routeDelivery({
      ...input,
      feedback: input.feedback ?? this.feedbackOf(input),
    });
  }

  routeBatch(input: DeliveryBatchQuery): DeliveryBatchResult {
    const feedbackFor = input.feedbackFor
      ?? ((candidate: DeliveryCandidateInput) => this.feedbackOf({ ...input, candidate }));
    return routeDeliveryBatch({ ...input, feedbackFor });
  }

  private feedbackOf(query: DeliveryRouteQuery): DeliveryFeedbackInput | undefined {
    if (!this.feedback) return undefined;
    const state = this.feedback.state({ projectId: query.projectId, now: query.now });
    const entry = state.types.find((type) => type.type === query.candidate.source);
    return entry ? { level: entry.level, stopped: entry.stopped } : undefined;
  }
}
