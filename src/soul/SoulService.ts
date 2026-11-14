/**
 * The versioned soul table (#194, F17).
 *
 * A soul is the companion's own persona text. It is stored per agent, appended rather than updated,
 * and the current version is the highest version for that agent. The owner writes through the
 * observatory; the agent may read its own soul and propose an edit, but it has no save face. The
 * written contract is `docs/soul-storage.md`, held by `__tests__/soul-storage.contract.test.ts`.
 */
import type Database from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';

export const SOUL_CONTRACT_VERSION = 1;

/** The editor's live estimate and the save's hard limit. Over the limit is rejected, never truncated. */
export const SOUL_MAX_TOKENS = 2000;

/** The version record's field set, frozen by the contract document. */
export const SOUL_VERSION_FIELDS = [
  'agentId',
  'version',
  'content',
  'supersedes',
  'createdAt',
  'createdBy',
  'reason',
  'tokenCount',
] as const;

/** The audit actions this face writes. Frozen. */
export const SOUL_AUDIT_ACTIONS = ['soul_save', 'soul_rollback', 'soul_edit_proposed'] as const;
export type SoulAuditAction = (typeof SOUL_AUDIT_ACTIONS)[number];

/** The audit read's field set. Frozen. */
export const SOUL_AUDIT_FIELDS = [
  'auditId',
  'action',
  'agentId',
  'version',
  'supersedes',
  'fromVersion',
  'contentHash',
  'tokens',
  'bytes',
  'reason',
  'createdAt',
] as const;

/** The pinned-lane injection rules, frozen by the contract document. */
export const SOUL_INJECTION_RULES = ['position', 'verbatim', 'stability', 'effective', 'cache'] as const;

/** The observatory endpoints, frozen. `GET` reads; the two `POST`s are the one write exception. */
export const SOUL_ENDPOINTS = [
  'GET /observatory/soul',
  'POST /observatory/soul',
  'POST /observatory/soul/rollback',
] as const;

/** The face's methods. */
export const SOUL_API_METHODS = [
  'read',
  'history',
  'save',
  'rollback',
  'propose',
  'proposal',
  'audit',
  'snapshot',
  'ensureDefault',
] as const;

/** The refusals this face names, frozen. */
export const SOUL_ERROR_CODES = [
  'agent_id_required',
  'soul_content_required',
  'soul_too_long',
  'soul_agent_write_forbidden',
  'soul_writer_required',
  'soul_version_unknown',
  'soul_version_is_current',
] as const;
export type SoulErrorCode = (typeof SOUL_ERROR_CODES)[number];

export type SoulActor = 'user' | 'agent';
export type SoulCreatedBy = 'installer' | 'user';

export interface SoulVersion {
  agentId: string;
  version: number;
  content: string;
  supersedes: number | null;
  createdAt: number;
  createdBy: SoulCreatedBy;
  reason?: string;
  /** Derived on read; never stored. */
  tokenCount: number;
}

export interface SoulProposal {
  agentId: string;
  content: string;
  reason?: string;
  contentHash: string;
  tokens: number;
  bytes: number;
  proposedAt: number;
}

export interface SoulAuditEntry {
  auditId: string;
  action: SoulAuditAction;
  agentId: string;
  version?: number;
  supersedes?: number | null;
  fromVersion?: number;
  contentHash?: string;
  tokens?: number;
  bytes?: number;
  reason?: string;
  createdAt: number;
}

export interface SoulSnapshot {
  agentId: string;
  current?: SoulVersion;
  versions: SoulVersion[];
  proposal?: SoulProposal;
  audit: SoulAuditEntry[];
  maxTokens: number;
  tokenCount: number;
}

export interface SoulSaveInput {
  agentId: string;
  content: string;
  actor: SoulActor;
  reason?: string;
  now?: number;
}

export interface SoulRollbackInput {
  agentId: string;
  version: number;
  actor: SoulActor;
  reason?: string;
  now?: number;
}

export interface SoulProposeInput {
  agentId: string;
  content: string;
  reason?: string;
  now?: number;
}

