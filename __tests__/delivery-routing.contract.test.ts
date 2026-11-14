import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DELIVERY_API_METHODS,
  DELIVERY_BATCH_FIELDS,
  DELIVERY_CONTRACT_VERSION,
  DELIVERY_DECISIONS,
  DELIVERY_DECISION_FIELDS,
  DELIVERY_DECISION_VERSION,
  DELIVERY_DESTINATIONS,
  DELIVERY_ERROR_CODES,
  DELIVERY_INPUT_FIELDS,
  DELIVERY_REASONS,
  DELIVERY_STEP_FIELDS,
  DELIVERY_TRACE_FIELDS,
  DELIVERY_URGENCY_DOWNGRADE,
  DELIVERY_URGENCY_TIERS,
  DELIVERY_URGENT_SOURCES,
  DELIVERY_USER_STATES,
  DeliveryRouter,
  deriveDeliveryUrgency,
  downgradeDeliveryUrgency,
  routeDelivery,
  routeDeliveryBatch,
  type DeliveryCandidateInput,
} from '../src/delivery/index.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * F18 (#195): delivery routing, asserted against `docs/delivery-routing.md`.
 *
 * The discriminators are the ticket's: one candidate routes differently by user state; a high
 * candidate never reaches a group/public surface; the night window accumulates every non-highest
 * urgency into the morning summary; every decision carries a trace whose reason agrees with it.
 */

const markdown = readFileSync(
  fileURLToPath(new URL('../docs/delivery-routing.md', import.meta.url)),
  'utf8',
);

function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

function firstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]!);
}

function tableRows(section: string): Array<{ first: string; cells: string[] }> {
  return [...section.matchAll(/^\|\s*([^|]+?)\s*\|(.*)\|\s*$/gmu)]
    .filter((match) => !/^-+$/.test(match[1]!.trim()))
    .map((match) => ({
      first: match[1]!.trim().replace(/`/g, ''),
      cells: match[2]!.split('|').map((cell) => cell.trim().replace(/`/g, '')),
    }));
}

const now = Date.UTC(2026, 10, 15, 12, 0, 0);

function candidate(overrides: Partial<DeliveryCandidateInput> = {}): DeliveryCandidateInput {
  return {
    candidateId: 'surfacing:prospective-memory:p1',
    source: 'prospective-memory',
    sensitivity: 'daily',
    freshness: { observedAt: now - 1_000, ageMs: 1_000, expiresAt: now + 86_400_000, expired: false },
    confidence: 0.8,
    ...overrides,
  };
}

const channel = { reachability: 'online' as const, interruptibility: 'normal' as const };

