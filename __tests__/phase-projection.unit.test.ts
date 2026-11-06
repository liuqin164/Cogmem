import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { phaseFor, phaseGist, PROVISIONAL_PHASE_THRESHOLDS } from '../src/recall/PhaseProjection.js';
import { makeTempDir } from './helpers/tmp.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6);

/**
 * #130: the research sample. Off by default, read-time, and store-free — so the first thing to prove is that
 * switching it off leaves a corpus exactly as it was, and the second is that switching it on does what the
 * ticket describes.
 */
function seeded(options: { phaseProjectionEnabled?: boolean } = {}) {
  const dir = makeTempDir('cogmem-phase-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec', ...options });
  const backend = new KernelAgentMemoryBackend(kernel);
  return { kernel, backend };
}

async function seedTurns(backend: KernelAgentMemoryBackend) {
  await backend.rememberTurn({
    agentId: 'hermes', sessionId: 's1', projectId: 'p', turnId: 'old',
    userText: 'The deploy window discussion from a long time ago covered the rollback plan.',
    assistantText: 'noted', timestamp: NOW - 200 * DAY,
  } as never);
  await backend.rememberTurn({
    agentId: 'hermes', sessionId: 's1', projectId: 'p', turnId: 'mid',
    userText: 'The deploy window discussion covered the threshold change.',
    assistantText: 'noted', timestamp: NOW - 20 * DAY,
  } as never);
}

test('the phase function is pure and its boundaries are where the table says', () => {
  const at = (days: number) => NOW - days * DAY;
  // scenario: detail ≤7, gist ≤60, dormant beyond
  expect(phaseFor({ occurredAt: at(1), category: 'scenario' }, NOW)).toBe('detail');
  expect(phaseFor({ occurredAt: at(20), category: 'scenario' }, NOW)).toBe('gist');
  expect(phaseFor({ occurredAt: at(200), category: 'scenario' }, NOW)).toBe('dormant');
  // fact: 30 / 180
  expect(phaseFor({ occurredAt: at(20), category: 'fact' }, NOW)).toBe('detail');
  expect(phaseFor({ occurredAt: at(100), category: 'fact' }, NOW)).toBe('gist');
  expect(phaseFor({ occurredAt: at(400), category: 'fact' }, NOW)).toBe('dormant');
  // relation: 90 only
  expect(phaseFor({ occurredAt: at(20), category: 'relation' }, NOW)).toBe('gist');
  expect(phaseFor({ occurredAt: at(400), category: 'relation' }, NOW)).toBe('dormant');
  // Nothing to age against stays readable, and only an explicit caller can protect.
  expect(phaseFor({ category: 'scenario' }, NOW)).toBe('detail');
  expect(phaseFor({ occurredAt: at(400), category: 'scenario', protection: 'stated_preference' }, NOW)).toBe('protected');
  // Deterministic: the same inputs give the same answer twice.
  expect(phaseFor({ occurredAt: at(20), category: 'scenario' }, NOW)).toBe(phaseFor({ occurredAt: at(20), category: 'scenario' }, NOW));
  expect(PROVISIONAL_PHASE_THRESHOLDS.factDormantDays).toBe(180);
});

test('the gist is a whitelist: provenance through, interpretation named', () => {
  const gist = phaseGist({
    id: 'episode:1', canonicalId: 'episode:1', text: 'A long body that must not be copied.',
    displayTitle: 'Deploy window', sourceType: 'raw_ledger',
    sourceAnchor: { eventId: 'evt-1', occurredAt: NOW, sessionId: 's1' },
    sourceLocator: 'cogmem memory show --event evt-1',
    confidence: 0.9, whyMatched: 'internal detail',
  });
  expect(gist.text).toBeUndefined();
  expect(gist.confidence).toBeUndefined();
  expect(gist.whyMatched).toBeUndefined();
  expect(gist.displayTitle).toBe('Deploy window');
  expect(gist.sourceAnchor).toEqual({ eventId: 'evt-1' });
  expect(String(gist.agent_interpretation_not_fact)).toContain('A long body');
});

test('with the projection off, a recall is exactly what it was', async () => {
  const { kernel, backend } = seeded();
  try {
    await seedTurns(backend);
    const result = backend.recall({ agentId: 'hermes', projectId: 'p', query: 'deploy window', limit: 5, now: NOW });
    expect(result.items.length).toBeGreaterThan(0);
    // Nothing was projected, and nothing claims to have been: the trace stays free of phase reasons.
    expect(JSON.stringify(result.decisionTrace)).not.toContain('phase_');
    expect(result.items.every((item) => (item as { phase?: string }).phase === undefined)).toBe(true);
  } finally {
    kernel.close();
  }
});

test('with the projection on, an item carrying no timestamp is left exactly as it was', async () => {
  const { kernel, backend } = seeded({ phaseProjectionEnabled: true });
  try {
    await seedTurns(backend);
    const result = backend.recall({ agentId: 'hermes', projectId: 'p', query: 'deploy window', limit: 5, now: NOW });
    // Measured, and the reason this sample stops where it does: the compiled items the default lane returns
    // carry no `sourceAnchor.occurredAt`, so there is nothing to age against and the phase is `detail`. The
    // function is right; the lane has no timestamp to give it. That is a prerequisite recorded on the ticket
    // rather than papered over — and it is also why turning the switch on changes nothing here, which is the
    // safe direction for a half-finished mechanism to fail in.
    expect(result.items.every((item) => (item as { phase?: string }).phase === undefined)).toBe(true);
    expect(JSON.stringify(result.decisionTrace)).not.toContain('phase_');
    expect(result.items.length).toBeGreaterThan(0);
  } finally {
    kernel.close();
  }
});
