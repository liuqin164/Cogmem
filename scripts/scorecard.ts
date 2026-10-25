/**
 * The recall scorecard (#51): cogmem's default path against two baselines, over a
 * scenario set that is generated here so the run is reproducible.
 *
 * What this is, stated plainly, because a benchmark that overstates itself is
 * worse than none:
 *
 * - **The data is synthetic and generated below**, from a fixed seed. It is not
 *   LongMemEval: that dataset is not vendored in this repository, so a run
 *   claiming it would be claiming something it did not do. `--items` and `--seed`
 *   are the subset, and both are printed with the results.
 * - **No model is called.** With no provider configured the kernel runs in
 *   `rule_only` mode, so cogmem's default path used no embedding model here. The
 *   vector baseline therefore embeds with a deterministic hashing vectorizer
 *   defined in this file. The two are not "the same embedder", and the table must
 *   not be read as though they were: this compares recall *paths* on text, not
 *   embedding quality.
 * - **`contextTokens` is an estimate** (`ceil(chars / 4)`), not a tokenizer count.
 * - **`provenance` is measured as "the returned context says where it came from"**:
 *   for cogmem, an item carrying a source or event anchor; for the baselines, the
 *   turn id they return with every turn. The baselines tie by construction on this
 *   one, and the table says so.
 * - **Latency covers the recall call only**, not ingestion, and is the p95 over
 *   the items.
 *
 * Usage: `bun run scorecard [--items 24] [--seed 20261025] [--json] [--markdown]`
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';

const TOPICS = [
  'deployment window', 'backup vault rotation', 'certificate renewal', 'index rebuild',
  'retention sweep', 'credential handover', 'schema audit', 'vendor review',
];
const TEAMS = ['atlas', 'beacon', 'cinder', 'delta', 'ember', 'flint', 'garnet', 'harbor'];
const DISTRACTOR_DAYS = [2, 4, 6, 11, 13, 15, 18, 20, 22, 25, 27, 28];

interface Scenario {
  projectId: string;
  query: string;
  turns: Array<{ turnId: string; content: string }>;
  answer: string;
  answerTurnId: string;
}

/** A small deterministic generator; `Math.random` would make runs incomparable. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function buildScenarios(items: number, seed: number): Scenario[] {
  const random = makeRandom(seed);
  const scenarios: Scenario[] = [];
  for (let index = 0; index < items; index += 1) {
    const topic = TOPICS[index % TOPICS.length]!;
    const team = TEAMS[(index * 3) % TEAMS.length]!;
    const answer = `SC-${index}-${Math.floor(random() * 0xffff).toString(16).padStart(4, '0')}`;
    const answerDay = 1 + (index % 28);
    const turns: Array<{ turnId: string; content: string }> = [];
    const answerPosition = Math.floor(random() * 8);
    let distractors = 0;
    for (let position = 0; position < 8; position += 1) {
      if (position === answerPosition) {
        turns.push({
          turnId: `${index}-${position}`,
          content: `The ${topic} for ${team} is scheduled on day ${answerDay}. Ticket ${answer}.`,
        });
        continue;
      }
      const day = DISTRACTOR_DAYS[(position * 5 + distractors) % DISTRACTOR_DAYS.length]!;
      const other = TEAMS[(position + 5) % TEAMS.length]!;
      turns.push({
        turnId: `${index}-${position}`,
        content: `The ${TOPICS[(index + position + 1) % TOPICS.length]!} for ${other} is scheduled on day ${day}. Ticket D-${index}-${position}.`,
      });
      distractors += 1;
    }
    scenarios.push({
      projectId: `scorecard-p${index}`,
      query: `When is the ${topic} for ${team} scheduled?`,
      turns,
      answer,
      answerTurnId: `${index}-${answerPosition}`,
    });
  }
  return scenarios;
}

/** A stated stand-in for an embedding model: hashed token counts, cosine rank. */
function vectorize(text: string, buckets = 512): Float64Array {
  const vector = new Float64Array(buckets);
  for (const token of text.toLowerCase().match(/[a-z0-9-]+/g) ?? []) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    vector[hash % buckets] += 1;
  }
  return vector;
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
    normA += a[index]! ** 2;
    normB += b[index]! ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface ContextItem { text: string; hasProvenance: boolean }

interface ArmResult {
  arm: string;
  recall: number;
  provenance: number;
  contextTokens: number;
  p95LatencyMs: number;
  misses: number[];
}

function score(arm: string, perItem: Array<{ context: ContextItem[]; latencyMs: number; hit: boolean }>, scenarioCount: number): ArmResult {
  const latencies = perItem.map((item) => item.latencyMs).sort((a, b) => a - b);
  const p95 = latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)]!;
  const allItems = perItem.flatMap((item) => item.context);
  const withProvenance = allItems.filter((item) => item.hasProvenance).length;
  const tokens = perItem.map((item) => Math.ceil(item.context.reduce((sum, entry) => sum + entry.text.length, 0) / 4));
  return {
    arm,
    recall: perItem.filter((item) => item.hit).length / scenarioCount,
    provenance: allItems.length === 0 ? 0 : withProvenance / allItems.length,
    contextTokens: tokens.reduce((sum, value) => sum + value, 0) / Math.max(1, tokens.length),
    p95LatencyMs: p95,
    misses: perItem.map((item, index) => (item.hit ? -1 : index)).filter((index) => index >= 0),
  };
}

