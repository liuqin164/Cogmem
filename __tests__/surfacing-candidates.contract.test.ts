import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  SENSITIVE_TAG_FIELDS,
  SENSITIVE_TAG_QUERY_FIELDS,
  SENSITIVITY_HIGH_MARKERS,
  SENSITIVITY_PRIVATE_MARKERS,
  SENSITIVITY_TIERS,
  SOURCE_TYPE_PRIVATE_VALUES,
  SURFACING_API_METHODS,
  SURFACING_CANDIDATE_FIELDS,
  SURFACING_CHANNELS,
  SURFACING_CHANNEL_POLICY,
  SURFACING_CONTRACT_VERSION,
  SURFACING_DECISION_STEP_FIELDS,
  SURFACING_DECISION_TRACE_FIELDS,
  SURFACING_ERROR_CODES,
  SURFACING_FRESHNESS_FIELDS,
  SURFACING_RESULT_FIELDS,
  SURFACING_SOURCES,
  SURFACING_WITHHELD_FIELDS,
  SurfacingCandidates,
  classifySensitivity,
  type SensitivityTag,
  type SensitivityTagSource,
} from '../src/surfacing/index.js';
import type { MemoryRawEventType } from '../src/types/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F6 surfacing-candidate contract (#160), asserted against the document it claims to implement.
 *
 * The document test reads the frozen tables out of `docs/surfacing-candidates.md` and compares them
 * with the code's lists, the way the F1–F5 contracts do. The behaviour tests are the ticket's
 * acceptance: a high candidate never appears in the proactive channel and does appear when asked;
 * a private one is withheld from proactive by default; a birthday is daily; a keychain mark is high
 * and hard-withheld; every reason reconciles with its trace; and each landed source produces one.
 */

const scratch = makeTempDir('cogmem-surfacing-contract-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;
let backend: KernelAgentMemoryBackend;
let privateBinding: ReturnType<MemoryKernel['occasionScope']['register']>;

const now = Date.UTC(2026, 10, 14, 12, 0, 0);

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
  // F6's subject is the sensitivity/channel policy. The occasion contract has its own file; this
  // one runs the whole suite as a private connection so the two gates do not confound each other.
  privateBinding = kernel.occasionScope.register({ channelId: 'contract', occasion: 'private' });
  backend = new KernelAgentMemoryBackend(kernel, { binding: privateBinding });
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/surfacing-candidates.md', import.meta.url)), 'utf8');

/** The text of one heading's section, stopping at the next heading of the same or a higher level. */
function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

/** The backticked first column of every table row in a section, in order. */
function firstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]!);
}