describe('the contract document and the frozen lists agree', () => {
  test('the version table pins the contract and decision versions', () => {
    expect(firstColumn(sectionAfter('## Version (frozen)'))).toEqual(['contractVersion', 'decisionVersion']);
    expect(DELIVERY_CONTRACT_VERSION).toBe(1);
    expect(DELIVERY_DECISION_VERSION).toBe('delivery_route_decision.v1');
  });

  test('the input, urgency, state, decision and destination tables are their frozen lists', () => {
    expect(firstColumn(sectionAfter('## Inputs (frozen)'))).toEqual([...DELIVERY_INPUT_FIELDS]);
    expect(firstColumn(sectionAfter('## Urgency (frozen)'))).toEqual([...DELIVERY_URGENCY_TIERS]);
    expect(firstColumn(sectionAfter('## User states (frozen)'))).toEqual([...DELIVERY_USER_STATES]);
    expect(firstColumn(sectionAfter('## Decisions (frozen)'))).toEqual([...DELIVERY_DECISIONS]);
    expect(firstColumn(sectionAfter('## Destinations (frozen)'))).toEqual([...DELIVERY_DESTINATIONS]);
  });

  test('the rules table names only frozen reasons, decisions and destinations', () => {
    const rows = tableRows(sectionAfter('## Rules (frozen)')).filter((row) => row.first !== 'Order');
    expect(rows).toHaveLength(12);
    const reasons = new Set<string>();
    for (const row of rows) {
      const [condition, decision, destination, reason] = row.cells;
      expect(condition).toBeTruthy();
      expect([...DELIVERY_DECISIONS]).toContain(decision!);
      expect([...DELIVERY_DESTINATIONS]).toContain(destination!);
      expect([...DELIVERY_REASONS]).toContain(reason!);
      reasons.add(reason!);
    }
    expect([...reasons].sort()).toEqual([...DELIVERY_REASONS].sort());
    expect([...DELIVERY_URGENT_SOURCES]).toEqual(['wake-intention', 'prospective-memory', 'commitment']);
  });

  test('the downgrade table is exactly the frozen function', () => {
    const rows = tableRows(sectionAfter('## Feedback downgrade (frozen)')).filter((row) => row.first !== 'Level');
    expect(rows.map((row) => Number(row.first))).toEqual([0, 1, 2, 3]);
    for (const row of rows) {
      const level = Number(row.first);
      for (const urgency of DELIVERY_URGENCY_TIERS) {
        const index = DELIVERY_URGENCY_TIERS.indexOf(urgency);
        expect(row.cells[index]).toBe(DELIVERY_URGENCY_DOWNGRADE[level]![urgency]);
        expect(downgradeDeliveryUrgency(urgency, level)).toBe(DELIVERY_URGENCY_DOWNGRADE[level]![urgency]);
      }
    }
  });

  test('the trace, decision, batch, error and API tables are their frozen lists', () => {
    expect(firstColumn(sectionAfter('## Decision trace (frozen)'))).toEqual([...DELIVERY_TRACE_FIELDS]);
    expect(firstColumn(sectionAfter('### Step fields (frozen)'))).toEqual([...DELIVERY_STEP_FIELDS]);
    expect(firstColumn(sectionAfter('### Decision fields (frozen)'))).toEqual([...DELIVERY_DECISION_FIELDS]);
    expect(firstColumn(sectionAfter('### Batch result fields (frozen)'))).toEqual([...DELIVERY_BATCH_FIELDS]);
    expect(firstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...DELIVERY_ERROR_CODES]);
    expect(firstColumn(sectionAfter('## API (frozen)'))).toEqual([...DELIVERY_API_METHODS]);
  });
});

describe('urgency is derived from F6 signals, not invented', () => {
  test('due, upcoming, expired and confidence all move the grade', () => {
    expect(deriveDeliveryUrgency(candidate())).toBe('high');
    expect(deriveDeliveryUrgency(candidate({ freshness: { ...candidate().freshness, ageMs: -1_000 } }))).toBe('normal');
    expect(deriveDeliveryUrgency(candidate({ freshness: { ...candidate().freshness, expired: true } }))).toBe('normal');
    expect(deriveDeliveryUrgency(candidate({ source: 'profile', confidence: 0.9 }))).toBe('normal');
    expect(deriveDeliveryUrgency(candidate({ source: 'ledger', confidence: 0.5 }))).toBe('low');
  });

  test('F7 levels downgrade the grade and bottom out at low', () => {
    expect(downgradeDeliveryUrgency('high', 1)).toBe('normal');
    expect(downgradeDeliveryUrgency('normal', 1)).toBe('low');
    expect(downgradeDeliveryUrgency('high', 2)).toBe('low');
    expect(downgradeDeliveryUrgency('high', 3)).toBe('low');
  });
});

describe('the same candidate routes differently by user state', () => {
  test('in-conversation mentions, idle accumulates, night-dnd accumulates to morning', () => {
    const normal = candidate({ source: 'profile', confidence: 0.9, candidateId: 'surfacing:profile:p1' });
    const inConversation = routeDelivery({ candidate: normal, occasion: 'private', userState: 'in-conversation', channel });
    const idle = routeDelivery({ candidate: normal, occasion: 'private', userState: 'idle', channel });
    const night = routeDelivery({ candidate: normal, occasion: 'private', userState: 'night-dnd', channel });

    expect(inConversation.decision).toBe('deliver');
    expect(inConversation.strength).toBe('incidental');
    expect(inConversation.destination).toBe('current-channel');

    expect(idle.decision).toBe('accumulate');
    expect(idle.destination).toBe('next-contact');

    expect(night.decision).toBe('accumulate');
    expect(night.destination).toBe('morning-summary');
    expect(night.strength).toBe('incidental');
  });

  test('the highest urgency still passes the night window, but not an uninterruptible channel', () => {
    const urgent = candidate();
    expect(routeDelivery({ candidate: urgent, occasion: 'private', userState: 'night-dnd', channel }).decision).toBe('deliver');
    expect(routeDelivery({
      candidate: urgent,
      occasion: 'private',
      userState: 'night-dnd',
      channel: { reachability: 'online', interruptibility: 'low' },
    }).destination).toBe('morning-summary');
  });
});

