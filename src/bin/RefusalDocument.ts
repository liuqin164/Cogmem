import { printCliJson } from './CliJson.js';

/**
 * The machine-readable form of a refusal, and the single source of its next steps.
 *
 * A refusal used to be a sentence on stdout even under `--json`, so an agent got a diagnosis and no
 * way forward while a human got both. The envelope is the one doctor already emits (`cogmem.cli.v1`);
 * `message` is the human sentence verbatim, and the human output is unchanged.
 *
 * The steps live here and only here: doctor's failing gate and this document describe the same
 * situation, so they share one definition rather than drifting apart later.
 */
export interface RefusalNextStep {
  id: string;
  action: string;
  command?: string;
  safeForAutomation: boolean;
}

/** The two refusals, by the bare reason code the contract carries. */
export type RefusalReason = 'unsupported_database_identity' | 'no_upgrade_path';

export const REFUSAL_NEXT_STEPS: Record<RefusalReason, RefusalNextStep[]> = {
  // The remedy the message names: a new database path, or checking the path was the one meant.
  unsupported_database_identity: [
    {
      id: 'use_new_database',
      action: 'point cogmem at a new database path and set it up there, leaving this file untouched',
      command: 'cogmem init --config <new-config.toml> --yes',
      safeForAutomation: true,
    },
    {
      id: 'verify_database_path',
      action: 'check that the configured database path is the file you meant to open',
      safeForAutomation: false,
    },
  ],
  // A 3.x database is kept for 3.x; 4.0 starts beside it and brings the history across.
  no_upgrade_path: [
    {
      id: 'keep_with_3x',
      action: 'keep this database for Cogmem 3.x, which is what still reads it',
      safeForAutomation: false,
    },
    {
      id: 'use_new_database',
      action: 'point cogmem at a new database path and move the history across from the 3.x install',
      command: 'cogmem init --config <new-config.toml> --yes',
      safeForAutomation: true,
    },
  ],
};

/** Which refusal this error is, if it is one. The version detail stays in the message. */
export function refusalReasonOf(error: unknown): RefusalReason | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('unsupported_database_identity')) return 'unsupported_database_identity';
  if (message.startsWith('no_upgrade_path')) return 'no_upgrade_path';
  return undefined;
}

/**
 * The document to print instead of the bare message under `--json`, or undefined when this is not a
 * refusal — a non-refusal error keeps whatever behaviour it had.
 */
export function refusalDocumentFor(error: unknown, command: string): Record<string, unknown> | undefined {
  const reason = refusalReasonOf(error);
  if (!reason) return undefined;
  const message = error instanceof Error ? error.message : String(error);
  return {
    schemaVersion: 'cogmem.cli.v1',
    command,
    status: 'refused',
    reason,
    message,
    nextSteps: REFUSAL_NEXT_STEPS[reason],
  };
}

/**
 * Print the refusal document for this error and exit, or return false so the caller keeps its own
 * error handling. Every entry that can open a database calls this at its error exit, so the shape is
 * written here once instead of in each of them.
 */
export function emitRefusalDocument(error: unknown, command: string, json = process.argv.includes('--json')): boolean {
  const document = json ? refusalDocumentFor(error, command) : undefined;
  if (!document) return false;
  printCliJson(command, document);
  process.exit(1);
}
