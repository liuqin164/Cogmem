import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { LoadedCogmemConfig } from '../config/CogmemConfig.js';
import { hostWorkspaceFor } from '../config/CogmemConfig.js';
import { inspectOpenClawAutoMemoryPlugin } from './openclaw/AutoMemoryPluginInstaller.js';

/** Host integration kinds that `connect` knows about. */
export type HostIntegration = 'openclaw' | 'hermes';

/**
 * Whether one Host's integration exists.
 *
 * A fact about files, not a preference (ADR-0010): `connect <host> --auto` is what
 * makes it true, and a Host that has been wired does not read back as unwired. That
 * is what lets the Install gate stop recommending a step that is already done and
 * lets `update` maintain files `connect` wrote (#81).
 */
export interface HostWiring {
  host: HostIntegration;
  /** The operator asked for this Host — `integrations.<host>.enabled`. */
  wanted: boolean;
  /** The integration is on disk. */
  established: boolean;
}

/** The Hermes config `connect` patches. One function, so writer and reader agree. */
export function defaultHermesConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME || homedir(), '.hermes', 'config.yaml');
}

/** Whether that config carries a Cogmem MCP entry, which is what `connect` writes. */
export function hermesMcpEntryConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const configPath = defaultHermesConfigPath(env);
  if (!existsSync(configPath)) return false;
  try {
    return /^\s+cogmem\s*:\s*$/m.test(readFileSync(configPath, 'utf8'));
  } catch {
    // An unreadable config is not "wired": the gate may recommend the step again,
    // which is recoverable, while a false positive would hide a broken install.
    return false;
  }
}

/** What is true about each Host for this config, as far as the gate can see. */
export function hostWiringFor(loaded: LoadedCogmemConfig, env: NodeJS.ProcessEnv = process.env): HostWiring[] {
  const openclawWorkspace = hostWorkspaceFor(loaded, 'openclaw');
  return [
    {
      host: 'openclaw',
      wanted: loaded.integrations.openclaw.enabled,
      established: inspectOpenClawAutoMemoryPlugin({ workspaceRoot: openclawWorkspace }).installed,
    },
    { host: 'hermes', wanted: loaded.integrations.hermes.enabled, established: hermesMcpEntryConfigured(env) },
  ];
}

/**
 * The Host the gate still has work for, or `undefined` when there is none.
 *
 * Only unsatisfied work is named: a Host whose integration is on disk is never
 * recommended again, which is what makes the gate converge instead of repeating
 * itself forever (#81). A Host the operator asked for and did not get comes first,
 * and the primary Host is the fallback so a fresh install is still told what to do
 * — named, rather than hardcoded to OpenClaw in a Hermes-only Workspace.
 */
export function pendingHostIntegration(
  wiring: HostWiring[],
  primary: HostIntegration = 'openclaw',
): HostIntegration | undefined {
  const wanted = wiring.find((entry) => entry.wanted && !entry.established);
  if (wanted) return wanted.host;
  // A Host the operator asked for *and already has* means the gate has no work
  // left. Falling through to another Host there would recommend OpenClaw forever
  // to a Hermes user — the non-convergence this function exists to remove.
  if (wiring.some((entry) => entry.wanted)) return undefined;
  const fallback = wiring.find((entry) => entry.host === primary);
  return fallback && !fallback.established ? primary : undefined;
}
