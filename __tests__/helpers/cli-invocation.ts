/**
 * "Runs as printed" (#78), as one assertion.
 *
 * A printed step is runnable when its first word resolves on this machine: the
 * bare name where `cogmem` is on `PATH`, the absolute launcher where it is not.
 * Asserting a literal path instead is what pinned the old
 * project-local one in place, so the contract is asserted and the string is not.
 *
 * Three test files needed this; three copies of it would be three chances to
 * weaken one of them.
 */
import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function expectRunnableCommand(command: string): void {
  const [head] = command.split(' ');
  expect(head === 'cogmem' || (isAbsolute(head!) && existsSync(head!))).toBe(true);
}

export function expectRunnableCommands(commands: string[]): void {
  expect(commands.length).toBeGreaterThan(0);
  for (const command of commands) expectRunnableCommand(command);
}

/**
 * Everything after the invocation. The arguments a step carries are the contract
 * — they are what the step *does* — so they are pinned exactly; only the head is
 * left to this machine. Hardcoding the whole string is what made the previous
 * relative path survive (AC7), and asserting only the head is what would let the
 * arguments drift.
 */
export function commandArguments(command: string): string {
  const space = command.indexOf(' ');
  return space === -1 ? '' : command.slice(space + 1);
}
