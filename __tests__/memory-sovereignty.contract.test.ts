import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  SOVEREIGNTY_ACTIONS,
  SOVEREIGNTY_API_METHODS,
  SOVEREIGNTY_AUDIT_FIELDS,
  SOVEREIGNTY_CONTRACT_VERSION,
  SOVEREIGNTY_DELETE_COUNT_FIELDS,
  SOVEREIGNTY_ERROR_CODES,
  SOVEREIGNTY_EXPORT_COUNT_FIELDS,
  SOVEREIGNTY_EXPORT_SECTIONS,
  SOVEREIGNTY_STATUS_FIELDS,
} from '../src/sovereignty/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F9 memory-sovereignty contract (#163): pause writes nothing, a time-range deletion leaves no
 * ghost in the ledger, the four books or the graph, the export is a readable archive that respects
 * deletion and sensitivity marks, and every action is on the owner's audit read.
 */

const scratch = makeTempDir('cogmem-sovereignty-');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath: join(scratch, 'memory.db'), projectTimeZone: 'UTC' });
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/memory-sovereignty.md', import.meta.url)), 'utf8');

function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]!);
}

function frozenKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe('the contract document and the frozen tables agree', () => {
  test('the face, actions, status, audit, counts, sections and errors are the frozen lists', () => {
    expect(backtickedFirstColumn(sectionAfter('## The face (frozen)'))).toEqual([...SOVEREIGNTY_API_METHODS]);
    expect(backtickedFirstColumn(sectionAfter('## Actions (frozen)'))).toEqual([...SOVEREIGNTY_ACTIONS]);
    expect(backtickedFirstColumn(sectionAfter('## Status fields (frozen)'))).toEqual([...SOVEREIGNTY_STATUS_FIELDS]);
    expect(backtickedFirstColumn(sectionAfter('## Audit fields (frozen)'))).toEqual([...SOVEREIGNTY_AUDIT_FIELDS]);
    expect(backtickedFirstColumn(sectionAfter('## Delete counts (frozen)'))).toEqual([...SOVEREIGNTY_DELETE_COUNT_FIELDS]);
    expect(backtickedFirstColumn(sectionAfter('## Export sections (frozen)'))).toEqual([...SOVEREIGNTY_EXPORT_SECTIONS]);
    expect(backtickedFirstColumn(sectionAfter('## Export counts (frozen)'))).toEqual([...SOVEREIGNTY_EXPORT_COUNT_FIELDS]);
    expect(backtickedFirstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...SOVEREIGNTY_ERROR_CODES]);
  });

  test('every frozen method exists and the contract version is 1', () => {
    expect(SOVEREIGNTY_CONTRACT_VERSION).toBe(1);
    for (const method of SOVEREIGNTY_API_METHODS) {
      expect(typeof (kernel.sovereignty as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});

describe('pause is a write-path gate', () => {
  test('a paused project appends no row and refuses ingest; resume writes again', async () => {
    const projectId = 'sovereignty-pause';
    const paused = kernel.sovereignty.pause(projectId, 'incognito');
    expect(paused.paused).toBe(true);
    expect(typeof paused.since).toBe('number');
    expect(frozenKeys(kernel.sovereignty.status(projectId))).toEqual([...SOVEREIGNTY_STATUS_FIELDS].sort());

    let rawRefused = false;
    try {
      kernel.recordRawEvent({
        projectId,
        threadId: 'pause-thread',
        role: 'user',
        content: '暂停期不该落账 pausemarker。',
        occurredAt: paused.since!,
      });
    } catch (error) {
      rawRefused = String(error).includes('recording_paused');
    }
    expect(rawRefused).toBe(true);
    await expect(kernel.ingest({ projectId, content: '暂停期也不该进神经元 pausemarker。' }))
      .rejects.toThrow('recording_paused');

    const resumed = kernel.sovereignty.resume(projectId);
    expect(resumed.paused).toBe(false);
    const during = kernel.eventStore.queryEvents(1, 100, {
      projectId: [projectId],
      startTime: paused.since,
      endTime: resumed.since ?? Date.now(),
      order: 'asc',
    });
    expect(during.total).toBe(0);
    expect(during.records).toHaveLength(0);

    const after = kernel.recordRawEvent({
      projectId,
      threadId: 'pause-thread',
      role: 'user',
      content: '恢复后正常记录。',
    });
    expect(kernel.eventStore.getEvent(after.eventId)).toBeTruthy();

    const audit = kernel.sovereignty.audit(projectId);
    expect(audit.map((entry) => entry.action)).toEqual(['resume_recording', 'pause_recording']);
    for (const entry of audit) {
      expect(frozenKeys(entry)).toEqual([...SOVEREIGNTY_AUDIT_FIELDS].sort());
      expect(typeof entry.range.start).toBe('number');
      expect(typeof entry.range.end).toBe('number');
      expect(typeof entry.counts).toBe('object');
    }
  });
});

describe('deleting a time range removes it everywhere', () => {
  test('ledger, books, session digest and graph lose the window; adjacent turns survive', () => {
    const projectId = 'sovereignty-delete';
    const rangeStart = Date.UTC(2026, 0, 10);
    const rangeEnd = Date.UTC(2026, 0, 11);
    const sessionId = 's-delete';
    const lane = { captureLane: 'conversation', sourceAgent: 'a', speaker: 'owner', channel: 'chat' };

    const promise = kernel.recordRawEvent({
      projectId,
      threadId: 'delete-thread',
      sessionId,
      sourceId: `a:${sessionId}`,
      role: 'user',
      content: '我明天把文件发你。',
      occurredAt: rangeStart + 1_000,
      metadata: lane,
    });
    const procedure = kernel.recordRawEvent({
      projectId,
      threadId: 'delete-thread',
      sessionId,
      sourceId: `a:${sessionId}`,
      role: 'assistant',
      content: '已把邮件附件发送。',
      occurredAt: rangeStart + 2_000,
      metadata: {
        ...lane,
        procedure: { domain: 'email', key: 'send-file', title: '发送文件', steps: ['打开邮件', '附上文件'], outcome: 'succeeded' },
      },
    });
    const preference = kernel.recordRawEvent({
      projectId,
      threadId: 'delete-thread',
      sessionId,
      sourceId: `a:${sessionId}`,
      role: 'user',
      content: '我喜欢喝乌龙茶。',
      occurredAt: rangeStart + 3_000,
      metadata: lane,
    });
    const outside = kernel.recordRawEvent({
      projectId,
      threadId: 'delete-thread',
      sessionId,
      sourceId: `a:${sessionId}`,
      role: 'user',
      content: '我住在东京。',
      occurredAt: rangeEnd + 1_000,
      metadata: lane,
    });

    kernel.beliefStore.upsert({
      projectId,
      scope: 'project',
      subject: 'owner',
      predicate: 'likes',
      objectValue: { raw: 'oolong', type: 'string' },
      confidence: 0.9,
      sourceType: 'user_input',
      extractionReason: 'preference_signal',
      sourceEventId: preference.eventId,
      validFrom: rangeStart + 3_000,
    });
    kernel.profile.compile({ projectId });
    kernel.procedures.compile({ projectId });
    kernel.commitments.compile({ projectId });
    // A compiled row written later (outside the window) but citing a turn inside it: deletion must
    // follow the evidence, not only the row's own timestamp.
    const ghostEntryId = 'profile-ghost';
    kernel.eventStore.append({
      streamId: `profile-entry:${ghostEntryId}`,
      streamType: 'system',
      eventType: 'PROFILE_ENTRY_COMPILED',
      projectId,
      sourceId: 'profile',
      occurredAt: rangeEnd + 10_000,
      payload: {
        entryId: ghostEntryId,
        ledger: 'facts',
        key: 'derived.ghost',
        value: 'ghost-from-range',
        sourceRefs: [{ eventId: promise.eventId }],
        recordedAt: rangeStart + 4_000,
        compiledAt: rangeEnd + 10_000,
        version: 1,
      },
    });

    expect(kernel.profile.entries({ projectId }).some((entry) => entry.value.includes('oolong'))).toBe(true);
    expect(kernel.procedures.entries({ projectId }).some((entry) => entry.title === '发送文件')).toBe(true);
    expect(kernel.commitments.list({ projectId, limit: 100 }).some((entry) => entry.content.includes('文件'))).toBe(true);
    expect(kernel.profile.entries({ projectId }).some((entry) => entry.key === 'derived.ghost')).toBe(true);

    kernel.graphOverview({ projectId, refresh: true });
    expect(kernel.memoryAtlasStore.listNodes(projectId, 1000).length).toBeGreaterThan(0);

    const result = kernel.sovereignty.deleteRange({ projectId, start: rangeStart, end: rangeEnd, reason: 'owner asked' });
    // The count covers every ledger row stamped in the window, including the compiled entry rows
    // that inherited the evidence's time; the three raw turns are the floor.
    expect(result.deleted.events).toBeGreaterThanOrEqual(3);
    for (const field of SOVEREIGNTY_DELETE_COUNT_FIELDS) expect(result.deleted).toHaveProperty(field, expect.any(Number));

    const range = kernel.eventStore.queryEvents(1, 100, {
      projectId: [projectId],
      startTime: rangeStart,
      endTime: rangeEnd,
      order: 'asc',
    });
    expect(range.total).toBe(0);
    expect(range.records).toHaveLength(0);
    expect(kernel.eventStore.getEvent(promise.eventId)).toBeFalsy();
    expect(kernel.eventStore.getEvent(procedure.eventId)).toBeFalsy();
    expect(kernel.eventStore.getEvent(preference.eventId)).toBeFalsy();
    expect(kernel.eventStore.getEvent(outside.eventId)).toBeTruthy();

    expect(kernel.profile.entries({ projectId }).some((entry) => entry.value.includes('oolong'))).toBe(false);
    expect(kernel.procedures.entries({ projectId })).toHaveLength(0);
    expect(kernel.commitments.list({ projectId, limit: 100 })).toHaveLength(0);
    expect(kernel.profile.entries({ projectId }).some((entry) => entry.key === 'derived.ghost')).toBe(false);
    expect(kernel.eventStore.getEventsByStreamId(`profile-entry:${ghostEntryId}`, projectId)).toHaveLength(0);

    const digest = kernel.sessionContext.digest({ projectId, agentId: 'a', sessionId });
    const digestText = [...digest.entries.map((entry) => entry.text), ...digest.tail.map((turn) => turn.text)].join('\n');
    expect(digestText).not.toContain('文件');
    expect(digestText).not.toContain('乌龙茶');
    expect(digestText).not.toContain('打开邮件');
    expect(digestText).toContain('我住在东京。');

    const nodes = kernel.memoryAtlasStore.listNodes(projectId, 1000);
    for (const removed of [promise.eventId, procedure.eventId, preference.eventId]) {
      expect(nodes.some((node) => node.sourceId === removed || node.id === `raw_event:${removed}`)).toBe(false);
    }

    const audit = kernel.sovereignty.audit(projectId);
    const deletion = audit.find((entry) => entry.action === 'delete_range')!;
    expect(deletion.range).toEqual({ start: rangeStart, end: rangeEnd });
    expect(deletion.counts.events).toBeGreaterThanOrEqual(3);
    expect(frozenKeys(deletion)).toEqual([...SOVEREIGNTY_AUDIT_FIELDS].sort());
    expect(JSON.stringify(deletion)).not.toContain('乌龙茶');
    expect(JSON.stringify(deletion)).not.toContain('文件');
  });
});

describe('audit ordering within one millisecond (#215)', () => {
  test('same-millisecond rows keep write order, not audit_id order', () => {
    const projectId = 'sovereignty-same-ms';
    const scope = `sha256:${createHash('sha256').update(projectId).digest('hex')}`;
    const at = Date.UTC(2026, 1, 1);
    const details = JSON.stringify({ start: at, end: at, counts: {} });
    const insert = kernel.factStore.getDatabase().prepare(
      `INSERT INTO governance_audit_log (audit_id, action, project_id, reason, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // Inserted pause first, resume second. `audit_id DESC` would put 'audit-zzz' first and flip the
    // pair, which is the old bug; the read must follow the write order.
    insert.run('audit-zzz', 'pause_recording', scope, null, details, at);
    insert.run('audit-aaa', 'resume_recording', scope, null, details, at);

    expect(kernel.sovereignty.audit(projectId).map((entry) => entry.action))
      .toEqual(['resume_recording', 'pause_recording']);
    expect(kernel.getGovernanceAudit(projectId).map((entry) => entry.action))
      .toEqual(['resume_recording', 'pause_recording']);
  });
});

describe('the whole-library export is readable and respects deletion', () => {
  test('sections, times, sources and sensitivity labels are present; deleted text is absent', () => {
    const projectId = 'sovereignty-export';
    const now = Date.UTC(2026, 10, 15, 12);
    const promise = kernel.recordRawEvent({
      projectId,
      threadId: 'export-thread',
      role: 'user',
      content: '我明天把报告发你。',
      occurredAt: now - 3_600_000,
    });
    const sensitive = kernel.recordRawEvent({
      projectId,
      threadId: 'export-thread',
      role: 'user',
      content: '医生给我开了处方，诊断是高血压。',
      occurredAt: now - 1_800_000,
    });
    const preference = kernel.recordRawEvent({
      projectId,
      threadId: 'export-thread',
      role: 'user',
      content: '我喜欢喝乌龙茶。',
      occurredAt: now - 900_000,
    });
    kernel.beliefStore.upsert({
      projectId,
      scope: 'project',
      subject: 'owner',
      predicate: 'likes',
      objectValue: { raw: 'oolong', type: 'string' },
      confidence: 0.9,
      sourceType: 'user_input',
      extractionReason: 'preference_signal',
      sourceEventId: preference.eventId,
      validFrom: now - 900_000,
    });
    kernel.profile.compile({ projectId });
    kernel.commitments.compile({ projectId });

    const first = join(scratch, 'archive-first.md');
    const firstResult = kernel.sovereignty.exportArchive({ projectId, outputPath: first });
    const body = readFileSync(first, 'utf8');
    for (const section of SOVEREIGNTY_EXPORT_SECTIONS) expect(body).toContain(`## ${section}`);
    expect(body).toContain('# Cog Memory Archive');
    expect(body).toContain(`Project: ${projectId}`);
    expect(body).toContain('Exported: ');
    expect(body).toContain(promise.eventId);
    expect(body).toContain(new Date(promise.occurredAt).toISOString());
    expect(body).toContain('Sensitivity: life-sensitivity: high');
    expect(body).toContain('报告');
    expect(body).toContain('oolong');
    expect(body).toContain(`source ${preference.eventId}`);
    expect(frozenKeys(firstResult.counts)).toEqual([...SOVEREIGNTY_EXPORT_COUNT_FIELDS].sort());
    expect(firstResult.bytes).toBeGreaterThan(0);

    kernel.sovereignty.deleteRange({ projectId, start: now - 7_200_000, end: now - 2_700_000, reason: 'erase the report promise' });
    const second = join(scratch, 'archive-second.md');
    kernel.sovereignty.exportArchive({ projectId, outputPath: second });
    const after = readFileSync(second, 'utf8');
    expect(after).not.toContain('报告');
    expect(after).not.toContain(promise.eventId);
    expect(after).toContain(sensitive.eventId);
    expect(after).toContain('Sensitivity: life-sensitivity: high');
    expect(after).toContain('oolong');

    const audit = kernel.sovereignty.audit(projectId);
    const exports = audit.filter((entry) => entry.action === 'export_archive');
    expect(exports).toHaveLength(2);
    for (const entry of exports) {
      expect(frozenKeys(entry)).toEqual([...SOVEREIGNTY_AUDIT_FIELDS].sort());
      expect(frozenKeys(entry.counts)).toEqual([...SOVEREIGNTY_EXPORT_COUNT_FIELDS].sort());
    }
  });
});
