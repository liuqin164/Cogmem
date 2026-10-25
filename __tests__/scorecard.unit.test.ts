import { expect, test } from 'bun:test';

import { buildScenarios } from '../scripts/scorecard.js';

/**
 * #51 asks for a run one command reproduces. That only holds if the scenario set
 * is a function of the seed and nothing else — `Math.random` or a clock read in
 * the generator would make two runs of the same command incomparable, and the
 * published table would describe a dataset nobody can regenerate.
 */
test('the scorecard scenario set is a function of the seed alone', () => {
  const first = buildScenarios(6, 20261025);
  const again = buildScenarios(6, 20261025);
  const different = buildScenarios(6, 20261026);

  expect(again).toEqual(first);
  expect(different).not.toEqual(first);
  expect(first).toHaveLength(6);
  // Every scenario has to be answerable from its own turns, or a recall miss
  // would say more about the fixture than about the path being measured.
  for (const scenario of first) {
    const answerTurns = scenario.turns.filter((turn) => turn.content.includes(scenario.answer));
    expect(answerTurns).toHaveLength(1);
    expect(answerTurns[0]!.turnId).toBe(scenario.answerTurnId);
    expect(scenario.turns).toHaveLength(8);
  }
});

/**
 * #72's acceptance is measured by `bun run scorecard --items 24 --seed 20261025`
 * (4.2% leakage, 91.7% current truth), which takes ~39 s and therefore is not in
 * this suite. What is asserted here is the property that number depends on, at
 * the cost of one ingest: an unmarked supersession must not survive recall.
 *
 * `__tests__/supersession-regression.unit.test.ts` covers the two ways it broke
 * before — the untagged speaker and the truncation order — so a regression fails
 * a test rather than only moving a number in `BENCHMARKS.md`.
 */
test('#72 the default recall path drops a superseded statement it was never told about', async () => {
  const { createMemoryKernel } = await import('../src/factory.js');
  const { makeTempDir } = await import('./helpers/tmp.js');
  const dir = makeTempDir('cogmem-scorecard-gate-');
  const kernel = createMemoryKernel({ dbPath: `${dir}/memory.db` });

  await kernel.ingest({
    content: 'The certificate renewal for harbor was scheduled on day 4. Ticket OLD-GATE.',
    projectId: 'gate',
  });
  await kernel.ingest({
    content: 'Correction: the certificate renewal for harbor is now scheduled on day 5. Ticket NEW-GATE.',
    projectId: 'gate',
  });

  const recalled = kernel.recall('When is the certificate renewal for harbor now scheduled?', {
    projectId: 'gate',
    includeRawEvidence: true,
  });
  const text = recalled.rawEvidence.map((neuron) => neuron.content).join('\n');
  expect(text).toContain('NEW-GATE');
  expect(text).not.toContain('OLD-GATE');

  kernel.close();
});
