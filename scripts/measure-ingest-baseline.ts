#!/usr/bin/env bun
/**
 * The ingest baseline (#199): what one capture write costs as the text grows.
 *
 *   bun scripts/measure-ingest-baseline.ts [--json]
 *
 * #199 reported `ingestToolObservation` at 183 ms / 1.7 s / 21.1 s for 1 / 4 / 16 KB and
 * `ingestTaskEvent` at 25.9 s for 40 KB, read as an O(n²) scan inside ingest. Re-measured here it
 * is linear, and the gap is measured rather than argued:
 *
 * - **Warm, after `createMemoryKernel` has finished `initialize()`.** The first ingest of a process
 *   also pays schema setup and the embedder's warmup (`MemoryKernel.initialize`), which dwarf the
 *   write itself — that fixed cost is reported as `coldFirstIngestMs` and is why the ticket's 1 KB
 *   row reads 183 ms where the ingest is single-digit milliseconds.
 * - **One kernel, several sizes.** A fresh kernel per size pays init again per row and hides the
 *   slope the ticket is about.
 * - **Median of `samples`.** The first sample after a burst also absorbs work that the previous
 *   writes scheduled (`queueMicrotask` offline consolidation, the async embedding queue), so a
 *   single sample is not the ingest's own cost.
 *
 * The gate is the ticket's own rule: a step of 4× input must not cost 10× time. Linear reads ~4×,
 * quadratic reads ~16×, so the rule separates them with room for a loaded machine.
 *
 * Two traps this harness had to learn, both measured rather than assumed:
 *
 * - **Neuron dedup reads as a fast ingest.** The kernel skips compiling a neuron whose vector is
 *   >= 0.98 similar to one it already has, and returns the earlier one, so a repeated sample measured
 *   25 ms instead of 1.5 s. Every sample now writes into its own project (dedup only fires within a
 *   project) and the conversation rows assert they produced a new neuron.
 * - **A newline-free line is a different shape from 64-column lines.** The quadratic #199 found — a
 *   backtracking regex in the AAAK summary — costs O(n²) on one long line and nothing at all on the
 *   same bytes split into lines. Every row here was line-separated when this gate was written, which
 *   is exactly why it passed while the bug was live. The one-line rows ran to 64 KB because at
 *   4->16 KB the bug reads 8.6× and slips under a 10× rule, where 16->64 KB reads 17× and fails it.
 */
import { createMemoryKernel, KernelAgentMemoryBackend } from '../src/public.js';

/** The ticket's step is 4× input; quadratic growth would be ~16×, so 10× is the separator. */
export const MAX_STEP_RATIO = 10;

export interface IngestMeasurement {
  write: 'ingestToolObservation' | 'ingestTaskEvent' | 'captureConversationTurn';
  /**
   * The shape of the text, because the shape is half the measurement: a newline-free line is the
   * shape that hides a backtracking scan, and every row here used to be line-separated, which is how
   * #199's quadratic stayed invisible to this gate until the one-line rows were added.
   */
  shape: 'lines' | 'one-line';
  kb: number;
  ms: number;
  /** Milliseconds per KB of this row — the number to watch across sizes. */
  perKb: number;
}

export interface IngestBaselineResult {
  coldFirstIngestMs: number;
  measurements: IngestMeasurement[];
  /** Consecutive 4× steps and their time ratio, which is what the gate reads. */
  steps: Array<{ fromKb: number; toKb: number; ratio: number }>;
}

export interface IngestBaselineOptions {
  toolObservationKb?: number[];
  taskEventKb?: number;
  /** The conversation face (#157) rides this same path, so it is measured by the same gate. */
  conversationKb?: number[];
  /**
   * The one-line rows: the shape #199's quadratic lived in, and they run to 64 KB because the
   * quadratic's own step grows with the size — at 4->16 KB the bug read 8.6x and slipped under a 10x
   * rule, where 16->64 KB read 17x and failed it.
   */
  oneLineKb?: number[];
  samples?: number;
}

/**
 * Text for one measurement. `salt` seeds it, and every sample must carry a different one: the kernel
 * dedupes a neuron whose vector is >= 0.98 similar to one it already has, and a duplicate returns the
 * earlier neuron *without compiling it*, which reads as a very fast ingest. Measured while building
 * this gate: three nearly identical 16 KB samples took 25 ms because the second and third were
 * deduped. Repeated text also made a 4 KB sample dedupe against a 16 KB one.
 */
