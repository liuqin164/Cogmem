import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  INTENTION_API_METHODS,
  INTENTION_CLOSE_REASONS,
  INTENTION_CONTRACT_VERSION,
  INTENTION_ENTRY_FIELDS,
  INTENTION_ERROR_CODES,
  INTENTION_EVENT_TYPES,
  INTENTION_ORIGINS,
  INTENTION_STATUSES,
  recognizeIntentions,
} from '../src/intention/index.js';
import {
  INTENTION_SEED_NEGATIVES,
  INTENTION_SEED_NOW,
  INTENTION_SEED_POSITIVES,
} from './fixtures/intention-seed.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F22 intention-ledger contract (#216), asserted against the document it claims to implement.
 *
 * The acceptance: an agent's self-plan enters with content, provenance and a derived status; a
 * promise does not enter this book and a plan does not enter F16; completion closes it, a veto
 * closes it everywhere with a trace, a restart brings active plans back into the wake assembly, and
 * conversion leaves one commitment and no second hanging intention.
 */

const scratch = makeTempDir('cogmem-intention-contract-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
});

afterAll(() => {
  kernel.close();
});

const DAY = 24 * 60 * 60 * 1000;
const markdown = readFileSync(fileURLToPath(new URL('../docs/intentions.md', import.meta.url)), 'utf8');

