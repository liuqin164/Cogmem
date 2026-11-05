import { expect, test } from 'bun:test';
import { fitRecallItems, recallIndexLine } from '../src/host/RecallBlock.js';

const item = (over: Record<string, unknown> = {}) => ({
  id: `id-${String(over.id ?? 'x')}`, text: 'Deploy window is Tuesday.', displayTitle: 'Deploy window',
  projectId: 'p', sourceAnchor: { eventId: 'e1', occurredAt: Date.UTC(2026, 0, 10) }, ...over,
});

/** Renders like the block does, so the measurement is on what would be printed. */
const render = (entry: Record<string, unknown>, mode: 'full' | 'index') =>
  mode === 'full' ? [`- ${entry.text}`, `  sourceType=raw_ledger; id=${entry.id}`] : [recallIndexLine(entry)];

/** Enough for roughly two full items at the sizes used below. */
const BUDGET = 240;

/**
 * #131: item counts cannot hold a block under a limit, because items are not uniform. The first item stays
 * whole, the next ones fit if they can, and the rest become index lines rather than disappearing.
 */
test('a long item does not push the block over its budget', () => {
  const long = item({ id: 'long', text: 'x'.repeat(400) });
  const fit = fitRecallItems([long], BUDGET, render, 40);
  // The first item is kept whole whatever it costs — but the fit says so instead of pretending.
  expect(fit.items).toHaveLength(1);
  expect(fit.fullCount).toBe(1);
  expect(fit.overBudget).toBe(true);
});

test('short items leave room for more, which is the point of measuring instead of counting', () => {
  const items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' }), item({ id: 'd' }), item({ id: 'e' })];
  // Room for every item at least as an index line: five one-line names cost far less than five full ones.
  const fit = fitRecallItems(items, 900, render, 40);
  expect(fit.fullCount).toBeGreaterThanOrEqual(2);
  expect(fit.measuredCost).toBeLessThanOrEqual(900);
  // Everything that could not be carried whole is still named, so nothing is silently missing.
  expect(fit.fullCount + fit.indexCount + fit.droppedCount).toBe(items.length);
  expect(fit.overBudget).toBe(false);
});

test('an index line is one line and names how to fetch the whole thing', () => {
  const line = recallIndexLine(item({ id: 'abc' }));
  expect(line.split('\n')).toHaveLength(1);
  expect(line).toContain('index[abc]');
  expect(line).toContain('Deploy window');
  expect(line).toContain('2026-01-10');
  expect(line).toContain('cogmem memory show --event e1');
});

test('when even index lines do not fit, the fit says over budget instead of truncating quietly', () => {
  const items = Array.from({ length: 12 }, (_, index) => item({ id: `n${index}`, text: 'Deploy window is Tuesday.' }));
  const fit = fitRecallItems(items, 140, render, 40);
  expect(fit.overBudget).toBe(true);
  expect(fit.droppedCount).toBeGreaterThan(0);
  // What is paid for stays inside the budget; the only line allowed to exceed it is the first item, which
  // rule 1 keeps whole whatever it costs, and here it fits.
  expect(fit.measuredCost).toBeLessThanOrEqual(140);
});
