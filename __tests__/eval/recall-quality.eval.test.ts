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

/** Measured on the commit that introduced this floor: 5 of 18, of which 2 are the unanswerable cases. Lower means a regression. */
const BASELINE_PASSES = 5;

const corpusPath = join(import.meta.dir, '..', '..', 'docs', 'engineering', '4.0-issue-loop.md');

interface IssueRecord { number: number; title: string; body: string | null }

/**
 * The corpus is the ledger: every round's decisions, in the words they were
 * recorded in. It is committed, so the floor is reproducible on a fresh clone.
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
  // Without the ledger there is nothing to measure; skip rather than report a
  // confident zero, which would look like a recall failure that never happened.
  if (corpus.length < 10) return;

  const kernel = createMemoryKernel({ dbPath: join(makeTempDir('cogmem-eval-'), 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  const DAY = 86_400_000;
  const started = Date.now() - corpus.length * DAY;
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
    const result = backend.recall({ query: evalCase.question, projectId: 'cogmem', agentId: 'eval', limit: 5 });
    const items = result.items ?? [];
    const text = JSON.stringify(items);

    if (evalCase.unanswerable) {
      // The honest outcome is that the ledger lane did not claim a match.
      const claimed = result.decisionTrace?.selectedLane === 'raw_ledger';
      if (!claimed) passed += 1;
      else missed.push(`${evalCase.question} (answered an unanswerable question)`);
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
