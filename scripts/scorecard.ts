/**
 * The recall scorecard (#51): cogmem's default path against two baselines, over two
 * scenario families generated here so the run is reproducible.
 *
 * The first family is lexical — the query shares its topic and team words with the
 * turn holding the answer — which is exactly the case a keyword or vector ranker is
 * built for, so it measures the fallback floor. The second family is the case the
 * structure exists for: a fact that was **superseded**. Two turns state when the same
 * thing happens; only the later one is current. A recent window or a vector ranker
 * that returns both has leaked a stale value into the context, and no amount of
 * lexical cleverness prevents that — suppression does.
 *
 * What this is, stated plainly, because a benchmark that overstates itself is worse
 * than none:
 *
 * - **The data is synthetic and generated below**, from a fixed seed. It is not
 *   LongMemEval: that dataset is not vendored in this repository, so a run claiming
 *   it would be claiming something it did not do.
 * - **No model is called.** With no provider configured the kernel runs in
 *   `rule_only` mode, so the default path used no embedding model here. The vector
 *   baseline embeds with a deterministic hashing vectorizer defined in this file.
 *   The two are not "the same embedder": this compares recall *paths* over text.
 * - **`contextTokens` is an estimate** (`ceil(chars / 4)`), not a tokenizer count.
 * - **`provenance`** is "the returned context says where it came from": for cogmem an
 *   item carrying a source identity and its ledger link; for the baselines the turn
 *   id they return with every turn, so they tie by construction.
 * - **Latency covers the recall call only**, never ingestion, and is the p95.
 *
 * Usage: `bun run scorecard [--items 24] [--seed 20261025] [--json]`
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { contextCandidateFromRecallItem } from '../src/host/RecallBlock.js';

const TOPICS = [
  'deployment window', 'backup vault rotation', 'certificate renewal', 'index rebuild',
  'retention sweep', 'credential handover', 'schema audit', 'vendor review',
];
const TEAMS = ['atlas', 'beacon', 'cinder', 'delta', 'ember', 'flint', 'garnet', 'harbor'];
const DISTRACTOR_DAYS = [2, 4, 6, 11, 13, 15, 18, 20, 22, 25, 27, 28];

interface Scenario {
  projectId: string;
  query: string;
  turns: Array<{ turnId: string; content: string; tags?: string[] }>;
  answer: string;
  answerTurnId: string;
  /** A value that was true earlier and is not true now, when the family has one. */
  superseded?: string;
}

