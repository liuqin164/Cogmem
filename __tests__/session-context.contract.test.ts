import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  SESSION_CONTEXT_CONTRACT_VERSION,
  SESSION_CONTEXT_DECISION_FIELDS,
  SESSION_CONTEXT_ERROR_CODES,
  SESSION_CONTEXT_LANES,
  SESSION_CONTEXT_LANE_PRIORITY,
  SESSION_CONTEXT_STABLE_LANES,
  SESSION_DIGEST_ENTRY_FIELDS,
  SESSION_RECALL_MODES,
  digestAnchors,
  sessionTokens,
} from '../src/session/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F14 session-context contract (#191): the digest, the session recall and the budget
 * controller, asserted against the document they claim to implement.
 *
 * The document's frozen tables are read back and compared with the code's lists, so a lane or a
 * refusal renamed in one place and not the other is red. The behaviour tests are the ticket's
 * discriminators: a long session's early decision stays verbatim, the assembly stays inside its
 * target, every downgrade is traceable, the stable prefix survives a re-assembly, and a killed
 * session wakes up with its open loops.
 */

const scratch = makeTempDir('cogmem-session-context-');
const dbPath = join(scratch, 'memory.db');
const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
const PROJECT = 'p-191';
const AGENT = 'cog';
const SESSION = 's-long';
const DECISION = '决定：由「小明」负责迁移，预算 12,500 元，日期 2026-11-19。';

let kernel: MemoryKernel;
let backend: KernelAgentMemoryBackend;

