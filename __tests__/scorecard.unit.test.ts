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


test('#72 gate: the user-facing path leaks an untagged stale value in under 10% of cases', async () => {
  // The bars the maintainer set for closing #72, asserted here so a regression
  // fails the suite instead of moving a number in a report (#72, §4.110).
  const { measureHostPathSupersession } = await import('../scripts/scorecard.js');
  const measured = await measureHostPathSupersession({ items: 24, seed: 20261025 });
  expect(measured.scenarios).toBe(24);
  expect({ found: measured.found >= 0.875 }).toEqual({ found: true });
  expect({ leaked: measured.stale <= 0.1 }).toEqual({ leaked: true });
}, 180_000);
