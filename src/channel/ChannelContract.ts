/**
 * Channel contract v1 (#166, F12): the one shape a shell and a channel share.
 *
 * A channel is registered once, at connection setup, with an occasion binding, the accounts it
 * carries, and its reachability/interruptibility. Messages come in through `ingest`; surfacing goes
 * out through `deliver` with one of three strengths. The occasion is always the one F8's registry
 * issued for the channel — a caller's declaration is recorded only so a mismatch is visible.
 *
 * The contract is `docs/channel-contract.md`, held by `__tests__/channel-contract.contract.test.ts`.
 * The first implementation is the shell's local terminal channel (`shell/src/channels/terminal.ts`).
 */
import {
  OCCASIONS,
  OccasionScope,
  type ChannelBinding,
  type Occasion,
} from '../occasion/index.js';

/** Bump when a field, value, rule or error meaning changes incompatibly. */
export const CHANNEL_CONTRACT_VERSION = 1;

/** The version field carried by every contract result. Format is frozen by the contract test. */
export function channelContractVersionTag(version = CHANNEL_CONTRACT_VERSION): string {
  return `channel_contract.v${version}`;
}

export const CHANNEL_CONTRACT_VERSION_TAG = channelContractVersionTag();

/** The three surfacing strengths, most to least intrusive. Frozen. */
export const CHANNEL_SURFACING_STRENGTHS = ['proactive', 'incidental', 'silence'] as const;
export type ChannelSurfacingStrength = (typeof CHANNEL_SURFACING_STRENGTHS)[number];

/** Whether the channel can carry a message now. Frozen. */
export const CHANNEL_REACHABILITY_STATES = ['online', 'offline'] as const;
export type ChannelReachability = (typeof CHANNEL_REACHABILITY_STATES)[number];

/** The owner's coarse activity signal on this channel. Frozen. */
export const CHANNEL_OWNER_ACTIVITY = ['active', 'idle', 'away'] as const;
export type ChannelOwnerActivity = (typeof CHANNEL_OWNER_ACTIVITY)[number];

/** How much the channel may interrupt. Frozen. */
export const CHANNEL_INTERRUPTIBILITY = ['high', 'normal', 'low'] as const;
export type ChannelInterruptibility = (typeof CHANNEL_INTERRUPTIBILITY)[number];

/** Who a channel account belongs to. Frozen. */
export const CHANNEL_ACCOUNT_ROLES = ['owner', 'other'] as const;
export type ChannelAccountRole = (typeof CHANNEL_ACCOUNT_ROLES)[number];

/** The four faces this contract covers. Frozen. */
export const CHANNEL_FACES = ['message-in', 'surfacing-out', 'presence', 'identity'] as const;

export const CHANNEL_REGISTRATION_FIELDS = [
  'channelId',
  'occasion',
  'accounts',
  'reachability',
  'interruptibility',
] as const;
export const CHANNEL_ACCOUNT_FIELDS = ['accountId', 'role'] as const;
export const CHANNEL_INGRESS_FIELDS = [
  'contractVersion',
  'channelId',
  'accountId',
  'role',
  'text',
  'at',
  'occasion',
  'occasionBinding',
  'declaredOccasion',
  'decisionTrace',
] as const;
export const CHANNEL_SURFACING_INPUT_FIELDS = [
  'candidateId',
  'strength',
  'text',
  'reason',
  'declaredOccasion',
] as const;
export const CHANNEL_DELIVERY_FIELDS = [
  'contractVersion',
  'channelId',
  'candidateId',
  'strength',
  'outcome',
  'occasion',
  'reason',
  'decisionTrace',
] as const;
export const CHANNEL_PRESENCE_FIELDS = [
  'contractVersion',
  'channelId',
  'reachability',
  'ownerActivity',
  'interruptibility',
  'updatedAt',
] as const;
export const CHANNEL_DECISION_TRACE_FIELDS = ['version', 'reason', 'steps'] as const;
export const CHANNEL_DECISION_STEP_FIELDS = ['rule', 'outcome', 'detail'] as const;

/** The occasion trace outcomes. Frozen; same meanings as F8's table. */
export const CHANNEL_TRACE_OUTCOMES = ['bound', 'unbound', 'mismatch'] as const;
export type ChannelTraceOutcome = (typeof CHANNEL_TRACE_OUTCOMES)[number];

