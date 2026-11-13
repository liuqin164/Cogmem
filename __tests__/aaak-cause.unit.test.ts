import { expect, test } from 'bun:test';

import { aaakGenerator } from '../src/utils/AAAKGenerator.js';

/**
 * The chat compressor's cause line (#199).
 *
 * It used to be `content.match(/(.+?)\s*(?:因为|…)(.+)/i)`, which re-expands its lazy group from every
 * start offset looking for a marker that may not be there: quadratic on a newline-free line (measured
 * 4 KB 187 ms, 16 KB 1.8 s, 64 KB 26 s), and the first match is all this code ever reads. The scan that
 * replaced it has to answer the same question, guards included — `__tests__/ingest-baseline.unit.test.ts`
 * is what holds the cost, this is what holds the answer.
 */

const summary = (content: string): string => aaakGenerator.generateSummarySync(content, 'chat', 3);

test('#199: the cause is the first line holding a marker, and nothing is invented when none does', () => {
  expect(summary('部署完成，因为缓存已预热。')).toContain('→部署完成，因为缓存已预热。');
  expect(summary('部署完成。')).not.toContain('→');
  // The pattern's two guards, kept: at least one character before the marker and one after it.
  expect(summary('因为缓存。')).not.toContain('→');
  expect(summary('缓存已预热因为')).not.toContain('→');
});

test('#199: the first matching line wins, and a marker is not found across a newline', () => {
  expect(summary('第一条。\n第二条，因此回滚。\n第三条，因为别的原因。')).toContain('→第二条，因此回滚。');
  // `.` never crossed a newline, so a line that is only a marker cannot borrow the next line's text.
  expect(summary('因为\n缓存已预热。')).not.toContain('→');
});

test('#199: a newline-free line is scanned once, not restarted at every offset', () => {
  // Not a wall-clock gate — the baseline harness measures the cost. This is the structural fact the
  // fix rests on: a 64 KB single line with no marker costs one pass and returns no cause. With the old
  // pattern this call took tens of seconds; a bound far above one pass still fails on a return to it.
  const line = 'deploy-release-worker-status '.repeat(2048);
  const started = performance.now();
  expect(summary(line)).not.toContain('→');
  expect(performance.now() - started).toBeLessThan(2_000);
});
