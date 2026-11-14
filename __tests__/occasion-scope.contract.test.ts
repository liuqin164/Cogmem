import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { explainRecallWithKernel } from '../src/recall/RecallExplanation.js';
import {
  CHANNEL_BINDING_FIELDS,
  OCCASION_CONTRACT_VERSION,
  OCCASION_ERROR_CODES,
  OCCASION_MATERIAL_KINDS,
  OCCASION_SCOPE_API_METHODS,
  OCCASION_STRICTEST,
  OCCASION_TRACE_OUTCOMES,
  OCCASION_WITHHOLD_REASONS,
  OCCASIONS,
  OccasionScope,
  occasionVisibility,
  type ChannelBinding,
  type Occasion,
  type OccasionMaterialKind,
} from '../src/occasion/index.js';
import type { SensitivityTier } from '../src/surfacing/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * F8 (#162): occasion scope, asserted against `docs/occasion-scope.md`.
 *
 * The discriminators are the ticket's: the same question in private / group / public returns
 * strictly decreasing sets on both faces; a group-bound connection that declares `private` does not
 * get private material and its trace names the mismatch; a group does not show another person's
 * private material while project-public material still appears; and an unbound connection answers
 * as `public`.
 */

const scratch = makeTempDir('cogmem-occasion-contract-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;

const projectId = 'occasion-contract';
const now = Date.UTC(2026, 10, 15, 12, 0, 0);
const agentId = 'cog';

let privateBinding: ChannelBinding;
let groupBinding: ChannelBinding;
let publicBinding: ChannelBinding;

let dailyPersonal: { eventId: string };
let privatePersonal: { eventId: string };
let highPersonal: { eventId: string };
let dailyOther: { eventId: string };
let privateOther: { eventId: string };
let projectPublic: { eventId: string };

let seq = 0;
function turn(
  content: string,
  options: { role?: 'user' | 'other'; metadata?: Record<string, unknown> } = {},
) {
  seq += 1;
  return kernel.recordRawEvent({
    threadId: `thread-${seq}`,
    sessionId: `session-${seq}`,
    projectId,
    role: options.role ?? 'user',
    content,
    occurredAt: now - 60_000,
    metadata: options.metadata,
  });
}

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
  privateBinding = kernel.occasionScope.register({ channelId: 'occasion-private', occasion: 'private' });
  groupBinding = kernel.occasionScope.register({ channelId: 'occasion-group', occasion: 'group' });
  publicBinding = kernel.occasionScope.register({ channelId: 'occasion-public', occasion: 'public' });

  // Every turn carries the cue, so one question recalls the whole corpus and the three occasions
  // differ only in what the filter admits.
  dailyPersonal = turn('今天下午喝了一杯咖啡。');
  // High tier, not a life mark: 密码 is F6's high marker and is deliberately outside F10's life
  // table, so this seed tests the occasion gate rather than the life gate. The earlier 工资 seed
  // hit the life-adjacent daily override and could not exercise the occasion tier.
  privatePersonal = turn('咖啡店的保险箱密码换了。');
  highPersonal = turn('医生说咖啡因让我的高血压加重了。');
  dailyOther = turn('小明说他喜欢喝咖啡。', { role: 'other' });
  privateOther = turn('小明说咖啡店的保险箱密码换了。', { role: 'other' });
  projectPublic = turn('项目公开：小明的咖啡店周五开业。', { metadata: { imported: true } });
});

afterAll(() => {
  kernel.close();
});

function backendWith(binding?: ChannelBinding): KernelAgentMemoryBackend {
  return new KernelAgentMemoryBackend(kernel, binding ? { binding } : {});
}

function recallEventIds(backend: KernelAgentMemoryBackend, query: string): string[] {
  const result = backend.recall({ agentId, projectId, query, limit: 50 });
  return result.items
    .map((item) => item.sourceAnchor?.eventId ?? item.source)
    .filter((id): id is string => Boolean(id));
}

function surfacedEventIds(backend: KernelAgentMemoryBackend, query: string): string[] {
  const result = backend.surfacingCandidates({ projectId, channel: 'asked', query, now, limit: 50 });
  return result.candidates
    .flatMap((candidate) => candidate.sourceRefs.map((ref) => ref.eventId))
    .filter((id): id is string => Boolean(id));
}

const seeded = () => new Set([
  dailyPersonal.eventId,
  privatePersonal.eventId,
  highPersonal.eventId,
  dailyOther.eventId,
  privateOther.eventId,
  projectPublic.eventId,
]);

function onlySeeded(ids: string[]): Set<string> {
  const known = seeded();
  return new Set(ids.filter((id) => known.has(id)));
}

