import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  LIFE_SENSITIVITY_CATEGORIES,
  LIFE_SENSITIVITY_PATTERNS,
  countLifeSensitivityFindings,
  eventHoldsLifeSensitivityMark,
} from '../src/security/LifeSensitivity.js';
import type { ChannelBinding } from '../src/occasion/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F10 life-sensitivity contract (#164): health / finance / identity / family marks are written
 * where the ledger is appended, withheld from the default recall lane, reachable through the
 * forensic intent, and correctable with immediate effect. The document's frozen tables are read back
 * and compared with the code, the way the F1–F6 contracts do.
 */

const scratch = makeTempDir('cogmem-life-sensitivity-');
let kernel: MemoryKernel;
let backend: KernelAgentMemoryBackend;
let privateBinding: ChannelBinding;
let privateBackend: KernelAgentMemoryBackend;
let seq = 0;
const now = Date.UTC(2026, 10, 15, 12, 0, 0);

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath: join(scratch, 'memory.db'), projectTimeZone: 'UTC' });
  backend = new KernelAgentMemoryBackend(kernel);
  // The positive samples grade F10's tier, not F8's occasion. A private binding lets F6's channel
  // policy be the only gate on `asked`; the unbound backend is kept for the public-withhold half.
  privateBinding = kernel.occasionScope.register({ channelId: 'life-private', occasion: 'private' });
  privateBackend = new KernelAgentMemoryBackend(kernel, { binding: privateBinding });
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/life-sensitivity.md', import.meta.url)), 'utf8');

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

/** The first cell of every plain table row, with the header and separator skipped. */
function plainRows(section: string): string[] {
  return [...section.matchAll(/^\|\s*([^|]+?)\s*\|/gmu)]
    .map((match) => match[1]!.trim())
    .filter((cell) => cell && cell !== 'Text' && !/^-+$/.test(cell));
}

function writeTurn(projectId: string, content: string, role: 'user' | 'assistant' = 'user') {
  seq += 1;
  return kernel.recordRawEvent({
    threadId: `life-thread-${projectId}-${seq}`,
    sessionId: `life-session-${projectId}-${seq}`,
    projectId,
    role,
    content,
    occurredAt: now - 60_000,
  });
}

describe('the contract document and the frozen tables agree', () => {
  test('the category table is exactly LIFE_SENSITIVITY_CATEGORIES', () => {
    expect(firstColumn(sectionAfter('## Categories (frozen)'))).toEqual([...LIFE_SENSITIVITY_CATEGORIES]);
  });

  test('the pattern table names every kind with its category and tier', () => {
    const rows = tableRows(sectionAfter('## Pattern table (frozen)'));
    expect(rows.length).toBe(LIFE_SENSITIVITY_PATTERNS.length);
    for (const [index, pattern] of LIFE_SENSITIVITY_PATTERNS.entries()) {
      const row = rows[index]!;
      expect(row.first).toBe(pattern.kind);
      expect(row.cells).toEqual([pattern.category, pattern.tier]);
    }
  });
});

