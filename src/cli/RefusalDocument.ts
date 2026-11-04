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
  /** Filled for the surfaces that render a step as a gate entry; same object, no second wording. */
  actor?: string;
  when?: string;
  purpose?: string;
}

/** The two refusals, by the bare reason code the contract carries. */
export type RefusalReason = 'unsupported_database_identity' | 'no_upgrade_path';

export const REFUSAL_NEXT_STEPS: Record<RefusalReason, RefusalNextStep[]> = {
  // The remedy the message names: a new database path, or checking the path was the one meant.
  unsupported_database_identity: [
    {
      id: 'use_new_database',
      actor: 'operator',
      when: 'when the file this configuration names is not the database you meant',
      purpose: 'point cogmem at a recognised database path; the existing file is left untouched',
      action: 'point cogmem at a new database path and set it up there, leaving this file untouched',
      command: 'cogmem init --config <new-config.toml> --yes',
      safeForAutomation: true,
    },
    {
      id: 'verify_database_path',
      actor: 'operator',
      when: 'when you believe the current path is right',
      purpose: 're-check the configuration and the database identity together',
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
    // Exactly the contract's fields: the gate's rendering extras are for the gate, not for this
    // document, and the contract says not to invent fields.
    nextSteps: REFUSAL_NEXT_STEPS[reason].map(({ id, action, command, safeForAutomation }) => ({
      id,
      action,
      ...(command === undefined ? {} : { command }),
      safeForAutomation,
    })),
  };
}