/** A small deterministic generator; `Math.random` would make runs incomparable. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function token(prefix: string, index: number, random: () => number): string {
  return `${prefix}-${index}-${Math.floor(random() * 0xffff).toString(16).padStart(4, '0')}`;
}

/** Family A: one target fact among distractor turns, queried with its own words. */
export function buildScenarios(items: number, seed: number): Scenario[] {
  const random = makeRandom(seed);
  const scenarios: Scenario[] = [];
  for (let index = 0; index < items; index += 1) {
    const topic = TOPICS[index % TOPICS.length]!;
    const team = TEAMS[(index * 3) % TEAMS.length]!;
    const answer = token('SC', index, random);
    const answerDay = 1 + (index % 28);
    const turns: Array<{ turnId: string; content: string; tags?: string[] }> = [];
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

/**
 * Family B: the same fact stated twice, the first statement superseded.
 *
 * The query names the topic and team, which both the current and the stale turn
 * mention — so the baselines rank them by recency or by word overlap alone, and the
 * only thing that can keep the stale value out of the context is suppression.
 */
export function buildSupersessionScenarios(items: number, seed: number, options: { markStale?: boolean } = {}): Scenario[] {
  // Each family gets its own projects: two families that ingest the same content into
  // the same project leave two neurons per turn, and a recall that finds the untagged
  // one reports leakage that the marked neuron would have been suppressed for. That is
  // a measurement artifact, and it looked exactly like a product defect.
  const prefix = options.markStale ? 'scorecard-m' : 'scorecard-s';
  const random = makeRandom(seed + 977);
  const scenarios: Scenario[] = [];
  for (let index = 0; index < items; index += 1) {
    const topic = TOPICS[(index + 3) % TOPICS.length]!;
    const team = TEAMS[(index * 5) % TEAMS.length]!;
    const stale = token('OLD', index, random);
    const current = token('NEW', index, random);
    const staleDay = 1 + (index % 27);
    const currentDay = 2 + (index % 26);
    const stalePosition = Math.floor(random() * 3);
    const currentPosition = 3 + Math.floor(random() * 5);
    const turns: Array<{ turnId: string; content: string }> = [];
    for (let position = 0; position < 8; position += 1) {
      if (position === stalePosition) {
        turns.push({
          turnId: `${index}-${position}`,
          content: `The ${topic} for ${team} was scheduled on day ${staleDay}. Ticket ${stale}.`,
          // `status:superseded` is the marker the host recall block honours when it
          // decides what reaches the model. Nothing in `src/` writes it — it comes
          // from curation or review — so a run that marks nothing is measuring a
          // system that was never told, and the two cases have to be measured apart.
          ...(options.markStale ? { tags: ['status:superseded'] } : {}),
        });
        continue;
      }
      if (position === currentPosition) {
        turns.push({
          turnId: `${index}-${position}`,
          content: `Correction: the ${topic} for ${team} is now scheduled on day ${currentDay}. Ticket ${current}.`,
        });
        continue;
      }
      turns.push({
        turnId: `${index}-${position}`,
        content: `The ${TOPICS[(index + position + 2) % TOPICS.length]!} for ${TEAMS[(position + 1) % TEAMS.length]!} is scheduled on day ${DISTRACTOR_DAYS[(index + position) % DISTRACTOR_DAYS.length]!}. Ticket D-${index}-${position}.`,
      });
    }
    scenarios.push({
      projectId: `${prefix}${index}`,
      query: `When is the ${topic} for ${team} now scheduled?`,
      turns,
      answer: current,
      answerTurnId: `${index}-${currentPosition}`,
      superseded: stale,
    });
  }
  return scenarios;
}

/** A stated stand-in for an embedding model: hashed token counts, cosine rank. */
function vectorize(text: string, buckets = 512): Float64Array {
  const vector = new Float64Array(buckets);
  for (const value of text.toLowerCase().match(/[a-z0-9-]+/g) ?? []) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
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

interface PerItem { context: ContextItem[]; latencyMs: number; hit: boolean; stale: boolean }

export interface ArmResult {
  arm: string;
  recall: number;
  staleLeakage: number;
  provenance: number;
  contextTokens: number;
  p95LatencyMs: number;
  misses: number[];
  staleItems: number[];
}

function score(arm: string, perItem: PerItem[], scenarioCount: number): ArmResult {
  const latencies = perItem.map((item) => item.latencyMs).sort((a, b) => a - b);
  const p95 = latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)]!;
  const allItems = perItem.flatMap((item) => item.context);
  const withProvenance = allItems.filter((item) => item.hasProvenance).length;
  const tokens = perItem.map((item) => Math.ceil(item.context.reduce((sum, entry) => sum + entry.text.length, 0) / 4));
  return {
    arm,
    recall: perItem.filter((item) => item.hit).length / scenarioCount,
    staleLeakage: perItem.filter((item) => item.stale).length / scenarioCount,
    provenance: allItems.length === 0 ? 0 : withProvenance / allItems.length,
    contextTokens: tokens.reduce((sum, value) => sum + value, 0) / Math.max(1, tokens.length),
    p95LatencyMs: p95,
    misses: perItem.map((item, index) => (item.hit ? -1 : index)).filter((index) => index >= 0),
    staleItems: perItem.map((item, index) => (item.stale ? index : -1)).filter((index) => index >= 0),
  };
}

async function runFamily(kernel: ReturnType<typeof createMemoryKernel>, scenarios: Scenario[], now: number): Promise<ArmResult[]> {
  const cogmem: PerItem[] = [];
  const recent: PerItem[] = [];
  const vector: PerItem[] = [];
  const paths = new Map<string, number>();

  for (const scenario of scenarios) {
    for (const turn of scenario.turns) {
      await kernel.ingest({ content: turn.content, projectId: scenario.projectId, tags: [turn.turnId, ...(turn.tags ?? [])] });
    }

    // The arm under test: cogmem's own recall, measured on its own.
    const before = performance.now();
    const recalled = kernel.recall(scenario.query, { projectId: scenario.projectId, includeRawEvidence: true, now });
    const latencyMs = performance.now() - before;
    paths.set(recalled.strategy.primaryLevel, (paths.get(recalled.strategy.primaryLevel) ?? 0) + 1);
    // Provenance is "the returned item says where it came from": a stable identity
    // plus the ledger link. A raw neuron carries `id`, `self_hash` and `prev_hash` —
    // not `projectId`, which an earlier version of this file wrongly read and
    // reported as 0% for a path that attributed every item.
    const recalledTexts: ContextItem[] = [
      ...recalled.compiledMemory.facts.map((fact) => ({
        text: String((fact as { statement?: string }).statement ?? JSON.stringify(fact)),
        hasProvenance: Boolean((fact as { factId?: string }).factId ?? (fact as { id?: string }).id),
      })),
      ...recalled.compiledMemory.events.map((event) => ({
        text: String((event as { summary?: string }).summary ?? JSON.stringify(event)),
        hasProvenance: Boolean((event as { eventId?: string }).eventId ?? (event as { id?: string }).id),
      })),
      ...recalled.rawEvidence.map((neuron) => ({ text: neuron.content, hasProvenance: Boolean(neuron.id && neuron.self_hash) })),
      ...recalled.fallbackSnippets.map((snippet) => ({ text: snippet.text ?? '', hasProvenance: Boolean(snippet.sourceId) })),
    ];
    cogmem.push(measure(recalledTexts, latencyMs, scenario));

    {
      const context = scenario.turns.slice(-4).map((turn) => ({ text: turn.content, hasProvenance: true }));
      recent.push(measure(context, 0, scenario));
    }

    {
      const beforeVector = performance.now();
      const queryVector = vectorize(scenario.query);
      const context = scenario.turns
        .map((turn) => ({ turn, score: cosine(queryVector, vectorize(turn.content)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((entry) => ({ text: entry.turn.content, hasProvenance: true }));
      vector.push(measure(context, performance.now() - beforeVector, scenario));
    }
  }

  console.error(`recall paths used: ${[...paths.entries()].map(([path, count]) => `${path}=${count}`).join(', ') || 'none'}`);
  const count = scenarios.length;
  return [
    score('evidence_layer', cogmem, count),
    score('fixed_recent_window_4', recent, count),
    score('vector_topk_3_hashing', vector, count),
  ];
}

function measure(context: ContextItem[], latencyMs: number, scenario: Scenario): PerItem {
  const text = context.map((entry) => entry.text).join('\n');
  return {
    context,
    latencyMs,
    hit: text.includes(scenario.answer),
    stale: scenario.superseded !== undefined && text.includes(scenario.superseded),
  };
}

/**
 * Family C: the path a host actually takes, which is not `kernel.recall`.
 *
 * The agent backend returns recall items, `contextCandidateFromRecallItem` turns them
 * into context candidates, and `ContextCortex.plan` decides what reaches the model —
 * including `hardSuppressionReason`, which is where `status:superseded` is honoured
 * (`src/context/ContextCortex.ts`). Measuring `kernel.recall` alone describes the
 * evidence list, not the prompt, and those are different artifacts.
 */
/**
 * Family D: two hosts, one project, two different values for the same topic.
 *
 * Host A's statement must not be superseded by host B's — they are different
 * reporters, not a correction. The stale slot is B's value, so a leak means A's
 * answer was displaced by another host's.
 */
export function buildCrossHostScenarios(items: number, seed: number): Scenario[] {
  const random = makeRandom(seed + 313);
  const scenarios: Scenario[] = [];
  for (let index = 0; index < items; index += 1) {
    const topic = TOPICS[(index + 5) % TOPICS.length]!;
    const team = TEAMS[(index * 3) % TEAMS.length]!;
    const own = token('OWN', index, random);
    const other = token('OTHER', index, random);
    scenarios.push({
      projectId: `scorecard-x-${index}`,
      query: `What is the ${topic} for ${team} according to host-a?`,
      answer: own,
      superseded: other,
      turns: [
        { turnId: `${index}-a`, content: `host-a reports the ${topic} for ${team} on day ${1 + (index % 20)}. Ticket ${own}.`, hostId: 'host-a' },
        { turnId: `${index}-b`, content: `host-b reports the ${topic} for ${team} on day ${2 + (index % 20)}. Ticket ${other}.`, hostId: 'host-b' },
        { turnId: `${index}-d`, content: `The ${TOPICS[(index + 2) % TOPICS.length]!} for ${TEAMS[(index + 1) % TEAMS.length]!} is scheduled on day ${DISTRACTOR_DAYS[index % DISTRACTOR_DAYS.length]!}. Ticket D-${index}.` },
      ],
    });
  }
  return scenarios;
}

/** Measure the agent backend as host-a, over a family that carries host identity. */
async function runCrossHostPath(kernel: ReturnType<typeof createMemoryKernel>, scenarios: Scenario[], now: number): Promise<ArmResult[]> {
  const backend = new KernelAgentMemoryBackend(kernel);
  const items: PerItem[] = [];
  for (const scenario of scenarios) {
    for (const turn of scenario.turns) {
      await backend.rememberTurn({
        agentId: (turn as { hostId?: string }).hostId ?? 'host-a',
        projectId: scenario.projectId,
        sessionId: `${scenario.projectId}-s`,
        userText: turn.content,
        assistantText: 'Noted.',
      });
    }
    const before = performance.now();
    const result = backend.recall({ agentId: 'host-a', projectId: scenario.projectId, query: scenario.query, limit: 8, now });
    const latencyMs = performance.now() - before;
    items.push(measure(result.items.map((item) => ({ text: String((item as { text?: string }).text ?? ''), hasProvenance: Boolean((item as { id?: string }).id) })), latencyMs, scenario));
  }
  return [score('agent_backend_cross_host', items, scenarios.length)];
}

async function runHostPath(kernel: ReturnType<typeof createMemoryKernel>, scenarios: Scenario[], now: number): Promise<ArmResult[]> {
  const backend = new KernelAgentMemoryBackend(kernel);
  const rawItems: PerItem[] = [];
  const planned: PerItem[] = [];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    // The turns are already in the store from the family that ingested them, tags and
    // all: this family measures the *read* path, and `rememberTurn` has no way to
    // carry `status:superseded`, so ingesting here would silently mark nothing.
    const before = performance.now();
    const result = backend.recall({ agentId: 'scorecard', projectId: scenario.projectId, query: scenario.query, limit: 8, now });
    const latencyMs = performance.now() - before;
    rawItems.push(measure(result.items.map((item) => ({ text: String((item as { text?: string }).text ?? ''), hasProvenance: Boolean((item as { id?: string }).id) })), latencyMs, scenario));

    if (process.env.COGMEM_SCORECARD_DEBUG === '1' && scenarioIndex === 0) {
      const first = result.items.find((item) => String(item.text).includes(scenario.superseded ?? '\u0000'));
      console.error(`[debug] item carrying the stale value: ${first ? 'found' : 'absent'} | tags=${JSON.stringify(first?.tags ?? [])} | candidate.superseded=${JSON.stringify(contextCandidateFromRecallItem(first as never).superseded)}`);
    }
    const plan = kernel.contextCortex.plan({
      query: scenario.query,
      projectId: scenario.projectId,
      currentSessionId: `${scenario.projectId}-s`,
      availableTokens: 16000,
      maxMemoryRatio: 0.25,
      candidates: result.items.map((item) => contextCandidateFromRecallItem(item as never)),
    }) as { selected?: Array<{ recallItem?: { text?: string; id?: string } }>; suppressed?: Array<{ id: string; reason: string }> } | undefined;
    if (process.env.COGMEM_SCORECARD_DEBUG === '1' && scenarioIndex === 0) {
      console.error(`[debug] plan selected=${plan?.selected?.length ?? 0} suppressed=${JSON.stringify((plan?.suppressed ?? []).map((entry) => entry.reason))}`);
    }
    const selected = plan?.selected?.map((candidate) => ({
      text: String(candidate.recallItem?.text ?? ''),
      hasProvenance: Boolean(candidate.recallItem?.id),
    })) ?? result.items.map((item) => ({ text: String((item as { text?: string }).text ?? ''), hasProvenance: true }));
    planned.push(measure(selected, latencyMs, scenario));
  }

  return [
    score('agent_backend_items', rawItems, scenarios.length),
    score('agent_backend_context_plan', planned, scenarios.length),
  ];
}

/**
 * The #72 gate: the user-facing path on the **unmarked** supersession family.
 *
 * The bars are the ones the maintainer set — current value found ≥87.5%, stale
 * value leaked ≤10% — and they are asserted in the suite, so a change that
 * reintroduces the leakage turns the gate red instead of quietly moving a
 * number in a report nobody re-reads.
 */
export async function measureHostPathSupersession(options: { items: number; seed: number }): Promise<{
  found: number;
  stale: number;
  scenarios: number;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-scorecard-gate-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db') });
  try {
    const now = Date.now();
    const scenarios = buildSupersessionScenarios(options.items, options.seed);
    for (const scenario of scenarios) {
      for (const turn of scenario.turns) {
        await kernel.ingest({ content: turn.content, projectId: scenario.projectId, tags: [turn.turnId, ...(turn.tags ?? [])] });
      }
    }
    const arms = await runHostPath(kernel, scenarios, now);
    const plan = arms.find((arm) => arm.arm === 'agent_backend_context_plan') ?? arms[0]!;
    return { found: plan.recall, stale: plan.staleLeakage, scenarios: scenarios.length };
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function runScorecard(options: { items: number; seed: number }): Promise<{
  recall: ArmResult[];
  currentTruth: ArmResult[];
  currentTruthMarked: ArmResult[];
  hostPath: ArmResult[];
  hostPathMarked: ArmResult[];
  crossHost: ArmResult[];
  scenarios: number;
  seed: number;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-scorecard-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db') });
  const now = Date.now();
  const recallScenarios = buildScenarios(options.items, options.seed);
  const supersessionScenarios = buildSupersessionScenarios(options.items, options.seed);
  const markedScenarios = buildSupersessionScenarios(options.items, options.seed, { markStale: true });

  const recall = await runFamily(kernel, recallScenarios, now);
  const currentTruth = await runFamily(kernel, supersessionScenarios, now + 1);
  const currentTruthMarked = await runFamily(kernel, markedScenarios, now + 2);
  const hostPath = await runHostPath(kernel, supersessionScenarios, now + 3);
  const hostPathMarked = await runHostPath(kernel, markedScenarios, now + 4);
  const crossHost = await runCrossHostPath(kernel, buildCrossHostScenarios(options.items, options.seed), now + 5);
  kernel.close();
  rmSync(dir, { recursive: true, force: true });

  return { recall, currentTruth, currentTruthMarked, hostPath, hostPathMarked, crossHost, scenarios: recallScenarios.length, seed: options.seed };
}

function table(results: ArmResult[], withStale: boolean): string[] {
  const lines = withStale
    ? ['| arm | current truth found | stale value leaked | provenance | context tokens/turn | p95 latency |', '| --- | --- | --- | --- | --- | --- |']
    : ['| arm | recall | stale value leaked | provenance | context tokens/turn | p95 latency |', '| --- | --- | --- | --- | --- | --- |'];
  for (const result of results) {
    lines.push(`| \`${result.arm}\` | ${(result.recall * 100).toFixed(1)}% | ${(result.staleLeakage * 100).toFixed(1)}% | ${(result.provenance * 100).toFixed(0)}% | ${result.contextTokens.toFixed(0)} | ${result.p95LatencyMs.toFixed(1)} ms |`);
  }
  return lines;
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const value = (flag: string, fallback: number): number => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? Number(argv[index + 1]) : fallback;
  };
  const items = value('--items', 24);
  const seed = value('--seed', 20261025);
  const result = await runScorecard({ items, seed });

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ schemaVersion: 'cogmem.scorecard.v2', ...result }, null, 2));
    return;
  }
  console.log(`scenarios: ${result.scenarios} per family (synthetic, generated here) | seed: ${seed} | model: none (rule_only)`);
  console.log('');
  console.log('**Primary metric: Family C — the host path (`KernelAgentMemoryBackend.recall`).**');
  console.log('Families A/B measure the evidence layer (`MemoryKernel.searchEvidence`, internal); it is a component, not the path a host takes.');
  console.log('');
  console.log('### Family A — one fact among distractors, queried with its own words');
  console.log('');
  for (const line of table(result.recall, false)) console.log(line);
  console.log('');
  console.log('### Family B — superseded, with nothing marking it stale');
  console.log('');
  for (const line of table(result.currentTruth, true)) console.log(line);
  console.log('');
  console.log('### Family B′ — the same, with the stale statement tagged `status:superseded`');
  console.log('');
  for (const line of table(result.currentTruthMarked, true)) console.log(line);
  console.log('');
  console.log('### Family C — the host path (agent backend → context candidates → cortex plan), Family B unmarked');
  console.log('');
  for (const line of table(result.hostPath, true)) console.log(line);
  console.log('');
  console.log('### Family C′ — the same host path, with the stale statement tagged `status:superseded`');
  console.log('');
  for (const line of table(result.hostPathMarked, true)) console.log(line);
  console.log('');
  console.log('### Family D — two hosts, one project: neither may supersede the other');
  console.log('');
  for (const line of table(result.crossHost, true)) console.log(line);
  console.log('');
  for (const arm of [...result.recall, ...result.currentTruth, ...result.currentTruthMarked, ...result.hostPath, ...result.hostPathMarked, ...result.crossHost]) {
    if (arm.misses.length > 0) console.log(`${arm.arm}: missed ${arm.misses.length} of ${items}`);
    if (arm.staleItems.length > 0) console.log(`${arm.arm}: leaked the superseded value in ${arm.staleItems.length} of ${items}`);
  }
}

if (import.meta.main) await main();
