/**
 * Memory sovereignty (#163, F9): the owner's controls over what is recorded, what is forgotten by
 * time, what leaves the machine, and what the control actions themselves left behind.
 *
 * Three of the four are deliberately small:
 *
 * - **Pause** is a kernel state, checked where the ledger is appended. A paused project writes no
 *   raw row at all; the host is refused rather than handed a filtered result later.
 * - **Range deletion** removes the ledger rows in a half-open window, the compiled-book rows whose
 *   `sourceRefs` point into that window, and the graph/episodes derived from them, then recompiles
 *   the books and rebuilds the Atlas from what is left.
 * - **Export** is a Markdown archive read from the current ledger and books, never a database dump.
 *
 * Every action writes one `governance_audit_log` row. The audit row carries the range, the counts
 * and the time; it never carries the deleted text or the exported content.
 *
 * The written contract is `docs/memory-sovereignty.md`.
 */
import type Database from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CommitmentBook } from '../commitment/CommitmentBook.js';
import type { ProcedureCompiler } from '../procedure/ProcedureCompiler.js';
import type { ProfileCompiler, ProfileEntry } from '../profile/ProfileCompiler.js';
import { eventLifeSensitivityTier } from '../security/LifeSensitivity.js';
import { eventHoldsSecretMark } from '../security/SecretMarks.js';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';
import { projectScope } from '../topology/ProjectScope.js';

export const SOVEREIGNTY_CONTRACT_VERSION = 1;

/** The control actions this face records. Frozen by the contract document. */
export const SOVEREIGNTY_ACTIONS = [
  'pause_recording',
  'resume_recording',
  'delete_range',
  'export_archive',
] as const;
export type SovereigntyAction = (typeof SOVEREIGNTY_ACTIONS)[number];

/** The methods on the face. Frozen by the contract document. */
export const SOVEREIGNTY_API_METHODS = ['status', 'pause', 'resume', 'deleteRange', 'exportArchive', 'audit'] as const;

/** The fields an audit read returns. Frozen. */
export const SOVEREIGNTY_AUDIT_FIELDS = [
  'auditId',
  'action',
  'projectId',
  'range',
  'counts',
  'createdAt',
] as const;

/** The fields the pause status read returns. Frozen. */
export const SOVEREIGNTY_STATUS_FIELDS = ['projectId', 'paused', 'since'] as const;

/** The sections every exported archive carries, in order. Frozen. */
export const SOVEREIGNTY_EXPORT_SECTIONS = [
  'Conversations',
  'Profile',
  'Procedures',
  'Commitments',
  'Memory graph',
] as const;

/** The counts a range deletion reports. Frozen. */
export const SOVEREIGNTY_DELETE_COUNT_FIELDS = [
  'events',
  'derivedEntries',
  'entryVersions',
  'neurons',
  'facts',
  'synapses',
  'beliefs',
  'entityMentions',
  'episodes',
  'frames',
] as const;

/** The counts an export reports. Frozen. */
export const SOVEREIGNTY_EXPORT_COUNT_FIELDS = [
  'events',
  'profile',
  'procedures',
  'commitments',
  'graph',
] as const;

/** The refusals this face names. Frozen. */
export const SOVEREIGNTY_ERROR_CODES = [
  'project_id_required',
  'recording_paused',
  'invalid_sovereignty_range',
  'invalid_sovereignty_path',
  'invalid_limit',
] as const;
export type SovereigntyErrorCode = (typeof SOVEREIGNTY_ERROR_CODES)[number];

export interface SovereigntyStatus {
  projectId: string;
  paused: boolean;
  since?: number;
}

export interface SovereigntyAuditRecord {
  auditId: string;
  action: SovereigntyAction | string;
  projectId: string;
  range: { start: number; end: number };
  counts: Record<string, number>;
  createdAt: number;
}

export interface SovereigntyDeleteInput {
  projectId: string;
  start: number;
  end: number;
  reason?: string;
}

export interface SovereigntyDeleteResult extends SovereigntyDeleteInput {
  auditId: string;
  deleted: Record<string, number>;
}

export interface SovereigntyExportInput {
  projectId: string;
  outputPath: string;
}

