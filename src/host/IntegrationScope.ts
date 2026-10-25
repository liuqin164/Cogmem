import { createHash } from 'node:crypto';

/**
 * The private memory scope of one Host integration: one Workspace, one project.
 *
 * Derived from the Workspace path, because a Workspace *is* a private scope
 * (ADR-0005, ADR-0009): a literal `openclaw` would merge every OpenClaw
 * Workspace on the machine into one memory, which is the sharing those ADRs
 * refuse. Two Workspaces therefore produce two names, and importing into one
 * cannot surface in the other.
 *
 * One function for both hosts, because this is the fact `connect`, its printed
 * steps and the README must agree about: the value written into the plugin entry
 * has to be the value the printed import step names, or the import reports
 * success and the agent recalls nothing (ADR-0010, #79).
 */
export function integrationScope(host: 'openclaw' | 'hermes', workspaceRoot: string): string {
  const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 8);
  return `${host}-${hash}`;
}
