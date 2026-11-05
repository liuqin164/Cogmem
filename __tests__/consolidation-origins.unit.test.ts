import { expect, test } from 'bun:test';
import { OfflineConsolidationPipeline } from '../src/engine/OfflineConsolidationPipeline.js';
import type { FactRecord } from '../src/store/FactStore.js';

/**
 * #129's first two rules, observed rather than argued: a claim restated three times inside one turn is
 * one source and stays provisional, and the same claim from three turns is three sources and is verified.
 *
 * Every fact is listed in `lowConfidenceItems`, which is what pins the decision to the corroboration
 * question alone — the other reasons a fact may be verified (its own confidence, the semantic compiler)
 * are all bypassed there, so what the run does here is the origin rule and nothing else.
 */
function fact(over: Partial<FactRecord> & { factId: string; unitId: string }): FactRecord {
  return {
    neuronId: `neuron-${over.factId}`,
    subject: 'the team',
    predicateFamily: 'likes',
    object: 'pnpm',
    validFrom: 1000,
    certaintyLevel: 'probable',
    confidence: 0.6,
    status: 'provisional',
    sourceText: 'we like pnpm',
    ...over,
  } as FactRecord;
}

function input(facts: FactRecord[], units: string[]) {
  return {
    rawEpisodes: [],
    interactionUnits: units.map((unitId) => ({
      unitId, type: 'statement' as const, messageNeuronIds: [], semanticText: 'we like pnpm',
      status: 'resolved' as const, createdAt: 1, updatedAt: 1,
    })),
    provisionalFacts: facts,
    provisionalEvents: [],
    provisionalEntities: [],
    unresolvedReferences: [],
    lowConfidenceItems: facts.map((entry) => ({ source: 'compiler' as const, targetType: 'fact' as const, targetId: entry.factId, reason: 'test' })),
    recentBeliefs: [],
    // No `projectId`: with no factStore in this fixture the scope assertion would judge every fact
    // foreign (it resolves each fact's neuron against the database), and the scope of this test is the
    // corroboration rule, not project isolation — which has its own tests.
    window: { startTime: 0, endTime: 10_000 },
  };
}

async function run(facts: FactRecord[], units: string[]) {
  const pipeline = new OfflineConsolidationPipeline({} as never);
  const output = await pipeline.run(input(facts, units) as never);
  return output.verifiedFacts.map((entry) => entry.factId);
}

test('one origin restated three times does not consolidate', async () => {
  const verified = await run([
    fact({ factId: 'f1', unitId: 'turn-1' }),
    fact({ factId: 'f2', unitId: 'turn-1' }),
    fact({ factId: 'f3', unitId: 'turn-1' }),
  ], ['turn-1']);
  expect(verified).toEqual([]);
});

test('the same claim from three independent origins consolidates', async () => {
  const verified = await run([
    fact({ factId: 'f1', unitId: 'turn-1' }),
    fact({ factId: 'f2', unitId: 'turn-2' }),
    fact({ factId: 'f3', unitId: 'turn-3' }),
  ], ['turn-1', 'turn-2', 'turn-3']);
  expect(verified.length).toBeGreaterThan(0);
});

test('turns of one imported document count as one origin', async () => {
  const verified = await run([
    fact({ factId: 'f1', unitId: 'turn-1', metadata: { sourceDocumentId: 'notes.md' } }),
    fact({ factId: 'f2', unitId: 'turn-2', metadata: { sourceDocumentId: 'notes.md' } }),
    fact({ factId: 'f3', unitId: 'turn-3', metadata: { sourceDocumentId: 'notes.md' } }),
  ], ['turn-1', 'turn-2', 'turn-3']);
  expect(verified).toEqual([]);
});