/** What `deliver` did. Frozen. */
export const CHANNEL_DELIVERY_OUTCOMES = ['delivered', 'silenced'] as const;
export type ChannelDeliveryOutcome = (typeof CHANNEL_DELIVERY_OUTCOMES)[number];

/** The face's methods. Frozen. */
export const CHANNEL_API_METHODS = ['register', 'ingest', 'presence', 'deliver'] as const;

/** The refusals this face names. Frozen. */
export const CHANNEL_ERROR_CODES = [
  'invalid_channel_registration',
  'invalid_channel_message',
  'invalid_channel_presence',
  'invalid_channel_surfacing',
  'channel_session_unbound',
] as const;
export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number];

export interface ChannelAccount {
  readonly accountId: string;
  readonly role: ChannelAccountRole;
}

export interface ChannelRegistrationInput {
  channelId: string;
  occasion: Occasion;
  accounts: readonly ChannelAccount[];
  reachability?: ChannelReachability;
  interruptibility?: ChannelInterruptibility;
}

/** An issued registration. Opaque by identity, like F8's binding. */
export interface ChannelSession {
  readonly contractVersion: string;
  readonly channelId: string;
  readonly binding: ChannelBinding;
  readonly accounts: readonly ChannelAccount[];
  readonly reachability: ChannelReachability;
  readonly interruptibility: ChannelInterruptibility;
}

export interface ChannelPresence {
  contractVersion: string;
  channelId: string;
  reachability: ChannelReachability;
  ownerActivity: ChannelOwnerActivity;
  interruptibility: ChannelInterruptibility;
  updatedAt: number;
}

export interface ChannelPresenceInput {
  reachability: ChannelReachability;
  ownerActivity: ChannelOwnerActivity;
  interruptibility?: ChannelInterruptibility;
  at?: number;
}

export interface ChannelIngressInput {
  accountId: string;
  text: string;
  at?: number;
  /** Recorded only; the registered binding decides. */
  declaredOccasion?: string;
}

export interface ChannelIngress {
  contractVersion: string;
  channelId: string;
  accountId: string;
  role: ChannelAccountRole;
  text: string;
  at: number;
  occasion: Occasion;
  occasionBinding: 'bound' | 'unbound';
  declaredOccasion?: string;
  decisionTrace: ChannelDecisionTrace;
}

export interface ChannelSurfacingInput {
  candidateId: string;
  strength: ChannelSurfacingStrength;
  text?: string;
  /** Why the router chose this strength; carried into the trace. */
  reason?: string;
  /** Recorded only; the registered binding decides. */
  declaredOccasion?: string;
}

export interface ChannelDelivery {
  contractVersion: string;
  channelId: string;
  candidateId: string;
  strength: ChannelSurfacingStrength;
  outcome: ChannelDeliveryOutcome;
  occasion: Occasion;
  reason: string;
  decisionTrace: ChannelDecisionTrace;
}

export interface ChannelDecisionStep {
  rule: string;
  outcome: string;
  detail: Record<string, unknown>;
}

export interface ChannelDecisionTrace {
  version: 'channel_decision.v1';
  reason: string;
  steps: ChannelDecisionStep[];
}

function channelError(code: ChannelErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return (values as readonly unknown[]).includes(value);
}

function traceOf(steps: ChannelDecisionStep[]): ChannelDecisionTrace {
  return {
    version: 'channel_decision.v1',
    reason: steps.map((step) => `${step.rule}=${step.outcome}`).join('; '),
    steps,
  };
}

function requireText(value: unknown, code: ChannelErrorCode, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw channelError(code, `${field} must be non-empty`);
  return text;
}

/**
 * The channel registry and its four faces.
 *
 * `register` is the only way to obtain a session the contract honours. A session issued for a
 * channel resolves to that channel's current registration, so re-registering replaces the accounts
 * and occasion an older session sees. Presence is in-process state, like F8's binding registry.
 */
export class ChannelContract {
  private readonly issued = new WeakSet<ChannelSession>();
  private readonly sessions = new Map<string, ChannelSession>();
  private readonly presences = new Map<string, ChannelPresence>();

  constructor(private readonly occasionScope: OccasionScope) {}

