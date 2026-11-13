import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  CONVERSATION_CAPTURE_CONTRACT_VERSION,
  CONVERSATION_CAPTURE_ERROR_CODES,
  CONVERSATION_CAPTURE_LANE,
  CONVERSATION_SPEAKER_ROLES,
  CONVERSATION_SPEAKERS,
  CONVERSATION_TURN_FIELDS,
} from '../src/conversation/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F3 conversation-capture contract (#157), asserted against the document it claims to implement.
 *
 * Same shape as the F1/F2 contract tests: the document's frozen tables are read back and compared
 * with the code's lists, so a name added in one place and not the other is red. The behaviour tests
 * below are the ticket's acceptance: the speaker filter discriminates, the same turn written under a
 * different agentId/project reads back verbatim the same, tool rows are never in the lane, and the
 * old write faces are unchanged.
 */

const scratch = makeTempDir('cogmem-conversation-contract-');
const dbPath = join(scratch, 'memory.db');
const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
let kernel: MemoryKernel;
let backend: KernelAgentMemoryBackend;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
  backend = new KernelAgentMemoryBackend(kernel);
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/conversation-capture.md', import.meta.url)), 'utf8');

/** The text of one heading's section, stopping at the next heading of the same or a higher level. */
function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

/** The backticked first column of every table row in a section, in order. */
function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_-]*)`/gmu)].map((match) => match[1]!);
}

/** The backticked second column of every table row in a section, in order. */
function backtickedSecondColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`[A-Za-z][A-Za-z0-9_-]*`\s*\|\s*`([A-Za-z][A-Za-z0-9_-]*)`/gmu)]
    .map((match) => match[1]!);
}

describe('the contract document and the frozen lists agree', () => {
  test('the speaker table is exactly CONVERSATION_SPEAKERS, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('## Speakers (frozen)'));
    expect(documented.length).toBeGreaterThan(0);
    expect(documented).toEqual([...CONVERSATION_SPEAKERS]);
  });

  test('the speaker→role table is exactly CONVERSATION_SPEAKER_ROLES, in order', () => {
    const section = sectionAfter('## Speaker → ledger role (frozen)');
    expect(backtickedFirstColumn(section)).toEqual([...CONVERSATION_SPEAKERS]);
    expect(backtickedSecondColumn(section)).toEqual(CONVERSATION_SPEAKERS.map((speaker) => CONVERSATION_SPEAKER_ROLES[speaker]));
  });

  test('the turn-field table is exactly CONVERSATION_TURN_FIELDS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Turn fields (frozen)'))).toEqual([...CONVERSATION_TURN_FIELDS]);
  });

  test('the error table is exactly CONVERSATION_CAPTURE_ERROR_CODES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...CONVERSATION_CAPTURE_ERROR_CODES]);
  });

  test('the version constant is 1', () => {
    expect(CONVERSATION_CAPTURE_CONTRACT_VERSION).toBe(1);
  });
});

describe('a captured turn', () => {
  test('carries every frozen field, with the speaker mapped to its ledger role', async () => {
    const record = await backend.captureConversationTurn({
      projectId: 'contract', agentId: 'cog', sessionId: 's-contract', channel: 'terminal',
      speaker: 'owner', text: '把发布窗口挪到周四。', occurredAt: T0,
    });
    // Every frozen field is present; `speakerLabel` is the one optional one, and it is absent when
    // the speaker has no display name to carry.
    const keys = new Set(Object.keys(record));
    expect([...CONVERSATION_TURN_FIELDS].filter((field) => !keys.has(field))).toEqual(['speakerLabel']);
    expect(Object.keys(record).filter((key) => !CONVERSATION_TURN_FIELDS.includes(key as never))).toEqual([]);
    expect(record.lane).toBe(CONVERSATION_CAPTURE_LANE);
    expect(record.role).toBe('user');
    expect(record.threadId).toBe('s-contract');
    expect(record.text).toBe('把发布窗口挪到周四。');
    expect(record.compiledNeuronId).toBeTruthy();
    // The ledger row is the write: reading it back returns the same turn.
    expect(backend.listConversationTurns({ projectId: 'contract' }).map((turn) => turn.eventId)).toEqual([record.eventId]);
  });

  test('a third party is neither the owner nor the agent, on the row and in the role', async () => {
    const record = await backend.captureConversationTurn({
      projectId: 'third-party', agentId: 'cog', sessionId: 's-other', channel: 'telegram',
      speaker: 'other', speakerLabel: '小明', text: '他要去东京出差。', occurredAt: T0,
    });
    expect(record.role).toBe(CONVERSATION_SPEAKER_ROLES.other);
    expect(record.role).not.toBe('user');
    expect(record.speakerLabel).toBe('小明');
    const row = kernel.factStore.getDatabase()
      .prepare(`SELECT raw_event_type, role FROM memory_events WHERE event_id = ?`)
      .get(record.eventId) as { raw_event_type: string; role: string };
    expect(row).toEqual({ raw_event_type: 'message', role: 'other' });
  });

  test('each refusal is the frozen code', async () => {
    const base = {
      projectId: 'refusals', agentId: 'cog', sessionId: 's-refuse', channel: 'terminal',
      speaker: 'owner' as const, text: 'text',
    };
    const refused = async (input: Parameters<typeof backend.captureConversationTurn>[0]): Promise<string> => {
      try {
        await backend.captureConversationTurn(input);
        return 'no error';
      } catch (error) {
        return String((error as Error).message).split(':')[0]!;
      }
    };
    expect(await refused({ ...base, projectId: ' ' })).toBe('project_id_required');
    expect(await refused({ ...base, agentId: '' })).toBe('agent_id_required');
    expect(await refused({ ...base, sessionId: '' })).toBe('conversation_session_id_required');
    expect(await refused({ ...base, channel: '  ' })).toBe('conversation_channel_required');
    expect(await refused({ ...base, text: '' })).toBe('conversation_text_required');
    expect(await refused({ ...base, speaker: 'stranger' as never })).toBe('invalid_conversation_speaker');
    expect(() => backend.listConversationTurns({ projectId: 'refusals', limit: 0 })).toThrow('invalid_limit');
  });

  test('an explicitly excluded passage never becomes an event', async () => {
    const record = await backend.captureConversationTurn({
      projectId: 'exclusion', agentId: 'cog', sessionId: 's-exclusion', channel: 'terminal',
      speaker: 'owner', text: 'before <COGMEM_PRIVATE>the key is sk-abcdefghijklmnop</COGMEM_PRIVATE> after',
      occurredAt: T0,
    });
    expect(record.text).not.toContain('sk-abcdefghijklmnop');
    expect(record.text).toContain('before');
    expect(record.text).toContain('after');
  });
});

describe('the speaker filter discriminates', () => {
  test('问「他说的」不召回「我说的」', async () => {
    const projectId = 'discriminate';
    await backend.captureConversationTurn({
      projectId, agentId: 'cog', sessionId: 's-talk', channel: 'terminal',
      speaker: 'owner', text: '我订了周五的机票。', occurredAt: T0,
    });
    await backend.captureConversationTurn({
      projectId, agentId: 'cog', sessionId: 's-talk', channel: 'terminal',
      speaker: 'other', speakerLabel: '小明', text: '他要去东京出差。', occurredAt: T0 + 1000,
    });
    await backend.captureConversationTurn({
      projectId, agentId: 'cog', sessionId: 's-talk', channel: 'terminal',
      speaker: 'agent', text: '我记下了你们的安排。', occurredAt: T0 + 2000,
    });

    expect(backend.listConversationTurns({ projectId, speaker: 'other' }).map((turn) => turn.text))
      .toEqual(['他要去东京出差。']);
    expect(backend.listConversationTurns({ projectId, speaker: 'owner' }).map((turn) => turn.text))
      .toEqual(['我订了周五的机票。']);
    expect(backend.listConversationTurns({ projectId, speaker: 'agent' }).map((turn) => turn.text))
      .toEqual(['我记下了你们的安排。']);
    // The unfiltered read is the whole lane, in ledger order.
    expect(backend.listConversationTurns({ projectId }).map((turn) => turn.speaker)).toEqual(['owner', 'other', 'agent']);
  });

  test('the channel, thread and occasion are filterable too', async () => {
    const projectId = 'filter-axes';
    await backend.captureConversationTurn({
      projectId, agentId: 'cog', sessionId: 's-a', threadId: 'thread-1', channel: 'terminal',
      speaker: 'owner', text: 'terminal turn', occurredAt: T0,
    });
    await backend.captureConversationTurn({
      projectId, agentId: 'cog', sessionId: 's-a', threadId: 'thread-2', channel: 'telegram',
      speaker: 'owner', text: 'telegram turn', occurredAt: T0 + 1000,
    });
    expect(backend.listConversationTurns({ projectId, channel: 'telegram' }).map((turn) => turn.text)).toEqual(['telegram turn']);
    expect(backend.listConversationTurns({ projectId, threadId: 'thread-1' }).map((turn) => turn.text)).toEqual(['terminal turn']);
    expect(backend.listConversationTurns({ projectId, sessionId: 's-a' })).toHaveLength(2);
    expect(backend.listConversationTurns({ projectId, sessionId: 's-missing' })).toEqual([]);
  });
});

describe('the same face under another identity', () => {
  test('the axes are independent: another agentId, and another project, both read back verbatim', async () => {
    const text = '把这次的口径写进契约，别只写在报告里。';
    const write = (projectId: string, agentId: string) => backend.captureConversationTurn({
      projectId, agentId, sessionId: 's-verbatim', channel: 'terminal', speaker: 'owner', text, occurredAt: T0,
    });
    // One axis at a time, so neither can hide behind the other: same project + two agents, then two
    // projects + one agent.
    const sameProjectA = await write('scope-same', 'agent-a');
    const sameProjectB = await write('scope-same', 'agent-b');
    const crossProjectA = await write('scope-cross-a', 'agent-c');
    const crossProjectB = await write('scope-cross-b', 'agent-c');

    for (const record of [sameProjectA, sameProjectB, crossProjectA, crossProjectB]) {
      expect(record.text).toBe(text);
    }
    const texts = (projectId: string) => backend.listConversationTurns({ projectId }).map((turn) => turn.text);
    expect(texts('scope-same')).toEqual([text, text]);
    expect(texts('scope-cross-a')).toEqual([text]);
    expect(texts('scope-cross-b')).toEqual([text]);
    // The compiled half is on this face too, and it is the same string whatever the identity.
    const compiled = (id: string) => kernel.memoryGraph.getNeuron(id)?.content;
    expect(compiled(sameProjectA.compiledNeuronId!)).toBe(compiled(sameProjectB.compiledNeuronId!));
    expect(compiled(crossProjectA.compiledNeuronId!)).toBe(compiled(crossProjectB.compiledNeuronId!));
    // One project's lane is not another's, even when the agent is the same.
    expect(backend.listConversationTurns({ projectId: 'scope-cross-a' }).map((turn) => turn.eventId))
      .not.toContain(crossProjectB.eventId);
  });

  test('a large turn is stored whole — the capture path never truncates to buy speed', async () => {
    // #199's red line, as a property rather than a promise: the row holds every character the caller
    // wrote, so a faster ingest cannot come from dropping text.
    const text = `大段对话文本。${'详细记录 '.repeat(4000)}`;
    expect(text.length).toBeGreaterThan(16 * 1024);
    const record = await backend.captureConversationTurn({
      projectId: 'verbatim-length', agentId: 'cog', sessionId: 's-long', channel: 'terminal',
      speaker: 'owner', text, occurredAt: T0,
    });
    expect(record.text).toBe(text);
    const row = kernel.factStore.getDatabase()
      .prepare(`SELECT LENGTH(json_extract(payload_json, '$.text')) AS len FROM memory_events WHERE event_id = ?`)
      .get(record.eventId) as { len: number };
    expect(row.len).toBe(text.length);
    expect(backend.listConversationTurns({ projectId: 'verbatim-length' })[0]!.text).toBe(text);
  });
});

describe('the lanes stay apart and the old faces stay put', () => {
  test('a tool row is never in the conversation lane, and a turn row carries the lane marker', async () => {
    const projectId = 'lanes';
    const call = await backend.ingestToolCall({
      agentId: 'cog', projectId, sessionId: 's-lanes', threadId: 's-lanes',
      toolCallId: 'call-1', toolName: 'bash', input: { cmd: 'ls' }, timestamp: T0,
    });
    await backend.ingestToolObservation({
      agentId: 'cog', projectId, sessionId: 's-lanes', threadId: 's-lanes',
      toolCallId: 'call-1', toolCallEventId: call.eventId, toolName: 'bash', output: 'ok', timestamp: T0 + 1,
    });
    const turn = await backend.captureConversationTurn({
      projectId, agentId: 'cog', sessionId: 's-lanes', channel: 'terminal',
      speaker: 'owner', text: '跑一下 ls。', occurredAt: T0 + 2,
    });

    expect(backend.listConversationTurns({ projectId }).map((record) => record.eventId)).toEqual([turn.eventId]);
    const db = kernel.factStore.getDatabase();
    const toolLane = db.prepare(`
      SELECT COUNT(*) AS n FROM memory_events
      WHERE COALESCE(project_id, '') = ? AND json_extract(payload_json, '$.metadata.captureLane') = 'conversation'
        AND raw_event_type IN ('tool_call', 'tool_result')
    `).get(projectId) as { n: number };
    expect(toolLane.n).toBe(0);
    const turnMetadata = JSON.parse(String((db.prepare(`SELECT payload_json FROM memory_events WHERE event_id = ?`).get(turn.eventId) as { payload_json: string }).payload_json)) as {
      metadata: Record<string, unknown>;
    };
    expect(turnMetadata.metadata).toMatchObject({
      captureLane: 'conversation', speaker: 'owner', channel: 'terminal', sourceAgent: 'cog',
    });
  });

  test('rememberTurn and the tool faces write exactly the rows they wrote before', async () => {
    const projectId = 'old-faces';
    await backend.rememberTurn({
      agentId: 'cog', projectId, sessionId: 's-old', threadId: 's-old',
      userText: '老面还是在用。', assistantText: '好。', timestamp: T0,
    });
    const call = await backend.ingestToolCall({
      agentId: 'cog', projectId, sessionId: 's-old', threadId: 's-old',
      toolCallId: 'call-old', toolName: 'read', input: { path: 'x' }, timestamp: T0 + 1,
    });
    await backend.ingestToolObservation({
      agentId: 'cog', projectId, sessionId: 's-old', threadId: 's-old',
      toolCallId: 'call-old', toolCallEventId: call.eventId, toolName: 'read', output: 'y', timestamp: T0 + 2,
    });

    const rows = kernel.factStore.getDatabase().prepare(`
      SELECT role, raw_event_type, json_extract(payload_json, '$.metadata.captureLane') AS lane
      FROM memory_events
      WHERE COALESCE(project_id, '') = ? AND event_type = 'RAW_EVENT_RECORDED'
      ORDER BY global_seq
    `).all(projectId) as Array<{ role: string; raw_event_type: string; lane: string | null }>;
    expect(rows.map((row) => [row.role, row.raw_event_type, row.lane])).toEqual([
      ['user', 'message', null],
      ['assistant', 'message', null],
      ['assistant', 'tool_call', null],
      ['tool', 'tool_result', null],
    ]);
    // And none of it is in the conversation lane.
    expect(backend.listConversationTurns({ projectId })).toEqual([]);
  });
});
