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
import type { McpToolProfile } from './profiles.js';
export interface RegisteredAgent {
    /** The identity this credential speaks for. */
    hostId: string;
    /** Bearer credential presented by the agent. */
    token: string;
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
export declare function createAgentRegistry(agents: RegisteredAgent[]): AgentRegistry;
/**
 * Validate a parsed `agents.json`. A registration without an identity or a
 * credential is refused rather than defaulted: an agent that cannot be told
 * apart from another one is not registered, it is a shared secret.
 */
export declare function parseAgentRegistry(raw: unknown): RegisteredAgent[];
/**
 * Load the registry, or return undefined when the file does not exist. An
 * absent file is the single-agent case and not an error; a file that exists and
 * cannot be understood is an error, because silently ignoring it would serve
 * every agent as anonymous while the operator believed they were registered.
 */
export declare function loadAgentRegistry(path: string): AgentRegistry | undefined;
/** The registered entries themselves, or undefined when the file does not exist. */
export declare function loadRegisteredAgents(path: string): RegisteredAgent[] | undefined;
export interface RegisterAgentInput {
    path: string;
    hostId: string;
    projectId?: string;
    profile?: McpToolProfile;
    /** Replace an existing credential instead of refusing. */
    rotate?: boolean;
}
export interface RegisteredAgentCredential extends RegisteredAgent {
    /** True when an existing entry was replaced. */
    replaced: boolean;
}
/**
 * Mint a credential for one agent and write it into the registry file.
 *
 * The credential is generated here and returned exactly once. It is never
 * recoverable from the file — only its digest is used for comparison, and the
 * file is written so that only the owner can read it, because a credential that
 * can be read back later is a credential that leaks out of a backup.
 *
 * Replacing an existing entry is refused unless `rotate` is set: silently
 * swapping a credential breaks the host already using it, and that host's failure
 * would surface as an authentication error somewhere else entirely.
 */
export declare function registerAgent(input: RegisterAgentInput): RegisteredAgentCredential;
/** `~/.cogmem/agents.json` — next to the config, and not inside it. */
export declare function defaultAgentRegistryPath(env?: NodeJS.ProcessEnv): string;
//# sourceMappingURL=AgentRegistry.d.ts.map