  register(input: ChannelRegistrationInput): ChannelSession {
    const channelId = requireText(input.channelId, 'invalid_channel_registration', 'channelId');
    if (!isOneOf(OCCASIONS, input.occasion)) {
      throw channelError('invalid_channel_registration', `occasion must be one of ${OCCASIONS.join(', ')}`);
    }
    const accounts = input.accounts ?? [];
    if (accounts.length === 0) {
      throw channelError('invalid_channel_registration', 'at least one account is required');
    }
    const seen = new Set<string>();
    let owners = 0;
    for (const account of accounts) {
      const accountId = requireText(account.accountId, 'invalid_channel_registration', 'accountId');
      if (!isOneOf(CHANNEL_ACCOUNT_ROLES, account.role)) {
        throw channelError('invalid_channel_registration', `account role must be one of ${CHANNEL_ACCOUNT_ROLES.join(', ')}`);
      }
      if (seen.has(accountId)) {
        throw channelError('invalid_channel_registration', `duplicate account ${accountId}`);
      }
      seen.add(accountId);
      if (account.role === 'owner') owners += 1;
    }
    if (owners !== 1) {
      throw channelError('invalid_channel_registration', 'exactly one owner account is required');
    }
    const reachability = input.reachability ?? 'online';
    if (!isOneOf(CHANNEL_REACHABILITY_STATES, reachability)) {
      throw channelError('invalid_channel_registration', `reachability must be one of ${CHANNEL_REACHABILITY_STATES.join(', ')}`);
    }
    const interruptibility = input.interruptibility ?? 'normal';
    if (!isOneOf(CHANNEL_INTERRUPTIBILITY, interruptibility)) {
      throw channelError('invalid_channel_registration', `interruptibility must be one of ${CHANNEL_INTERRUPTIBILITY.join(', ')}`);
    }
    const binding = this.occasionScope.register({ channelId, occasion: input.occasion });
    const session: ChannelSession = Object.freeze({
      contractVersion: CHANNEL_CONTRACT_VERSION_TAG,
      channelId,
      binding,
      accounts: Object.freeze(accounts.map((account) => Object.freeze({ ...account }))),
      reachability,
      interruptibility,
    });
    this.issued.add(session);
    this.sessions.set(channelId, session);
    this.presences.set(channelId, {
      contractVersion: CHANNEL_CONTRACT_VERSION_TAG,
      channelId,
      reachability,
      ownerActivity: 'idle',
      interruptibility,
      updatedAt: Date.now(),
    });
    return session;
  }

  ingest(session: ChannelSession, input: ChannelIngressInput): ChannelIngress {
    const current = this.currentSession(session);
    const accountId = requireText(input.accountId, 'invalid_channel_message', 'accountId');
    const text = requireText(input.text, 'invalid_channel_message', 'text');
    const at = input.at ?? Date.now();
    if (!Number.isFinite(at)) throw channelError('invalid_channel_message', 'at must be finite');
    const declared = input.declaredOccasion?.trim() || undefined;
    if (declared !== undefined && !isOneOf(OCCASIONS, declared)) {
      throw channelError('invalid_channel_message', `declaredOccasion must be one of ${OCCASIONS.join(', ')}`);
    }
    const resolved = this.occasionScope.resolve(current.binding);
    const mismatch = declared !== undefined && declared !== resolved.occasion;
    const account = current.accounts.find((candidate) => candidate.accountId === accountId);
    const role: ChannelAccountRole = account?.role ?? 'other';
    const steps: ChannelDecisionStep[] = [
      {
        rule: 'identity',
        outcome: account ? role : 'unknown',
        detail: { accountId, role, known: Boolean(account) },
      },
      {
        rule: 'occasion',
        outcome: resolved.bound ? (mismatch ? 'mismatch' : 'bound') : 'unbound',
        detail: {
          occasion: resolved.occasion,
          channelId: resolved.channelId,
          declared,
          mismatch,
        },
      },
    ];
    return {
      contractVersion: CHANNEL_CONTRACT_VERSION_TAG,
      channelId: current.channelId,
      accountId,
      role,
      text,
      at,
      occasion: resolved.occasion,
      occasionBinding: resolved.bound ? 'bound' : 'unbound',
      ...(declared ? { declaredOccasion: declared } : {}),
      decisionTrace: traceOf(steps),
    };
  }

