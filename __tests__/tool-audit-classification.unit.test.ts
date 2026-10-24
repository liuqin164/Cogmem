import { expect, test } from 'bun:test';

import { classify } from '../evals/mcp/tool-audit.js';

/**
 * A tool that reaches the dispatcher but explodes on an undefined handler is
 * not "reachable": the surface advertises a capability that cannot execute.
 * The audit used to file `ReferenceError: X is not defined` under reachable,
 * which reported `defect: 0` while three tools were broken.
 */
test('a ReferenceError from a missing handler is a defect, not a reachable tool', () => {
  const verdict = classify({
    isError: true,
    structuredContent: { error: 'handleImportPreview is not defined' },
    content: [{ text: '{"error":"handleImportPreview is not defined"}' }],
  });

  expect(verdict.verdict).toBe('defect');
  expect(verdict.detail).toContain('is not defined');
});

test('an explicit ReferenceError message is a defect', () => {
  const verdict = classify({
    isError: true,
    content: [{ text: 'ReferenceError: handlers is not initialized' }],
  });

  expect(verdict.verdict).toBe('defect');
});

test('a TypeError is still a defect', () => {
  const verdict = classify({
    isError: true,
    structuredContent: { error: 'TypeError: undefined is not an object' },
    content: [{ text: '' }],
  });

  expect(verdict.verdict).toBe('defect');
});

test('an unknown tool is still a defect', () => {
  const verdict = classify({ isError: true, content: [{ text: 'unknown cogmem tool: nope' }] });

  expect(verdict.verdict).toBe('defect');
});

test('a business precondition error stays reachable', () => {
  const verdict = classify({
    isError: true,
    structuredContent: { error: 'shared_item_not_found:audit-item-1' },
    content: [{ text: '{"error":"shared_item_not_found:audit-item-1"}' }],
  });

  expect(verdict.verdict).toBe('reachable');
});

test('a successful call is ok', () => {
  const verdict = classify({ isError: false, structuredContent: { items: [] }, content: [{ text: '{}' }] });

  expect(verdict).toEqual({ verdict: 'ok', detail: 'returned without error' });
});