function fillerText(bytes: number, salt: number): string {
  let out = `run-${salt}\n`;
  let index = 0;
  while (out.length < bytes) {
    index += 1;
    out += `Worker ${index} reported status ok at step ${index} with elapsed ${index * 3} ms.\n`;
  }
  return out.slice(0, bytes);
}

/** One newline-free line of `bytes` characters: the shape a backtracking scan goes quadratic on. */
function oneLineText(bytes: number, salt: number): string {
  const words = ['deploy', 'release', 'worker', 'status', 'latency', 'shard', 'queue', 'cache', 'retry', 'drain'];
  // Every token carries the salt, so two samples share no tokens at all: a small shared vocabulary
  // still reads as the same text to the embedder at 64 KB, which the dedup guard below caught.
  let out = `run-${salt} `;
  let state = (salt * 2654435761) % 4294967296;
  while (out.length < bytes) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += `${words[state % words.length]!}-${salt}x${state % 997} `;
  }
  return out.slice(0, bytes);
}

async function medianIngestMs(run: () => Promise<unknown>, samples: number): Promise<number> {
  const times: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((left, right) => left - right);
  return times[Math.floor(times.length / 2)]!;
}

export async function measureIngestBaseline(options: IngestBaselineOptions = {}): Promise<IngestBaselineResult> {
  const toolObservationKb = options.toolObservationKb ?? [1, 4, 16, 64];
  const taskEventKb = options.taskEventKb ?? 40;
  const conversationKb = options.conversationKb ?? [4, 16];
  const oneLineKb = options.oneLineKb ?? [4, 16, 64];
  const samples = options.samples ?? 3;
  const kernel = createMemoryKernel({ dbPath: ':memory:' });
  const backend = new KernelAgentMemoryBackend(kernel);
  const measurements: IngestMeasurement[] = [];
  const compiledNeuronIds = new Set<string>();
  /** A project per sample: dedup only fires inside one project, and a deduped sample is not an ingest. */
  const projectFor = (sample: number) => `baseline-${sample}`;
  try {
    const coldStart = performance.now();
    const warmCall = await backend.ingestToolCall({
      agentId: 'baseline', projectId: projectFor(0), sessionId: 'warm', threadId: 'warm',
      toolCallId: 'warm', toolName: 'bash', input: {}, timestamp: 1,
    });
    await backend.ingestToolObservation({
      agentId: 'baseline', projectId: projectFor(0), sessionId: 'warm', threadId: 'warm',
      toolCallId: 'warm', toolCallEventId: warmCall.eventId, toolName: 'bash', output: 'warm', timestamp: 2,
    });
    const coldFirstIngestMs = performance.now() - coldStart;

    // Warm the one-line shape too: it is the first CJK-heavy text these rows write, and the lexicon
    // paths it touches are lazy, so the un-warmed row reads a fixed cost as if it were the slope.
    let seeded = 0;
    seeded += 1;
    const warmRecord = await backend.captureConversationTurn({
      projectId: projectFor(seeded), agentId: 'baseline', sessionId: `l-warm-${seeded}`, channel: 'baseline',
      speaker: 'owner', text: oneLineText(1024, seeded), occurredAt: Date.now() - 2000,
    });
    compiledNeuronIds.add(warmRecord.compiledNeuronId ?? '');

    let seq = 0;
    const observation = (kb: number) => async (): Promise<void> => {
      seq += 1;
      const tag = `o-${kb}-${seq}`;
      const call = await backend.ingestToolCall({
        agentId: 'baseline', projectId: projectFor(seq), sessionId: tag, threadId: tag,
        toolCallId: tag, toolName: 'bash', input: {}, timestamp: 10 + seq,
      });
      await backend.ingestToolObservation({
        agentId: 'baseline', projectId: projectFor(seq), sessionId: tag, threadId: tag,
        toolCallId: tag, toolCallEventId: call.eventId, toolName: 'bash',
        output: fillerText(kb * 1024, seq), timestamp: 11 + seq,
      });
    };
    for (const kb of toolObservationKb) {
      const ms = await medianIngestMs(observation(kb), samples);
      measurements.push({ write: 'ingestToolObservation', shape: 'lines', kb, ms, perKb: ms / kb });
    }

    const ms = await medianIngestMs(async () => {
      seq += 1;
      await backend.ingestTaskEvent({
        agentId: 'baseline', projectId: projectFor(seq), sessionId: `t-${seq}`, threadId: `t-${seq}`,
        taskId: `task-${seq}`, title: 'baseline', content: fillerText(taskEventKb * 1024, seq), timestamp: 100 + seq,
      });
    }, samples);
    measurements.push({ write: 'ingestTaskEvent', shape: 'lines', kb: taskEventKb, ms, perKb: ms / taskEventKb });

    for (const kb of conversationKb) {
      const conversationMs = await medianIngestMs(async () => {
        seq += 1;
        await backend.captureConversationTurn({
          projectId: projectFor(seq), agentId: 'baseline', sessionId: `c-${seq}`, channel: 'baseline',
          speaker: 'owner', text: fillerText(kb * 1024, seq), occurredAt: Date.now() - 1000 + seq,
        });
      }, samples);
      measurements.push({ write: 'captureConversationTurn', shape: 'lines', kb, ms: conversationMs, perKb: conversationMs / kb });
    }

    for (const kb of oneLineKb) {
      const oneLineMs = await medianIngestMs(async () => {
        seq += 1;
        const record = await backend.captureConversationTurn({
          projectId: projectFor(seq), agentId: 'baseline', sessionId: `l-${seq}`, channel: 'baseline',
          speaker: 'owner', text: oneLineText(kb * 1024, seq), occurredAt: Date.now() - 1000 + seq,
        });
        // A deduped sample compiled nothing, so its time is the duplicate short-circuit, not the
        // ingest. Fail rather than publish a number produced by it.
        if (compiledNeuronIds.has(record.compiledNeuronId ?? '')) {
          throw new Error(
            `ingest baseline fixture was deduped at ${kb} KB: the sample reused a neuron the kernel already had. `
            + 'Vary the sample text (see fillerText/oneLineText) instead of trusting this timing.',
          );
        }
        compiledNeuronIds.add(record.compiledNeuronId ?? '');
      }, samples);
      measurements.push({ write: 'captureConversationTurn', shape: 'one-line', kb, ms: oneLineMs, perKb: oneLineMs / kb });
    }

    const steps: IngestBaselineResult['steps'] = [];
    for (let index = 1; index < measurements.length; index += 1) {
      const previous = measurements[index - 1]!;
      const current = measurements[index]!;
      if (current.write !== previous.write || current.shape !== previous.shape) continue;
      steps.push({ fromKb: previous.kb, toKb: current.kb, ratio: current.ms / previous.ms });
    }
    return { coldFirstIngestMs, measurements, steps };
  } finally {
    kernel.close();
  }
}