export async function runScorecard(options: { items: number; seed: number }): Promise<{ results: ArmResult[]; scenarios: number }> {
  const scenarios = buildScenarios(options.items, options.seed);
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-scorecard-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db') });
  const startedAt = Date.now();

  const cogmem: Array<{ context: ContextItem[]; latencyMs: number; hit: boolean }> = [];
  const paths = new Map<string, number>();
  const recent: typeof cogmem = [];
  const vector: typeof cogmem = [];

  for (const [index, scenario] of scenarios.entries()) {
    for (const turn of scenario.turns) {
      await kernel.ingest({ content: turn.content, projectId: scenario.projectId, tags: [turn.turnId] });
    }

    // The arm under test: cogmem's own recall, measured on its own.
    const before = performance.now();
    const recalled = kernel.recall(scenario.query, { projectId: scenario.projectId, includeRawEvidence: true, now: startedAt });
    const latencyMs = performance.now() - before;
    // Provenance is measured as "the returned item says where it came from": a
    // stable identity plus the ledger link that makes it checkable. A raw neuron
    // carries `id`, `self_hash` and `prev_hash` — not `projectId`, which an earlier
    // version of this file wrongly read, reporting 0% for a path that was in fact
    // attributing every item. A metric that misreads the field is worse than no
    // metric, because it looks like a result.
    const recalledTexts = [
      ...recalled.compiledMemory.facts.map((fact) => ({
        text: String((fact as { statement?: string }).statement ?? JSON.stringify(fact)),
        hasProvenance: Boolean((fact as { factId?: string }).factId ?? (fact as { id?: string }).id),
      })),
      ...recalled.compiledMemory.events.map((event) => ({
        text: String((event as { summary?: string }).summary ?? JSON.stringify(event)),
        hasProvenance: Boolean((event as { eventId?: string }).eventId ?? (event as { id?: string }).id),
      })),
      ...recalled.rawEvidence.map((neuron) => ({
        text: neuron.content,
        hasProvenance: Boolean(neuron.id && neuron.self_hash),
      })),
      ...recalled.fallbackSnippets.map((snippet) => ({
        text: snippet.text ?? '',
        hasProvenance: Boolean(snippet.sourceId),
      })),
    ];
    cogmem.push({ context: recalledTexts, latencyMs, hit: recalledTexts.some((entry) => entry.text.includes(scenario.answer)) });
    paths.set(recalled.strategy.primaryLevel, (paths.get(recalled.strategy.primaryLevel) ?? 0) + 1);

    // Baseline 1: the last four turns, verbatim.
    {
      const window = scenario.turns.slice(-4);
      const context = window.map((turn) => ({ text: turn.content, hasProvenance: true }));
      recent.push({ context, latencyMs: 0, hit: context.some((entry) => entry.text.includes(scenario.answer)) });
    }

    // Baseline 2: vector top-k over the same turns, with the stated vectorizer.
    {
      const beforeVector = performance.now();
      const queryVector = vectorize(scenario.query);
      const ranked = scenario.turns
        .map((turn) => ({ turn, score: cosine(queryVector, vectorize(turn.content)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const vectorLatency = performance.now() - beforeVector;
      const context = ranked.map((entry) => ({ text: entry.turn.content, hasProvenance: true }));
      vector.push({ context, latencyMs: vectorLatency, hit: context.some((entry) => entry.text.includes(scenario.answer)) });
    }
    void index;
  }
  kernel.close();
  rmSync(dir, { recursive: true, force: true });

  console.error(`recall paths used: ${[...paths.entries()].map(([path, count]) => `${path}=${count}`).join(', ') || 'none'}`);
  return {
    scenarios: scenarios.length,
    results: [
      score('cogmem_default', cogmem, scenarios.length),
      score('fixed_recent_window_4', recent, scenarios.length),
      score('vector_topk_3_hashing', vector, scenarios.length),
    ],
  };
}

function formatRow(result: ArmResult): string {
  return `| ${result.arm} | ${(result.recall * 100).toFixed(1)}% | ${(result.provenance * 100).toFixed(1)}% | ${result.contextTokens.toFixed(0)} | ${result.p95LatencyMs.toFixed(1)} ms |`;
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const value = (flag: string, fallback: number): number => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? Number(argv[index + 1]) : fallback;
  };
  const items = value('--items', 24);
  const seed = value('--seed', 20261025);
  const { results, scenarios } = await runScorecard({ items, seed });

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ schemaVersion: 'cogmem.scorecard.v1', scenarios, items, seed, results }, null, 2));
    return;
  }
  console.log(`scenarios: ${scenarios} (synthetic, generated here) | seed: ${seed} | model: none (rule_only)`);
  console.log('');
  console.log('| arm | recall | provenance | context tokens/turn | p95 latency |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const result of results) console.log(formatRow(result));
  console.log('');
  for (const result of results) {
    if (result.misses.length > 0) console.log(`${result.arm}: missed ${result.misses.length} of ${scenarios} (items ${result.misses.slice(0, 8).join(', ')}${result.misses.length > 8 ? ', …' : ''})`);
  }
}

if (import.meta.main) await main();