beforeAll(async () => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
  backend = new KernelAgentMemoryBackend(kernel);
  for (let i = 0; i < 24; i += 1) {
    await backend.captureConversationTurn({
      projectId: PROJECT,
      agentId: AGENT,
      sessionId: SESSION,
      channel: 'terminal',
      speaker: i % 2 === 0 ? 'owner' : 'agent',
      text: i === 0 ? DECISION : `第 ${i} 轮：继续整理会话上下文，检查第 ${i} 项。`,
      occurredAt: T0 + i * 1000,
    });
  }
  // A second agent's turn with the same session id is a different session scope.
  await backend.captureConversationTurn({
    projectId: PROJECT,
    agentId: 'other-agent',
    sessionId: SESSION,
    channel: 'terminal',
    speaker: 'owner',
    text: '这是另一个 agent 的会话，不该出现在 cog 的回溯里。',
    occurredAt: T0 + 100,
  });
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/session-context.md', import.meta.url)), 'utf8');

function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_-]*)`/gmu)].map((match) => match[1]!);
}

function laneRows(section: string): Array<{ lane: string; priority: number; stable: boolean }> {
  return [...section.matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*(\d+)\s*\|\s*(yes|no)\s*\|/gmu)].map((match) => ({
    lane: match[1]!,
    priority: Number(match[2]),
    stable: match[3] === 'yes',
  }));
}

describe('the contract document and the frozen lists agree', () => {
  test('the lane table is exactly SESSION_CONTEXT_LANES, with the frozen priority and stability', () => {
    const rows = laneRows(sectionAfter('## Lanes (frozen)'));
    expect(rows.map((row) => row.lane)).toEqual([...SESSION_CONTEXT_LANES]);
    for (const row of rows) expect(row.priority).toBe(SESSION_CONTEXT_LANE_PRIORITY[row.lane as never]);
    expect(rows.filter((row) => row.stable).map((row) => row.lane)).toEqual([...SESSION_CONTEXT_STABLE_LANES]);
  });

  test('the digest-field table is exactly SESSION_DIGEST_ENTRY_FIELDS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Digest entry fields (frozen)'))).toEqual([...SESSION_DIGEST_ENTRY_FIELDS]);
  });

  test('the recall-mode table is exactly SESSION_RECALL_MODES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Recall modes (frozen)'))).toEqual([...SESSION_RECALL_MODES]);
  });

  test('the decision-trace table is exactly SESSION_CONTEXT_DECISION_FIELDS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Decision trace fields (frozen)'))).toEqual([...SESSION_CONTEXT_DECISION_FIELDS]);
  });

  test('the error table is exactly SESSION_CONTEXT_ERROR_CODES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...SESSION_CONTEXT_ERROR_CODES]);
  });

  test('the version constant is 1', () => {
    expect(SESSION_CONTEXT_CONTRACT_VERSION).toBe(1);
  });
});

describe('the digest is a verbatim index, not a summary (#191 primitive 1)', () => {
  test('an early decision survives a long session word for word, with its anchors', () => {
    const digest = backend.sessionDigest({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, tailTurns: 8 });
    expect(digest.entries.length).toBe(16);
    expect(digest.tail.length).toBe(8);
    const first = digest.entries[0]!;
    expect(first.text).toBe(DECISION);
    expect(first.sourceRefs).toEqual([expect.any(String)]);
    expect(first.anchor).toBe(true);
    const anchors = digestAnchors(DECISION);
    expect(anchors).toEqual(expect.arrayContaining(['12,500', '2026-11-19', '小明']));
    for (const anchor of anchors) expect(first.text).toContain(anchor);
  });

  test('every digest entry quotes a ledger row exactly', () => {
    const digest = backend.sessionDigest({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, tailTurns: 8 });
    const turns = backend.listConversationTurns({ projectId: PROJECT, sessionId: SESSION, limit: 500 });
    const byId = new Map(turns.map((turn) => [turn.eventId, turn.text]));
    for (const entry of digest.entries) {
      expect(entry.text).toBe(byId.get(entry.sourceRefs[0]!));
    }
  });
});

describe('session recall is the ledger, paged and scoped (#191 primitive 2)', () => {
  test('time pages newest first with a stable cursor and no duplicates', () => {
    const first = backend.recallSession({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'time', limit: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.hasMore).toBe(true);
    const second = backend.recallSession({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'time', limit: 5, cursor: first.nextCursor! });
    const ids = [...first.items, ...second.items].map((item) => item.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.items[0]!.occurredAt).toBeLessThan(first.items.at(-1)!.occurredAt);
  });

  test('a keyword returns the exact words of the early decision', () => {
    const page = backend.recallSession({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'keyword', query: '12,500' });
    expect(page.items.map((item) => item.text)).toContain(DECISION);
    expect(page.items[0]!.sourceRefs).toHaveLength(1);
  });

  test('topic is the session episode index, and an unknown topic is empty', () => {
    const episode = kernel.episodeStore.listEpisodes({ projectId: PROJECT, sessionId: SESSION })[0]!;
    kernel.episodeStore.reclassifyForRepair(episode.episodeId, { topicPath: 'release/planning', now: T0 });
    const hit = backend.recallSession({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'topic', query: 'planning' });
    expect(hit.items.length).toBeGreaterThan(0);
    const miss = backend.recallSession({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'topic', query: 'unrelated-topic' });
    expect(miss.items).toEqual([]);
  });

  test('another agent with the same session id is outside this session', () => {
    const page = backend.recallSession({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'keyword', query: '另一个 agent' });
    expect(page.items).toEqual([]);
  });

  test('each refusal is the frozen code', () => {
    const refused = (input: Parameters<typeof backend.recallSession>[0]): string => {
      try {
        backend.recallSession(input);
        return 'no error';
      } catch (error) {
        return String((error as Error).message).split(':')[0]!;
      }
    };
    expect(refused({ projectId: ' ', agentId: AGENT, sessionId: SESSION, mode: 'time' })).toBe('project_id_required');
    expect(refused({ projectId: PROJECT, agentId: '', sessionId: SESSION, mode: 'time' })).toBe('agent_id_required');
    expect(refused({ projectId: PROJECT, agentId: AGENT, sessionId: '', mode: 'time' })).toBe('session_id_required');
    expect(refused({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'nope' as never })).toBe('invalid_recall_mode');
    expect(refused({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'keyword' })).toBe('recall_query_required');
    expect(refused({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'time', limit: 0 })).toBe('invalid_limit');
    expect(refused({ projectId: PROJECT, agentId: AGENT, sessionId: SESSION, mode: 'time', cursor: 'bad' })).toBe('invalid_cursor');
  });
});

describe('the assembly stays inside the target and explains every cut (#191 primitive 3)', () => {
  test('the result is within the target and every downgrade is in the trace', () => {
    const assembly = backend.assembleSessionContext({
      projectId: PROJECT,
      agentId: AGENT,
      sessionId: SESSION,
      targetTokens: 120,
      pinned: ['system: be terse and exact'],
      profile: ['preference: terse answers'],
      workingSet: ['fix #191 session context'],
      recall: [{ id: 'recall:1', text: '这是一条很长的本轮召回材料，用来把预算挤过目标带宽。'.repeat(3) }],
      tailTurns: 8,
    });
    expect(assembly.usedTokens).toBeLessThanOrEqual(120);
    expect(sessionTokens(assembly.text)).toBeLessThanOrEqual(120);
    expect(assembly.decisionTrace.length).toBeGreaterThan(0);
    for (const decision of assembly.decisionTrace) {
      expect(decision.reason).toBe('budget_exceeded');
      expect(decision.action === 'downgraded' || decision.action === 'trimmed').toBe(true);
    }
    const downgraded = new Set(assembly.decisionTrace.map((decision) => decision.lane));
    expect(downgraded.has('recall')).toBe(true);
    // A downgraded lane is a pointer, not a lane trimmed item by item: the ids stay browseable.
    const recallLane = assembly.lanes.find((lane) => lane.lane === 'recall')!;
    expect(recallLane.status).toBe('downgraded');
    expect(recallLane.browseIds.length).toBeGreaterThan(0);
  });

  test('the stable lanes render the same bytes across assemblies at the same budget', () => {
    const base = {
      projectId: PROJECT,
      agentId: AGENT,
      sessionId: SESSION,
      targetTokens: 400,
      pinned: ['system: be terse and exact'],
      profile: ['preference: terse answers'],
      tailTurns: 8,
    } as const;
    const first = backend.assembleSessionContext({ ...base, recall: [{ id: 'recall:a', text: 'first recall' }] });
    const second = backend.assembleSessionContext({ ...base, recall: [{ id: 'recall:b', text: 'a different recall for the next turn' }] });
    expect(first.stablePrefix).toBe(second.stablePrefix);
    expect(first.text.startsWith(first.stablePrefix)).toBe(true);
    expect(second.text.startsWith(second.stablePrefix)).toBe(true);
    const stable = first.lanes.filter((lane) => lane.stable);
    expect(stable.every((lane) => lane.status === 'included')).toBe(true);
  });

  test('a downgrade is readable from trace_events, not only from the return value', () => {
    backend.assembleSessionContext({
      projectId: PROJECT,
      agentId: AGENT,
      sessionId: SESSION,
      targetTokens: 80,
      pinned: ['system: be terse and exact'],
      profile: ['preference: terse answers'],
      tailTurns: 8,
    });
    const row = kernel.factStore.getDatabase()
      .prepare(`SELECT payload FROM trace_events WHERE event_type = 'session.context.assemble' ORDER BY timestamp DESC LIMIT 1`)
      .get() as { payload: string } | null;
    expect(row).not.toBeNull();
    const payload = JSON.parse(row!.payload) as { downgrades: Array<{ lane: string; reason: string }> };
    expect(payload.downgrades.length).toBeGreaterThan(0);
    expect(payload.downgrades.every((entry) => entry.reason === 'budget_exceeded')).toBe(true);
  });
});

describe('a killed session wakes up from the ledger, not from memory', () => {
  const killDb = join(scratch, 'kill.db');
  const KILL_PROJECT = 'p-kill';
  const KILL_AGENT = 'cog';
  const KILL_SESSION = 's-kill';
  let firstEventId = '';

  test('the three answers and the open loops are back, each with sourceRefs', async () => {
    const before = createMemoryKernel({ dbPath: killDb, projectTimeZone: 'UTC' });
    const beforeBackend = new KernelAgentMemoryBackend(before);
    const lines = [
      '刚才在做什么：修复 #191 的会话上下文组装。',
      '卡在哪：TraceStore 的只读构造路径还没有。',
      '下一步：给 getDecisionChain 加可选上限。',
    ];
    for (let i = 0; i < lines.length; i += 1) {
      const turn = await beforeBackend.captureConversationTurn({
        projectId: KILL_PROJECT,
        agentId: KILL_AGENT,
        sessionId: KILL_SESSION,
        channel: 'terminal',
        speaker: i === 1 ? 'owner' : 'agent',
        text: lines[i]!,
        occurredAt: T0 + i * 1000,
      });
      if (i === 0) firstEventId = turn.eventId;
    }
    before.wakeIntentions.register({
      projectId: KILL_PROJECT,
      agentId: KILL_AGENT,
      at: T0 + 3_600_000,
      reason: '醒来先看 #206 的只读构造',
      sourceRefs: [{ eventId: firstEventId }],
      now: T0,
    });
    before.close();

    // Kill: the only thing carried across is the file on disk.
    const after = createMemoryKernel({ dbPath: killDb, projectTimeZone: 'UTC' });
    try {
      const afterBackend = new KernelAgentMemoryBackend(after);
      const digest = afterBackend.sessionDigest({ projectId: KILL_PROJECT, agentId: KILL_AGENT, sessionId: KILL_SESSION, tailTurns: 1 });
      expect([...digest.entries.map((entry) => entry.text), ...digest.tail.map((turn) => turn.text)])
        .toEqual(expect.arrayContaining(lines));
      for (const entry of digest.entries) expect(entry.sourceRefs[0]).toBeTruthy();

      const recall = afterBackend.recallSession({
        projectId: KILL_PROJECT, agentId: KILL_AGENT, sessionId: KILL_SESSION, mode: 'keyword', query: '卡在',
      });
      expect(recall.items[0]?.text).toBe(lines[1]!);
      expect(recall.items[0]?.sourceRefs).toEqual([expect.any(String)]);

      const surfacing = after.surfacing.candidates({ projectId: KILL_PROJECT, channel: 'asked', now: T0 + 1000 });
      expect(surfacing.candidates.some((candidate) => candidate.source === 'wake-intention')).toBe(true);

      const assembly = afterBackend.assembleSessionContext({
        projectId: KILL_PROJECT,
        agentId: KILL_AGENT,
        sessionId: KILL_SESSION,
        targetTokens: 1000,
        pinned: ['system: resume the interrupted session'],
        workingSet: ['continue #191'],
        tailTurns: 1,
      });
      for (const line of lines) expect(assembly.text).toContain(line);
      expect(assembly.text).toContain('醒来先看 #206 的只读构造');
      const working = assembly.lanes.find((lane) => lane.lane === 'working_set')!;
      expect(working.items.some((item) => item.id.startsWith('wake:'))).toBe(true);
      expect(working.items.some((item) => item.id.startsWith('surfacing:'))).toBe(true);
    } finally {
      after.close();
    }
  });
});
