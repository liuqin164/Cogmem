/**
 * The family roster: the agents this install owns.
 *
 * It used to be a credential register. Each entry carried a bearer credential that a
 * transport presented, and the server derived which agent the connection spoke for (ADR-0006).
 * That is the external frame R3 of #200 removes: a registry of *foreign* agents, trusted by a
 * secret. What stays is the roster itself — the names of this install's own agents, and the
 * project scope each is confined to — which is what the observatory lists and what the future
 * child-agents will be recorded in.
 *
 * Read-only by design. The credential minting (`cogmem init --register-agent`) and the
 * token lookup are gone, so nothing here writes a file and nothing trusts a presented secret.
 * An entry no longer needs a credential to be understood; an existing `agents.json` written by
 * the old command still loads, because the unknown credential fields are ignored.
 *
 * Shape, reported rather than extended (R3): `hostId` (the agent's name), `projectId` (its
 * scope), `profile` (a tool-surface ceiling with no consumer since the MCP face left). A real
 * roster wants role, temporary/permanent and lifecycle; those fields do not exist yet and this
 * round does not invent them.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { defaultCogmemHome, findUp, resolveWorkspaceRoot } from '../config/CogmemConfig.js';

/**
 * The tool-surface ceiling a registration may name. It used to come from the MCP profile module;
 * with that surface gone nothing enforces it. R3 owns what the registry becomes, so the value is
 * carried unchanged rather than dropped out from under an existing roster file.
 */
export type AgentToolProfile = 'core' | 'admin' | 'full';

export interface RegisteredAgent {
  /** The agent's name: the identity its writes are scoped to. */
  hostId: string;
  /**
   * Project this agent is confined to. A call naming another project is
   * rejected; a call naming none is stamped with this one.
   */
  projectId?: string;
  /** Ceiling for this agent's tool profile. Absent means no ceiling was recorded. */
  profile?: AgentToolProfile;
}

export interface AgentRegistry {
  /** Every agent this install names, in file order. */
  list(): RegisteredAgent[];
}

const TOOL_PROFILES: AgentToolProfile[] = ['core', 'admin', 'full'];

export function createAgentRegistry(agents: RegisteredAgent[]): AgentRegistry {
  const ordered: RegisteredAgent[] = [...agents];
  return {
    list: () => [...ordered],
  };
}

/**
 * Validate a parsed `agents.json`. A roster entry without a name is refused rather than
 * defaulted: an agent that cannot be told apart from another one is not on the roster.
 *
 * Credential fields (`token`, `tokenDigest`) are not read any more. They are tolerated so the
 * file an older install wrote still answers as a roster, and ignored so no presented secret is
 * ever compared against anything.
 */
export function parseAgentRegistry(raw: unknown): RegisteredAgent[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('agents file must be an object with an "agents" array');
  }
  const list = (raw as { agents?: unknown }).agents;
  if (!Array.isArray(list)) {
    throw new Error('agents file must contain an "agents" array');
  }

  const agents: RegisteredAgent[] = [];
  const hostIds = new Set<string>();
  for (const [index, entry] of list.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`agents[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;

    const hostId = typeof record.hostId === 'string' ? record.hostId.trim() : '';
    if (!hostId) throw new Error(`agents[${index}].hostId must be a non-empty string`);
    if (hostIds.has(hostId)) throw new Error(`duplicate agent hostId: ${hostId}`);
    hostIds.add(hostId);

    const projectId = typeof record.projectId === 'string' && record.projectId.trim() ? record.projectId : undefined;

    let profile: AgentToolProfile | undefined;
    if (record.profile !== undefined) {
      const requested = typeof record.profile === 'string' ? record.profile : '';
      if (!TOOL_PROFILES.includes(requested as AgentToolProfile)) {
        throw new Error(`agents[${index}].profile must be core, admin, or full`);
      }
      profile = requested as AgentToolProfile;
    }

    agents.push({ hostId, projectId, profile });
  }
  return agents;
}

/**
 * Load the roster, or return undefined when the file does not exist. An
 * absent file is the single-agent case and not an error; a file that exists and
 * cannot be understood is an error, because silently ignoring it would hide every
 * agent the operator believed was on the roster.
 */
export function loadAgentRegistry(path: string): AgentRegistry | undefined {
  const agents = loadRegisteredAgents(path);
  return agents === undefined ? undefined : createAgentRegistry(agents);
}

/** The roster entries themselves, or undefined when the file does not exist. */
export function loadRegisteredAgents(path: string): RegisteredAgent[] | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`agents file is not valid JSON: ${path}`);
  }
  return parseAgentRegistry(parsed);
}

/** `~/.cogmem/agents.json` — next to the config, and not inside it. */
export function defaultAgentRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultCogmemHome(env), 'agents.json');
}

export interface AgentRegistryLookup {
  /** Where a roster is read from, or undefined when none is configured. */
  path?: string;
  /**
   * True when the caller named the path instead of it being discovered. A named
   * roster that cannot be read is a misconfiguration, not the single-agent
   * case (#80).
   */
  explicit: boolean;
}

/**
 * Where this install's roster lives.
 *
 * The Workspace first, then beside the home directory (ADR-0010): a roster written
 * under a project scope is found from any directory, and an existing
 * home-scoped one keeps working because it is the fallback.
 *
 * `path: undefined` means no roster is configured anywhere. That is a
 * *different* answer from "a named roster could not be read", and only the second
 * is refused.
 */
export function resolveAgentRegistryPath(
  options: { explicit?: string; configPath?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): AgentRegistryLookup {
  const env = options.env ?? process.env;
  const explicit = options.explicit?.trim();
  if (explicit) {
    const named = resolve(explicit);
    // Refused here rather than in each caller: `loadAgentRegistry` answers
    // `undefined` for a file that is not there, so a reader that forgets to check
    // reopens exactly the hole this function closes (#80).
    if (!existsSync(named)) {
      throw new Error(`agent_registry_not_found: ${named} was named but does not exist. A roster that cannot be read is not the single-agent case.`);
    }
    return { path: named, explicit: true };
  }

  const workspaceRegistry = join(resolveWorkspaceRoot({ cwd: options.cwd, configPath: options.configPath, env }), '.cogmem', 'agents.json');
  if (existsSync(workspaceRegistry)) return { path: workspaceRegistry, explicit: false };

  // A roster can sit in a `.cogmem/` that has no `config.toml`, and the Workspace
  // above was derived from a config. Walking up for the roster itself is what makes
  // that file found rather than invisible (#80).
  const inTree = findUp(options.cwd ?? process.cwd(), join('.cogmem', 'agents.json'));
  if (inTree) return { path: inTree, explicit: false };

  const homeRegistry = defaultAgentRegistryPath(env);
  if (existsSync(homeRegistry)) return { path: homeRegistry, explicit: false };

  return { explicit: false };
}
