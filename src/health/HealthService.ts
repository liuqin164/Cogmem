/**
 * The kernel's own health face (#196, F19).
 *
 * Four checks — model route, Dream streak, database writability, kernel integrity — answer whether
 * the companion is well enough to keep its promises. A state change is recorded once: a
 * `governance_audit_log` row and a `health-changed` kernel event. The contract is
 * `docs/health-backup.md`; `__tests__/health-backup.contract.test.ts` holds the frozen tables.
 *
 * The check is deliberately not a model call. Reachability is the configuration's answer; a Dream
 * that cannot reach the provider already reports that in its own result and in the streak.
 */
import { randomUUID } from 'node:crypto';
import Database from 'bun:sqlite';

import { routeDelivery, type DeliveryCandidateInput, type DeliveryChannelInput, type DeliveryDecision, type DeliveryUserState } from '../delivery/index.js';
import type { KernelEventStream } from '../events/index.js';
import type { ModelRegistry } from '../models/ModelRegistry.js';
import type { Occasion } from '../occasion/index.js';

export const HEALTH_CONTRACT_VERSION = 1;

/** The four self-checks, in the order the document freezes. */
export const HEALTH_CHECK_IDS = ['model_route', 'dream_streak', 'db_writable', 'kernel_integrity'] as const;
export type HealthCheckId = (typeof HEALTH_CHECK_IDS)[number];