describe('a high candidate never reaches a shared surface', () => {
  test('group and public suppress in every user state', () => {
    const high = candidate({ sensitivity: 'high' });
    for (const occasion of ['group', 'public'] as const) {
      for (const userState of DELIVERY_USER_STATES) {
        const decision = routeDelivery({
          candidate: high,
          occasion,
          userState,
          channel: { reachability: 'online', interruptibility: 'high' },
        });
        expect(decision.decision).toBe('suppress');
        expect(decision.strength).toBe('silence');
        expect(decision.reasonCode).toBe('high_sensitivity_shared_surface');
      }
    }
  });

  test('private still allows the same candidate', () => {
    const decision = routeDelivery({ candidate: candidate({ sensitivity: 'high' }), occasion: 'private', userState: 'in-conversation', channel });
    expect(decision.decision).toBe('deliver');
  });
});

describe('the night window accumulates every non-highest candidate into the morning summary', () => {
  test('the summary and the accumulated set agree item by item', () => {
    const normal = candidate({ source: 'profile', confidence: 0.9, candidateId: 'surfacing:profile:p1' });
    const low = candidate({ source: 'ledger', confidence: 0.5, candidateId: 'surfacing:ledger:l1' });
    const high = candidate({ candidateId: 'surfacing:prospective-memory:p1' });
    const result = routeDeliveryBatch({
      candidates: [normal, low, high],
      occasion: 'private',
      userState: 'night-dnd',
      channel,
    });
    expect(result.decisions).toHaveLength(3);
    expect(result.accumulated).toEqual(['surfacing:profile:p1', 'surfacing:ledger:l1']);
    expect(result.morningSummary).toEqual(['surfacing:profile:p1', 'surfacing:ledger:l1']);
    expect(result.morningSummary).toEqual(result.accumulated);
    expect(result.decisions.find((entry) => entry.candidateId === 'surfacing:prospective-memory:p1')?.decision).toBe('deliver');
  });
});

describe('every decision carries a trace that agrees with it', () => {
  test('the route step and the reason code match the decision', () => {
    const cases = [
      routeDelivery({ candidate: candidate(), occasion: 'private', userState: 'in-conversation', channel }),
      routeDelivery({ candidate: candidate(), occasion: 'group', userState: 'in-conversation', channel }),
      routeDelivery({ candidate: candidate(), occasion: 'private', userState: 'idle', channel }),
      routeDelivery({ candidate: candidate(), occasion: 'private', userState: 'night-dnd', channel }),
      routeDelivery({ candidate: candidate(), occasion: 'private', userState: 'in-conversation', channel, feedback: { level: 0, stopped: true } }),
    ];
    for (const decision of cases) {
      expect(decision.reason).toBe(decision.decisionTrace.reason);
      expect(decision.decisionTrace.version).toBe('delivery_route_decision.v1');
      expect(decision.decisionTrace.steps.map((step) => step.rule)).toEqual([
        'sensitivity', 'feedback', 'reachability', 'user_state', 'route',
      ]);
      const routeStep = decision.decisionTrace.steps.find((step) => step.rule === 'route')!;
      expect(routeStep.outcome).toBe(decision.decision);
      expect(routeStep.detail.decision).toBe(decision.decision);
      expect(routeStep.detail.destination).toBe(decision.destination);
      expect(routeStep.detail.strength).toBe(decision.strength);
      expect(routeStep.detail.reason).toBe(decision.reasonCode);
      expect([...DELIVERY_REASONS]).toContain(decision.reasonCode);
    }
  });

  test('removing any one input signal changes at least one decision', () => {
    const base = { candidate: candidate({ source: 'profile', confidence: 0.9 }), occasion: 'private' as const, userState: 'in-conversation' as const, channel };
    const baseline = routeDelivery(base);
    expect(baseline.decision).toBe('deliver');

    expect(routeDelivery({ ...base, candidate: { ...base.candidate, sensitivity: 'high' }, occasion: 'group' }).decision).toBe('suppress');
    expect(routeDelivery({ ...base, channel: { ...channel, reachability: 'offline' } }).decision).toBe('accumulate');
    expect(routeDelivery({ ...base, userState: 'idle' }).decision).toBe('accumulate');
    expect(routeDelivery({ ...base, channel: { ...channel, interruptibility: 'low' } }).decision).toBe('accumulate');
    expect(routeDelivery({ ...base, feedback: { level: 0, stopped: true } }).decision).toBe('suppress');
    expect(routeDelivery({ ...base, feedback: { level: 1, stopped: false } }).decision).toBe('accumulate');

    const due = candidate();
    const upcoming = candidate({ freshness: { ...due.freshness, ageMs: -1_000 } });
    expect(routeDelivery({ candidate: due, occasion: 'private', userState: 'night-dnd', channel }).decision).toBe('deliver');
    expect(routeDelivery({ candidate: upcoming, occasion: 'private', userState: 'night-dnd', channel }).decision).toBe('accumulate');
  });
});

