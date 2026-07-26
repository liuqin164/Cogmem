import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildEpisodeEnvelope, ConversationMarkdownAdapter, type SourceDefinition, type SourceFileSnapshot } from '../src/adapters/index.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { explainRecallWithKernel } from '../src/recall/RecallExplanation.js';
import { EventStore } from '../src/store/EventStore.js';
import {
  normalizeDelimitedRecords,
  normalizeJsonArrayRecords,
  writeNormalizedConversationMarkdown,
} from '../src/utils/ConversationMarkdownNormalization.js';

function tempDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), 'memory.db');
}

function makeSnapshot(source: SourceDefinition, content: string): SourceFileSnapshot {
  return {
    sourceId: source.sourceId,
    adapterKind: source.adapterKind,
    sourcePath: source.sourcePath,
    projectId: source.projectId,
    fileHash: 'ledger-test-hash',
    fileMtimeMs: Date.parse('2026-05-07T09:00:00+09:00'),
    fileSize: content.length,
    readAt: Date.now(),
    content,
  };
}

test('EventStore allocates sequence values atomically across connections', () => {
  const path = tempDbPath('cogmem-event-counter-');
  const a = new EventStore(path);
  const b = new EventStore(path);
  const first = a.append({ streamId: 'shared', streamType: 'thread', eventType: 'message', projectId: 'a', payload: { text: 'one' } });
  const second = b.append({ streamId: 'shared', streamType: 'thread', eventType: 'message', projectId: 'a', payload: { text: 'two' } });
  expect([first.globalSeq, second.globalSeq]).toEqual([1, 2]);
  expect([first.eventVersion, second.eventVersion]).toEqual([1, 2]);
  expect([first.threadSeq, second.threadSeq]).toEqual([1, 2]);
  a.close();
  b.close();
});

test('EventStore replays same-timestamp thread events by threadSeq and eventOrdinal', () => {
  const store = new EventStore(tempDbPath('cogmem-ledger-store-'));

  const later = (store as any).append({
    streamId: 'thread-a',
    streamType: 'thread',
    eventType: 'RAW_EVENT_RECORDED',
    projectId: 'project-a',
    threadId: 'thread-a',
    sessionId: 'session-a',
    threadSeq: 2,
    eventOrdinal: 1,
    role: 'assistant',
    occurredAt: 1_700_000_000_000,
    orderingConfidence: 'high',
    payload: { text: 'assistant second' },
  });
  const earlier = (store as any).append({
    streamId: 'thread-a',
    streamType: 'thread',
    eventType: 'RAW_EVENT_RECORDED',
    projectId: 'project-a',
    threadId: 'thread-a',
    sessionId: 'session-a',
    threadSeq: 1,
    eventOrdinal: 1,
    role: 'user',
    occurredAt: 1_700_000_000_000,
    orderingConfidence: 'high',
    payload: { text: 'user first' },
  });

  const replay = (store as any).getThreadEvents('thread-a');

  expect(later.globalSeq).toBeLessThan(earlier.globalSeq);
  expect(replay.map((event: any) => event.payload.text)).toEqual(['user first', 'assistant second']);
  expect(replay.map((event: any) => event.threadSeq)).toEqual([1, 2]);
  expect(replay.every((event: any) => event.orderingConfidence === 'high')).toBe(true);

  store.close();
});

test('EventStore rejects and hides cross-project parent and child links', () => {
  const dbPath = tempDbPath('cogmem-ledger-project-links-');
  const store = new EventStore(dbPath);
  const parent = store.append({
    streamId: 'stream-a', streamType: 'thread', eventType: 'MESSAGE',
    projectId: 'a', occurredAt: 1, payload: { text: 'a' },
  });
  expect(() => store.append({
    streamId: 'stream-b', streamType: 'thread', eventType: 'MESSAGE',
    projectId: 'b', parentEventId: parent.eventId, occurredAt: 2, payload: { text: 'b' },
  })).toThrow('event_link_project_scope_mismatch');
  const child = store.append({
    streamId: 'stream-b', streamType: 'thread', eventType: 'MESSAGE',
    projectId: 'b', occurredAt: 3, payload: { text: 'b' },
  });
  const db = new Database(dbPath);
  db.prepare(`UPDATE memory_events SET parent_event_id=? WHERE event_id=?`).run(parent.eventId, child.eventId);
  db.close();

  expect(store.getEventContext(child.eventId)?.parent).toBeUndefined();
  expect(store.getChildEvents(parent.eventId, 'a')).toEqual([]);
  store.close();
});

