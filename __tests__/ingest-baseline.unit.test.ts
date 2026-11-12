import { expect, test } from 'bun:test';

import { ingestGrowthViolations, measureIngestBaseline } from '../scripts/measure-ingest-baseline.js';

/**
 * The ingest baseline gate (#199).
 *
 * The ticket's premise was an O(n²) scan inside ingest — 183 ms / 1.7 s / 21.1 s for 1 / 4 / 16 KB.
 * Re-measured on this path the writes are linear, so what this pins is the property the ticket
 * asked for, not a repair: a 4× step in captured text must not cost 10× time (`MAX_STEP_RATIO`), and
 * the per-KB cost must not climb with size. Quadratic growth reads ~16× on a step and a rising
 * per-KB column, so both halves would fail here.
 *
 * The measurement warms the kernel first. The first ingest of a process also pays `initialize()`
 * (schema, FTS, embedder warmup) and would otherwise be the largest number on every row — which is
 * the whole of the ticket's small-input column.
 */
test('#199: the capture path stays linear from 1 KB to 64 KB', async () => {
  const result = await measureIngestBaseline({ samples: 3 });
  const table = result.measurements.map((row) => `${row.write} ${row.kb}KB=${row.ms.toFixed(1)}ms`).join(' ');

  // One row per size the ticket's table names, plus the task-event write.
  expect({ table, rows: result.measurements.map((row) => `${row.write}:${row.kb}`) }).toEqual({
    table,
    rows: [
      'ingestToolObservation:1',
      'ingestToolObservation:4',
      'ingestToolObservation:16',
      'ingestToolObservation:64',
      'ingestTaskEvent:40',
    ],
  });

  // The ticket's own rule. Linear is ~4×, quadratic ~16×; anything at 10× is a regression.
  expect(ingestGrowthViolations(result)).toEqual([]);

  // A catastrophic blow-up (a hang, or a machine-independent quadratic the ratio noise could hide)
  // would still show here. Deliberately far above the measured ~36 ms so a loaded runner stays green.
  const largest = result.measurements[result.measurements.length - 1]!;
  expect(largest.ms).toBeLessThan(10_000);
}, 180_000);

test('#199: the growth rule fails a quadratic step, so the gate above is not decoration', () => {
  const measurements = [
    { write: 'ingestToolObservation' as const, kb: 1, ms: 10, perKb: 10 },
    { write: 'ingestToolObservation' as const, kb: 4, ms: 40, perKb: 10 },
    { write: 'ingestToolObservation' as const, kb: 16, ms: 640, perKb: 40 },
  ];
  const quadratic = {
    coldFirstIngestMs: 10,
    measurements,
    steps: [
      { fromKb: 1, toKb: 4, ratio: 4 },
      { fromKb: 4, toKb: 16, ratio: 16 },
    ],
  };
  expect(ingestGrowthViolations(quadratic)).toEqual([
    '4 KB -> 16 KB took 16.0x (>= 10x): superlinear segment',
  ]);
});