describe('invalid inputs name their error', () => {
  test('candidate, state, occasion, channel and feedback are validated', () => {
    const base = { candidate: candidate(), occasion: 'private' as const, userState: 'idle' as const, channel };
    expect(() => routeDelivery({ ...base, candidate: { ...base.candidate, candidateId: '' } })).toThrow('invalid_delivery_candidate');
    expect(() => routeDelivery({ ...base, candidate: { ...base.candidate, source: 'nowhere' as never } })).toThrow('invalid_delivery_candidate');
    expect(() => routeDelivery({ ...base, userState: 'sleeping' as never })).toThrow('invalid_delivery_user_state');
    expect(() => routeDelivery({ ...base, occasion: 'shared' as never })).toThrow('invalid_delivery_occasion');
    expect(() => routeDelivery({ ...base, channel: { ...channel, reachability: 'maybe' as never } })).toThrow('invalid_delivery_channel');
    expect(() => routeDelivery({ ...base, feedback: { level: -1, stopped: false } })).toThrow('invalid_delivery_feedback');
  });
});

describe('F7 feedback is read from the kernel, not invented', () => {
  const scratch = makeTempDir('cogmem-delivery-contract-');
  const dbPath = join(scratch, 'memory.db');
  const projectId = 'delivery-contract';
  let kernel: MemoryKernel;

  beforeAll(() => {
    kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
  });

  afterAll(() => {
    kernel.close();
  });

  test('three ignores downgrade a normal category until it accumulates', () => {
    const profile = candidate({ source: 'profile', confidence: 0.9, candidateId: 'surfacing:profile:p1' });
    const query = {
      projectId,
      candidate: profile,
      occasion: 'private' as const,
      userState: 'in-conversation' as const,
      channel,
      now,
    };
    expect(kernel.deliveryRouter.route(query).decision).toBe('deliver');

    for (let index = 0; index < 3; index += 1) {
      kernel.surfacingFeedback.record({
        projectId,
        candidateId: 'surfacing:profile:p1',
        outcome: 'ignored',
        now,
      });
    }
    const downgraded = kernel.deliveryRouter.route(query);
    expect(downgraded.urgency).toBe('normal');
    expect(downgraded.effectiveUrgency).toBe('low');
    expect(downgraded.decision).toBe('accumulate');
    expect(downgraded.reasonCode).toBe('not_urgent');
  });

  test('the pure router and the kernel face agree when feedback is passed explicitly', () => {
    const profile = candidate({ source: 'profile', confidence: 0.9 });
    const explicit = routeDelivery({
      candidate: profile,
      occasion: 'private',
      userState: 'in-conversation',
      channel,
      feedback: { level: 1, stopped: false },
    });
    const viaClass = new DeliveryRouter().route({
      projectId,
      candidate: profile,
      occasion: 'private',
      userState: 'in-conversation',
      channel,
      feedback: { level: 1, stopped: false },
      now,
    });
    expect(viaClass).toEqual(explicit);
  });
});
