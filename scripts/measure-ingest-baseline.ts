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
 */
import { createMemoryKernel, KernelAgentMemoryBackend } from '../src/public.js';

/** The ticket's step is 4× input; quadratic growth would be ~16×, so 10× is the separator. */
export const MAX_STEP_RATIO = 10;

export interface IngestMeasurement {
  write: 'ingestToolObservation' | 'ingestTaskEvent';
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
  samples?: number;
}

function fillerText(bytes: number): string {
  let out = '';
  let index = 0;
  while (out.length < bytes) {
    index += 1;
    out += `Worker ${index} reported status ok at step ${index} with elapsed ${index * 3} ms.\n`;
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
  const samples = options.samples ?? 3;
  const kernel = createMemoryKernel({ dbPath: ':memory:' });
  const backend = new KernelAgentMemoryBackend(kernel);
  const measurements: IngestMeasurement[] = [];
  try {
    const coldStart = performance.now();
    const warmCall = await backend.ingestToolCall({
      agentId: 'baseline', projectId: 'baseline', sessionId: 'warm', threadId: 'warm',
      toolCallId: 'warm', toolName: 'bash', input: {}, timestamp: 1,
    });
    await backend.ingestToolObservation({
      agentId: 'baseline', projectId: 'baseline', sessionId: 'warm', threadId: 'warm',
      toolCallId: 'warm', toolCallEventId: warmCall.eventId, toolName: 'bash', output: 'warm', timestamp: 2,
    });
    const coldFirstIngestMs = performance.now() - coldStart;

    let seq = 0;
    const observation = (kb: number) => async (): Promise<void> => {
      seq += 1;
      const tag = `o-${kb}-${seq}`;
      const call = await backend.ingestToolCall({
        agentId: 'baseline', projectId: 'baseline', sessionId: tag, threadId: tag,
        toolCallId: tag, toolName: 'bash', input: {}, timestamp: 10 + seq,
      });
      await backend.ingestToolObservation({
        agentId: 'baseline', projectId: 'baseline', sessionId: tag, threadId: tag,
        toolCallId: tag, toolCallEventId: call.eventId, toolName: 'bash',
        output: fillerText(kb * 1024), timestamp: 11 + seq,
      });
    };
    for (const kb of toolObservationKb) {
      const ms = await medianIngestMs(observation(kb), samples);
      measurements.push({ write: 'ingestToolObservation', kb, ms, perKb: ms / kb });
    }

    const ms = await medianIngestMs(async () => {
      seq += 1;
      await backend.ingestTaskEvent({
        agentId: 'baseline', projectId: 'baseline', sessionId: `t-${seq}`, threadId: `t-${seq}`,
        taskId: `task-${seq}`, title: 'baseline', content: fillerText(taskEventKb * 1024), timestamp: 100 + seq,
      });
    }, samples);
    measurements.push({ write: 'ingestTaskEvent', kb: taskEventKb, ms, perKb: ms / taskEventKb });

    const steps: IngestBaselineResult['steps'] = [];
    for (let index = 1; index < measurements.length; index += 1) {
      const previous = measurements[index - 1]!;
      const current = measurements[index]!;
      if (current.write !== previous.write) continue;
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
    lines.push(`${row.write}\t${row.kb}\t${row.ms.toFixed(1)}\t${row.perKb.toFixed(3)}`);
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