function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_.-]*)`/gmu)].map((match) => match[1]!);
}

function say(input: {
  projectId: string;
  text: string;
  role?: 'user' | 'assistant' | 'other';
  occurredAt: number;
  threadId?: string;
  sessionId?: string;
}) {
  return kernel.recordRawEvent({
    projectId: input.projectId,
    threadId: input.threadId ?? `t-${input.projectId}`,
    sessionId: input.sessionId,
    role: input.role ?? 'user',
    content: input.text,
    occurredAt: input.occurredAt,
  });
}

describe('the contract document and the frozen lists agree', () => {
  test('the status, origin and close-reason tables are exactly their frozen lists, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Statuses (frozen)'))).toEqual([...INTENTION_STATUSES]);
    expect(backtickedFirstColumn(sectionAfter('## Origins (frozen)'))).toEqual([...INTENTION_ORIGINS]);
    expect(backtickedFirstColumn(sectionAfter('## Close reasons (frozen)'))).toEqual([...INTENTION_CLOSE_REASONS]);
  });

  test('the face table is exactly INTENTION_API_METHODS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## The face (frozen)'))).toEqual([...INTENTION_API_METHODS]);
  });

  test('the entry-field table is exactly INTENTION_ENTRY_FIELDS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Entry fields (frozen)'))).toEqual([...INTENTION_ENTRY_FIELDS]);
  });

  test('the book-event table is exactly INTENTION_EVENT_TYPES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Book events (frozen)'))).toEqual([...INTENTION_EVENT_TYPES]);
  });

  test('the error table is exactly INTENTION_ERROR_CODES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...INTENTION_ERROR_CODES]);
  });

  test('every frozen method exists and the version is 1', () => {
    expect(INTENTION_CONTRACT_VERSION).toBe(1);
    for (const method of INTENTION_API_METHODS) {
      expect(typeof (kernel.intentions as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});

describe('the seed evaluation gate', () => {
  test('智能体自述计划的准确率与召回率各 ≥90%，正负样例都备', () => {
    let truePositives = 0;
    let falseNegatives = 0;
    let falsePositives = 0;
    for (const sample of INTENTION_SEED_POSITIVES) {
      const got = recognizeIntentions({ text: sample.text, role: sample.role, occurredAt: INTENTION_SEED_NOW });
      if (got.length > 0) truePositives += 1;
      else falseNegatives += 1;
    }
    for (const sample of INTENTION_SEED_NEGATIVES) {
      const got = recognizeIntentions({ text: sample.text, role: sample.role, occurredAt: INTENTION_SEED_NOW });
      if (got.length > 0) falsePositives += 1;
    }
    const precision = truePositives / (truePositives + falsePositives);
    const recall = truePositives / (truePositives + falseNegatives);
    console.log(`[F22 seed] positive=${INTENTION_SEED_POSITIVES.length} negative=${INTENTION_SEED_NEGATIVES.length} `
      + `precision=${precision.toFixed(3)} recall=${recall.toFixed(3)}`);
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });
});

describe('formation: a conversation plan and a dream candidate enter with provenance', () => {
  test('对话自述打算直接入账，内容/来由/状态齐全', () => {
    const projectId = 'intention-formation';
    const now = Date.UTC(2026, 10, 15, 9);
    const turn = say({ projectId, text: '我准备把报告整理一下。', role: 'assistant', occurredAt: now });
    const result = kernel.intentions.compile({ projectId, now: now + 1_000 });
    expect(result.opened).toBe(1);

    const entry = kernel.intentions.list({ projectId, now: now + 1_000 })[0]!;
    expect(entry.content).toBe('我准备把报告整理一下');
    expect(entry.origin).toBe('conversation');
    expect(entry.status).toBe('active');
    expect(entry.sourceRefs.map((ref) => ref.eventId)).toContain(turn.eventId);
    expect(kernel.eventStore.getEvent(entry.sourceRefs[0]!.eventId!)).toBeTruthy();
  });

  test('做梦候选必须带真实来由，同一候选只入一次', () => {
    const projectId = 'intention-dream';
    const now = Date.UTC(2026, 10, 15, 9);
    const ref = say({ projectId, text: '复盘时提到缓存层最近很慢。', role: 'assistant', occurredAt: now });
    const proposed = kernel.intentions.propose({
      projectId,
      agentId: 'hermes',
      content: '我准备把缓存层换掉。',
      sourceRefs: [{ eventId: ref.eventId }],
      dueAt: now + DAY,
      now: now + 1_000,
    });
    expect(proposed.origin).toBe('dream');
    expect(proposed.agentId).toBe('hermes');
    expect(proposed.dueAt).toBe(now + DAY);

    const again = kernel.intentions.propose({
      projectId,
      agentId: 'hermes',
      content: '我准备把缓存层换掉。',
      sourceRefs: [{ eventId: ref.eventId }],
      dueAt: now + DAY,
      now: now + 2_000,
    });
    expect(again.intentionId).toBe(proposed.intentionId);
    expect(kernel.intentions.list({ projectId }).filter((entry) => entry.origin === 'dream')).toHaveLength(1);

    expect(() => kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备做点什么。', sourceRefs: [], now: now + 3_000,
    })).toThrow('invalid_source_refs');
    expect(() => kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备做点什么。', sourceRefs: [{ eventId: 'missing' }], now: now + 3_000,
    })).toThrow('invalid_source_refs');
  });
});

describe('the two books are isolated in both directions', () => {
  test('承诺不进意图册，意图不进承诺册', () => {
    const projectId = 'intention-isolation';
    const now = Date.UTC(2026, 10, 15, 9);
    say({ projectId, text: '我明天把文件发你。', role: 'assistant', occurredAt: now });
    say({ projectId, text: '我准备把报告整理一下。', role: 'assistant', occurredAt: now + 1_000 });
    kernel.commitments.compile({ projectId, now: now + 2_000 });
    kernel.intentions.compile({ projectId, now: now + 2_000 });

    const commitments = kernel.commitments.list({ projectId, now: now + 2_000 });
    const intentions = kernel.intentions.list({ projectId, now: now + 2_000 });
    expect(commitments).toHaveLength(1);
    expect(intentions).toHaveLength(1);
    expect(commitments[0]!.content).toContain('文件');
    expect(intentions[0]!.content).toContain('报告');
    expect(intentions.some((entry) => entry.content.includes('文件'))).toBe(false);
    expect(commitments.some((entry) => entry.content.includes('准备'))).toBe(false);

    const commitmentTypes = kernel.commitments.audit({ projectId }).map((row) => row.eventType);
    const intentionTypes = kernel.intentions.audit({ projectId }).map((row) => row.eventType);
    expect(commitmentTypes.every((type) => type.startsWith('COMMITMENT_'))).toBe(true);
    expect(intentionTypes.every((type) => type.startsWith('INTENTION_'))).toBe(true);
  });
});

describe('completion and abandonment stop the plan from resurfacing', () => {
  test('完成证据 → done，不再浮现，证据留在 sourceRefs', () => {
    const projectId = 'intention-complete';
    const now = Date.UTC(2026, 10, 15, 9);
    say({ projectId, text: '我准备把报告整理一下。', role: 'assistant', occurredAt: now });
    kernel.intentions.compile({ projectId, now: now + 1_000 });

    const doneTurn = say({ projectId, text: '报告已经弄完了。', role: 'assistant', occurredAt: now + DAY });
    const compiled = kernel.intentions.compile({ projectId, now: now + DAY + 1_000 });
    expect(compiled.closed).toBe(1);
    const done = kernel.intentions.list({ projectId, statuses: ['done'], now: now + DAY + 1_000 })[0]!;
    expect(done.status).toBe('done');
    expect(done.closeReason).toBe('done');
    expect(done.closedAt).toBe(doneTurn.occurredAt);
    expect(done.sourceRefs.map((ref) => ref.eventId)).toContain(doneTurn.eventId);
    expect(kernel.intentions.activeForAgent({ projectId, agentId: 'hermes' })).toEqual([]);

    const again = kernel.intentions.compile({ projectId, now: now + DAY + 2_000 });
    expect(again.closed).toBe(0);
    expect(kernel.intentions.audit({ projectId }).filter((row) => row.eventType === 'INTENTION_CLOSED')).toHaveLength(1);
  });

  test('完成的 artifact 可以按 id 关闭做梦候选', () => {
    const projectId = 'intention-artifact';
    const now = Date.UTC(2026, 10, 15, 9);
    const ref = say({ projectId, text: '复盘时提到缓存层最近很慢。', role: 'assistant', occurredAt: now });
    const proposed = kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备把缓存层换掉。', sourceRefs: [{ eventId: ref.eventId }], now: now + 1_000,
    });
    const artifact = kernel.recordTaskEvent({
      projectId, threadId: 't-artifact', content: 'cache layer swapped', occurredAt: now + DAY,
      metadata: { completesIntention: proposed.intentionId },
    });
    kernel.intentions.compile({ projectId, now: now + DAY + 1_000 });
    const done = kernel.intentions.list({ projectId, statuses: ['done'], now: now + DAY + 1_000 })[0]!;
    expect(done.sourceRefs.map((ref) => ref.eventId)).toContain(artifact.eventId);
  });

  test('自弃 → abandoned，留痕且不再浮现', () => {
    const projectId = 'intention-abandon';
    const now = Date.UTC(2026, 10, 15, 9);
    const ref = say({ projectId, text: '复盘时提到日志太多。', role: 'assistant', occurredAt: now });
    const proposed = kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备把这批日志清掉。', sourceRefs: [{ eventId: ref.eventId }], now: now + 1_000,
    });
    const evidence = say({ projectId, text: '这个先不做了。', occurredAt: now + DAY });
    const closed = kernel.intentions.close({
      projectId, intentionId: proposed.intentionId, status: 'abandoned', evidenceEventId: evidence.eventId, now: now + DAY + 1_000,
    });
    expect(closed.status).toBe('abandoned');
    expect(closed.closeReason).toBe('abandoned');
    expect(closed.sourceRefs.map((ref) => ref.eventId)).toContain(evidence.eventId);
    expect(kernel.intentions.list({ projectId, statuses: ['active'] })).toEqual([]);
    expect(kernel.intentions.audit({ projectId }).filter((row) => row.eventType === 'INTENTION_CLOSED')).toHaveLength(1);
    expect(() => kernel.intentions.close({
      projectId, intentionId: proposed.intentionId, status: 'done', evidenceEventId: 'missing', now: now + DAY + 2_000,
    })).toThrow('invalid_intention_evidence');
  });
});

describe('a restart brings active intentions back into the wake assembly', () => {
  test('kill 后重启，working_set 里仍有 active 意图与 sourceRefs', async () => {
    const projectId = 'intention-restart';
    const sessionId = 'restart-hermes';
    const now = Date.now();
    await kernel.appendEpisodeMessageAsync({
      projectId, sessionId, sourceAgent: 'hermes', role: 'assistant',
      text: '我准备把重启后的接口补上。', timestamp: now - 1_000,
    });
    kernel.intentions.compile({ projectId, now });

    kernel.close();
    kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });

    const assembly = kernel.sessionContext.assemble({
      projectId, agentId: 'hermes', sessionId, targetTokens: 4_000, now: now + 1_000,
    });
    const working = assembly.lanes.find((lane) => lane.lane === 'working_set')!;
    expect(working.items.some((item) => item.text.includes('意图：') && item.text.includes('重启后的接口'))).toBe(true);
    expect(working.items.find((item) => item.text.includes('意图：'))?.sourceRefs?.length).toBeGreaterThan(0);
    expect(assembly.lanes.map((lane) => lane.lane)).toEqual(['pinned', 'profile', 'digest', 'working_set', 'recall', 'tail']);
  });
});

describe('conversion moves the debt to F16 without double-booking', () => {
  test('意图转承诺后 converted，承诺册单账，不双挂', () => {
    const projectId = 'intention-convert';
    const now = Date.UTC(2026, 10, 15, 9);
    const promiseTurn = say({ projectId, text: '我明天把文件发你。', role: 'assistant', occurredAt: now });
    kernel.commitments.compile({ projectId, now: now + 1_000 });
    const commitment = kernel.commitments.list({ projectId, now: now + 1_000 })[0]!;
    const proposed = kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备把文件发你。', sourceRefs: [{ eventId: promiseTurn.eventId }], now: now + 2_000,
    });

    const converted = kernel.intentions.convert({
      projectId, intentionId: proposed.intentionId, commitmentId: commitment.commitmentId, now: now + 3_000,
    });
    expect(converted.status).toBe('converted');
    expect(converted.closeReason).toBe('converted');
    expect(converted.convertedTo).toBe(commitment.commitmentId);
    expect(kernel.intentions.activeForAgent({ projectId, agentId: 'hermes' })).toEqual([]);
    expect(kernel.commitments.list({ projectId, now: now + 4_000 })).toHaveLength(1);
    expect(kernel.commitments.audit({ projectId }).filter((row) => row.eventType === 'COMMITMENT_OPENED')).toHaveLength(1);

    const again = kernel.intentions.convert({
      projectId, intentionId: proposed.intentionId, commitmentId: commitment.commitmentId, now: now + 5_000,
    });
    expect(again.status).toBe('converted');
    expect(kernel.intentions.audit({ projectId }).filter((row) => row.eventType === 'INTENTION_CLOSED')).toHaveLength(1);

    const other = kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备把另一份文件也发你。', sourceRefs: [{ eventId: promiseTurn.eventId }], now: now + 6_000,
    });
    expect(() => kernel.intentions.convert({
      projectId, intentionId: other.intentionId, commitmentId: 'missing', now: now + 7_000,
    })).toThrow('commitment_unknown');
  });
});

describe('the owner veto is abandoned, traced and global', () => {
  test('否决一处，换读面/换场合仍不浮现，审计留痕', () => {
    const projectId = 'intention-veto';
    const now = Date.UTC(2026, 10, 15, 9);
    const ref = say({ projectId, text: '复盘时提到日志太多。', role: 'assistant', occurredAt: now });
    const proposed = kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备把这批日志清掉。', sourceRefs: [{ eventId: ref.eventId }], now: now + 1_000,
    });
    const ownerTurn = say({ projectId, text: '这个计划我不同意。', role: 'user', occurredAt: now + 2_000 });
    const vetoed = kernel.intentions.veto({
      projectId, intentionId: proposed.intentionId, evidenceEventId: ownerTurn.eventId, now: now + 3_000,
    });
    expect(vetoed.status).toBe('abandoned');
    expect(vetoed.closeReason).toBe('vetoed');
    expect(vetoed.vetoEventId).toBe(ownerTurn.eventId);
    expect(vetoed.sourceRefs.map((ref) => ref.eventId)).toContain(ownerTurn.eventId);

    expect(kernel.intentions.list({ projectId, statuses: ['active'] })).toEqual([]);
    expect(kernel.intentions.activeForAgent({ projectId, agentId: 'hermes' })).toEqual([]);
    const assembly = kernel.sessionContext.assemble({
      projectId, agentId: 'hermes', sessionId: 'veto-session', targetTokens: 4_000, now: now + 4_000,
    });
    const working = assembly.lanes.find((lane) => lane.lane === 'working_set')!;
    expect(working.items.some((item) => item.text.includes('意图：'))).toBe(false);

    const again = kernel.intentions.veto({
      projectId, intentionId: proposed.intentionId, evidenceEventId: ownerTurn.eventId, now: now + 5_000,
    });
    expect(again.status).toBe('abandoned');
    expect(kernel.intentions.audit({ projectId }).filter((row) => row.eventType === 'INTENTION_CLOSED')).toHaveLength(1);
    expect(() => kernel.intentions.veto({
      projectId, intentionId: proposed.intentionId, evidenceEventId: 'missing', now: now + 6_000,
    })).toThrow('invalid_intention_evidence');
  });
});

describe('a plan can become an F2 wake intention', () => {
  test('目标时机落 F2，重复排程仍是一条', () => {
    const projectId = 'intention-schedule';
    const now = Date.UTC(2026, 10, 15, 9);
    const ref = say({ projectId, text: '复盘时提到缓存层最近很慢。', role: 'assistant', occurredAt: now });
    const proposed = kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备把缓存层换掉。', sourceRefs: [{ eventId: ref.eventId }], dueAt: now + DAY, now: now + 1_000,
    });
    const scheduled = kernel.intentions.schedule({ projectId, intentionId: proposed.intentionId, now: now + 2_000 });
    expect(scheduled.wakeIntentionId).toBeTruthy();
    const wakes = kernel.wakeIntentions.list({ projectId, agentId: 'hermes', statuses: ['pending'] });
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.at).toBe(now + DAY);
    expect(wakes[0]!.reason).toBe(proposed.content);

    const again = kernel.intentions.schedule({ projectId, intentionId: proposed.intentionId, now: now + 3_000 });
    expect(again.wakeIntentionId).toBe(scheduled.wakeIntentionId);
    expect(kernel.wakeIntentions.list({ projectId, agentId: 'hermes', statuses: ['pending'] })).toHaveLength(1);

    const noDue = kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备把文档补上。', sourceRefs: [{ eventId: ref.eventId }], now: now + 4_000,
    });
    expect(() => kernel.intentions.schedule({ projectId, intentionId: noDue.intentionId, now: now + 5_000 }))
      .toThrow('intention_due_required');
  });
});

describe('the agent corrects its own plan and the ledger records it', () => {
  test('自改内容与目标时机，version 递增', () => {
    const projectId = 'intention-update';
    const now = Date.UTC(2026, 10, 15, 9);
    const ref = say({ projectId, text: '复盘时提到报告还没整理。', role: 'assistant', occurredAt: now });
    const proposed = kernel.intentions.propose({
      projectId, agentId: 'hermes', content: '我准备把报告整理一下。', sourceRefs: [{ eventId: ref.eventId }], now: now + 1_000,
    });
    const updated = kernel.intentions.update({
      projectId, intentionId: proposed.intentionId, content: '我准备把报告再整理一遍。', dueAt: now + DAY, now: now + 2_000,
    });
    expect(updated.content).toBe('我准备把报告再整理一遍。');
    expect(updated.dueAt).toBe(now + DAY);
    expect(updated.version).toBe(2);
    expect(kernel.intentions.audit({ projectId }).filter((row) => row.eventType === 'INTENTION_UPDATED')).toHaveLength(1);
  });
});

describe('the backend exposes the agent face and not the owner veto', () => {
  test('后端可提议/改/弃，读面可用，且没有 veto', () => {
    const projectId = 'intention-backend';
    const now = Date.UTC(2026, 10, 15, 9);
    const ref = say({ projectId, text: '复盘时提到后端接口还没补。', role: 'assistant', occurredAt: now });
    const backend = new KernelAgentMemoryBackend(kernel, { agentId: 'hermes' });
    const proposed = backend.proposeIntention({
      projectId, content: '我准备把后端接口补上。', sourceRefs: [{ eventId: ref.eventId }], now: now + 1_000,
    });
    expect(proposed.agentId).toBe('hermes');
    expect(backend.listIntentions({ projectId, statuses: ['active'] }).some((entry) => entry.intentionId === proposed.intentionId)).toBe(true);

    const updated = backend.updateIntention({
      projectId, intentionId: proposed.intentionId, content: '我准备把后端接口补齐。', now: now + 2_000,
    });
    expect(updated.content).toBe('我准备把后端接口补齐。');

    const evidence = say({ projectId, text: '这个先不做了。', occurredAt: now + 3_000 });
    const closed = backend.closeIntention({
      projectId, intentionId: proposed.intentionId, status: 'abandoned', evidenceEventId: evidence.eventId, now: now + 4_000,
    });
    expect(closed.status).toBe('abandoned');
    expect(backend.auditIntentions({ projectId }).length).toBeGreaterThan(0);
    expect((backend as unknown as Record<string, unknown>).veto).toBeUndefined();
  });
});

describe('the refusals are named', () => {
  test('缺 project / intention / limit 的调用按契约报错', () => {
    const projectId = 'intention-errors';
    expect(() => kernel.intentions.list({ projectId: '' })).toThrow('project_id_required');
    expect(() => kernel.intentions.close({
      projectId, intentionId: '', status: 'done', evidenceEventId: 'x',
    })).toThrow('intention_id_required');
    expect(() => kernel.intentions.list({ projectId, limit: 0 })).toThrow('invalid_limit');
    expect(() => kernel.intentions.update({ projectId, intentionId: 'missing' })).toThrow('intention_unknown');
    expect(() => kernel.intentions.propose({
      projectId, agentId: '', content: '我准备做点什么。', sourceRefs: [],
    })).toThrow('agent_id_required');
  });
});
