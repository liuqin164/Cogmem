import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  PROCEDURE_API_METHODS,
  PROCEDURE_CONTRACT_VERSION,
  PROCEDURE_DELIVERY_POLICY,
  PROCEDURE_DELIVERY_TIERS,
  PROCEDURE_ENTRY_FIELDS,
  PROCEDURE_ERROR_CODES,
  PROCEDURE_EVENT_TYPES,
  PROCEDURE_GRADES,
  PROCEDURE_ORIGINS,
} from '../src/procedure/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F15 procedure-compilation contract (#192), asserted against the document it claims to
 * implement.
 *
 * The acceptance is behavioural: a second same-domain task's start-of-work assembly carries the
 * tool choice and preference learned from the first attempt (and a project that never compiles
 * carries neither); an imported guide is recallable and an own practice outranks it; a checklist
 * entry is delivered whole under a budget that would cut everything else; and every entry's
 * sourceRefs resolve to a real ledger row.
 */

const scratch = makeTempDir('cogmem-procedure-contract-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/procedure-compilation.md', import.meta.url)), 'utf8');

function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_.-]*)`/gmu)].map((match) => match[1]!);
}

function experience(input: {
  projectId: string;
  threadId: string;
  domain?: string;
  key?: string;
  title?: string;
  steps?: string[];
  tools?: string[];
  outcome?: 'succeeded' | 'failed';
  checklist?: boolean;
  occurredAt?: number;
}) {
  return kernel.recordTaskEvent({
    projectId: input.projectId,
    threadId: input.threadId,
    role: 'system',
    content: 'task completed',
    occurredAt: input.occurredAt,
    metadata: {
      procedure: {
        domain: input.domain ?? '发布',
        key: input.key ?? 'publish',
        title: input.title ?? '发布 npm 包',
        steps: input.steps ?? ['跑测试', 'bun run build', 'npm publish'],
        tools: input.tools ?? ['bun', 'npm'],
        outcome: input.outcome ?? 'succeeded',
        checklist: input.checklist === true,
      },
    },
  });
}

describe('the contract document and the frozen lists agree', () => {
  test('the grade, origin and delivery tables are exactly their frozen lists, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Grades (frozen)'))).toEqual([...PROCEDURE_GRADES]);
    expect(backtickedFirstColumn(sectionAfter('## Origins (frozen)'))).toEqual([...PROCEDURE_ORIGINS]);
    expect(backtickedFirstColumn(sectionAfter('## Delivery tiers (frozen)'))).toEqual([...PROCEDURE_DELIVERY_TIERS]);
  });

  test('the face table is exactly PROCEDURE_API_METHODS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## The face (frozen)'))).toEqual([...PROCEDURE_API_METHODS]);
  });

  test('the entry-field table is exactly PROCEDURE_ENTRY_FIELDS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Entry fields (frozen)'))).toEqual([...PROCEDURE_ENTRY_FIELDS]);
  });

  test('the book-event table is exactly PROCEDURE_EVENT_TYPES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Book events (frozen)'))).toEqual([...PROCEDURE_EVENT_TYPES]);
  });

  test('the error table is exactly PROCEDURE_ERROR_CODES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...PROCEDURE_ERROR_CODES]);
  });

  test('every frozen method exists, the version is 1, and the delivery policy has one row per tier', () => {
    expect(PROCEDURE_CONTRACT_VERSION).toBe(1);
    for (const method of PROCEDURE_API_METHODS) {
      expect(typeof (kernel.procedures as unknown as Record<string, unknown>)[method]).toBe('function');
    }
    expect(Object.keys(PROCEDURE_DELIVERY_POLICY)).toEqual([...PROCEDURE_DELIVERY_TIERS]);
    expect(PROCEDURE_DELIVERY_POLICY.checklist.downgradable).toBe(false);
    expect(PROCEDURE_DELIVERY_POLICY.recall.downgradable).toBe(true);
  });
});

describe('the second same-domain task starts with what the first one learned', () => {
  test('第二次任务的开工组装带上工具选择与用户偏好；首次组装没有，拆掉编译产物也变红', async () => {
    const projectId = 'procedure-second-task';
    const first = kernel.procedures.assembleTask({ projectId, task: '帮我发布 npm 包', now: 1_000 });
    expect(first.items).toEqual([]);
    expect(first.text).toBe('');

    // The owner's preference, through F5's own ledger (not copied into the procedure book).
    const preferenceTurn = kernel.recordRawEvent({
      threadId: 't-pref', projectId, role: 'user', content: '发布前我想先跑一遍测试。',
    });
    kernel.beliefStore.upsert({
      projectId, scope: 'project', subject: 'owner', predicate: 'prefers',
      objectValue: { raw: '发布前先跑测试', type: 'string' }, confidence: 0.9,
      sourceType: 'user_input', extractionReason: 'preference_signal', sourceEventId: preferenceTurn.eventId, validFrom: 1_500,
    });

    experience({ projectId, threadId: 't-1', occurredAt: 2_000 });
    experience({ projectId, threadId: 't-2', occurredAt: 3_000 });
    kernel.profile.compile({ projectId });
    kernel.procedures.compile({ projectId, now: 4_000 });

    const second = kernel.procedures.assembleTask({ projectId, task: '帮我发布 npm 包', now: 5_000 });
    expect(second.items.some((item) => item.kind === 'procedure' && item.text.includes('bun run build'))).toBe(true);
    expect(second.items.some((item) => item.kind === 'procedure' && item.text.includes('tools: bun, npm'))).toBe(true);
    expect(second.items.some((item) => item.kind === 'preference' && item.text.includes('发布前先跑测试'))).toBe(true);

    // The counterfactual: the same ledger with no compile has no procedure to assemble, which is
    // what makes the compile the thing under test rather than the evidence's mere presence.
    const uncompiled = 'procedure-second-task-uncompiled';
    experience({ projectId: uncompiled, threadId: 't-u1', occurredAt: 2_000 });
    experience({ projectId: uncompiled, threadId: 't-u2', occurredAt: 3_000 });
    const without = kernel.procedures.assembleTask({ projectId: uncompiled, task: '帮我发布 npm 包', now: 5_000 });
    expect(without.items).toEqual([]);
  });

  test('重复成功为 established，一次成功加一次失败仍是 tentative 且失败落账', () => {
    const projectId = 'procedure-grades';
    experience({ projectId, threadId: 't-ok', occurredAt: 1_000 });
    kernel.procedures.compile({ projectId, now: 1_100 });
    expect(kernel.procedures.entries({ projectId })[0]!.grade).toBe('tentative');

    experience({ projectId, threadId: 't-bad', outcome: 'failed', occurredAt: 1_200 });
    kernel.procedures.compile({ projectId, now: 1_300 });
    const revised = kernel.procedures.entries({ projectId })[0]!;
    expect(revised.grade).toBe('tentative');
    expect(revised.support.failures).toBe(1);
    expect(revised.support.successes).toBe(1);
    expect(revised.support.lastOutcome).toBe('failed');

    experience({ projectId, threadId: 't-ok-2', occurredAt: 1_400 });
    kernel.procedures.compile({ projectId, now: 1_500 });
    expect(kernel.procedures.entries({ projectId })[0]!.grade).toBe('established');
  });

  test('用户纠正压过旧做法并成为 high-weight 经历', () => {
    const projectId = 'procedure-correction';
    experience({ projectId, threadId: 't-1', occurredAt: 1_000, steps: ['npm publish'], tools: ['npm'] });
    const correction = kernel.recordRawEvent({
      threadId: 't-correct', projectId, role: 'user', content: '不要直接 npm publish，先跑 bun run build。',
      occurredAt: 2_000,
      metadata: { procedureCorrection: { domain: '发布', key: 'publish' } },
    });
    kernel.procedures.compile({ projectId, now: 2_100 });
    const entry = kernel.procedures.entries({ projectId })[0]!;
    expect(entry.origin).toBe('correction');
    expect(entry.grade).toBe('established');
    expect(entry.steps).toEqual(['不要直接 npm publish，先跑 bun run build。']);
    expect(entry.sourceRefs.map((ref) => ref.eventId)).toContain(correction.eventId);
    expect(kernel.eventStore.getEvent(correction.eventId)?.role).toBe('user');
  });
});

describe('imported guides are recalled, and an own practice outranks them', () => {
  test('导入材料可召回；同域自有经历重编译后排序压过导入', () => {
    const projectId = 'procedure-imported';
    kernel.recordRawEvent({
      threadId: 't-import', projectId, role: 'user', content: 'Imported skill guide.',
      occurredAt: 1_000,
      metadata: {
        imported: true,
        procedure: {
          domain: '发布', key: 'publish', title: '发布 npm 包', steps: ['npm publish --access public'],
          tools: ['npm'], checklist: false,
        },
      },
    });
    kernel.procedures.compile({ projectId, now: 1_100 });
    const importedOnly = kernel.procedures.recall({ projectId, task: '帮我发布 npm 包', now: 1_200 });
    expect(importedOnly.map((entry) => entry.origin)).toEqual(['imported']);
    expect(importedOnly[0]!.steps).toContain('npm publish --access public');

    // One own attempt is still `tentative`, the same grade as imported material, so origin is the
    // only thing that can put it first here.
    experience({ projectId, threadId: 't-1', occurredAt: 2_000, steps: ['跑测试', 'bun run build', 'bun publish'], tools: ['bun'] });
    kernel.procedures.compile({ projectId, now: 2_100 });
    const tentativeOwn = kernel.procedures.recall({ projectId, task: '帮我发布 npm 包', now: 2_200 });
    expect(tentativeOwn.map((entry) => entry.origin)).toEqual(['experience', 'imported']);
    expect(tentativeOwn[0]!.grade).toBe('tentative');
    expect(tentativeOwn[1]!.grade).toBe('tentative');

    // A second success establishes it; it still leads, now on support as well as origin.
    experience({ projectId, threadId: 't-2', occurredAt: 3_000, steps: ['跑测试', 'bun run build', 'bun publish'], tools: ['bun'] });
    kernel.procedures.compile({ projectId, now: 3_100 });
    const both = kernel.procedures.recall({ projectId, task: '帮我发布 npm 包', now: 3_200 });
    expect(both.map((entry) => entry.origin)).toEqual(['experience', 'imported']);
    expect(both[0]!.grade).toBe('established');
    expect(both[0]!.score).toBeGreaterThan(both[1]!.score);

    // The imported book is not deleted: it is still there, as the guide that was read.
    expect(kernel.procedures.entries({ projectId }).filter((entry) => entry.origin === 'imported')).toHaveLength(1);
  });
});

describe('a checklist entry is delivered whole under any budget', () => {
  test('命中领域时清单原文完整出现，降级车道再挤也不许摘录', () => {
    const projectId = 'procedure-checklist';
    const steps = ['确认版本号已提升', '跑完整测试', '构建产物', '打 tag', '发布并核对 npm 页面'];
    experience({
      projectId, threadId: 't-check', domain: '发布', key: 'release-checklist',
      title: '发布清单', steps, tools: ['bun', 'npm'], checklist: true, occurredAt: 1_000,
    });
    experience({ projectId, threadId: 't-note', domain: '发布', key: 'notes', title: '普通做法', steps: ['先看文档'], occurredAt: 900 });
    kernel.procedures.compile({ projectId, now: 1_100 });

    const assembled = kernel.procedures.assembleTask({ projectId, task: '发布 npm 包', now: 1_200, targetTokens: 1 });
    const mandatory = assembled.items.filter((item) => item.mandatory);
    expect(mandatory).toHaveLength(1);
    expect(mandatory[0]!.text).toContain('发布清单: 确认版本号已提升 → 跑完整测试 → 构建产物 → 打 tag → 发布并核对 npm 页面');
    // The ordinary entry did not fit and was dropped, with its reason recorded.
    expect(assembled.items.some((item) => item.text.includes('先看文档'))).toBe(false);
    expect(assembled.decisionTrace.some((step) => step.action === 'dropped' && step.reason === 'budget_exceeded')).toBe(true);
    // Whole means whole: every step is present, in order, and none was cut for the budget.
    for (const step of steps) expect(assembled.text).toContain(step);
    expect(assembled.text).not.toMatch(/…|\.\.\./);
  });

  test('非清单条目在预算内正常出现', () => {
    const projectId = 'procedure-budget';
    experience({ projectId, threadId: 't-1', key: 'publish', steps: ['跑测试', '构建'], occurredAt: 1_000 });
    kernel.procedures.compile({ projectId, now: 1_100 });
    const assembled = kernel.procedures.assembleTask({ projectId, task: '发布', now: 1_200, targetTokens: 1_000 });
    expect(assembled.items.map((item) => item.kind)).toEqual(['procedure']);
    expect(assembled.items[0]!.mandatory).toBe(false);
  });
});

describe('every entry is traceable to the turns it was compiled from', () => {
  test('sourceRefs 指向真实回合 fixture', () => {
    const projectId = 'procedure-refs';
    const first = experience({ projectId, threadId: 't-1', occurredAt: 1_000 });
    const second = experience({ projectId, threadId: 't-2', occurredAt: 2_000 });
    kernel.procedures.compile({ projectId, now: 2_100 });
    const entry = kernel.procedures.entries({ projectId })[0]!;
    const refIds = entry.sourceRefs.map((ref) => ref.eventId);
    expect(refIds).toContain(first.eventId);
    expect(refIds).toContain(second.eventId);
    for (const ref of entry.sourceRefs) {
      const event = kernel.eventStore.getEvent(ref.eventId!);
      expect(event).toBeTruthy();
      expect(event!.projectId).toBe(projectId);
      expect(event!.role).toBe('system');
    }
    expect(kernel.procedures.audit({ projectId }).some((row) => row.eventType === 'PROCEDURE_BOOK_RECOMPILED')).toBe(true);
  });

  test('a task event with no descriptor is not procedural evidence', () => {
    const projectId = 'procedure-no-descriptor';
    kernel.recordTaskEvent({ projectId, threadId: 't-plain', content: 'just a task' });
    kernel.procedures.compile({ projectId, now: 1_000 });
    expect(kernel.procedures.entries({ projectId })).toEqual([]);
    expect(() => kernel.procedures.recall({ projectId, task: '   ' })).toThrow('procedure_task_required');
  });
});

describe('the procedure lane reaches the surfacing query by task description', () => {
  test('asked 通道带任务描述时，做法作为候选出现并带出处', () => {
    const projectId = 'procedure-surfacing';
    experience({ projectId, threadId: 't-1', occurredAt: 1_000 });
    kernel.procedures.compile({ projectId, now: 1_100 });
    const result = kernel.surfacing.candidates({ projectId, channel: 'asked', query: '发布 npm 包', now: 1_200 });
    const procedure = result.candidates.find((candidate) => candidate.source === 'procedure');
    expect(procedure).toBeTruthy();
    expect(procedure!.content).toContain('bun run build');
    expect(procedure!.sourceRefs.length).toBeGreaterThan(0);
  });
});