export class SoulError extends Error {
  constructor(readonly code: SoulErrorCode, message: string = code) {
    super(message);
    this.name = 'SoulError';
  }
}

const CJK_RE = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;

/**
 * A rough token estimate for the editor and the limit: one CJK character, four Latin characters.
 * The exact tokenizer belongs to the provider; this is the same order of magnitude the ticket asks
 * the editor to display, and the contract calls it an estimate rather than a measurement.
 */
export function soulTokens(text: string): number {
  let units = 0;
  for (const char of text) units += CJK_RE.test(char) ? 1 : 0.25;
  return Math.ceil(units);
}

export function ensureSoulSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_versions (
      agent_id   TEXT    NOT NULL,
      version    INTEGER NOT NULL,
      content    TEXT    NOT NULL,
      supersedes INTEGER,
      created_at INTEGER NOT NULL,
      created_by TEXT    NOT NULL,
      reason     TEXT,
      PRIMARY KEY (agent_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_soul_versions_agent_created
      ON soul_versions(agent_id, created_at DESC);
  `);
}

interface SoulRow {
  agent_id: string;
  version: number;
  content: string;
  supersedes: number | null;
  created_at: number;
  created_by: string;
  reason: string | null;
}

function toVersion(row: SoulRow): SoulVersion {
  return {
    agentId: row.agent_id,
    version: Number(row.version),
    content: row.content,
    supersedes: row.supersedes === null ? null : Number(row.supersedes),
    createdAt: Number(row.created_at),
    createdBy: row.created_by === 'user' ? 'user' : 'installer',
    ...(row.reason ? { reason: row.reason } : {}),
    tokenCount: soulTokens(row.content),
  };
}

/** The newest version for an agent, read without opening a writable handle. */
export function readSoulVersion(db: Database, agentId: string): SoulVersion | undefined {
  if (typeof agentId !== 'string' || agentId.trim() === '') return undefined;
  try {
    const row = db.prepare(`
      SELECT agent_id, version, content, supersedes, created_at, created_by, reason
      FROM soul_versions WHERE agent_id = ? ORDER BY version DESC LIMIT 1
    `).get(agentId) as SoulRow | undefined;
    return row ? toVersion(row) : undefined;
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return undefined;
    throw error;
  }
}

export class SoulService {
  private readonly now: () => number;

  constructor(private readonly db: Database, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    ensureSoulSchema(db);
    this.ensureAuditTable();
  }

  read(agentId: string): SoulVersion | undefined {
    return readSoulVersion(this.db, requireAgent(agentId));
  }

  history(agentId: string, limit = 50): SoulVersion[] {
    const scope = requireAgent(agentId);
    const size = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;
    const rows = this.db.prepare(`
      SELECT agent_id, version, content, supersedes, created_at, created_by, reason
      FROM soul_versions WHERE agent_id = ? ORDER BY version DESC LIMIT ?
    `).all(scope, size) as SoulRow[];
    return rows.map(toVersion);
  }

  /** Append version 0 once. The installer's seed, not an owner edit; no audit row. */
  ensureDefault(agentId: string, content: string, now = this.now()): SoulVersion {
    const scope = requireAgent(agentId);
    const text = requireContent(content);
    if (soulTokens(text) > SOUL_MAX_TOKENS) throw new SoulError('soul_too_long');
    const existing = readSoulVersion(this.db, scope);
    if (existing) return existing;
    this.db.prepare(`
      INSERT OR IGNORE INTO soul_versions
        (agent_id, version, content, supersedes, created_at, created_by, reason)
      VALUES (?, 0, ?, NULL, ?, 'installer', NULL)
    `).run(scope, text, now);
    return readSoulVersion(this.db, scope)!;
  }

  save(input: SoulSaveInput): SoulVersion {
    const scope = requireAgent(input.agentId);
    requireUserActor(input.actor);
    const content = requireContent(input.content);
    this.assertLength(content);
    const now = input.now ?? this.now();
    const reason = input.reason?.trim() || undefined;
    return this.db.transaction(() => {
      const current = readSoulVersion(this.db, scope);
      const version = current ? current.version + 1 : 0;
      this.insert({ agentId: scope, version, content, supersedes: current?.version ?? null, createdAt: now, createdBy: 'user', reason });
      this.writeAudit('soul_save', scope, {
        agentId: scope,
        version,
        supersedes: current?.version ?? null,
        contentHash: hashContent(content),
        bytes: Buffer.byteLength(content, 'utf8'),
        tokens: soulTokens(content),
      }, reason, now);
      return readSoulVersion(this.db, scope)!;
    })();
  }

  rollback(input: SoulRollbackInput): SoulVersion {
    const scope = requireAgent(input.agentId);
    requireUserActor(input.actor);
    if (!Number.isInteger(input.version) || input.version < 0) throw new SoulError('soul_version_unknown');
    const target = this.versionAt(scope, input.version);
    if (!target) throw new SoulError('soul_version_unknown');
    const current = readSoulVersion(this.db, scope);
    if (!current) throw new SoulError('soul_version_unknown');
    if (current.version === target.version) throw new SoulError('soul_version_is_current');
    const now = input.now ?? this.now();
    const reason = input.reason?.trim() || undefined;
    return this.db.transaction(() => {
      const version = current.version + 1;
      this.insert({
        agentId: scope,
        version,
        content: target.content,
        supersedes: current.version,
        createdAt: now,
        createdBy: 'user',
        reason,
      });
      this.writeAudit('soul_rollback', scope, {
        agentId: scope,
        version,
        supersedes: current.version,
        fromVersion: target.version,
        contentHash: hashContent(target.content),
        bytes: Buffer.byteLength(target.content, 'utf8'),
        tokens: soulTokens(target.content),
      }, reason, now);
      return readSoulVersion(this.db, scope)!;
    })();
  }

  /** The agent's draft. It is an audit row, not a version; the owner still has to approve it. */
  propose(input: SoulProposeInput): SoulProposal {
    const scope = requireAgent(input.agentId);
    const content = requireContent(input.content);
    this.assertLength(content);
    const now = input.now ?? this.now();
    const reason = input.reason?.trim() || undefined;
    this.writeAudit('soul_edit_proposed', scope, {
      agentId: scope,
      content,
      contentHash: hashContent(content),
      bytes: Buffer.byteLength(content, 'utf8'),
      tokens: soulTokens(content),
    }, reason, now);
    return {
      agentId: scope,
      content,
      ...(reason ? { reason } : {}),
      contentHash: hashContent(content),
      tokens: soulTokens(content),
      bytes: Buffer.byteLength(content, 'utf8'),
      proposedAt: now,
    };
  }

  proposal(agentId: string): SoulProposal | undefined {
    const scope = requireAgent(agentId);
    try {
      const row = this.db.prepare(`
        SELECT details_json, created_at FROM governance_audit_log
        WHERE action = 'soul_edit_proposed'
          AND json_extract(details_json, '$.agentId') = ?
        ORDER BY created_at DESC, audit_id DESC LIMIT 1
      `).get(scope) as { details_json: string | null; created_at: number } | undefined;
      if (!row?.details_json) return undefined;
      const details = JSON.parse(row.details_json) as {
        agentId?: string; content?: string; reason?: string; contentHash?: string; tokens?: number; bytes?: number;
      };
      if (typeof details.content !== 'string') return undefined;
      return {
        agentId: scope,
        content: details.content,
        ...(details.reason ? { reason: details.reason } : {}),
        contentHash: details.contentHash ?? hashContent(details.content),
        tokens: details.tokens ?? soulTokens(details.content),
        bytes: details.bytes ?? Buffer.byteLength(details.content, 'utf8'),
        proposedAt: Number(row.created_at),
      };
    } catch (error) {
      if (error instanceof Error && /no such table/i.test(error.message)) return undefined;
      throw error;
    }
  }

  audit(agentId: string, limit = 50): SoulAuditEntry[] {
    const scope = requireAgent(agentId);
    const size = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;
    try {
      const rows = this.db.prepare(`
        SELECT audit_id, action, details_json, reason, created_at FROM governance_audit_log
        WHERE action IN ('soul_save', 'soul_rollback', 'soul_edit_proposed')
          AND json_extract(details_json, '$.agentId') = ?
        ORDER BY created_at DESC, audit_id DESC LIMIT ?
      `).all(scope, size) as Array<{ audit_id: string; action: string; details_json: string | null; reason: string | null; created_at: number }>;
      return rows.map((row) => {
        const details = row.details_json ? JSON.parse(row.details_json) as Record<string, unknown> : {};
        return {
          auditId: row.audit_id,
          action: row.action as SoulAuditAction,
          agentId: scope,
          ...(typeof details.version === 'number' ? { version: details.version } : {}),
          ...('supersedes' in details ? { supersedes: details.supersedes as number | null } : {}),
          ...(typeof details.fromVersion === 'number' ? { fromVersion: details.fromVersion } : {}),
          ...(typeof details.contentHash === 'string' ? { contentHash: details.contentHash } : {}),
          ...(typeof details.tokens === 'number' ? { tokens: details.tokens } : {}),
          ...(typeof details.bytes === 'number' ? { bytes: details.bytes } : {}),
          ...(row.reason ? { reason: row.reason } : {}),
          createdAt: Number(row.created_at),
        };
      });
    } catch (error) {
      if (error instanceof Error && /no such table/i.test(error.message)) return [];
      throw error;
    }
  }

  snapshot(agentId: string): SoulSnapshot {
    const scope = requireAgent(agentId);
    const current = readSoulVersion(this.db, scope);
    const proposal = this.proposal(scope);
    return {
      agentId: scope,
      ...(current ? { current } : {}),
      versions: this.history(scope),
      ...(proposal ? { proposal } : {}),
      audit: this.audit(scope),
      maxTokens: SOUL_MAX_TOKENS,
      tokenCount: current?.tokenCount ?? 0,
    };
  }

  private versionAt(agentId: string, version: number): SoulVersion | undefined {
    const row = this.db.prepare(`
      SELECT agent_id, version, content, supersedes, created_at, created_by, reason
      FROM soul_versions WHERE agent_id = ? AND version = ?
    `).get(agentId, version) as SoulRow | undefined;
    return row ? toVersion(row) : undefined;
  }

  private insert(input: {
    agentId: string;
    version: number;
    content: string;
    supersedes: number | null;
    createdAt: number;
    createdBy: SoulCreatedBy;
    reason?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO soul_versions
        (agent_id, version, content, supersedes, created_at, created_by, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.agentId,
      input.version,
      input.content,
      input.supersedes,
      input.createdAt,
      input.createdBy,
      input.reason ?? null,
    );
  }

  private assertLength(content: string): void {
    if (soulTokens(content) > SOUL_MAX_TOKENS) {
      throw new SoulError('soul_too_long', `soul_too_long: the estimate is over ${SOUL_MAX_TOKENS} tokens`);
    }
  }

  private writeAudit(
    action: SoulAuditAction,
    agentId: string,
    details: Record<string, unknown>,
    reason: string | undefined,
    now: number,
  ): string {
    const auditId = `audit-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO governance_audit_log (audit_id, action, project_id, reason, details_json, created_at)
      VALUES (?, ?, NULL, ?, ?, ?)
    `).run(auditId, action, reason ?? null, JSON.stringify(details), now);
    return auditId;
  }

  private ensureAuditTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS governance_audit_log (
        audit_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        project_id TEXT,
        reason TEXT,
        details_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }
}

function requireAgent(agentId: unknown): string {
  if (typeof agentId !== 'string' || agentId.trim() === '') throw new SoulError('agent_id_required');
  return agentId;
}

function requireUserActor(actor: unknown): 'user' {
  if (actor === 'agent') throw new SoulError('soul_agent_write_forbidden');
  if (actor !== 'user') throw new SoulError('soul_writer_required');
  return 'user';
}

function requireContent(content: unknown): string {
  if (typeof content !== 'string' || content.trim() === '') throw new SoulError('soul_content_required');
  return content;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
