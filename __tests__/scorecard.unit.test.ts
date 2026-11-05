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

test('the scorecard entry point runs, so a rename inside it cannot go unnoticed', async () => {
  // The script lives outside tsconfig's `include`, so a method rename in src/
  // broke it silently until someone ran the command by hand (#72 review). This
  // exercises the real entry point on a tiny corpus.
  const { runScorecard } = await import('../scripts/scorecard.js');
  const result = await runScorecard({ items: 2, seed: 1 });
  const arms = [...result.recall, ...result.currentTruth, ...result.hostPath, ...result.hostPathMarked, ...result.crossHost];
  expect(arms.map((arm) => arm.arm)).toContain('evidence_layer');
  expect(result.hostPath.some((arm) => arm.arm === 'agent_backend_context_plan')).toBe(true);
}, 180_000);

test('#72: the cross-host property holds (agent scope, with the speaker key as defence in depth)', async () => {
  const { measureCrossHostScope } = await import('../scripts/scorecard.js');
  const measured = await measureCrossHostScope({ items: 24, seed: 20261025 });
  expect(measured.found).toBeGreaterThanOrEqual(0.875);
  expect(measured.stale).toBeLessThanOrEqual(0.1);
}, 180_000);
