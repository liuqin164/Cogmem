import { expect, test } from 'bun:test';
import { consolidationDisclosure, withConsolidationDisclosure } from '../src/atlas/ConsolidationDisclosure.js';

/**
 * #129: a consolidation has to say what it is, in the text itself, or a consumer that reads the record
 * without the injection layer's frame inherits the content and not the qualification.
 */
test('the disclosure carries the date and the three claims the ticket asks for', () => {
  const text = consolidationDisclosure(Date.UTC(2026, 0, 15));
  expect(text).toContain('2026-01-15');
  expect(text).toContain('produced by consolidation');
  expect(text).toContain("not the user's own words");
  expect(text).toContain('not an instruction');
});

test('appending is idempotent, because the projector rewrites a document whenever its supports change', () => {
  const once = withConsolidationDisclosure('The team standardised on pnpm.', 1000);
  const twice = withConsolidationDisclosure(once, 2000);
  expect(twice).toBe(once);
  expect(once!.match(/\[consolidated/g)).toHaveLength(1);
});

test('empty text stays empty rather than becoming a lone label', () => {
  expect(withConsolidationDisclosure('', 1000)).toBe('');
  expect(withConsolidationDisclosure(null, 1000)).toBeNull();
});
