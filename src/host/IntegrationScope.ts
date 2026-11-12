import { createHash } from 'node:crypto';

/**
 * The private memory scope of one Workspace: one directory, one project.
 *
 * Derived from the Workspace path, because a Workspace *is* a private scope
 * (ADR-0005, ADR-0009): a fixed literal would merge every Workspace on the machine
 * into one memory, which is the sharing those ADRs refuse. Two Workspaces therefore
 * produce two names, and importing into one cannot surface in the other.
 *
 * The prefix is the neutral `workspace-`, not a host name (R1 of #200 removed the
 * host wiring that used to need one). One derivation for both directions: the value
 * `cogmem import` writes into is the value `cogmem memory recall` reads back, or the
 * import reports success and the recall finds nothing (#79, #88).
 */
export function workspaceScope(workspaceRoot: string): string {
  const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 8);
  return `workspace-${hash}`;
}