describe('write marks and surfacing', () => {
  const positives = tableRows(sectionAfter('### Positive samples'));

  test('every positive sample is marked, withheld from proactive, and graded its documented tier', () => {
    expect(positives.length).toBeGreaterThanOrEqual(8);
    const projectId = 'life-positive';
    for (const sample of positives) {
      const event = writeTurn(projectId, sample.first);
      expect(countLifeSensitivityFindings(sample.first).total).toBeGreaterThan(0);
      expect(eventHoldsLifeSensitivityMark(kernel.eventStore.getEvent(event.eventId)!)).toBe(true);

      const proactive = privateBackend.surfacingCandidates({ projectId, channel: 'proactive', now });
      const withheld = proactive.withheld.find((entry) => entry.candidateId.endsWith(event.eventId));
      expect(withheld?.sensitivity).toBe(sample.cells[0]);
      expect(proactive.candidates.some((candidate) => candidate.candidateId.endsWith(event.eventId))).toBe(false);

      const asked = privateBackend.surfacingCandidates({ projectId, channel: 'asked', now, query: '' });
      expect(asked.candidates.find((candidate) => candidate.candidateId.endsWith(event.eventId))?.sensitivity).toBe(sample.cells[0]);

      // F8 intersection: the same asked query on an unbound (public) connection is withheld.
      const publicAsked = backend.surfacingCandidates({ projectId, channel: 'asked', now, query: '' });
      expect(publicAsked.candidates.some((candidate) => candidate.candidateId.endsWith(event.eventId))).toBe(false);
      expect(publicAsked.withheld.find((entry) => entry.candidateId.endsWith(event.eventId))?.sensitivity).toBe(sample.cells[0]);
    }
  });

  test('life-marked turns are withheld from the default recall lane and reachable by forensic intent', () => {
    const projectId = 'life-recall';
    const secret = writeTurn(projectId, '诊断结果需要保密：zephyrmark。');
    const ordinary = writeTurn(projectId, '今天下午喝了一杯咖啡。');

    const normal = privateBackend.recall({ query: 'zephyrmark', projectId, agentId: 'a' });
    expect(normal.items.some((item) => item.text.includes('诊断结果需要保密'))).toBe(false);
    expect(normal.decisionTrace?.suppressed).toContainEqual({ reason: 'life_sensitivity_withheld', count: 1 });

    const forensic = privateBackend.recall({ query: 'zephyrmark', projectId, agentId: 'a', intent: 'forensic_quote' });
    expect(forensic.items.some((item) => item.text.includes('诊断结果需要保密'))).toBe(true);

    // F8 intersection: forensic opens F10's gate but not F8's occasion gate.
    const publicForensic = backend.recall({ query: 'zephyrmark', projectId, agentId: 'a', intent: 'forensic_quote' });
    expect(publicForensic.items.some((item) => item.text.includes('诊断结果需要保密'))).toBe(false);
    expect(publicForensic.decisionTrace?.suppressed).toContainEqual({ reason: 'occasion_private_tier', count: 1 });

    const ordinaryResult = backend.recall({ query: '咖啡', projectId, agentId: 'a' });
    expect(ordinaryResult.items.some((item) => item.id === ordinary.eventId || item.text.includes('咖啡'))).toBe(true);
    expect(secret.eventId).not.toBe(ordinary.eventId);
  });
});

describe('adjacent terms are not findings', () => {
  const negatives = plainRows(sectionAfter('### Negative samples'));

  test('every negative sample grades daily and is not withheld', () => {
    expect(negatives.length).toBeGreaterThanOrEqual(8);
    const projectId = 'life-negative';
    for (const sample of negatives) {
      const event = writeTurn(projectId, sample);
      expect(countLifeSensitivityFindings(sample).total).toBe(0);

      const proactive = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
      const candidate = proactive.candidates.find((entry) => entry.candidateId.endsWith(event.eventId));
      expect(candidate?.sensitivity).toBe('daily');
      expect(proactive.withheld.some((entry) => entry.candidateId.endsWith(event.eventId))).toBe(false);
    }
  });
});

describe('corrections take effect immediately in both directions', () => {
  test('daily releases a false positive and high adds a missed one', () => {
    const projectId = 'life-correction';
    const falsePositive = writeTurn(projectId, '医生给我开了处方，诊断是高血压。');

    const before = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(before.withheld.some((entry) => entry.candidateId.endsWith(falsePositive.eventId))).toBe(true);
    expect(backend.recall({ query: '处方', projectId, agentId: 'a' }).items.some((item) => item.text.includes('处方'))).toBe(false);

    kernel.correctLifeSensitivity(falsePositive.eventId, 'daily');
    const after = backend.surfacingCandidates({ projectId, channel: 'proactive', now, query: '处方' });
    expect(after.candidates.find((entry) => entry.candidateId.endsWith(falsePositive.eventId))?.sensitivity).toBe('daily');
    expect(backend.recall({ query: '处方', projectId, agentId: 'a' }).items.some((item) => item.text.includes('处方'))).toBe(true);

    const missed = writeTurn(projectId, '今天下午喝了一杯咖啡。');
    kernel.correctLifeSensitivity(missed.eventId, 'high');
    const reverse = backend.surfacingCandidates({ projectId, channel: 'proactive', now, query: '咖啡' });
    expect(reverse.withheld.find((entry) => entry.candidateId.endsWith(missed.eventId))?.sensitivity).toBe('high');

    kernel.correctLifeSensitivity(falsePositive.eventId, null);
    const restored = backend.surfacingCandidates({ projectId, channel: 'proactive', now });
    expect(restored.withheld.some((entry) => entry.candidateId.endsWith(falsePositive.eventId))).toBe(true);
  });
});