/** The gate: every 4× step under `MAX_STEP_RATIO`. Returns one line per violation. */
export function ingestGrowthViolations(result: IngestBaselineResult, maxStepRatio = MAX_STEP_RATIO): string[] {
  const violations: string[] = [];
  for (const step of result.steps) {
    if (step.toKb >= 4 * step.fromKb && step.ratio >= maxStepRatio) {
      violations.push(
        `${step.fromKb} KB -> ${step.toKb} KB took ${step.ratio.toFixed(1)}x (>= ${maxStepRatio}x): superlinear segment`,
      );
    }
  }
  return violations;
}

function formatTable(result: IngestBaselineResult): string {
  const lines = [`cold first ingest (kernel init + embedder warmup): ${result.coldFirstIngestMs.toFixed(0)} ms`, '', 'write\tKB\tms\tms/KB'];
  for (const row of result.measurements) {
    lines.push(`${row.write} (${row.shape})\t${row.kb}\t${row.ms.toFixed(1)}\t${row.perKb.toFixed(3)}`);
  }
  for (const step of result.steps) {
    lines.push(`step ${step.fromKb} KB -> ${step.toKb} KB = ${step.ratio.toFixed(2)}x (linear ~4x, quadratic ~16x)`);
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const result = await measureIngestBaseline();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(formatTable(result));
  const violations = ingestGrowthViolations(result);
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
}
