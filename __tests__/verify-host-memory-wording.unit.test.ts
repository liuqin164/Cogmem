import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The host check is run repeatedly (it writes a fact into a real cogmem each time), so
 * the sentence it prints on failure is read by every future round. An earlier version
 * explained both hosts' failures with one cause, and the measurement afterwards
 * falsified it: pi WAS wired (its live session calls `cogmem_recall` when asked) while
 * hermes was NOT (its server never started), so "the one-shot path does not exercise
 * their harness" sent the next reader to fix the wrong thing (#107, #109).
 *
 * The checks below read the script as text. That is the right level: running it needs
 * a box, an API key and a host, so the only part reachable in this suite is the wording
 * -- which is the part this guards.
 */
const script = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'verify-host-memory.sh'),
  'utf8',
);

test('the check does not claim a cause it cannot tell apart', () => {
  // The claim measured false on 2026-10-30. It must not come back.
  expect(script).not.toContain('does not exercise their harness');
  expect(script).not.toContain('DOES return');
});

test('the check says what it measured and where to look next', () => {
  expect(script).toContain('whether $HOST reaches for cogmem on its own');
  // One concrete command per host, so a reader can separate wiring from prompting.
  expect(script).toContain('pi mcp list');
  expect(script).toContain("registered .* tool");
  // The assertion itself is untouched: still the passcode, still never in the question.
  expect(script).toContain('PASSCODE="BEACON-$$"');
  expect(script).toContain('grep -q "$PASSCODE"');
});