export const HEALTH_STATUSES = ['ok', 'degraded'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_MODES = ['normal', 'read_only'] as const;
export type HealthMode = (typeof HEALTH_MODES)[number];

export const HEALTH_DEGRADATIONS = [
  'model_unavailable',
  'dream_failing',
  'db_read_only',
  'kernel_integrity_failed',
] as const;
export type HealthDegradation = (typeof HEALTH_DEGRADATIONS)[number];

/** Consecutive failed nights before one health notice. Frozen. */
export const DREAM_FAILURE_NIGHTS = 3;

export const HEALTH_EVENT_TYPE = 'health-changed';
export const HEALTH_AUDIT_ACTION = 'health_changed';
export const HEALTH_STATE_KEY = 'health_state';
export const HEALTH_NOTICE_KEY = 'health_notice_streak';
export const HEALTH_ANOMALY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const HEALTH_NOTICE_SOURCE = 'wake-intention' as const;
export const HEALTH_NOTICE_SENSITIVITY = 'daily' as const;
export const HEALTH_NOTICE_CONFIDENCE = 1;

/** The face's methods. Frozen. */
export const HEALTH_API_METHODS = ['check', 'lastReport', 'notice', 'assertWritable'] as const;

/** The refusals this face names. Frozen. */
export const HEALTH_ERROR_CODES = ['health_read_only'] as const;
export type HealthErrorCode = (typeof HEALTH_ERROR_CODES)[number];

export interface HealthCheck {
  id: HealthCheckId;
  status: HealthStatus;
  detail: Record<string, unknown>;
  degradation?: HealthDegradation;
}

export interface HealthReport {
  version: 1;
  checkedAt: number;
  mode: HealthMode;
  status: HealthStatus;
  checks: HealthCheck[];
  degradations: HealthDegradation[];
}

export interface HealthNoticeInput {
  projectId?: string;
  occasion?: Occasion;
  userState: DeliveryUserState;
  channel: DeliveryChannelInput;
  now?: number;
}

export interface HealthNotice {
  due: boolean;
  reason: 'dream_streak' | 'below_threshold' | 'already_notified';
  streak: number;
  candidate?: DeliveryCandidateInput;
  decision?: DeliveryDecision;
}

export class HealthReadOnlyError extends Error {
  readonly code: HealthErrorCode = 'health_read_only';

  constructor() {
    super('health_read_only: the memory database is read-only; the companion is in read-only mode');
    this.name = 'HealthReadOnlyError';
  }
}

export interface HealthServiceDeps {
  db: Database;
  dbPath: string;
  events: KernelEventStream;
  modelRegistry: ModelRegistry;
  now?: () => number;
}

export class HealthService {
  private readonly now: () => number;
  private lastMode?: HealthMode;
  private lastNoticeKey?: string;

  constructor(private readonly deps: HealthServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Run the four checks. `record: false` is the observatory-safe form: it reads and probes but
   * writes no transition, so a read page stays zero-write.
   */
  check(options: { record?: boolean; now?: number } = {}): HealthReport {
    const checkedAt = options.now ?? this.now();
    const checks: HealthCheck[] = [
      this.modelRouteCheck(),
      this.dreamStreakCheck(),
      this.dbWritableCheck(),
      this.kernelIntegrityCheck(),
    ];
    const mode: HealthMode = checks.find((check) => check.id === 'db_writable')?.status === 'degraded'
      ? 'read_only'
      : 'normal';
    const report: HealthReport = {
      version: 1,
      checkedAt,
      mode,
      status: checks.some((check) => check.status === 'degraded') ? 'degraded' : 'ok',
      checks,
      degradations: checks
        .filter((check) => check.degradation !== undefined)
        .map((check) => check.degradation!),
    };
    this.lastMode = mode;
    if (options.record !== false && mode !== 'read_only') this.recordTransitions(report);
    return report;
  }

  /** The last persisted report, or undefined when no check has ever run. */
  lastReport(): HealthReport | undefined {
    const raw = readMeta(this.deps.db, HEALTH_STATE_KEY);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Partial<HealthReport>;
      if (parsed.version !== 1 || !Array.isArray(parsed.checks)) return undefined;
      return parsed as HealthReport;
    } catch {
      return undefined;
    }
  }

  /**
   * The Dream-streak notice, once per failed streak. The candidate is a due `wake-intention`, so
   * F18 derives urgency `high`; the caller's user state and channel decide whether that highest tier
   * is delivered now or queued.
   */
  notice(input: HealthNoticeInput): HealthNotice {
    const now = input.now ?? this.now();
    const { streak, latestNight } = this.dreamStreak();
    if (streak < DREAM_FAILURE_NIGHTS) return { due: false, reason: 'below_threshold', streak };
    const key = `${latestNight ?? 'none'}:${streak}`;
    if (this.lastNoticeKey === key || readMeta(this.deps.db, HEALTH_NOTICE_KEY) === key) {
      return { due: false, reason: 'already_notified', streak };
    }
    const candidate: DeliveryCandidateInput = {
      candidateId: `health:dream-streak:${key}`,
      source: HEALTH_NOTICE_SOURCE,
      sensitivity: HEALTH_NOTICE_SENSITIVITY,
      freshness: {
        observedAt: now,
        ageMs: 0,
        expiresAt: now + 24 * 60 * 60_000,
        expired: false,
      },
      confidence: HEALTH_NOTICE_CONFIDENCE,
    };
    const decision = routeDelivery({
      candidate,
      occasion: input.occasion ?? 'private',
      userState: input.userState,
      channel: input.channel,
      feedback: { level: 0, stopped: false },
      now,
    });
    this.lastNoticeKey = key;
    try {
      writeMeta(this.deps.db, HEALTH_NOTICE_KEY, key);
    } catch {
      // A read-only database cannot hold the mark; the in-process key still makes this process
      // announce once. The next process re-announces, which is the honest trade for a mode whose
      // whole point is that writes are refused.
    }
    return { due: true, reason: 'dream_streak', streak, candidate, decision };
  }

  /** The write guard for agent-facing paths. Reads are never guarded. */
  assertWritable(): void {
    if (this.lastMode === 'read_only') throw new HealthReadOnlyError();
  }

  private recordTransitions(report: HealthReport): void {
    const previous = this.lastReport();
    const previousStatus = new Map<HealthCheckId, HealthStatus>(
      (previous?.checks ?? []).map((check) => [check.id, check.status]),
    );
    let changed = false;
    for (const check of report.checks) {
      const from = previousStatus.get(check.id) ?? 'ok';
      if (from === check.status) continue;
      changed = true;
      this.deps.db.prepare(`
        INSERT INTO governance_audit_log (audit_id, action, project_id, reason, details_json, created_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `).run(
        `audit-${randomUUID()}`,
        HEALTH_AUDIT_ACTION,
        check.degradation ?? null,
        JSON.stringify({ checkId: check.id, from, to: check.status, mode: report.mode }),
        report.checkedAt,
      );
      this.deps.events.emit({
        type: HEALTH_EVENT_TYPE,
        at: report.checkedAt,
        payload: { checkId: check.id, status: check.status, mode: report.mode },
      });
    }
    // The baseline report is persisted once; an unchanged report is not rewritten on every check.
    if (changed || previous === undefined) {
      writeMeta(this.deps.db, HEALTH_STATE_KEY, JSON.stringify(report));
    }
  }

  private modelRouteCheck(): HealthCheck {
    const memory = this.deps.modelRegistry.getRoleConfig('memory');
    const reasoning = this.deps.modelRegistry.getRoleConfig('reasoning');
    const ok = memory.provider !== 'rule_only' && reasoning.provider !== 'rule_only';
    return {
      id: 'model_route',
      status: ok ? 'ok' : 'degraded',
      detail: {
        memoryProvider: memory.provider,
        memoryModel: memory.modelName,
        reasoningProvider: reasoning.provider,
        reasoningModel: reasoning.modelName,
      },
      ...(ok ? {} : { degradation: 'model_unavailable' as const }),
    };
  }

  private dreamStreakCheck(): HealthCheck {
    const { streak, latestNight, nights } = this.dreamStreak();
    const ok = streak < DREAM_FAILURE_NIGHTS;
    return {
      id: 'dream_streak',
      status: ok ? 'ok' : 'degraded',
      detail: { streak, latestNight, nights },
      ...(ok ? {} : { degradation: 'dream_failing' as const }),
    };
  }

  private dreamStreak(): { streak: number; latestNight?: string; nights: Array<{ night: string; status: 'succeeded' | 'failed' | 'idle' }> } {
    let rows: Array<{ status: string; created_at: number }> = [];
    try {
      rows = this.deps.db.prepare(`
        SELECT status, created_at FROM episode_dream_runs ORDER BY created_at DESC
      `).all() as Array<{ status: string; created_at: number }>;
    } catch {
      return { streak: 0, nights: [] };
    }
    const byNight = new Map<string, Set<string>>();
    for (const row of rows) {
      const night = new Date(Number(row.created_at)).toISOString().slice(0, 10);
      const statuses = byNight.get(night) ?? new Set<string>();
      statuses.add(String(row.status));
      byNight.set(night, statuses);
    }
    const nights = [...byNight.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([night, statuses]) => ({
        night,
        status: statuses.has('succeeded') ? 'succeeded' as const
          : statuses.has('partial') ? 'failed' as const
            : 'idle' as const,
      }));
    let streak = 0;
    for (const night of nights) {
      if (night.status !== 'failed') break;
      streak += 1;
    }
    return { streak, latestNight: nights[0]?.night, nights: nights.slice(0, 7) };
  }

  private dbWritableCheck(): HealthCheck {
    if (this.deps.dbPath === ':memory:' || this.deps.dbPath.startsWith('file:')) {
      return { id: 'db_writable', status: 'ok', detail: { kind: 'memory' } };
    }
    let probe: Database | undefined;
    try {
      probe = new Database(this.deps.dbPath);
      probe.exec('PRAGMA busy_timeout = 1000');
      probe.exec('BEGIN IMMEDIATE');
      probe.exec('ROLLBACK');
      return { id: 'db_writable', status: 'ok', detail: { kind: 'file' } };
    } catch (error) {
      return {
        id: 'db_writable',
        status: 'degraded',
        detail: { kind: 'file', error: error instanceof Error ? error.message : String(error) },
        degradation: 'db_read_only',
      };
    } finally {
      try { probe?.close(); } catch { /* the probe failed; the diagnosis is already built */ }
    }
  }

  private kernelIntegrityCheck(): HealthCheck {
    const required = ['_meta', 'memory_events', 'memory_episodes', 'soul_versions'];
    try {
      const rows = this.deps.db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>;
      const quickCheck = rows.map((row) => String(Object.values(row)[0] ?? '')).join('; ');
      const tables = new Set(
        (this.deps.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>)
          .map((row) => row.name),
      );
      const missingTables = required.filter((table) => !tables.has(table));
      const ok = quickCheck === 'ok' && missingTables.length === 0;
      return {
        id: 'kernel_integrity',
        status: ok ? 'ok' : 'degraded',
        detail: { quickCheck, missingTables },
        ...(ok ? {} : { degradation: 'kernel_integrity_failed' as const }),
      };
    } catch (error) {
      return {
        id: 'kernel_integrity',
        status: 'degraded',
        detail: { error: error instanceof Error ? error.message : String(error) },
        degradation: 'kernel_integrity_failed',
      };
    }
  }
}

function readMeta(db: Database, key: string): string | undefined {
  try {
    const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get(key) as { value?: string } | undefined;
    return row?.value;
  } catch {
    return undefined;
  }
}

function writeMeta(db: Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run(key, value);
}
