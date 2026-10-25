/**
 * Registered agents and their credentials.
 *
 * 4.0 puts several agents behind one resident process, so "which agent is this"
 * has to come from the connection rather than from the caller's word (see
 * ADR-0006). Each agent is registered with a credential; the transport presents
 * it, and the server derives the identity — `hostId`, and the `projectId` the
 * agent is confined to — from the registration rather than from a header.
 *
 * A credential is a bearer secret, so it is compared by hashing the presented
 * value and looking the digest up: no comparison walks the secret byte by byte,
 * and a lookup miss cannot be timed to reveal a prefix.
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { defaultCogmemHome } from '../config/CogmemConfig.js';
import type { McpToolProfile } from './profiles.js';

export interface RegisteredAgent {
  /** The identity this credential speaks for. */
  hostId: string;
  /** SHA-256 digest of the bearer credential. The plaintext credential is never stored. */
  tokenDigest: string;
  /**
   * Project this agent is confined to. A call naming another project is
   * rejected; a call naming none is stamped with this one.
   */
  projectId?: string;
  /** Ceiling for this agent's tool profile. Absent means the server's profile. */
  profile?: McpToolProfile;
}

export interface AgentRegistry {
  /** The agent a presented credential belongs to, or undefined. */
  resolve(token: string | undefined): RegisteredAgent | undefined;
  list(): RegisteredAgent[];
}

const TOOL_PROFILES: McpToolProfile[] = ['core', 'admin', 'full'];

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createAgentRegistry(agents: RegisteredAgent[]): AgentRegistry {
  const byDigest = new Map<string, RegisteredAgent>();
  const ordered: RegisteredAgent[] = [];
  for (const agent of agents) {
    byDigest.set(agent.tokenDigest, agent);
    ordered.push(agent);
  }
  return {
    resolve(token: string | undefined): RegisteredAgent | undefined {
      if (typeof token !== 'string' || token.length === 0) return undefined;
      return byDigest.get(digest(token));
    },
    list: () => [...ordered],
  };
}

/**
 * Validate a parsed `agents.json`. A registration without an identity or a
 * credential is refused rather than defaulted: an agent that cannot be told
 * apart from another one is not registered, it is a shared secret.
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
  const digests = new Set<string>();
  for (const [index, entry] of list.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`agents[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;

    const hostId = typeof record.hostId === 'string' ? record.hostId.trim() : '';
    if (!hostId) throw new Error(`agents[${index}].hostId must be a non-empty string`);
    if (hostIds.has(hostId)) throw new Error(`duplicate agent hostId: ${hostId}`);
    hostIds.add(hostId);

    // Support both new format (tokenDigest) and legacy format (token) for backward compatibility
    let tokenDigest: string;
    if (typeof record.tokenDigest === 'string' && record.tokenDigest.trim()) {
      tokenDigest = record.tokenDigest.trim();
    } else if (typeof record.token === 'string' && record.token.trim()) {
      // Legacy: plaintext token in file — compute digest for comparison
      tokenDigest = digest(record.token.trim());
    } else {
      throw new Error(`agents[${index}].tokenDigest (or legacy token) must be a non-empty string`);
    }
    if (!/^[a-f0-9]{64}$/.test(tokenDigest)) {
      throw new Error(`agents[${index}].tokenDigest must be a valid sha256 hex digest`);
    }
    if (digests.has(tokenDigest)) throw new Error(`duplicate agent credential for hostId: ${hostId}`);
    digests.add(tokenDigest);

    const projectId = typeof record.projectId === 'string' && record.projectId.trim() ? record.projectId : undefined;

    let profile: McpToolProfile | undefined;
    if (record.profile !== undefined) {
      const requested = typeof record.profile === 'string' ? record.profile : '';
      if (!TOOL_PROFILES.includes(requested as McpToolProfile)) {
        throw new Error(`agents[${index}].profile must be core, admin, or full`);
      }
      profile = requested as McpToolProfile;
    }

    agents.push({ hostId, tokenDigest, projectId, profile });
  }
  return agents;
}

/**
 * Load the registry, or return undefined when the file does not exist. An
 * absent file is the single-agent case and not an error; a file that exists and
 * cannot be understood is an error, because silently ignoring it would serve
 * every agent as anonymous while the operator believed they were registered.
 */
export function loadAgentRegistry(path: string): AgentRegistry | undefined {
  const agents = loadRegisteredAgents(path);
  return agents === undefined ? undefined : createAgentRegistry(agents);
}

/** The registered entries themselves, or undefined when the file does not exist. */
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

export interface RegisterAgentInput {
  path: string;
  hostId: string;
  projectId?: string;
  profile?: McpToolProfile;
  /** Replace an existing credential instead of refusing. */
  rotate?: boolean;
}

export interface RegisteredAgentCredential {
  /** The identity this credential speaks for. */
  hostId: string;
  /** The plaintext bearer credential. Returned exactly once at registration; never stored. */
  token: string;
  /** Project this agent is confined to. */
  projectId?: string;
  /** Ceiling for this agent's tool profile. */
  profile?: McpToolProfile;
  /** True when an existing entry was replaced. */
  replaced: boolean;
}

/**
 * Mint a credential for one agent and write it into the registry file.
 *
 * The credential is generated here and returned exactly once. It is never
 * recoverable from the file — only its digest is stored, and the
 * file is written so that only the owner can read it, because a credential that
 * can be read back later is a credential that leaks out of a backup.
 *
 * Replacing an existing entry is refused unless `rotate` is set: silently
 * swapping a credential breaks the host already using it, and that host's failure
 * would surface as an authentication error somewhere else entirely.
 */
export function registerAgent(input: RegisterAgentInput): RegisteredAgentCredential {
  const hostId = input.hostId.trim();
  if (!hostId) throw new Error('hostId must be a non-empty string');

  const existing = loadRegisteredAgents(input.path) ?? [];
  const current = existing.find((agent) => agent.hostId === hostId);
  if (current && !input.rotate) {
    throw new Error(`agent_already_registered:${hostId} — pass --rotate to replace its credential`);
  }

  const plaintextToken = randomBytes(32).toString('hex');
  const tokenDigest = digest(plaintextToken);

  const entry: RegisteredAgent = {
    hostId,
    tokenDigest,
    projectId: input.projectId ?? current?.projectId ?? hostId,
    profile: input.profile ?? current?.profile,
  };
  const next = [...existing.filter((agent) => agent.hostId !== hostId), entry];

  mkdirSync(dirname(input.path), { recursive: true });
  writeFileSync(input.path, `${JSON.stringify({ agents: next }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  // `mode` on write only applies when the file is created, so an existing file
  // with looser permissions would keep them.
  chmodSync(input.path, 0o600);

  return { hostId, token: plaintextToken, projectId: entry.projectId, profile: entry.profile, replaced: Boolean(current) };
}

/** `~/.cogmem/agents.json` — next to the config, and not inside it. */
export function defaultAgentRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultCogmemHome(env), 'agents.json');
}
