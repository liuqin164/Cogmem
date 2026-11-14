import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  SURFACING_FEEDBACK_API_METHODS,
  SURFACING_FEEDBACK_AUDIT_FIELDS,
  SURFACING_FEEDBACK_CONTRACT_VERSION,
  SURFACING_FEEDBACK_ERROR_CODES,
  SURFACING_FEEDBACK_EVENT_FIELDS,
  SURFACING_FEEDBACK_EVENT_TYPES,
  SURFACING_FEEDBACK_OUTCOMES,
  SURFACING_FEEDBACK_RESUME_FIELDS,
  SURFACING_FEEDBACK_RULES,
  SURFACING_FEEDBACK_RULE_FIELDS,
  SURFACING_FEEDBACK_STATE_FIELDS,
  SURFACING_FEEDBACK_TYPES,
  SURFACING_FEEDBACK_TYPE_FIELDS,
  SURFACING_SOURCES,
  SurfacingCandidates,
} from '../src/surfacing/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F7 surfacing-feedback contract (#161), asserted against the document it claims to implement.
 *
 * The document test reads the frozen tables out of `docs/surfacing-feedback.md` and compares them
 * with the code's lists, the way F1–F6 do. The behaviour tests are the ticket's acceptance: three
 * consecutive ignores measurably reduce that type's proactive frequency (and removing the feedback
 * port restores it), a stop holds the type at zero until an explicit resume, throttling does not
 * touch another type, the state reads back and reconciles with the ledger audit, and the frozen
 * rules are readable in the state.
 */

