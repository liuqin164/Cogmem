import { renameSync, rmSync, writeFileSync } from 'node:fs';

export const CLI_JSON_SCHEMA_VERSION = 'cogmem.cli.v1' as const;

interface QueueCounters {
  candidate?: unknown;
  promoted?: unknown;
  needsConfirmation?: unknown;
  needs_confirmation?: unknown;
}

export function formatCliJson(
  command: string,
  payload: unknown,
  options: { queue?: QueueCounters; beliefs?: number } = {},
): Record<string, unknown> {
  const queue = options.queue;
  const output: Record<string, unknown> = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>), schemaVersion: CLI_JSON_SCHEMA_VERSION, command }
    : { schemaVersion: CLI_JSON_SCHEMA_VERSION, command, items: Array.isArray(payload) ? payload : [payload] };
  if (queue) {
    output.candidate = finiteCounter(queue.candidate);
    output.promoted = finiteCounter(queue.promoted);
    output.needs_confirmation = finiteCounter(queue.needs_confirmation ?? queue.needsConfirmation);
    output.beliefs = finiteCounter(options.beliefs);
  }
  return output;
}

/**
 * The `--out <path>` target, if this command was given one.
 *
 * Reading it here covers every command that prints JSON (fifteen bins) in one place
 * instead of teaching each parser a flag. `COGMEM_CLI_OUT_EXEMPT` names the commands
 * where `--out` already means something else — `snapshot export --out` is the snapshot
 * file, and hijacking it would write a JSON report over the snapshot.
 */
const OUT_USAGE = '--out needs a file path: `--out <path>` or `--out=<path>`';

/**
 * Report a usage error the way the other bins do — one line, non-zero — instead of
 * letting a stack trace reach the operator. `doctor` runs top-level without a catch, so a
 * thrown error there printed the whole source frame.
 */
function failUsage(message: string): never {
  console.error(message);
  process.exit(1);
}

function outputPathFromArgv(exemptCommand?: string): string | undefined {
  if (exemptCommand) return undefined;
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // `--out` takes the next token only if it is a value. A following option is a missing
    // value, not a path: `--out --json` used to write a file named `--json` into the
    // working directory and exit 0, which is a silent write to a place nobody asked for.
    if (arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('-')) failUsage(OUT_USAGE);
      return value;
    }
    if (arg?.startsWith('--out=')) {
      const value = arg.slice('--out='.length);
      if (value === '') failUsage(OUT_USAGE);
      return value;
    }
  }
  return undefined;
}

/**
 * Write the report to `--out` atomically, or report why it could not.
 *
 * A partial report is worse than no report: the previous file is left exactly as it was
 * unless the new one is complete, which is why the bytes go to a sibling temporary file
 * and are renamed into place. A failure exits non-zero and says where, because the flag
 * this replaces was accepted and silently ignored (#83).
 */
function writeReportFile(path: string, body: string): void {
  const tempPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, body);
    renameSync(tempPath, path);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // The temporary file is already gone or never created; the report below is what matters.
    }
    throw new Error(`--out ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Print a JSON document to stdout and, when `--out` was given, to that file too.
 *
 * The one place both a `formatCliJson` client and a command that builds its own
 * envelope (`doctor`) go through, so `--out` means the same thing everywhere.
 */
export function printJsonDocument(body: string, options: { outExempt?: boolean } = {}): void {
  const outPath = outputPathFromArgv(options.outExempt ? 'exempt' : undefined);
  if (outPath) writeReportFile(outPath, `${body}\n`);
  console.log(body);
}

export function printCliJson(
  command: string,
  payload: unknown,
  options: { queue?: QueueCounters; beliefs?: number; outExempt?: boolean } = {},
): void {
  printJsonDocument(JSON.stringify(formatCliJson(command, payload, options), null, 2), options);
}

function finiteCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