test('EventStore raw ledger FTS finds original events without compiled memory vectors', () => {
  const store = new EventStore(tempDbPath('cogmem-ledger-fts-'));

  const first = store.append({
    streamId: 'thread-a',
    streamType: 'thread',
    eventType: 'RAW_EVENT_RECORDED',
    projectId: 'project-a',
    threadId: 'thread-a',
    sessionId: 'session-a',
    threadSeq: 1,
    eventOrdinal: 1,
    role: 'user',
    occurredAt: 1_700_000_000_000,
    payload: { text: 'Important Obsidian boundary: keep this an agent memory kernel.' },
  });
  store.append({
    streamId: 'thread-b',
    streamType: 'thread',
    eventType: 'RAW_EVENT_RECORDED',
    projectId: 'project-b',
    threadId: 'thread-b',
    sessionId: 'session-b',
    threadSeq: 1,
    eventOrdinal: 1,
    role: 'user',
    occurredAt: 1_700_000_000_000,
    payload: { text: 'Other project also mentions Obsidian but must stay isolated.' },
  });

  const matches = store.searchRawEvents('Obsidian boundary', { projectId: 'project-a', limit: 5 });

  expect(matches.map((event) => event.eventId)).toEqual([first.eventId]);
  expect(matches[0].payload.text).toContain('agent memory kernel');
  expect(matches[0].threadSeq).toBe(1);
  expect(matches[0].eventOrdinal).toBe(1);

  store.close();
});

test('MemoryKernel exposes project-scoped raw ledger search through the public facade', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath('cogmem-ledger-kernel-fts-'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'project-a',
    sessionId: 'session-a',
    userText: 'Raw ledger keyword anchor says vector pruning is not memory pruning.',
    assistantText: 'Stored in raw ledger only.',
    ingestMode: 'raw_archive_only',
    timestamp: 1_700_000_000_000,
  });

  expect(kernel.vectorStore.getCurrentCount()).toBe(0);
  const matches = kernel.searchRawEvents('vector pruning memory pruning', {
    projectId: 'project-a',
    limit: 5,
  });

  expect(matches).toHaveLength(1);
  expect(matches[0].payload.text).toContain('vector pruning is not memory pruning');

  kernel.close();
});

test('KernelAgentMemoryBackend records raw turn events with parent and prev links before semantic ingest', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath('cogmem-ledger-agent-'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurn({
    agentId: 'openclaw',
    projectId: 'project-a',
    sessionId: 'session-a',
    userText: 'Use chronological ledger for replay.',
    assistantText: 'I will preserve the original order.',
    timestamp: 1_700_000_000_000,
  });

  const events = (kernel as any).getThreadEvents('session-a');
  const [userEvent, assistantEvent] = events;

  expect(events.map((event: any) => event.role)).toEqual(['user', 'assistant']);
  expect(events.map((event: any) => event.threadSeq)).toEqual([1, 2]);
  expect(events.map((event: any) => event.eventOrdinal)).toEqual([1, 2]);
  expect(assistantEvent.parentEventId).toBe(userEvent.eventId);
  expect(assistantEvent.prevEventId).toBe(userEvent.eventId);
  expect(userEvent.nextEventId).toBe(assistantEvent.eventId);
  expect(assistantEvent.causalityType).toBe('replies_to');

  const context = (kernel as any).getEventContext(assistantEvent.eventId, { before: 1, after: 0 });
  expect(context.event.eventId).toBe(assistantEvent.eventId);
  expect(context.before.map((event: any) => event.eventId)).toEqual([userEvent.eventId]);
  expect(context.parent?.eventId).toBe(userEvent.eventId);

  kernel.close();
});