describe('the contract document and the frozen lists agree', () => {
  const markdown = readFileSync(fileURLToPath(new URL('../docs/occasion-scope.md', import.meta.url)), 'utf8');

  function sectionAfter(heading: string): string {
    return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
  }

  function firstColumn(section: string): string[] {
    return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]!);
  }

  function tableRows(section: string): Array<{ first: string; cells: string[] }> {
    return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/gmu)].map((match) => ({
      first: match[1]!,
      cells: match[2]!.split('|').map((cell) => cell.trim().replace(/`/g, '')),
    }));
  }

  test('the occasion table is exactly OCCASIONS, in order', () => {
    expect(firstColumn(sectionAfter('## Occasions (frozen)'))).toEqual([...OCCASIONS]);
    expect(OCCASION_STRICTEST).toBe('public');
    expect(OCCASION_CONTRACT_VERSION).toBe(1);
  });

  test('the binding-field and material-kind tables are their frozen lists', () => {
    expect(firstColumn(sectionAfter('### Binding fields (frozen)'))).toEqual([...CHANNEL_BINDING_FIELDS]);
    expect(firstColumn(sectionAfter('## Material kinds (frozen)'))).toEqual([...OCCASION_MATERIAL_KINDS]);
  });

  test('the visibility table is exactly what occasionVisibility returns', () => {
    const combinations: Array<[OccasionMaterialKind, SensitivityTier]> = [
      ['personal', 'daily'], ['personal', 'private'], ['personal', 'high'],
      ['third-party', 'daily'], ['third-party', 'private'], ['third-party', 'high'],
      ['project-public', 'daily'],
    ];
    const rows = tableRows(sectionAfter('## Visibility (frozen)'));
    expect(rows.map((row) => row.first)).toEqual([...OCCASIONS]);
    for (const row of rows) {
      const expected = combinations.map(([kind, tier]) =>
        occasionVisibility(row.first as Occasion, tier, { kind }).allowed ? 'allowed' : 'withheld');
      expect(row.cells).toEqual(expected);
    }
  });

  test('the error and API tables are their frozen lists', () => {
    expect(firstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...OCCASION_ERROR_CODES]);
    expect(firstColumn(sectionAfter('## API (frozen)'))).toEqual([...OCCASION_SCOPE_API_METHODS]);
  });

  test('the withhold-reason and trace-outcome tables are their frozen lists', () => {
    expect(firstColumn(sectionAfter('### Withhold reasons (frozen)'))).toEqual([...OCCASION_WITHHOLD_REASONS]);
    expect(firstColumn(sectionAfter('### Decision trace (frozen)'))).toEqual([...OCCASION_TRACE_OUTCOMES]);
  });
});

describe('the same question decreases strictly across private, group and public', () => {
  test('recall sets are private ⊃ group ⊃ public, and F10 still withholds in private', () => {
    const privateResult = backendWith(privateBinding).recall({ agentId, projectId, query: '咖啡', limit: 50 });
    const privateIds = onlySeeded(privateResult.items
      .map((item) => item.sourceAnchor?.eventId ?? item.source)
      .filter((id): id is string => Boolean(id)));
    const groupIds = onlySeeded(recallEventIds(backendWith(groupBinding), '咖啡'));
    const publicIds = onlySeeded(recallEventIds(backendWith(publicBinding), '咖啡'));

    // The private occasion admits every occasion cell, but F10's default-lane withhold is a
    // separate gate: the life-marked high turn is still absent. See the Composition section.
    expect(privateIds.size).toBe(5);
    expect(privateIds.has(highPersonal.eventId)).toBe(false);
    expect(privateResult.decisionTrace?.suppressed).toContainEqual({ reason: 'life_sensitivity_withheld', count: 1 });
    expect(groupIds.size).toBe(3);
    expect(publicIds.size).toBe(2);
    for (const id of groupIds) expect(privateIds.has(id)).toBe(true);
    for (const id of publicIds) expect(groupIds.has(id)).toBe(true);
  });

  test('surfacing sets are private ⊃ group ⊃ public, and asked may show life in private', () => {
    const privateIds = onlySeeded(surfacedEventIds(backendWith(privateBinding), '咖啡'));
    const groupIds = onlySeeded(surfacedEventIds(backendWith(groupBinding), '咖啡'));
    const publicIds = onlySeeded(surfacedEventIds(backendWith(publicBinding), '咖啡'));

    // Unlike the default recall lane, the asked surfacing channel is an explicit opening: F10's
    // channel policy allows private/high when asked, so the private set is the full corpus.
    expect(privateIds.size).toBe(6);
    expect(groupIds.size).toBe(3);
    expect(publicIds.size).toBe(2);
    for (const id of groupIds) expect(privateIds.has(id)).toBe(true);
    for (const id of publicIds) expect(groupIds.has(id)).toBe(true);
  });

  test('a group-bound connection that declares private is not believed, and the trace says so', () => {
    const group = backendWith(groupBinding);
    const result = group.surfacingCandidates({
      projectId,
      channel: 'asked',
      query: '咖啡',
      occasion: 'private',
      now,
      limit: 50,
    });

    expect(result.occasion).toBe('group');
    expect(result.candidates.some((candidate) => candidate.content.includes('密码'))).toBe(false);
    expect(result.candidates.some((candidate) => candidate.content.includes('高血压'))).toBe(false);

    const withheld = result.withheld.find((entry) => entry.candidateId.endsWith(privatePersonal.eventId))!;
    const step = withheld.decisionTrace.steps.find((entry) => entry.rule === 'occasion')!;
    expect(step.outcome).toBe('mismatch');
    expect(step.detail).toMatchObject({
      occasion: 'group',
      declared: 'private',
      mismatch: true,
      decision: 'withheld',
      reason: 'occasion_private_tier',
    });

    const recalled = recallEventIds(group, '咖啡');
    expect(recalled).not.toContain(privatePersonal.eventId);
    expect(recalled).not.toContain(highPersonal.eventId);
  });

  test('a binding object the registry did not issue is unbound and answers as public', () => {
    const forged = { channelId: groupBinding.channelId, occasion: 'private' } as ChannelBinding;
    const backend = backendWith(forged);
    const recalled = backend.recall({ agentId, projectId, query: '咖啡', limit: 50 });

    expect(recalled.decisionTrace?.occasion).toBe('public');
    expect(recalled.decisionTrace?.occasionBinding).toBe('unbound');
    const ids = recalled.items.map((item) => item.sourceAnchor?.eventId ?? item.source).filter(Boolean);
    expect(ids).not.toContain(privatePersonal.eventId);
    expect(ids).not.toContain(highPersonal.eventId);
  });
});

describe('group withholds another person’s private material, not project-public material', () => {
  test('a third party’s private turn is absent while daily and imported material remain', () => {
    const group = backendWith(groupBinding);
    const recalled = group.recall({ agentId, projectId, query: '小明', limit: 50 });
    const text = recalled.items.map((item) => item.text).join('\n');

    expect(text).not.toContain('密码');
    expect(text).toContain('喜欢喝咖啡');
    expect(text).toContain('周五开业');
    expect(recalled.decisionTrace?.suppressed).toContainEqual({ reason: 'occasion_private_tier', count: 1 });

    const surfaced = group.surfacingCandidates({ projectId, channel: 'asked', query: '小明', now, limit: 50 });
    expect(surfaced.candidates.some((candidate) => candidate.content.includes('密码'))).toBe(false);
    expect(surfaced.candidates.some((candidate) => candidate.content.includes('周五开业'))).toBe(true);
  });

  test('public shows project-public material but no third-party material', () => {
    const publicBackend = backendWith(publicBinding);
    const recalled = publicBackend.recall({ agentId, projectId, query: '小明', limit: 50 });
    const text = recalled.items.map((item) => item.text).join('\n');

    expect(text).not.toContain('喜欢喝咖啡');
    expect(text).toContain('周五开业');
    expect(recalled.decisionTrace?.suppressed).toContainEqual({ reason: 'occasion_third_party', count: 1 });
  });
});

describe('the pack slots apply the same gate as the direct answer', () => {
  test('a private belief touch is withheld in group and kept in private', () => {
    const belief = kernel.beliefStore.upsert({
      projectId,
      scope: 'project',
      subject: '咖啡',
      predicate: 'note',
      objectValue: { raw: '保险箱密码换了', normalized: '保险箱密码换了', type: 'string' },
      confidence: 0.9,
      sourceEventId: privatePersonal.eventId,
      sourceType: 'user_input',
      validityKind: 'open',
      validFrom: 1,
    }).belief!;

    const groupPack = backendWith(groupBinding).recallPack({ agentId, projectId, query: '咖啡', limit: 50 });
    expect(groupPack.slots.beliefTouches.some((touch) => touch.beliefId === belief.id)).toBe(false);
    // Two non-life high turns plus the belief touch are withheld by occasion; the life-marked high
    // turn is withheld by F10 and names its own gate.
    expect(groupPack.decisionTrace?.suppressed).toContainEqual({ reason: 'occasion_private_tier', count: 3 });
    expect(groupPack.decisionTrace?.suppressed).toContainEqual({ reason: 'life_sensitivity_withheld', count: 1 });

    const privatePack = backendWith(privateBinding).recallPack({ agentId, projectId, query: '咖啡', limit: 50 });
    expect(privatePack.slots.beliefTouches.some((touch) => touch.beliefId === belief.id)).toBe(true);
  });
});

describe('explain obeys the connection binding', () => {
  test('group evidence, context windows and withheld entries carry no private text', () => {
    for (const scopedAgent of [agentId, undefined]) {
      const explained = explainRecallWithKernel(kernel, {
        query: '咖啡',
        projectId,
        ...(scopedAgent ? { agentId: scopedAgent } : {}),
        binding: groupBinding,
        limit: 50,
      });

      expect(explained.evidence.map((entry) => entry.text).join('\n')).not.toContain('密码');
      expect(JSON.stringify(explained.evidence.map((entry) => entry.sourceAnchor?.context))).not.toContain('密码');
      expect(JSON.stringify(explained.evidence.map((entry) => entry.sourceAnchor?.context))).not.toContain('高血压');
      expect(JSON.stringify(explained.filteredEvidence)).not.toContain('密码');
    }
  });

  test('the no-agent branch drops a high-sensitivity neuron in group and names the reason', async () => {
    const explainScratch = makeTempDir('cogmem-occasion-explain-');
    const other = createMemoryKernel({ dbPath: join(explainScratch, 'memory.db'), projectTimeZone: 'UTC' });
    try {
      const neuron = await other.ingest({ projectId, content: 'The vault password changed this month.' });
      const group = other.occasionScope.register({ channelId: 'explain-group', occasion: 'group' });
      const privateScopeBinding = other.occasionScope.register({ channelId: 'explain-private', occasion: 'private' });

      const groupExplained = explainRecallWithKernel(other, { query: 'password', projectId, binding: group, limit: 50 });
      expect(groupExplained.evidence.map((entry) => entry.text)).not.toContain(neuron.content);
      const withheld = groupExplained.filteredEvidence?.find((entry) => entry.id === neuron.id);
      expect(withheld?.reason).toBe('occasion_private_tier');
      expect(withheld?.text).toBeUndefined();

      const privateExplained = explainRecallWithKernel(other, {
        query: 'password', projectId, binding: privateScopeBinding, limit: 50,
      });
      expect(privateExplained.evidence.map((entry) => entry.text)).toContain(neuron.content);
    } finally {
      other.close();
    }
  });
});

describe('an unbound connection is the strictest occasion', () => {
  test('no binding means public, and private/high material is absent from both faces', () => {
    const unbound = backendWith();
    const recalled = unbound.recall({ agentId, projectId, query: '咖啡', limit: 50 });
    const text = recalled.items.map((item) => item.text).join('\n');

    expect(recalled.decisionTrace?.occasion).toBe('public');
    expect(recalled.decisionTrace?.occasionBinding).toBe('unbound');
    expect(text).not.toContain('密码');
    expect(text).not.toContain('高血压');

    const surfaced = unbound.surfacingCandidates({ projectId, channel: 'asked', query: '咖啡', now, limit: 50 });
    expect(surfaced.occasion).toBe('public');
    expect(surfaced.candidates.every((candidate) => candidate.sensitivity === 'daily')).toBe(true);
  });

  test('a recall whose every match was withheld explains itself as occasion_filtered', () => {
    const group = backendWith(groupBinding);
    const recalled = group.recall({ agentId, projectId, query: '密码', limit: 50 });
    expect(recalled.items).toHaveLength(0);
    expect(recalled.decisionTrace?.zeroExplanation).toEqual({ kind: 'occasion_filtered', count: 2 });
    expect(recalled.decisionTrace?.suppressed).toContainEqual({ reason: 'occasion_private_tier', count: 2 });
  });
});

describe('the registry issues and revokes bindings', () => {
  test('an empty channel or an unknown occasion is refused', () => {
    const scope = new OccasionScope();
    expect(() => scope.register({ channelId: ' ', occasion: 'private' })).toThrow('invalid_channel_binding');
    expect(() => scope.register({ channelId: 'x', occasion: 'nope' as never })).toThrow('invalid_channel_binding');
  });

  test('re-registering a channel replaces the occasion an old binding resolves to', () => {
    const scope = new OccasionScope();
    const first = scope.register({ channelId: 'telegram', occasion: 'private' });
    expect(scope.resolve(first)).toMatchObject({ occasion: 'private', bound: true });
    scope.register({ channelId: 'telegram', occasion: 'group' });
    expect(scope.resolve(first)).toMatchObject({ occasion: 'group', bound: true });
  });
});