const scratch = makeTempDir('cogmem-surfacing-feedback-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;
let backend: KernelAgentMemoryBackend;

const now = Date.UTC(2026, 10, 14, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
  backend = new KernelAgentMemoryBackend(kernel);
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/surfacing-feedback.md', import.meta.url)), 'utf8');

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
function writeTurn(projectId: string, content: string, occurredAt = now - 60_000) {
  seq += 1;
  return kernel.recordRawEvent({
    threadId: `thread-${projectId}-${seq}`,
    sessionId: `session-${projectId}-${seq}`,
    projectId,
    role: 'user',
    content,
    occurredAt,
  });
}

async function seedProfile(projectId: string): Promise<void> {
  await kernel.ingest({ content: '我喜欢喝乌龙茶。', projectId });
  kernel.profile.compile({ projectId });
}

function proactive(projectId: string, at: number) {
  return backend.surfacingCandidates({ projectId, channel: 'proactive', now: at, limit: 50 });
}

function count(result: ReturnType<typeof proactive>, source: (typeof SURFACING_SOURCES)[number]): number {
  return result.candidates.filter((candidate) => candidate.source === source).length;
}

function candidateOf(result: ReturnType<typeof proactive>, source: (typeof SURFACING_SOURCES)[number]) {
  const candidate = result.candidates.find((entry) => entry.source === source);
  if (!candidate) throw new Error(`no ${source} candidate`);
  return candidate;
}

describe('the contract document and the frozen lists agree', () => {
  test('the type table is exactly SURFACING_FEEDBACK_TYPES, in order', () => {
    expect(firstColumn(sectionAfter('## Types (frozen)'))).toEqual([...SURFACING_FEEDBACK_TYPES]);
    expect(SURFACING_FEEDBACK_TYPES).toEqual([...SURFACING_SOURCES]);
  });

  test('the outcome table is exactly SURFACING_FEEDBACK_OUTCOMES, in order', () => {
    expect(firstColumn(sectionAfter('## Outcomes (frozen)'))).toEqual([...SURFACING_FEEDBACK_OUTCOMES]);
  });

  test('the event-type table is exactly SURFACING_FEEDBACK_EVENT_TYPES, in order', () => {
    expect(firstColumn(sectionAfter('## Event types (frozen)'))).toEqual([...SURFACING_FEEDBACK_EVENT_TYPES]);
  });

  test('the feedback-event and resume-event field tables are exactly their frozen lists', () => {
    expect(firstColumn(sectionAfter('## Feedback event fields (frozen)'))).toEqual([...SURFACING_FEEDBACK_EVENT_FIELDS]);
    expect(firstColumn(sectionAfter('## Resume event fields (frozen)'))).toEqual([...SURFACING_FEEDBACK_RESUME_FIELDS]);
    expect(firstColumn(sectionAfter('## Audit entry fields (frozen)'))).toEqual([...SURFACING_FEEDBACK_AUDIT_FIELDS]);
  });

  test('the rules table is exactly the frozen rule parameters and values', () => {
    const rows = tableRows(sectionAfter('## Rules (frozen)'));
    expect(rows.map((row) => row.first)).toEqual([...SURFACING_FEEDBACK_RULE_FIELDS]);
    for (const row of rows) {
      expect(row.cells[0]).toBe(String(SURFACING_FEEDBACK_RULES[row.first as keyof typeof SURFACING_FEEDBACK_RULES]));
    }
  });

  test('the state, type-state, API and error tables are exactly their frozen lists', () => {
    expect(firstColumn(sectionAfter('## State fields (frozen)'))).toEqual([...SURFACING_FEEDBACK_STATE_FIELDS]);
    expect(firstColumn(sectionAfter('## Type state fields (frozen)'))).toEqual([...SURFACING_FEEDBACK_TYPE_FIELDS]);
    expect(firstColumn(sectionAfter('## API (frozen)'))).toEqual([...SURFACING_FEEDBACK_API_METHODS]);
    expect(firstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...SURFACING_FEEDBACK_ERROR_CODES]);
    expect(SURFACING_FEEDBACK_CONTRACT_VERSION).toBe(1);
  });
});

describe('a reaction is a ledger row', () => {
  test('the event carries the candidate id, its type and its source refs', () => {
    const projectId = 'feedback-record';
    writeTurn(projectId, '今天下午喝了一杯咖啡。');
    const candidate = candidateOf(proactive(projectId, now), 'ledger');

    const record = backend.recordSurfacingFeedback({
      projectId,
      candidateId: candidate.candidateId,
      outcome: 'ignored',
      sourceRefs: candidate.sourceRefs,
      now,
    });

    expect(Object.keys(record)).toEqual([...SURFACING_FEEDBACK_EVENT_FIELDS]);
    expect(record.type).toBe('ledger');
    expect(record.outcome).toBe('ignored');
    expect(record.candidateId).toBe(candidate.candidateId);
    expect(record.sourceRefs).toEqual(candidate.sourceRefs);

    const audit = kernel.surfacingFeedback.audit({ projectId });
    expect(audit.length).toBe(1);
    expect(Object.keys(audit[0]!)).toEqual([...SURFACING_FEEDBACK_AUDIT_FIELDS]);
    expect(audit[0]!.candidateId).toBe(candidate.candidateId);
    expect(audit[0]!.type).toBe('ledger');
    expect(audit[0]!.sourceRefs).toEqual(candidate.sourceRefs);
    expect(audit[0]!.occurredAt).toBe(now);
  });
});

describe('three consecutive ignores reduce that type’s proactive frequency', () => {
  test('the measured appearance count drops to zero, and removing the feedback port restores it', () => {
    const projectId = 'feedback-throttle';
    writeTurn(projectId, '今天下午喝了一杯咖啡。');
    const instants = [now + 3 * HOUR, now + 4 * HOUR, now + 5 * HOUR];
    const baseline = instants.map((at) => count(proactive(projectId, at), 'ledger'));
    expect(baseline.every((value) => value > 0)).toBe(true);

    const candidate = candidateOf(proactive(projectId, now), 'ledger');
    for (let index = 0; index < 3; index += 1) {
      backend.recordSurfacingFeedback({
        projectId,
        candidateId: candidate.candidateId,
        outcome: 'ignored',
        now: now + index * HOUR,
      });
    }

    const after = instants.map((at) => count(proactive(projectId, at), 'ledger'));
    expect(after).toEqual([0, 0, 0]);
    expect(baseline.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(after.reduce((sum, value) => sum + value, 0));

    // The withhold is visible with its reason, not silently dropped.
    const withheld = proactive(projectId, instants[0]!).withheld.find((entry) => entry.source === 'ledger');
    expect(withheld?.reason).toContain('modulation=throttled');
    const step = withheld?.decisionTrace.steps.find((entry) => entry.rule === 'modulation');
    expect(step?.outcome).toBe('throttled');
    expect(step?.detail.type).toBe('ledger');
    expect(step?.detail.level).toBe(1);

    // Removing the feedback port is removing the modulation: the same instants surface again.
    const unmodulated = new SurfacingCandidates({
      events: kernel.eventStore,
      profile: kernel.profile,
      wakeIntentions: kernel.wakeIntentions,
      prospectiveMemories: kernel.prospectiveMemoryService,
      occasionScope: kernel.occasionScope,
    });
    expect(instants.map((at) => unmodulated.candidates({ projectId, channel: 'proactive', now: at, limit: 50 })
      .candidates.filter((entry) => entry.source === 'ledger').length)).toEqual(baseline);
  });

  test('an engaged reaction restores the frequency after the ignores', () => {
    const projectId = 'feedback-engaged';
    writeTurn(projectId, '今天下午喝了一杯咖啡。');
    const candidate = candidateOf(proactive(projectId, now), 'ledger');
    for (let index = 0; index < 3; index += 1) {
      backend.recordSurfacingFeedback({
        projectId,
        candidateId: candidate.candidateId,
        outcome: 'ignored',
        now: now + index * HOUR,
      });
    }
    expect(count(proactive(projectId, now + 3 * HOUR), 'ledger')).toBe(0);

    backend.recordSurfacingFeedback({
      projectId,
      candidateId: candidate.candidateId,
      outcome: 'engaged',
      now: now + 3 * HOUR,
    });
    const state = kernel.surfacingFeedback.state({ projectId, now: now + 4 * HOUR });
    const ledger = state.types.find((entry) => entry.type === 'ledger')!;
    expect(ledger.consecutiveIgnored).toBe(0);
    expect(ledger.level).toBe(0);
    expect(ledger.cooldownUntil).toBeNull();
    expect(count(proactive(projectId, now + 4 * HOUR), 'ledger')).toBeGreaterThan(0);
  });
});

describe('a stop holds the type until the owner resumes it', () => {
  test('zero for thirty days without a resume, restored by an explicit resume', async () => {
    const projectId = 'feedback-stop';
    await seedProfile(projectId);
    writeTurn(projectId, '今天下午喝了一杯咖啡。');
    const candidate = candidateOf(proactive(projectId, now), 'profile');
    backend.recordSurfacingFeedback({ projectId, candidateId: candidate.candidateId, outcome: 'stopped', now });

    const stopped = proactive(projectId, now + DAY);
    expect(count(stopped, 'profile')).toBe(0);
    expect(count(stopped, 'ledger')).toBeGreaterThan(0);
    expect(kernel.surfacingFeedback.state({ projectId, now: now + DAY }).stoppedTypes).toEqual(['profile']);
    expect(count(proactive(projectId, now + 30 * DAY), 'profile')).toBe(0);

    backend.resumeSurfacingType({ projectId, type: 'profile', now: now + 31 * DAY });
    expect(count(proactive(projectId, now + 32 * DAY), 'profile')).toBeGreaterThan(0);
    expect(kernel.surfacingFeedback.state({ projectId, now: now + 32 * DAY }).stoppedTypes).toEqual([]);
    const resumeRow = kernel.surfacingFeedback.audit({ projectId })
      .find((entry) => entry.eventType === 'SURFACING_TYPE_RESUMED')!;
    expect(Object.keys(resumeRow)).toEqual(['eventId', 'eventType', 'type', 'sourceRefs', 'occurredAt']);
  });
});

describe('throttling is per type', () => {
  test('ignoring the ledger type leaves the profile type surfacing', async () => {
    const projectId = 'feedback-isolation';
    await seedProfile(projectId);
    writeTurn(projectId, '今天下午喝了一杯咖啡。');
    const candidate = candidateOf(proactive(projectId, now), 'ledger');
    for (let index = 0; index < 3; index += 1) {
      backend.recordSurfacingFeedback({
        projectId,
        candidateId: candidate.candidateId,
        outcome: 'ignored',
        now: now + index * HOUR,
      });
    }

    const result = proactive(projectId, now + 3 * HOUR);
    expect(count(result, 'ledger')).toBe(0);
    expect(count(result, 'profile')).toBeGreaterThan(0);
    expect(result.withheld.some((entry) => entry.source === 'profile')).toBe(false);
  });
});

describe('the state is readable and reconciles with the ledger', () => {
  test('counts, level, cooldown and stopped list read back from the same rows', () => {
    const projectId = 'feedback-state';
    writeTurn(projectId, '今天下午喝了一杯咖啡。');
    const candidate = candidateOf(proactive(projectId, now), 'ledger');
    for (let index = 0; index < 3; index += 1) {
      backend.recordSurfacingFeedback({
        projectId,
        candidateId: candidate.candidateId,
        outcome: 'ignored',
        now: now + index * HOUR,
      });
    }

    const state = kernel.surfacingFeedback.state({ projectId, now: now + 3 * HOUR });
    expect(Object.keys(state)).toEqual([...SURFACING_FEEDBACK_STATE_FIELDS]);
    expect(state.types.map((entry) => entry.type)).toEqual([...SURFACING_FEEDBACK_TYPES]);
    for (const entry of state.types) expect(Object.keys(entry)).toEqual([...SURFACING_FEEDBACK_TYPE_FIELDS]);

    const ledger = state.types.find((entry) => entry.type === 'ledger')!;
    expect(ledger.ignoredCount).toBe(3);
    expect(ledger.consecutiveIgnored).toBe(3);
    expect(ledger.level).toBe(1);
    expect(ledger.lastIgnoredAt).toBe(now + 2 * HOUR);
    expect(ledger.cooldownUntil).toBe(now + 2 * HOUR + SURFACING_FEEDBACK_RULES.baseCooldownMs);
    expect(ledger.stopped).toBe(false);
    expect(state.stoppedTypes).toEqual([]);
    expect(state.rules).toEqual(SURFACING_FEEDBACK_RULES);

    const audit = kernel.surfacingFeedback.audit({ projectId });
    expect(audit.map((entry) => entry.occurredAt)).toEqual([now, now + HOUR, now + 2 * HOUR]);
    expect(audit.every((entry) => entry.outcome === 'ignored' && entry.type === 'ledger')).toBe(true);
    expect(audit.length).toBe(ledger.ignoredCount);
  });
});

describe('the asked channel is not modulated', () => {
  test('a stopped type still answers a question', () => {
    const projectId = 'feedback-asked';
    writeTurn(projectId, '今天下午喝了一杯咖啡。');
    const candidate = candidateOf(proactive(projectId, now), 'ledger');
    backend.recordSurfacingFeedback({ projectId, candidateId: candidate.candidateId, outcome: 'stopped', now });

    const asked = backend.surfacingCandidates({ projectId, channel: 'asked', now: now + HOUR, query: '咖啡' });
    const found = asked.candidates.find((entry) => entry.source === 'ledger');
    expect(found).toBeDefined();
    expect(found?.decisionTrace.steps.find((step) => step.rule === 'modulation')?.outcome).toBe('not-applicable');
  });
});

describe('the frozen errors are thrown', () => {
  test('each refusal names itself', () => {
    expect(() => kernel.surfacingFeedback.record({ projectId: '', candidateId: 'surfacing:ledger:x', outcome: 'ignored' }))
      .toThrow('project_id_required');
    expect(() => kernel.surfacingFeedback.record({ projectId: 'p', candidateId: '', outcome: 'ignored' }))
      .toThrow('surfacing_candidate_id_required');
    expect(() => kernel.surfacingFeedback.record({ projectId: 'p', candidateId: 'surfacing:topic:x', outcome: 'ignored' }))
      .toThrow('invalid_surfacing_feedback_type');
    expect(() => kernel.surfacingFeedback.record({ projectId: 'p', candidateId: 'surfacing:ledger:', outcome: 'ignored' }))
      .toThrow('invalid_surfacing_feedback_type');
    expect(() => kernel.surfacingFeedback.record({ projectId: 'p', candidateId: 'surfacing:ledger:x', outcome: 'maybe' as never }))
      .toThrow('invalid_surfacing_feedback_outcome');
    expect(() => kernel.surfacingFeedback.record({ projectId: 'p', candidateId: 'surfacing:ledger:x', outcome: 'ignored', now: Number.NaN }))
      .toThrow('invalid_surfacing_feedback_now');
    expect(() => kernel.surfacingFeedback.record({ projectId: 'p', candidateId: 'surfacing:ledger:x', outcome: 'ignored', sourceRefs: 'nope' as never }))
      .toThrow('invalid_surfacing_feedback_source_refs');
    expect(() => kernel.surfacingFeedback.resume({ projectId: 'p', type: 'topic' as never }))
      .toThrow('invalid_surfacing_feedback_type');
    expect(() => kernel.surfacingFeedback.resume({ projectId: '', type: 'ledger' }))
      .toThrow('project_id_required');
  });
});