test('recall explanation can anchor semantic evidence back to raw ledger events', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath('cogmem-ledger-explain-'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurn({
    agentId: 'openclaw',
    projectId: 'project-a',
    sessionId: 'session-a',
    userText: 'The billing migration must keep the audit trail.',
    assistantText: 'Stored the billing migration audit constraint.',
    timestamp: 1_700_000_000_000,
  });

  const rawEvents = (kernel as any).getThreadEvents('session-a');
  const explanation = explainRecallWithKernel(kernel, {
    query: 'billing migration audit trail',
    projectId: 'project-a',
    agentId: 'openclaw',
    limit: 1,
  });
  const anchor = explanation.evidence[0]?.sourceAnchor;

  expect(anchor?.eventId).toMatch(/^evt-/);
  expect(anchor?.sourceRefs?.map((ref: any) => ref.eventId)).toEqual(rawEvents.map((event: any) => event.eventId));
  expect(anchor?.sourceRefs?.map((ref: any) => ref.role)).toEqual(['user', 'assistant']);
  expect(anchor?.context?.event.eventType).toBe('INGESTED');

  kernel.close();
});

test('markdown conversation import preserves line order and sourceRef anchors', () => {
  const adapter = new ConversationMarkdownAdapter();
  const source: SourceDefinition = {
    sourceId: 'conversation-ledger',
    adapterKind: 'conversation_markdown',
    sourcePath: '/tmp/ledger-transcript.md',
    projectId: 'project-a',
  };
  const content = [
    '# 2026-05-07',
    'Human: first line',
    'AI: second line',
    'Human: third line',
  ].join('\n');

  const adapted = adapter.adapt(source, makeSnapshot(source, content));
  const [first, second, third] = adapted.records;

  expect(first.metadata).toMatchObject({
    lineStart: 2,
    lineEnd: 2,
    sourceOffset: 1,
    turnSeq: 1,
    eventOrdinal: 1,
    orderingConfidence: 'high',
  });
  expect(second.metadata).toMatchObject({
    lineStart: 3,
    lineEnd: 3,
    sourceOffset: 2,
    turnSeq: 1,
    eventOrdinal: 2,
    orderingConfidence: 'high',
  });
  expect(third.metadata).toMatchObject({
    lineStart: 4,
    lineEnd: 4,
    sourceOffset: 3,
    turnSeq: 2,
    eventOrdinal: 1,
    orderingConfidence: 'high',
  });

  const envelope = buildEpisodeEnvelope(source, first);
  expect(envelope.ingestInput.sourceRefs?.[0]).toMatchObject({
    sourceId: source.sourceId,
    sourcePath: source.sourcePath,
    lineStart: 2,
    lineEnd: 2,
    sourceOffset: 1,
    threadSeq: 1,
    turnSeq: 1,
    eventOrdinal: 1,
    orderingConfidence: 'high',
  });
});

test('json array normalization preserves original array order in sourceRefs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-json-normalize-'));
  const inputPath = join(dir, 'memory.json');
  const outputPath = join(dir, 'memory.normalized.md');
  writeFileSync(inputPath, JSON.stringify([
    { role: 'user', text: 'First JSON memory', timestamp: '2026-06-01T10:00:00Z' },
    { role: 'assistant', text: 'Second JSON memory', timestamp: '2026-06-01T10:00:01Z' },
  ], null, 2));

  const messages = normalizeJsonArrayRecords(inputPath);
  writeNormalizedConversationMarkdown(outputPath, 'JSON Memory', 'json_array_transcript_export', messages);

  const source: SourceDefinition = {
    sourceId: 'json-array',
    adapterKind: 'conversation_markdown',
    sourcePath: outputPath,
    projectId: 'ledger-project',
  };
  const adapter = new ConversationMarkdownAdapter();
  const adapted = adapter.adapt(source, makeSnapshot(source, readFileSync(outputPath, 'utf8')));
  const refs = adapted.records.map((record) => buildEpisodeEnvelope(source, record).ingestInput.sourceRefs?.[0]);

  expect(refs.map((ref) => ref?.sourceOffset)).toEqual([1, 2]);
  expect(refs.map((ref) => ref?.threadSeq)).toEqual([1, 2]);
  expect(refs.map((ref) => ref?.eventOrdinal)).toEqual([1, 2]);
  expect(refs.every((ref) => ref?.orderingConfidence === 'high')).toBe(true);
});