  presence(session: ChannelSession, input: ChannelPresenceInput): ChannelPresence {
    const current = this.currentSession(session);
    if (!isOneOf(CHANNEL_REACHABILITY_STATES, input.reachability)) {
      throw channelError('invalid_channel_presence', `reachability must be one of ${CHANNEL_REACHABILITY_STATES.join(', ')}`);
    }
    if (!isOneOf(CHANNEL_OWNER_ACTIVITY, input.ownerActivity)) {
      throw channelError('invalid_channel_presence', `ownerActivity must be one of ${CHANNEL_OWNER_ACTIVITY.join(', ')}`);
    }
    const interruptibility = input.interruptibility ?? current.interruptibility;
    if (!isOneOf(CHANNEL_INTERRUPTIBILITY, interruptibility)) {
      throw channelError('invalid_channel_presence', `interruptibility must be one of ${CHANNEL_INTERRUPTIBILITY.join(', ')}`);
    }
    const updatedAt = input.at ?? Date.now();
    if (!Number.isFinite(updatedAt)) throw channelError('invalid_channel_presence', 'at must be finite');
    const presence: ChannelPresence = {
      contractVersion: CHANNEL_CONTRACT_VERSION_TAG,
      channelId: current.channelId,
      reachability: input.reachability,
      ownerActivity: input.ownerActivity,
      interruptibility,
      updatedAt,
    };
    this.presences.set(current.channelId, presence);
    return presence;
  }

  deliver(session: ChannelSession, input: ChannelSurfacingInput): ChannelDelivery {
    const current = this.currentSession(session);
    const candidateId = requireText(input.candidateId, 'invalid_channel_surfacing', 'candidateId');
    if (!isOneOf(CHANNEL_SURFACING_STRENGTHS, input.strength)) {
      throw channelError('invalid_channel_surfacing', `strength must be one of ${CHANNEL_SURFACING_STRENGTHS.join(', ')}`);
    }
    if (input.text !== undefined && typeof input.text !== 'string') {
      throw channelError('invalid_channel_surfacing', 'text must be a string');
    }
    const declared = input.declaredOccasion?.trim() || undefined;
    if (declared !== undefined && !isOneOf(OCCASIONS, declared)) {
      throw channelError('invalid_channel_surfacing', `declaredOccasion must be one of ${OCCASIONS.join(', ')}`);
    }
    const resolved = this.occasionScope.resolve(current.binding);
    const mismatch = declared !== undefined && declared !== resolved.occasion;
    const presence = this.presences.get(current.channelId);
    const offline = presence?.reachability === 'offline';
    const outcome: ChannelDeliveryOutcome = input.strength === 'silence' || offline ? 'silenced' : 'delivered';
    const reason = offline
      ? 'channel_offline'
      : input.strength === 'silence'
        ? 'silence'
        : input.strength === 'incidental'
          ? 'incidental_mention'
          : 'proactive_send';
    const steps: ChannelDecisionStep[] = [
      {
        rule: 'occasion',
        outcome: resolved.bound ? (mismatch ? 'mismatch' : 'bound') : 'unbound',
        detail: {
          occasion: resolved.occasion,
          channelId: resolved.channelId,
          declared,
          mismatch,
        },
      },
      {
        rule: 'presence',
        outcome: presence?.reachability ?? 'unknown',
        detail: {
          reachability: presence?.reachability,
          ownerActivity: presence?.ownerActivity,
          interruptibility: presence?.interruptibility,
        },
      },
      {
        rule: 'strength',
        outcome,
        detail: {
          strength: input.strength,
          outcome,
          reason,
          requestedReason: input.reason,
        },
      },
    ];
    return {
      contractVersion: CHANNEL_CONTRACT_VERSION_TAG,
      channelId: current.channelId,
      candidateId,
      strength: input.strength,
      outcome,
      occasion: resolved.occasion,
      reason: traceOf(steps).reason,
      decisionTrace: traceOf(steps),
    };
  }

  private currentSession(session: ChannelSession): ChannelSession {
    if (!session || !this.issued.has(session)) {
      throw channelError('channel_session_unbound');
    }
    const current = this.sessions.get(session.channelId);
    if (!current) throw channelError('channel_session_unbound');
    return current;
  }
}
