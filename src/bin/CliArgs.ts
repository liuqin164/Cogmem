/**
 * One strict argument parser for every entry point.
 *
 * The parser used to accept any `--flag` and silently ignore what it did not
 * understand, so `cogmem dream tick --promote` looked like it ran governance
 * (#105). A flag that is not part of an entry's published usage is now an
 * error, with the available flags listed.
 *
 * The allowed set is derived from the entry's own usage text — the contract it
 * prints — so the two cannot drift, and `extraFlags` covers a flag that is
 * accepted but deliberately undocumented. A flag that is used but missing from
 * usage is a documentation bug this surfaces rather than hides.
 */

export type CliArgs = Record<string, string | boolean> & { command?: string };

export interface CliParseOptions {
  /** The entry's usage text; every `--flag` in it is accepted. */
  usage: string;
  /** Flags accepted without being listed in usage. */
  extraFlags?: readonly string[];
  /** Commands this entry accepts; omit to accept any first positional. */
  commands?: readonly string[];
}

export class CliUsageError extends Error {}

const FLAG_IN_TEXT = /--([a-z][a-z0-9-]*)/g;

export function knownFlags(usage: string, extraFlags: readonly string[] = []): Set<string> {
  const flags = new Set<string>(['help', 'h', ...extraFlags]);
  for (const match of usage.matchAll(FLAG_IN_TEXT)) flags.add(match[1]!);
  return flags;
}

export function parseCliArgs(argv: readonly string[], options: CliParseOptions): CliArgs {
  const flags = knownFlags(options.usage, options.extraFlags);
  // A leading `--flag` is a flag, not a command: `cogmem-dream --typo` used to
  // take `--typo` as the command name and skip validation entirely.
  const leadingIsFlag = (argv[0] ?? '').startsWith('--');
  const command = leadingIsFlag ? undefined : argv[0];
  const rest = leadingIsFlag ? [...argv] : argv.slice(1);
  const args: CliArgs = {};
  if (command) args.command = command;
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]!;
    if (item === '--') break;
    if (!item.startsWith('--')) continue;
    const equals = item.indexOf('=');
    const key = equals === -1 ? item.slice(2) : item.slice(2, equals);
    if (!flags.has(key)) {
      throw new CliUsageError(`unknown flag --${key}; available: ${[...flags].sort().map((flag) => `--${flag}`).join(', ')}`);
    }
    if (equals !== -1) { args[key] = item.slice(equals + 1); continue; }
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; index += 1; }
  }
  if (options.commands && command && !options.commands.includes(command)) {
    throw new CliUsageError(`unknown command ${command}; available: ${options.commands.join(', ')}`);
  }
  return args;
}

/**
 * Validate argv for an entry point that parses its own flags.
 *
 * Prints the error and exits non-zero, so a mistyped flag stops the command
 * instead of being ignored (#105).
 */
export function assertCliArgs(argv: readonly string[], options: CliParseOptions): void {
  try {
    parseCliArgs(argv, options);
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
