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
/** `~/.cogmem/agents.json` — next to the config, and not inside it. */
export declare function defaultAgentRegistryPath(env?: NodeJS.ProcessEnv): string;
//# sourceMappingURL=AgentRegistry.d.ts.map