test('csv normalization preserves original row line anchors in sourceRefs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-csv-normalize-'));
  const inputPath = join(dir, 'memory.csv');
  const outputPath = join(dir, 'memory.normalized.md');
  writeFileSync(inputPath, [
    'timestamp,role,text',
    '2026-06-01T10:00:00Z,user,First CSV memory',
    '2026-06-01T10:00:01Z,assistant,Second CSV memory',
  ].join('\n'));

  const normalized = normalizeDelimitedRecords(inputPath, 'csv');
  writeNormalizedConversationMarkdown(outputPath, 'CSV Memory', normalized.family, normalized.messages);

  const source: SourceDefinition = {
    sourceId: 'csv-export',
    adapterKind: 'conversation_markdown',
    sourcePath: outputPath,
    projectId: 'ledger-project',
  };
  const adapter = new ConversationMarkdownAdapter();
  const adapted = adapter.adapt(source, makeSnapshot(source, readFileSync(outputPath, 'utf8')));
  const refs = adapted.records.map((record) => buildEpisodeEnvelope(source, record).ingestInput.sourceRefs?.[0]);

  expect(refs.map((ref) => ref?.sourceOffset)).toEqual([1, 2]);
  expect(refs.map((ref) => ref?.lineStart)).toEqual([2, 3]);
  expect(refs.map((ref) => ref?.lineEnd)).toEqual([2, 3]);
  expect(refs.map((ref) => ref?.orderingConfidence)).toEqual(['high', 'high']);
});

test('tool call and result facade records parent-child ledger links without bypassing semantic governance', async () => {
  const kernel = createMemoryKernel({ dbPath: tempDbPath('cogmem-ledger-tool-'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurn({
    agentId: 'agent-a',
    projectId: 'tool-ledger-project',
    sessionId: 'session-tool',
    threadId: 'thread-tool',
    userText: 'Check the migration file.',
    assistantText: 'I will inspect it.',
    timestamp: 1000,
  });
  const assistantEvent = kernel.getThreadEvents('thread-tool').find((event) => event.role === 'assistant');

  const callEvent = await backend.ingestToolCall({
    agentId: 'agent-a',
    projectId: 'tool-ledger-project',
    sessionId: 'session-tool',
    threadId: 'thread-tool',
    turnId: assistantEvent?.turnId,
    turnSeq: assistantEvent?.turnSeq,
    assistantEventId: assistantEvent?.eventId,
    toolCallId: 'call-1',
    toolName: 'read_file',
    input: { path: 'migration.ts' },
    eventOrdinal: 3,
    timestamp: 1001,
  });
  const resultEvent = await backend.ingestToolObservation({
    agentId: 'agent-a',
    projectId: 'tool-ledger-project',
    sessionId: 'session-tool',
    threadId: 'thread-tool',
    turnId: assistantEvent?.turnId,
    turnSeq: assistantEvent?.turnSeq,
    toolCallEventId: callEvent.eventId,
    toolCallId: 'call-1',
    toolName: 'read_file',
    output: 'migration.ts contains an idempotent ALTER TABLE.',
    eventOrdinal: 4,
    timestamp: 1002,
  });

  const replay = kernel.getThreadEvents('thread-tool');
  expect(replay.map((event) => event.rawEventType)).toEqual([
    'message',
    'message',
    'tool_call',
    'tool_result',
  ]);
  expect(callEvent.parentEventId).toBe(assistantEvent?.eventId);
  expect(callEvent.causalityType).toBe('triggered_by');
  expect(resultEvent.parentEventId).toBe(callEvent.eventId);
  expect(resultEvent.causalityType).toBe('tool_result_for');
  expect(resultEvent.role).toBe('tool');
  expect(replay.find((event) => event.eventId === assistantEvent?.eventId)?.nextEventId).toBe(callEvent.eventId);
  expect(replay.find((event) => event.eventId === callEvent.eventId)?.nextEventId).toBe(resultEvent.eventId);

  const recall = kernel.recall('idempotent ALTER TABLE', {
    projectId: 'tool-ledger-project',
    includeRawEvidence: true,
  });
  expect(recall.rawEvidence.some((neuron) => neuron.metadata.sourceType === 'external_tool')).toBe(true);
  kernel.close();
});