/** The first cell and remaining cells of every backticked-first-column table row. */
function tableRows(section: string): Array<{ first: string; cells: string[] }> {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/gmu)].map((match) => ({
    first: match[1]!,
    cells: match[2]!.split('|').map((cell) => cell.trim().replace(/`/g, '')),
  }));
}

let seq = 0;
function writeTurn(
  projectId: string,
  content: string,
  options: {
    role?: 'user' | 'assistant';
    occurredAt?: number;
    rawEventType?: MemoryRawEventType;
    metadata?: Record<string, unknown>;
  } = {},
) {
  seq += 1;
  return kernel.recordRawEvent({
    threadId: `thread-${projectId}-${seq}`,
    sessionId: `session-${projectId}-${seq}`,
    projectId,
    role: options.role ?? 'user',
    rawEventType: options.rawEventType,
    content,
    occurredAt: options.occurredAt ?? now - 60_000,
    metadata: options.metadata,
  });
}

function surfacingWith(sources: SensitivityTagSource[] = []) {
  return new SurfacingCandidates({
    events: kernel.eventStore,
    profile: kernel.profile,
    wakeIntentions: kernel.wakeIntentions,
    prospectiveMemories: kernel.prospectiveMemoryService,
    occasionScope: kernel.occasionScope,
    sensitiveTagSources: sources,
  });
}

describe('the contract document and the frozen lists agree', () => {
  test('the channel table is exactly SURFACING_CHANNELS, in order', () => {
    expect(firstColumn(sectionAfter('## Channels (frozen)'))).toEqual([...SURFACING_CHANNELS]);
  });

  test('the source table is exactly SURFACING_SOURCES, in order', () => {
    expect(firstColumn(sectionAfter('## Sources (frozen)'))).toEqual([...SURFACING_SOURCES]);
  });

  test('the candidate-field table is exactly SURFACING_CANDIDATE_FIELDS, in order', () => {
    expect(firstColumn(sectionAfter('## Candidate fields (frozen)'))).toEqual([...SURFACING_CANDIDATE_FIELDS]);
  });

  test('the result-field table is exactly SURFACING_RESULT_FIELDS, in order', () => {
    expect(firstColumn(sectionAfter('## Result fields (frozen)'))).toEqual([...SURFACING_RESULT_FIELDS]);
  });

  test('the withheld-field table is exactly SURFACING_WITHHELD_FIELDS, in order', () => {
    expect(firstColumn(sectionAfter('## Withheld fields (frozen)'))).toEqual([...SURFACING_WITHHELD_FIELDS]);
  });

  test('the freshness-field table is exactly SURFACING_FRESHNESS_FIELDS, in order', () => {
    expect(firstColumn(sectionAfter('## Freshness fields (frozen)'))).toEqual([...SURFACING_FRESHNESS_FIELDS]);
  });

  test('the tier table is exactly SENSITIVITY_TIERS, in order', () => {
    expect(firstColumn(sectionAfter('## Sensitivity tiers (frozen)'))).toEqual([...SENSITIVITY_TIERS]);
  });

  test('the channel-policy table is exactly SURFACING_CHANNEL_POLICY', () => {
    const rows = tableRows(sectionAfter('### Channel policy (frozen)'));
    expect(rows.map((row) => row.first)).toEqual([...SENSITIVITY_TIERS]);
    for (const row of rows) {
      const policy = SURFACING_CHANNEL_POLICY[row.first as keyof typeof SURFACING_CHANNEL_POLICY];
      expect(row.cells).toEqual(SURFACING_CHANNELS.map((channel) => (policy[channel] ? 'allowed' : 'withheld')));
    }
  });

  test('the classifier marker tables are exactly their frozen lists', () => {
    expect(firstColumn(sectionAfter('### High markers (frozen)'))).toEqual([...SENSITIVITY_HIGH_MARKERS]);
    expect(firstColumn(sectionAfter('### Private markers (frozen)'))).toEqual([...SENSITIVITY_PRIVATE_MARKERS]);
    expect(firstColumn(sectionAfter('### Private raw event types (frozen)'))).toEqual([...SOURCE_TYPE_PRIVATE_VALUES]);
  });

  test('the decision-trace and step tables are exactly their frozen lists', () => {
    expect(firstColumn(sectionAfter('## Decision trace (frozen)'))).toEqual([...SURFACING_DECISION_TRACE_FIELDS]);
    expect(firstColumn(sectionAfter('### Step fields (frozen)'))).toEqual([...SURFACING_DECISION_STEP_FIELDS]);
  });

  test('the sensitive-tag tables are exactly their frozen lists', () => {
    expect(firstColumn(sectionAfter('### Tag fields (frozen)'))).toEqual([...SENSITIVE_TAG_FIELDS]);
    expect(firstColumn(sectionAfter('### Query fields (frozen)'))).toEqual([...SENSITIVE_TAG_QUERY_FIELDS]);
  });

  test('the error table is exactly SURFACING_ERROR_CODES, in order', () => {
    expect(firstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...SURFACING_ERROR_CODES]);
  });

  test('the API table is exactly SURFACING_API_METHODS, in order', () => {
    expect(firstColumn(sectionAfter('## API (frozen)'))).toEqual([...SURFACING_API_METHODS]);
    expect(SURFACING_CONTRACT_VERSION).toBe(2);
  });
});

describe('the computed shapes have exactly the frozen fields', () => {
  test('a result, a candidate, its freshness and its trace expose only documented fields', async () => {
    const projectId = 'contract-shapes';
    await kernel.ingest({ content: '我喜欢喝乌龙茶。', projectId });
    kernel.profile.compile({ projectId });

    const result = backend.surfacingCandidates({ projectId, channel: 'proactive', now, occasion: 'late_night' });
    expect(Object.keys(result)).toEqual([...SURFACING_RESULT_FIELDS]);
    expect(result.candidates.length).toBeGreaterThan(0);

    const candidate = result.candidates[0]!;
    expect(Object.keys(candidate)).toEqual([...SURFACING_CANDIDATE_FIELDS]);
    expect(Object.keys(candidate.freshness)).toEqual([...SURFACING_FRESHNESS_FIELDS]);
    expect(Object.keys(candidate.decisionTrace)).toEqual([...SURFACING_DECISION_TRACE_FIELDS]);
    expect(Object.keys(candidate.decisionTrace.steps[0]!)).toEqual([...SURFACING_DECISION_STEP_FIELDS]);

    const privateProject = 'contract-shapes-private';
    writeTurn(privateProject, '我的工资这个月晚发了。');
    const withheld = backend.surfacingCandidates({ projectId: privateProject, channel: 'proactive', now });
    expect(withheld.withheld.length).toBeGreaterThan(0);
    expect(Object.keys(withheld.withheld[0]!)).toEqual([...SURFACING_WITHHELD_FIELDS]);
  });
});

describe('the classifier is deterministic and passes the acceptance sample set', () => {
  test('every documented sample grades to its documented tier', () => {
    const samples = tableRows(sectionAfter('### Acceptance samples'));
    expect(samples.length).toBeGreaterThanOrEqual(9);
    for (const sample of samples) {
      expect(classifySensitivity({ text: sample.first }).tier).toBe(sample.cells[0]);
    }
  });

  test('a birthday is daily, a medical record is high, and a salary is private', () => {
    expect(classifySensitivity({ text: '我的生日是五月一日。' }).tier).toBe('daily');
    expect(classifySensitivity({ text: '医生给我开了处方，诊断是高血压。' }).tier).toBe('high');
    expect(classifySensitivity({ text: '我的工资这个月晚发了。' }).tier).toBe('private');
  });

  test('a tool-call source type is private', () => {
    const tags = [{
      source: 'source-type',
      tier: 'private' as const,
      reason: 'tool call',
      eventIds: [],
    }];
    expect(classifySensitivity({ text: '天气不错', tags }).tier).toBe('private');
  });

  test('a tool-call ledger turn is private through the built-in source-type tag', () => {
    const projectId = 'contract-source-type';
    const tool = writeTurn(projectId, 'Tool call calendar: 明天下午三点开会。', {
      rawEventType: 'tool_call',
      role: 'assistant',
    });

    const proactive = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(proactive.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === tool.eventId))).toBe(false);
    expect(proactive.withheld.find((entry) => entry.candidateId.endsWith(tool.eventId))?.sensitivity).toBe('private');

    const asked = backend.surfacingCandidates({ projectId, channel: 'asked', now, query: 'calendar' });
    const found = asked.candidates.find((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === tool.eventId));
    expect(found?.sensitivity).toBe('private');
  });

  test('a tool-result ledger turn is private through the built-in source-type tag', () => {
    const projectId = 'contract-source-type-result';
    const tool = writeTurn(projectId, 'Calendar result: 明天下午三点开会。', {
      rawEventType: 'tool_result',
      role: 'assistant',
    });

    const proactive = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(proactive.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === tool.eventId))).toBe(false);
    expect(proactive.withheld.find((entry) => entry.candidateId.endsWith(tool.eventId))?.sensitivity).toBe('private');
  });
});

describe('the proactive channel never shows a high candidate', () => {
  test('a high ledger turn is withheld from proactive and appears when asked', () => {
    const projectId = 'contract-high';
    const medical = writeTurn(projectId, '医生给我开了处方，诊断是高血压。');

    const proactive = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(proactive.candidates.some((candidate) => candidate.content.includes('处方'))).toBe(false);
    expect(proactive.candidates.every((candidate) => candidate.sensitivity !== 'high')).toBe(true);
    expect(proactive.withheld.find((entry) => entry.candidateId.endsWith(medical.eventId))?.sensitivity).toBe('high');

    const asked = backend.surfacingCandidates({ projectId, channel: 'asked', now, query: '处方' });
    const found = asked.candidates.find((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === medical.eventId));
    expect(found?.sensitivity).toBe('high');
  });

  test('a private ledger turn is withheld from proactive by default and appears when asked', () => {
    const projectId = 'contract-private';
    const salary = writeTurn(projectId, '我的工资这个月晚发了。');

    const proactive = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(proactive.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === salary.eventId))).toBe(false);
    expect(proactive.withheld.find((entry) => entry.candidateId.endsWith(salary.eventId))?.sensitivity).toBe('private');

    const asked = backend.surfacingCandidates({ projectId, channel: 'asked', now, query: '工资' });
    expect(asked.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === salary.eventId))).toBe(true);
  });

  test('a birthday is daily and appears in proactive', () => {
    const projectId = 'contract-birthday';
    const birthday = writeTurn(projectId, '我的生日是五月一日。');
    const proactive = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    const found = proactive.candidates.find((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === birthday.eventId));
    expect(found?.sensitivity).toBe('daily');
  });
});

describe('the keychain mark is high and hard-withheld', () => {
  test('a secret-marked turn has no text marker, yet grades high and never surfaces', () => {
    const projectId = 'contract-keychain';
    const secretText = '我的钥匙在这里 sk-abcdefghijklmnopqrstuvwxyz0123456789';
    const secret = writeTurn(projectId, secretText);

    // The text alone is daily; only the keychain mark raises it.
    expect(classifySensitivity({ text: secretText }).tier).toBe('daily');

    for (const channel of ['proactive', 'asked'] as const) {
      const result = backend.surfacingCandidates({
        projectId,
        channel,
        now,
        ...(channel === 'asked' ? { query: '钥匙' } : {}),
      });
      expect(result.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === secret.eventId))).toBe(false);
      expect(result.withheld.find((entry) => entry.candidateId.endsWith(secret.eventId))?.sensitivity).toBe('high');
    }
  });

  test('an injected tag source is appended to the built-ins, so the keychain rule cannot be dropped', () => {
    const projectId = 'contract-keychain-injected';
    const secret = writeTurn(projectId, '我的钥匙在这里 sk-abcdefghijklmnopqrstuvwxyz0123456789');
    const lifeInfo: SensitivityTagSource = { tagsFor: () => [] };
    const service = surfacingWith([lifeInfo]);

    const result = service.candidates({ projectId, channel: 'asked', now, query: '钥匙' }, privateBinding);
    expect(result.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === secret.eventId))).toBe(false);
    expect(result.withheld.find((entry) => entry.candidateId.endsWith(secret.eventId))?.sensitivity).toBe('high');
  });
});

describe('the trace reconciles with every candidate field', () => {
  test('reason is rebuilt from the steps, and each step agrees with the candidate', async () => {
    const projectId = 'contract-trace';
    await kernel.ingest({ content: '我喜欢喝乌龙茶。', projectId });
    kernel.profile.compile({ projectId });
    writeTurn(projectId, '今天下午喝了一杯咖啡。');

    const result = backend.surfacingCandidates({ projectId, channel: 'proactive', now, occasion: 'late_night' });
    expect(result.candidates.length).toBeGreaterThan(0);

    for (const candidate of result.candidates) {
      expect(candidate.reason).toBe(candidate.decisionTrace.reason);
      expect(candidate.reason).toBe(candidate.decisionTrace.steps.map((step) => `${step.rule}=${step.outcome}`).join('; '));

      const source = candidate.decisionTrace.steps.find((step) => step.rule === 'source')!;
      expect(source.outcome.startsWith(`${candidate.source}:`)).toBe(true);
      expect(source.detail.sourceRefs).toBe(candidate.sourceRefs.length);
      const freshness = candidate.decisionTrace.steps.find((step) => step.rule === 'freshness')!;
      expect(freshness.detail).toEqual(candidate.freshness);
      const sensitivity = candidate.decisionTrace.steps.find((step) => step.rule === 'sensitivity')!;
      expect(sensitivity.outcome).toBe(candidate.sensitivity);
      const channel = candidate.decisionTrace.steps.find((step) => step.rule === 'channel')!;
      expect(channel.outcome).toBe('allowed');
      const occasion = candidate.decisionTrace.steps.find((step) => step.rule === 'occasion')!;
      expect(['bound', 'mismatch']).toContain(occasion.outcome);
      expect(occasion.detail.occasion).toBe(candidate.occasion);
    }
  });

  test('a withheld entry reconciles its reason, sensitivity and channel step', () => {
    const projectId = 'contract-trace-withheld';
    writeTurn(projectId, '我的工资这个月晚发了。');

    const result = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(result.withheld.length).toBeGreaterThan(0);
    for (const entry of result.withheld) {
      expect(entry.reason).toBe(entry.decisionTrace.reason);
      expect(entry.reason).toBe(entry.decisionTrace.steps.map((step) => `${step.rule}=${step.outcome}`).join('; '));
      const sensitivity = entry.decisionTrace.steps.find((step) => step.rule === 'sensitivity')!;
      expect(sensitivity.outcome).toBe(entry.sensitivity);
      const channel = entry.decisionTrace.steps.find((step) => step.rule === 'channel')!;
      expect(channel.outcome).toBe('withheld');
      const freshness = entry.decisionTrace.steps.find((step) => step.rule === 'freshness')!;
      expect(['upcoming', 'fresh', 'expired']).toContain(freshness.outcome);
      expect(freshness.detail).toHaveProperty('expired');
    }
  });

  test('a declared occasion is recorded beside the bound one, and a mismatch is visible', () => {
    const projectId = 'contract-occasion';
    writeTurn(projectId, '我的工资这个月晚发了。');

    const lateNight = backend.surfacingCandidates({ projectId, channel: 'proactive', now, occasion: 'late_night' });
    const work = backend.surfacingCandidates({ projectId, channel: 'proactive', now, occasion: 'work' });
    expect(lateNight.occasion).toBe('private');
    expect(lateNight.candidates.map((candidate) => candidate.candidateId)).toEqual(work.candidates.map((candidate) => candidate.candidateId));
    expect(lateNight.withheld.map((entry) => entry.candidateId)).toEqual(work.withheld.map((entry) => entry.candidateId));
    const step = lateNight.withheld[0]!.decisionTrace.steps.find((entry) => entry.rule === 'occasion')!;
    expect(step.outcome).toBe('mismatch');
    expect(step.detail).toMatchObject({ occasion: 'private', declared: 'late_night', mismatch: true });
  });
});

describe('each landed source produces a candidate', () => {
  test('wake intention, prospective memory, profile entry and ledger turn all appear', async () => {
    const projectId = 'contract-sources';
    const evidence = writeTurn(projectId, '提醒我买咖啡。');

    kernel.wakeIntentions.register({
      projectId,
      agentId: 'cog',
      at: now - 60_000,
      reason: '提醒我买咖啡',
      sourceRefs: [{ eventId: evidence.eventId }],
      now,
    });
    const proposed = kernel.prospectiveMemoryService.propose({
      projectId,
      candidateType: 'reminder',
      canonicalKey: 'buy-coffee',
      title: '买咖啡',
      evidenceEventIds: [evidence.eventId],
      proposedBy: 'operator',
      dueAt: now - 30_000,
    });
    const confirmation = writeTurn(projectId, '确认这个提醒。');
    kernel.prospectiveMemoryService.resolve(
      proposed.candidateId,
      { action: 'confirm', confirmationEvidenceEventId: confirmation.eventId },
      projectId,
    );
    await kernel.ingest({ content: '我喜欢喝乌龙茶。', projectId });
    kernel.profile.compile({ projectId });

    const result = backend.surfacingCandidates({ projectId, channel: 'proactive', now, limit: 50 });
    const sources = new Set(result.candidates.map((candidate) => candidate.source));
    expect(sources.has('wake-intention')).toBe(true);
    expect(sources.has('prospective-memory')).toBe(true);
    expect(sources.has('profile')).toBe(true);
    expect(sources.has('ledger')).toBe(true);
  });
});

describe('freshness is reported and enforced', () => {
  test('an eight-day-old turn is outside proactive but inside the asked window', () => {
    const projectId = 'contract-asked-window';
    const old = now - 8 * 24 * 60 * 60 * 1000;
    const turn = writeTurn(projectId, '八天前我整理过一次书架。', { occurredAt: old });

    const proactive = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(proactive.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === turn.eventId))).toBe(false);

    const asked = backend.surfacingCandidates({ projectId, channel: 'asked', now });
    expect(asked.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === turn.eventId))).toBe(true);
  });

  test('an expired due item is withheld from proactive and remains available when asked', () => {
    const projectId = 'contract-expiry';
    const old = now - 30 * 24 * 60 * 60 * 1000;
    const evidence = writeTurn(projectId, '提醒我交报告。', { occurredAt: old });
    kernel.wakeIntentions.register({
      projectId,
      agentId: 'cog',
      at: old,
      reason: '提醒我交报告',
      sourceRefs: [{ eventId: evidence.eventId }],
      now: old,
    });

    const proactive = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(proactive.candidates.some((candidate) => candidate.source === 'wake-intention')).toBe(false);
    const asked = backend.surfacingCandidates({ projectId, channel: 'asked', now, query: '交报告' });
    const found = asked.candidates.find((candidate) => candidate.source === 'wake-intention');
    expect(found?.freshness.expired).toBe(true);
  });
});

describe('the sensitive-tag interface is the F10 entry point', () => {
  test('a third source can raise a birthday to high without a contract change', () => {
    const lifeInfo: SensitivityTag = {
      source: 'life-info',
      tier: 'high',
      reason: 'life information',
      eventIds: [],
    };
    expect(Object.keys(lifeInfo)).toEqual([...SENSITIVE_TAG_FIELDS]);
    expect(classifySensitivity({ text: '我的生日是五月一日。', tags: [lifeInfo] }).tier).toBe('high');
    expect(Object.keys({ projectId: 'p', eventIds: [], text: '', sourceType: undefined, metadata: undefined }))
      .toEqual([...SENSITIVE_TAG_QUERY_FIELDS]);
  });

  test('an injected life-info source withholds a birthday from proactive and allows it when asked', () => {
    const projectId = 'contract-life-info';
    const birthday = writeTurn(projectId, '我的生日是五月一日。');
    const lifeInfo: SensitivityTagSource = {
      tagsFor: (query) => query.text.includes('生日')
        ? [{ source: 'life-info', tier: 'high', reason: 'life information', eventIds: [] }]
        : [],
    };
    const service = surfacingWith([lifeInfo]);

    const proactive = service.candidates({ projectId, channel: 'proactive', now }, privateBinding);
    expect(proactive.candidates.some((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === birthday.eventId))).toBe(false);
    expect(proactive.withheld.find((entry) => entry.candidateId.endsWith(birthday.eventId))?.sensitivity).toBe('high');

    const asked = service.candidates({ projectId, channel: 'asked', now, query: '生日' }, privateBinding);
    expect(asked.candidates.find((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === birthday.eventId))?.sensitivity).toBe('high');
  });

  test('a tag whose event ids do not intersect the candidate does not raise it', () => {
    const projectId = 'contract-tag-scope';
    const birthday = writeTurn(projectId, '我的生日是五月一日。');
    const elsewhere: SensitivityTagSource = {
      tagsFor: () => [{ source: 'life-info', tier: 'high', reason: 'elsewhere', eventIds: ['not-this-event'] }],
    };

    const proactive = surfacingWith([elsewhere]).candidates({ projectId, channel: 'proactive', now });
    expect(proactive.candidates.find((candidate) => candidate.sourceRefs.some((ref) => ref.eventId === birthday.eventId))?.sensitivity).toBe('daily');
  });
});

describe('the frozen errors are thrown', () => {
  test('a missing project, unknown channel, bad limit and bad clock each name themselves', () => {
    expect(() => backend.surfacingCandidates({ projectId: '', channel: 'proactive' })).toThrow('project_id_required');
    expect(() => backend.surfacingCandidates({ projectId: 'p', channel: 'nope' as never })).toThrow('invalid_surfacing_channel');
    expect(() => backend.surfacingCandidates({ projectId: 'p', channel: 'proactive', limit: 0 })).toThrow('invalid_limit');
    expect(() => backend.surfacingCandidates({ projectId: 'p', channel: 'proactive', now: Number.NaN })).toThrow('invalid_surfacing_now');
    expect(() => backend.surfacingCandidates({ projectId: 'p', channel: 'proactive', query: 1 as never })).toThrow('invalid_surfacing_query');
    expect(() => backend.surfacingCandidates({ projectId: 'p', channel: 'proactive', occasion: 1 as never })).toThrow('invalid_surfacing_occasion');
  });
});