export interface SovereigntyExportResult {
  projectId: string;
  path: string;
  counts: Record<string, number>;
  bytes: number;
  auditId: string;
}

export interface MemorySovereigntyPorts {
  db: Database;
  events: EventStore;
  profile: ProfileCompiler;
  procedures: ProcedureCompiler;
  commitments: CommitmentBook;
  rebuildAtlas?: (projectId: string) => unknown;
  now?: () => number;
}

function error(code: SovereigntyErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function requiredProject(projectId: string | undefined): string {
  if (typeof projectId !== 'string' || (projectId !== '' && projectId.trim() === '')) {
    throw error('project_id_required');
  }
  return projectScope(projectId);
}

function refsOf(payload: unknown): string[] {
  const out: string[] = [];
  const sourceRefs = (payload as { sourceRefs?: unknown } | undefined)?.sourceRefs;
  if (Array.isArray(sourceRefs)) {
    for (const ref of sourceRefs) {
      const eventId = (ref as { eventId?: unknown } | undefined)?.eventId;
      if (typeof eventId === 'string') out.push(eventId);
    }
  }
  const evidence = (payload as { evidenceEventIds?: unknown } | undefined)?.evidenceEventIds;
  if (Array.isArray(evidence)) {
    for (const eventId of evidence) if (typeof eventId === 'string') out.push(eventId);
  }
  return out;
}

function eventText(event: MemoryEvent): string {
  const text = (event.payload as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text : '';
}

function iso(ms: number): string {
  const value = new Date(ms);
  return Number.isFinite(value.getTime()) ? value.toISOString() : String(ms);
}

function sensitivityLabel(event: MemoryEvent): string | undefined {
  const labels: string[] = [];
  if (eventHoldsSecretMark(event)) labels.push('secret');
  const tier = eventLifeSensitivityTier(event);
  if (tier) labels.push(`life-sensitivity: ${tier}`);
  return labels.length ? labels.join(', ') : undefined;
}

function entrySensitivity(refs: readonly MemorySourceRef[], events: EventStore): string | undefined {
  const labels = new Set<string>();
  for (const ref of refs) {
    if (!ref.eventId) continue;
    const event = events.getEvent(ref.eventId);
    if (!event) continue;
    const label = sensitivityLabel(event);
    if (label) labels.add(label);
  }
  return labels.size ? [...labels].join(', ') : undefined;
}

function sourceLabel(refs: readonly MemorySourceRef[]): string | undefined {
  const ids = refs.map((ref) => ref.eventId).filter((id): id is string => typeof id === 'string' && id.length > 0);
  return ids.length ? ids.slice(0, 3).join(', ') : undefined;
}

export class MemorySovereigntyService {
  private readonly now: () => number;

  constructor(private readonly ports: MemorySovereigntyPorts) {
    this.now = ports.now ?? (() => Date.now());
    this.ensureAuditTable();
  }

  /** Whether the project is paused. The write path asks this before appending a raw row. */
  recordingPaused(projectId: string | undefined): boolean {
    const scope = projectScope(projectId);
    return this.readPause(scope) !== undefined;
  }

  status(projectId: string): SovereigntyStatus {
    const scope = requiredProject(projectId);
    const pause = this.readPause(scope);
    return { projectId: scope, paused: pause !== undefined, since: pause?.pausedAt };
  }

  pause(projectId: string, reason?: string): SovereigntyStatus {
    const scope = requiredProject(projectId);
    if (this.readPause(scope)) return this.status(scope);
    const pausedAt = this.now();
    this.ports.db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)`)
      .run(this.pauseKey(scope), JSON.stringify({ pausedAt, reason }));
    this.writeAudit('pause_recording', scope, { start: pausedAt, end: pausedAt, counts: {} }, reason);
    return { projectId: scope, paused: true, since: pausedAt };
  }

  resume(projectId: string): SovereigntyStatus {
    const scope = requiredProject(projectId);
    const pause = this.readPause(scope);
    if (!pause) return this.status(scope);
    this.ports.db.prepare(`DELETE FROM _meta WHERE key=?`).run(this.pauseKey(scope));
    const resumedAt = this.now();
    this.writeAudit('resume_recording', scope, {
      start: pause.pausedAt,
      end: resumedAt,
      counts: { pausedMs: Math.max(0, resumedAt - pause.pausedAt) },
    });
    return { projectId: scope, paused: false };
  }

  /**
   * Delete one half-open window. The ledger rows in `[start, end)` go first; every compiled-book
   * row whose `sourceRefs` names one of those events goes with the whole entry stream; facts,
   * beliefs, neurons, episodes and graph documents derived from the window are removed; then the
   * books recompile and the Atlas rebuilds from what remains.
   */
  deleteRange(input: SovereigntyDeleteInput): SovereigntyDeleteResult {
    const scope = requiredProject(input.projectId);
    if (!Number.isFinite(input.start) || !Number.isFinite(input.end) || input.start >= input.end) {
      throw error('invalid_sovereignty_range');
    }
    const all = this.readAllEvents(scope);
    const range = all.filter((event) => event.occurredAt >= input.start && event.occurredAt < input.end);
    const rangeIds = new Set(range.map((event) => event.eventId));
    const derived = all.filter((event) => !rangeIds.has(event.eventId) && refsOf(event.payload).some((id) => rangeIds.has(id)));
    const entryStreams = new Set(derived.map((event) => event.streamId).filter((streamId) => (
      streamId.startsWith('profile-entry:') || streamId.startsWith('procedure-entry:') || streamId.startsWith('commitment:')
    )));
    const streamRows = all.filter((event) => entryStreams.has(event.streamId));
    const deleteIds = new Set([...rangeIds, ...derived.map((event) => event.eventId), ...streamRows.map((event) => event.eventId)]);
    const deleted = Object.fromEntries(SOVEREIGNTY_DELETE_COUNT_FIELDS.map((field) => [field, 0])) as Record<string, number>;
    deleted.events = rangeIds.size;
    deleted.derivedEntries = derived.length;
    deleted.entryVersions = streamRows.length;
    if (deleteIds.size === 0) {
      const auditId = this.writeAudit('delete_range', scope, { start: input.start, end: input.end, counts: deleted }, input.reason);
      return { ...input, projectId: scope, auditId, deleted };
    }

    const episodeRows = this.episodesInRange(scope, input.start, input.end, rangeIds);
    const episodeIds = new Set(episodeRows.map((row) => row.episodeId));
    const neuronIds = this.neuronsForEvents(scope, [...rangeIds]);
    if (neuronIds.length === 0) {
      deleted.facts = 0;
      deleted.synapses = 0;
      deleted.entityMentions = 0;
    }
    if (episodeIds.size === 0) {
      deleted.episodes = 0;
      deleted.frames = 0;
    }

    this.ports.db.transaction(() => {
      const placeholders = [...deleteIds].map(() => '?').join(', ');
      const ids = [...deleteIds];
      this.deleteIfTable('memory_events_fts', `DELETE FROM memory_events_fts WHERE event_id IN (${placeholders})`, ids);
      deleted.neurons = neuronIds.length;
      if (neuronIds.length > 0) {
        const p = neuronIds.map(() => '?').join(', ');
        deleted.facts = this.runDelete(`DELETE FROM facts WHERE neuron_id IN (${p})`, neuronIds);
        deleted.synapses = this.runDelete(`DELETE FROM synapses WHERE source_id IN (${p}) OR target_id IN (${p})`, [...neuronIds, ...neuronIds]);
        deleted.beliefs = this.runDelete(`DELETE FROM beliefs WHERE source_event_id IN (${placeholders}) OR source_neuron_id IN (${p})`, [...ids, ...neuronIds]);
        deleted.entityMentions = this.runDelete(`DELETE FROM entity_mentions WHERE neuron_id IN (${p})`, neuronIds);
        this.deleteIfTable('neuron_embeddings', `DELETE FROM neuron_embeddings WHERE neuron_id IN (${p})`, neuronIds);
        this.deleteIfTable('vector_index', `DELETE FROM vector_index WHERE neuron_id IN (${p})`, neuronIds);
        this.deleteIfTable('neurons_fts', `DELETE FROM neurons_fts WHERE id IN (${p})`, neuronIds);
        deleted.neurons = this.runDelete(`DELETE FROM neurons WHERE id IN (${p})`, neuronIds);
      } else {
        deleted.beliefs = this.runDelete(`DELETE FROM beliefs WHERE source_event_id IN (${placeholders})`, ids);
      }
      if (episodeIds.size > 0) {
        const e = [...episodeIds].map(() => '?').join(', ');
        const episodeParams = [...episodeIds];
        this.runDelete(`DELETE FROM memory_episode_events WHERE episode_id IN (${e}) OR event_id IN (${placeholders})`, [...episodeParams, ...ids]);
        this.deleteIfTable('memory_frame_reviews', `DELETE FROM memory_frame_reviews WHERE frame_id IN (SELECT frame_id FROM memory_frames WHERE episode_id IN (${e}))`, episodeParams);
        this.deleteIfTable('memory_frame_relations', `DELETE FROM memory_frame_relations WHERE frame_id IN (SELECT frame_id FROM memory_frames WHERE episode_id IN (${e}))`, episodeParams);
        this.deleteIfTable('memory_frame_nodes', `DELETE FROM memory_frame_nodes WHERE frame_id IN (SELECT frame_id FROM memory_frames WHERE episode_id IN (${e}))`, episodeParams);
        deleted.frames = this.deleteIfTable('memory_frames', `DELETE FROM memory_frames WHERE episode_id IN (${e})`, episodeParams);
        deleted.episodes = this.runDelete(`DELETE FROM memory_episodes WHERE episode_id IN (${e})`, episodeParams);
      }
      this.deleteIfTable('memory_atlas_documents',
        `DELETE FROM memory_atlas_documents WHERE project_id=? AND (
           source_id IN (${placeholders})
           OR EXISTS (SELECT 1 FROM json_each(evidence_event_ids_json) WHERE value IN (${placeholders}))
         )`,
        [scope, ...ids, ...ids]);
      this.runDelete(`DELETE FROM memory_events WHERE event_id IN (${placeholders})`, ids);
    })();

    // The ledger and derived rows are gone before the audit row is written, so a failed recompile
    // still leaves the owner a record of what was removed.
    const auditId = this.writeAudit('delete_range', scope, { start: input.start, end: input.end, counts: deleted }, input.reason);
    // The books are views over the ledger, so a recompile is the consistency proof rather than a
    // second deletion list: an entry whose evidence is gone does not come back.
    if (scope) {
      this.ports.profile.compile({ projectId: scope, now: this.now() });
      this.ports.procedures.compile({ projectId: scope, now: this.now() });
      this.ports.commitments.compile({ projectId: scope, now: this.now() });
    }
    this.ports.rebuildAtlas?.(scope);
    return { ...input, projectId: scope, auditId, deleted };
  }

  /** Write the human-readable archive. The current ledger is the source, so deleted ranges are absent. */
  exportArchive(input: SovereigntyExportInput): SovereigntyExportResult {
    const scope = requiredProject(input.projectId);
    const path = typeof input.outputPath === 'string' ? input.outputPath.trim() : '';
    if (!path) throw error('invalid_sovereignty_path');
    const events = this.readAllEvents(scope).filter((event) => eventText(event).trim().length > 0);
    const profile = scope ? this.ports.profile.entries({ projectId: scope }) : [];
    const procedures = scope ? this.ports.procedures.entries({ projectId: scope }) : [];
    const commitments = scope ? this.ports.commitments.list({ projectId: scope, limit: 1000, now: this.now() }) : [];
    const graph = this.graphRows(scope);
    const exportedAt = this.now();
    const lines: string[] = [
      '# Cog Memory Archive',
      '',
      `Project: ${scope || '(projectless)'}`,
      `Exported: ${iso(exportedAt)}`,
      '',
      `This is a human-readable archive, not a database dump. It contains ${events.length} conversation turns, ${profile.length} profile entries, ${procedures.length} procedures, ${commitments.length} commitments and ${graph.length} graph nodes.`,
      '',
      '## Conversations',
      '',
    ];
    if (events.length === 0) lines.push('_No conversation turns remain._', '');
    for (const event of events) {
      const label = sensitivityLabel(event);
      lines.push(`### ${iso(event.occurredAt)} · ${event.role ?? 'unknown'} · ${event.eventId}`, '');
      if (label) lines.push(`Sensitivity: ${label}`, '');
      lines.push(eventText(event).trim(), '');
    }
    lines.push('## Profile', '');
    this.renderEntries(lines, 'Facts', profile.filter((entry) => entry.ledger === 'facts'), this.ports.events);
    this.renderEntries(lines, 'Preferences', profile.filter((entry) => entry.ledger === 'preferences'), this.ports.events);
    this.renderEntries(lines, 'Relations', profile.filter((entry) => entry.ledger === 'relations'), this.ports.events);
    this.renderEntries(lines, 'Ongoing', profile.filter((entry) => entry.ledger === 'ongoing'), this.ports.events);
    lines.push('## Procedures', '');
    if (procedures.length === 0) lines.push('_No procedures remain._', '');
    for (const entry of procedures) {
      const label = entrySensitivity(entry.sourceRefs, this.ports.events);
      const source = sourceLabel(entry.sourceRefs);
      lines.push(`### ${entry.title}`, '', `Domain: ${entry.domain} · ${entry.grade} · ${entry.origin}${source ? ` · source ${source}` : ''}`, '');
      if (label) lines.push(`Sensitivity: ${label}`, '');
      lines.push(...entry.steps.map((step, index) => `${index + 1}. ${step}`), '');
    }
    lines.push('## Commitments', '');
    if (commitments.length === 0) lines.push('_No commitments remain._', '');
    for (const entry of commitments) {
      const label = entrySensitivity(entry.sourceRefs, this.ports.events);
      const source = sourceLabel(entry.sourceRefs);
      lines.push(`- ${entry.content} — ${entry.status}${entry.dueAt ? ` · due ${iso(entry.dueAt)}` : ''}${source ? ` · source ${source}` : ''}`);
      if (label) lines.push(`  Sensitivity: ${label}`);
    }
    lines.push('', '## Memory graph', '');
    if (graph.length === 0) lines.push('_No graph nodes remain._', '');
    for (const row of graph) lines.push(`- ${row.node_type}: ${row.label}`);
    lines.push('');
    mkdirSync(dirname(path), { recursive: true });
    const body = lines.join('\n');
    writeFileSync(path, body, 'utf8');
    const counts = Object.fromEntries(SOVEREIGNTY_EXPORT_COUNT_FIELDS.map((field) => [field, 0])) as Record<string, number>;
    Object.assign(counts, { events: events.length, profile: profile.length, procedures: procedures.length, commitments: commitments.length, graph: graph.length });
    const auditId = this.writeAudit('export_archive', scope, { start: exportedAt, end: exportedAt, path, counts });
    return { projectId: scope, path, counts, bytes: Buffer.byteLength(body, 'utf8'), auditId };
  }

  /** The owner's read: what was paused, deleted and exported, with range, counts and time. */
  audit(projectId: string, limit = 50): SovereigntyAuditRecord[] {
    const scope = requiredProject(projectId);
    if (!Number.isInteger(limit) || limit <= 0) throw error('invalid_limit');
    const rows = this.ports.db.prepare(`
      SELECT audit_id, action, details_json, created_at
      FROM governance_audit_log
      WHERE project_id=?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(this.auditScope(scope), Math.min(limit, 500)) as Array<{
      audit_id: string;
      action: string;
      details_json: string | null;
      created_at: number;
    }>;
    return rows
      .filter((row) => (SOVEREIGNTY_ACTIONS as readonly string[]).includes(row.action))
      .map((row) => {
        const details = row.details_json ? JSON.parse(row.details_json) as Record<string, unknown> : {};
        const counts = (details.counts ?? details.deleted ?? {}) as Record<string, number>;
        const start = typeof details.start === 'number' ? details.start : typeof details.since === 'number' ? details.since : Number(row.created_at);
        const end = typeof details.end === 'number' ? details.end : start;
        return {
          auditId: row.audit_id,
          action: row.action,
          projectId: scope,
          range: { start, end },
          counts,
          createdAt: Number(row.created_at),
        };
      });
  }

  private renderEntries(lines: string[], title: string, entries: ProfileEntry[], events: EventStore): void {
    lines.push(`### ${title}`, '');
    if (entries.length === 0) lines.push('_No entries remain._', '');
    for (const entry of entries) {
      const label = entrySensitivity(entry.sourceRefs, events);
      const source = sourceLabel(entry.sourceRefs);
      lines.push(`- ${entry.key}: ${entry.value} (recorded ${iso(entry.recordedAt)}${source ? ` · source ${source}` : ''})`);
      if (label) lines.push(`  Sensitivity: ${label}`);
    }
    lines.push('');
  }

  private readAllEvents(scope: string): MemoryEvent[] {
    const out: MemoryEvent[] = [];
    const pageSize = 1000;
    for (let page = 1; ; page += 1) {
      const result = this.ports.events.queryEvents(page, pageSize, { projectId: [scope], order: 'asc' });
      out.push(...result.records);
      if (result.records.length < pageSize || out.length >= result.total) break;
    }
    return out;
  }

  private episodesInRange(scope: string, start: number, end: number, rangeIds: Set<string>): Array<{ episodeId: string }> {
    const placeholders = [...rangeIds].map(() => '?').join(', ');
    const ids = [...rangeIds];
    const rows = this.ports.db.prepare(`
      SELECT DISTINCT episode_id FROM memory_episodes
      WHERE project_id=? AND (
        (started_at < ? AND COALESCE(sealed_at, updated_at) >= ?)
        ${ids.length ? `OR start_event_id IN (${placeholders}) OR end_event_id IN (${placeholders})` : ''}
      )
    `).all(scope, end, start, ...ids, ...ids) as Array<{ episode_id: string }>;
    return rows.map((row) => ({ episodeId: row.episode_id }));
  }

  private neuronsForEvents(scope: string, eventIds: string[]): string[] {
    if (eventIds.length === 0) return [];
    const placeholders = eventIds.map(() => '?').join(', ');
    const rows = this.ports.db.prepare(`
      SELECT id FROM neurons WHERE COALESCE(project_id, '')=? AND source_event_id IN (${placeholders})
    `).all(scope, ...eventIds) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private graphRows(scope: string): Array<{ node_type: string; label: string }> {
    if (!this.tableExists('memory_atlas_documents')) return [];
    return this.ports.db.prepare(`
      SELECT node_type, label FROM memory_atlas_documents
      WHERE project_id=? AND status='active'
      ORDER BY node_type, label LIMIT 500
    `).all(scope) as Array<{ node_type: string; label: string }>;
  }

  private readPause(scope: string): { pausedAt: number } | undefined {
    if (!this.tableExists('_meta')) return undefined;
    const row = this.ports.db.prepare(`SELECT value FROM _meta WHERE key=?`).get(this.pauseKey(scope)) as { value?: string } | undefined;
    if (!row?.value) return undefined;
    try {
      const parsed = JSON.parse(row.value) as { pausedAt?: unknown };
      return typeof parsed.pausedAt === 'number' ? { pausedAt: parsed.pausedAt } : undefined;
    } catch {
      return undefined;
    }
  }

  private pauseKey(scope: string): string {
    return `sovereignty.pause:${scope}`;
  }

  private auditScope(scope: string): string {
    return `sha256:${createHash('sha256').update(scope).digest('hex')}`;
  }

  private writeAudit(action: SovereigntyAction, scope: string, details: Record<string, unknown>, reason?: string): string {
    const auditId = `audit-${randomUUID()}`;
    this.ports.db.prepare(`
      INSERT INTO governance_audit_log (audit_id, action, project_id, reason, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(auditId, action, this.auditScope(scope), reason ?? null, JSON.stringify(details), this.now());
    return auditId;
  }

  private ensureAuditTable(): void {
    this.ports.db.exec(`
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

  private tableExists(table: string): boolean {
    return Boolean(this.ports.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
  }

  private runDelete(sql: string, params: Array<string | number>): number {
    try {
      return Number(this.ports.db.prepare(sql).run(...params).changes ?? 0);
    } catch (error) {
      if (error instanceof Error && /no such table:/i.test(error.message)) return 0;
      throw error;
    }
  }

  private deleteIfTable(table: string, sql: string, params: Array<string | number>): number {
    return this.tableExists(table) ? this.runDelete(sql, params) : 0;
  }
}
