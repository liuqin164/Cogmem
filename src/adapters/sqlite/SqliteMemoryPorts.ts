/**
 * SQLite implementations of the domain ports.
 *
 * These adapters delegate to the existing stores. They exist to fix the
 * boundary, not to reimplement behavior: every method forwards to the code
 * that already ships, so the SQLite path stays the behavioral oracle a future
 * backend must match.
 */

import type { Database } from 'bun:sqlite';

import { EventStore } from '../../store/EventStore.js';
import type { AppendEventInput } from '../../store/EventStore.js';
import { EpisodeStore } from '../../episode/EpisodeStore.js';
import type { CreateEpisodeInput } from '../../episode/EpisodeStore.js';
import type { EpisodeListOptions, MemoryEpisode } from '../../episode/EpisodeTypes.js';
import { MemoryBindingStore } from '../../store/MemoryBindingStore.js';
import { MemoryBindingService } from '../../binding/MemoryBindingService.js';
import { SqliteSharedMemory } from './SqliteSharedMemory.js';
import type { MemoryBindingEventInput } from '../../binding/MemoryBindingService.js';
import type { MemoryBindingRecord, MemoryGraphRecallAnchor } from '../../binding/MemoryBindingTypes.js';
import type { MemoryEvent } from '../../types/index.js';
import type { BrainRecall } from '../../recall/BrainRecall.js';
import type { MemoryGovernanceExecutor } from '../../governance/MemoryGovernanceExecutor.js';
import type { MemoryGovernancePlan, MemoryGovernanceExecutionResult } from '../../governance/MemoryGovernancePlan.js';
import type { BrainRecallResult } from '../../types/BrainRecallResult.js';

import type {
  AppendEpisodeEventCommand,
  EpisodePort,
  GovernancePort,
  MemoryGraphPort,
  RawLedgerPort,
  RecallPort,
  SealEpisodeCommand,
  SharedMemoryPort,
} from '../../ports/index.js';

class SqliteRawLedger implements RawLedgerPort {
  constructor(private readonly store: EventStore, private readonly db: Database) {}

  async appendEvent(input: AppendEventInput): Promise<MemoryEvent> {
    return this.store.append(input);
  }

  async appendBatch(inputs: AppendEventInput[]): Promise<MemoryEvent[]> {
    // One transaction so a mid-batch failure leaves no partial archive.
    return this.db.transaction(() => inputs.map((input) => this.store.append(input)))();
  }

  async getEvent(eventId: string): Promise<MemoryEvent | null> {
    return this.store.getEvent(eventId);
  }

  async listBySeq(from: number, through?: number): Promise<MemoryEvent[]> {
    return this.store.getEventsAfterGlobalSeq(from - 1, through);
  }

  async count(): Promise<number> {
    return this.store.getEventCount();
  }
}

class SqliteEpisodes implements EpisodePort {
  constructor(private readonly store: EpisodeStore) {}

  async create(input: CreateEpisodeInput): Promise<MemoryEpisode> {
    return this.store.createEpisode(input);
  }

  async appendEvent(command: AppendEpisodeEventCommand): Promise<void> {
    this.store.appendEvent({
      episodeId: command.episodeId,
      eventId: command.eventId,
      relation: command.relation,
      confidence: command.confidence,
      globalSeq: command.globalSeq,
      occurredAt: command.occurredAt,
      summaryText: command.summaryText,
    });
  }

  async seal(episodeId: string, command: SealEpisodeCommand): Promise<MemoryEpisode> {
    this.store.sealEpisode(episodeId, {
      mode: command.mode,
      reason: command.reason,
      reasonCode: command.reasonCode as never,
      reasonDetail: command.reasonDetail,
      requiresReview: command.requiresReview,
      now: command.now,
    });
    const sealed = this.store.getEpisode(episodeId);
    if (!sealed) throw new Error(`episode_not_found_after_seal:${episodeId}`);
    return sealed;
  }

  async get(episodeId: string): Promise<MemoryEpisode | null> {
    return this.store.getEpisode(episodeId) ?? null;
  }

  async list(options: EpisodeListOptions = {}): Promise<MemoryEpisode[]> {
    return this.store.listEpisodes(options);
  }
}

class SqliteGraph implements MemoryGraphPort {
  constructor(private readonly service: MemoryBindingService) {}

  async bindEvent(input: MemoryBindingEventInput): Promise<MemoryBindingRecord[]> {
    return this.service.bindEvent(input);
  }

  async bindRawEvent(event: MemoryEvent): Promise<MemoryBindingRecord[]> {
    return this.service.bindRawEvent(event);
  }

  async anchors(
    query: string,
    options: { projectId?: string; limit?: number } = {},
  ): Promise<MemoryGraphRecallAnchor[]> {
    return this.service.recallGraphAnchors(query, options);
  }
}

class SqliteRecall implements RecallPort {
  constructor(private readonly recallEngine: BrainRecall) {}

  async recall(query: string, options: Parameters<RecallPort['recall']>[1] = {}): Promise<BrainRecallResult> {
    return this.recallEngine.recallAsync(query, options as never);
  }
}

class SqliteGovernance implements GovernancePort {
  constructor(private readonly executor: MemoryGovernanceExecutor) {}

  async commit(plan: MemoryGovernancePlan): Promise<MemoryGovernanceExecutionResult> {
    return this.executor.execute(plan);
  }
}

export interface SqlitePortsOptions {
  db: Database;
  /** Required only if `recall` is used. */
  recall?: BrainRecall;
  /** Required only if `governance` is used. */
  governance?: MemoryGovernanceExecutor;
  /** Shared region is not implemented on SQLite; lands with the seekdb backend. */
  shared?: SharedMemoryPort;
}

export interface SqlitePorts {
  rawLedger: RawLedgerPort;
  episodes: EpisodePort;
  graph: MemoryGraphPort;
  recall: RecallPort | null;
  governance: GovernancePort | null;
  shared: SharedMemoryPort | null;
}

export function createSqlitePorts(options: SqlitePortsOptions): SqlitePorts {
  const { db } = options;

  const events = new EventStore(db);
  const episodes = new EpisodeStore(db, (eventId) => events.getEvent(eventId));
  const bindings = new MemoryBindingService(new MemoryBindingStore(db));

  return {
    rawLedger: new SqliteRawLedger(events, db),
    episodes: new SqliteEpisodes(episodes),
    graph: new SqliteGraph(bindings),
    recall: options.recall ? new SqliteRecall(options.recall) : null,
    governance: options.governance ? new SqliteGovernance(options.governance) : null,
    shared: options.shared ?? new SqliteSharedMemory(db),
  };
}
