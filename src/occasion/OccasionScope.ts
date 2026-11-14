/**
 * Occasion scope (#162, F8): what a connection may recall and surface.
 *
 * An occasion is where the companion is speaking: a private conversation, a group, or a public
 * place. The caller does not get to declare it. The host registers a channel once, at connection
 * setup, and every recall and surfacing query on that connection resolves its occasion from the
 * registration. A connection with no registration is the strictest occasion, `public`.
 *
 * The rule is deliberately small: the registry, the material classification and one visibility
 * function. The contract, including the minimal channel shape F12 will consume, is
 * `docs/occasion-scope.md`.
 */
import { isImportedMaterial } from '../agent/AgentScopeRules.js';
import type { SensitivityTier } from '../surfacing/SurfacingCandidates.js';
import type { MemoryEvent } from '../types/index.js';

/** Bump when a field, occasion, rule or error meaning changes incompatibly. */
export const OCCASION_CONTRACT_VERSION = 1;

/** The three occasions, least to most restrictive. Frozen. */
export const OCCASIONS = ['private', 'group', 'public'] as const;
export type Occasion = (typeof OCCASIONS)[number];

/** The occasion an unbound connection gets. Frozen: never `private`. */
export const OCCASION_STRICTEST: Occasion = 'public';

/** How a candidate's material is classified for occasion filtering. Frozen. */
export const OCCASION_MATERIAL_KINDS = ['personal', 'third-party', 'project-public'] as const;
export type OccasionMaterialKind = (typeof OCCASION_MATERIAL_KINDS)[number];

/** The refusals this face names. Frozen. */
export const OCCASION_ERROR_CODES = ['invalid_channel_binding'] as const;
export type OccasionErrorCode = (typeof OCCASION_ERROR_CODES)[number];

/** The binding's field set, frozen for F12. */
export const CHANNEL_BINDING_FIELDS = ['channelId', 'occasion'] as const;

/** The face's methods. Frozen. */
export const OCCASION_SCOPE_API_METHODS = ['register', 'resolve'] as const;

/**
 * The minimal channel contract F12 consumes. A host registers this once per connection; the
 * returned object is opaque by identity, so a forged `{ channelId, occasion }` is unbound.
 */
export interface ChannelBinding {
  readonly channelId: string;
  readonly occasion: Occasion;
}

export interface ResolvedOccasion {
  occasion: Occasion;
  /** False when no registered binding was supplied; the occasion is then `public`. */
  bound: boolean;
  channelId?: string;
}

export interface OccasionMaterial {
  kind: OccasionMaterialKind;
}

/** The withhold reasons a decision trace can name. Frozen; the document's table is the source. */
export const OCCASION_WITHHOLD_REASONS = ['occasion_private_tier', 'occasion_third_party'] as const;
export type OccasionWithholdReason = (typeof OCCASION_WITHHOLD_REASONS)[number];

/** The decision-trace outcomes. Frozen; the document's table is the source. */
export const OCCASION_TRACE_OUTCOMES = ['bound', 'unbound', 'mismatch'] as const;

export interface OccasionDecision {
  allowed: boolean;
  reason?: OccasionWithholdReason;
}

function occasionError(code: OccasionErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

/**
 * The registry of channel → occasion bindings.
 *
 * `register` is the only way to obtain a binding the registry will honour. The returned object is
 * frozen and tracked by identity, so `resolve({ channelId: 'terminal', occasion: 'private' })` — a
 * caller's own object — is unbound and resolves to `public`. Re-registering a channel replaces its
 * binding; an older object for the same channel resolves to the current registration, so a revoked
 * private binding does not keep its old power.
 */
export class OccasionScope {
  private readonly issued = new WeakSet<ChannelBinding>();
  private readonly byChannel = new Map<string, ChannelBinding>();

  register(input: { channelId: string; occasion: Occasion }): ChannelBinding {
    const channelId = typeof input.channelId === 'string' ? input.channelId.trim() : '';
    if (!channelId) throw occasionError('invalid_channel_binding', 'channelId must be non-empty');
    if (!(OCCASIONS as readonly unknown[]).includes(input.occasion)) {
      throw occasionError('invalid_channel_binding', `occasion must be one of ${OCCASIONS.join(', ')}`);
    }
    const binding: ChannelBinding = Object.freeze({ channelId, occasion: input.occasion });
    this.issued.add(binding);
    this.byChannel.set(channelId, binding);
    return binding;
  }

  resolve(binding: ChannelBinding | undefined): ResolvedOccasion {
    if (!binding || !this.issued.has(binding)) return { occasion: OCCASION_STRICTEST, bound: false };
    const current = this.byChannel.get(binding.channelId);
    if (!current) return { occasion: OCCASION_STRICTEST, bound: false };
    return { occasion: current.occasion, bound: true, channelId: current.channelId };
  }
}

/** Whether one event is a third party's turn, per the conversation capture's own marker. */
export function isThirdPartyEvent(event: MemoryEvent): boolean {
  if (event.role === 'other') return true;
  const metadata = (event.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  return metadata?.speaker === 'other';
}

/**
 * Classify the events a candidate rests on.
 *
 * `project-public` requires *every* ref to be imported: a candidate that mixes an import with a
 * private turn is not public. `third-party` wins over `personal` but not over `project-public`.
 * No refs means `personal`; absence is not a public declaration.
 */
export function occasionMaterialOf(events: readonly MemoryEvent[]): OccasionMaterial {
  if (events.length > 0 && events.every((event) => isImportedMaterial(event))) {
    return { kind: 'project-public' };
  }
  if (events.some(isThirdPartyEvent)) return { kind: 'third-party' };
  return { kind: 'personal' };
}

/**
 * The whole visibility rule.
 *
 * - `project-public` material is visible everywhere; it is the #143 public-material exemption.
 * - `private` shows everything.
 * - `group` shows daily material, including a third party's daily remark, and withholds private or
 *   high material (a third party's sensitive detail is therefore withheld too).
 * - `public` shows the owner's daily material and project-public material only; no third-party
 *   material at all, so the three sets strictly decrease when a daily third-party item is present.
 */
export function occasionVisibility(
  occasion: Occasion,
  tier: SensitivityTier,
  material: OccasionMaterial,
): OccasionDecision {
  if (material.kind === 'project-public') return { allowed: true };
  if (occasion === 'private') return { allowed: true };
  if (tier !== 'daily') return { allowed: false, reason: 'occasion_private_tier' };
  if (material.kind === 'third-party' && occasion === 'public') {
    return { allowed: false, reason: 'occasion_third_party' };
  }
  return { allowed: true };
}
