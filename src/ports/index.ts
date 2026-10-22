/**
 * Domain-level persistence ports.
 *
 * Upper layers depend on these interfaces, never on a SQL client. Each method
 * expresses a memory operation ("append a raw event", "commit a governance
 * plan"), so a storage backend can be replaced without the kernel learning
 * about it.
 *
 * All methods are async by contract. A synchronous backend simply returns an
 * already-resolved promise; an asynchronous backend awaits its driver.
 */

import type { MemoryEvent } from '../types/index.js';
import type { AppendEventInput } from '../store/EventStore.js';
import type { CreateEpisodeInput } from '../episode/EpisodeStore.js';
import type {
  EpisodeClosureMode,
  EpisodeListOptions,
  MemoryEpisode,
  TurnRelation,
} from '../episode/EpisodeTypes.js';
import type {
  MemoryGovernanceExecutionResult,
  MemoryGovernancePlan,
} from '../governance/MemoryGovernancePlan.js';
import type { BrainRecallResult } from '../types/BrainRecallResult.js';
import type { MemoryBindingEventInput } from '../binding/MemoryBindingService.js';
import type {
  MemoryBindingRecord,
  MemoryGraphRecallAnchor,
} from '../binding/MemoryBindingTypes.js';

/** Raw ledger: the append-only archive of everything the agent observed. */
export interface RawLedgerPort {
  appendEvent(input: AppendEventInput): Promise<MemoryEvent>;
  appendBatch(inputs: AppendEventInput[]): Promise<MemoryEvent[]>;
  getEvent(eventId: string): Promise<MemoryEvent | null>;
  /** Inclusive `from`, inclusive `through`, ordered by global sequence. */
  listBySeq(from: number, through?: number): Promise<MemoryEvent[]>;
  count(): Promise<number>;
}

export interface SealEpisodeCommand {
  mode: EpisodeClosureMode;
  reason: string;
  reasonCode?: string;
  reasonDetail?: string;
  requiresReview?: boolean;
  now?: number;
}

export interface AppendEpisodeEventCommand {
  episodeId: string;
  eventId: string;
  relation: TurnRelation;
  confidence: number;
  globalSeq?: number;
  occurredAt: number;
  summaryText?: string;
}

/** Episode boundary: deterministic grouping of raw events into conversations. */
export interface EpisodePort {
  create(input: CreateEpisodeInput): Promise<MemoryEpisode>;
  appendEvent(command: AppendEpisodeEventCommand): Promise<void>;
  seal(episodeId: string, command: SealEpisodeCommand): Promise<MemoryEpisode>;
  get(episodeId: string): Promise<MemoryEpisode | null>;
  list(options?: EpisodeListOptions): Promise<MemoryEpisode[]>;
}

/** Memory graph: entity/topic bindings and their navigable neighbourhood. */
export interface MemoryGraphPort {
  bindEvent(input: MemoryBindingEventInput): Promise<MemoryBindingRecord[]>;
  bindRawEvent(event: MemoryEvent): Promise<MemoryBindingRecord[]>;
  anchors(query: string, options?: { projectId?: string; limit?: number }): Promise<MemoryGraphRecallAnchor[]>;
}

export interface RecallPort {
  recall(query: string, options?: {
    projectId?: string;
    limit?: number;
    now?: number;
    includeRawEvidence?: boolean;
    topicPath?: string;
  }): Promise<BrainRecallResult>;
}

/** Governance: one plan in, one atomic commit or one rollback out. */
export interface GovernancePort {
  commit(plan: MemoryGovernancePlan): Promise<MemoryGovernanceExecutionResult>;
}

export interface SharedItem {
  itemHash: string;
  sourceHost: string;
  sourceItem: string;
  collection: string;
  payload: Record<string, unknown>;
  publishedAt: number;
}

export interface SharedRetraction {
  itemHash: string;
  retractedAt: number;
  retractedBy: string;
}

/**
 * Shared region. Publishing is idempotent on `itemHash`; retraction is soft, so
 * a subscriber's earlier reasoning stays explainable.
 */
export interface SharedMemoryPort {
  publish(items: SharedItem[]): Promise<number>;
  retract(retraction: SharedRetraction): Promise<void>;
  subscribe(collections: string[], options?: { limit?: number }): Promise<SharedItem[]>;
  explain(itemHash: string): Promise<{ item: SharedItem; retractedAt: number | null } | null>;
}

export interface MemoryPorts {
  rawLedger: RawLedgerPort;
  episodes: EpisodePort;
  graph: MemoryGraphPort;
  recall: RecallPort;
  governance: GovernancePort;
  shared: SharedMemoryPort | null;
}
