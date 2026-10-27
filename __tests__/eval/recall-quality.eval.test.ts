/**
 * A floor under recall quality, measured against real questions.
 *
 * Every other recall test asks "does something come back" or "is the wrong thing
 * excluded". Neither notices the failure that matters most to a person: a confident
 * answer that is about something else. That is not caught by inspecting a single
 * query either, because each query in isolation looks plausible — it only shows up
 * when two different questions return the same memories.
 *
 * So this measures the whole thing: the corpus is the project's own issue history,
 * the questions are how a person would ask about it, and the score is how often the
 * named record is among the results. It is a floor, not a target — it fails when
 * recall gets worse than it is today, and it does not object to getting better.
 */
import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernel } from '../../src/public.js';
import { KernelAgentMemoryBackend } from '../../src/agent/AgentMemoryBackend.js';
import { makeTempDir } from '../helpers/tmp.js';
import { EVAL_CASES } from './cases.js';

/**
 * Measured on the commit that introduced this floor: 4 of 18 — four answered
 * questions out of sixteen, and neither unanswerable case abstaining.
 *
 * The two unanswerable cases are expected to fail today: recall reports
 * `compiled_cue_match` for a question whose words appear nowhere in the corpus.
 * They are kept in the set because the number would otherwise be flattering, and
 * the miss list is where a known defect belongs.
 */
const BASELINE_PASSES = 4;

// A frozen copy, not the live ledger.
//
// The corpus was the ledger itself, so recording a round changed the thing being
// measured: five new sections moved the score from 6 to 4 with no code change at
// all. An instrument that moves when the experimenter writes down results cannot
// compare two rounds. This copy stops changing the moment it is committed.
const corpusPath = join(import.meta.dir, 'corpus.md');

interface IssueRecord { number: number; title: string; body: string | null }

/**
 * The corpus is a frozen snapshot of the round ledger: every round's decisions, in
 * the words they were recorded in, at the moment the floor was set. It is
 * committed, so the floor is reproducible on a fresh clone.
 */
function loadCorpus(): IssueRecord[] {
  if (!existsSync(corpusPath)) return [];
  const text = readFileSync(corpusPath, 'utf8');
  const records: IssueRecord[] = [];
  // Each heading and its body become one memory, which is how a round was recorded.
  const sections = text.split(/\n(?=###\s)/u);
  for (const [index, section] of sections.entries()) {
    const heading = section.split('\n')[0]?.replace(/^#+\s*/u, '').trim() ?? '';
    if (heading.length < 4) continue;
    const issueMatch = heading.match(/#(\d+)/u);
    records.push({
      number: issueMatch ? Number(issueMatch[1]) : index,
      title: heading,
      body: section,
    });
  }
  return records;
}

test('recall finds the record that answers a real question', async () => {
  const corpus = loadCorpus();
  // Assert rather than skip: a renamed or reformatted ledger would otherwise turn
  // the only recall-quality measurement in the repo into a silent no-op that
  // reports nothing and passes.
  expect(corpus.length).toBeGreaterThan(10);

  const kernel = createMemoryKernel({ dbPath: join(makeTempDir('cogmem-eval-'), 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  // Pin every clock. Built from `Date.now()` and asked with the live one, the same
  // code and the same corpus scored 5 one hour and 4 the next, because recall reads
  // "now" for recency and period cues and the corpus ages with it. A floor that
  // drifts with the wall clock measures the wall clock.
  const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
  const DAY = 86_400_000;
  const started = NOW - corpus.length * DAY;
  for (const [index, record] of corpus.entries()) {
    await backend.rememberTurnWithResult({
      agentId: 'eval',
      projectId: 'cogmem',
      sessionId: `round-${record.number}-${index}`,
      userText: `${record.title}\n\n${record.body ?? ''}`,
      assistantText: `第 ${index} 条记录`,
      timestamp: started + index * DAY,
    });
  }

  let passed = 0;
  const missed: string[] = [];
  const ranks: string[] = [];
  for (const evalCase of EVAL_CASES) {
    const result = backend.recall({
      query: evalCase.question,
      projectId: 'cogmem',
      agentId: 'eval',
      limit: 5,
      now: NOW,
    });
    const items = result.items ?? [];
    const text = JSON.stringify(items);

    if (evalCase.unanswerable) {
      // Nothing in the corpus is about this, so no lane can honestly claim the
      // query's words were found. Asserting the lane name would not say that: the
      // previous version passed these two cases because the lane happened to be
      // "compiled" rather than "raw_ledger", while the trace still reported
      // `compiled_cue_match` and the caller was handed five unrelated records with
      // no way to tell they were a fallback. The claim is what must not be made.
      const reason = result.decisionTrace?.reason ?? '';
      const claimsMatch = reason.includes('cue_match');
      if (!claimsMatch) passed += 1;
      else missed.push(`${evalCase.question} (claimed "${reason}" for a question nothing answers)`);
      continue;
    }

    if (text.includes(evalCase.expectsSection)) {
      passed += 1;
      // Where it landed says whether it was answered or merely present: an answer
      // at rank 5 is inside the noise a caller has to read past.
      const rank = items.findIndex((item) => JSON.stringify(item).includes(evalCase.expectsSection)) + 1;
      ranks.push(`#${rank} ${evalCase.question}`);
    } else {
      missed.push(`${evalCase.question} (wanted "${evalCase.expectsSection}", lane ${result.decisionTrace?.selectedLane})`);
    }
  }

  kernel.close();

  // Report the misses in the failure message: a number alone does not say what to fix.
  console.log(`[eval] recall quality: ${passed}/${EVAL_CASES.length} (floor ${BASELINE_PASSES})`);
  console.log(`[eval] answer ranks: ${ranks.map((line) => line.split(' ')[0]).join(' ')}`);
  if (missed.length) console.log(`[eval] missed:\n${missed.map((line) => `  - ${line}`).join(String.fromCharCode(10))}`);

  if (passed < BASELINE_PASSES) {
    throw new Error(
      `recall answered ${passed}/${EVAL_CASES.length}, below the floor of ${BASELINE_PASSES}.\n`
      + missed.map((line) => `  - ${line}`).join('\n'),
    );
  }
  expect(passed).toBeGreaterThanOrEqual(BASELINE_PASSES);
}, 120_000);
