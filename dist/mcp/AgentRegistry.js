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
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultCogmemHome } from '../config/CogmemConfig.js';
const TOOL_PROFILES = ['core', 'admin', 'full'];
function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function createAgentRegistry(agents) {
    const byDigest = new Map();
    const ordered = [];
    for (const agent of agents) {
        byDigest.set(digest(agent.token), agent);
        ordered.push(agent);
    }
    return {
        resolve(token) {
            if (typeof token !== 'string' || token.length === 0)
                return undefined;
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
export function parseAgentRegistry(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('agents file must be an object with an "agents" array');
    }
    const list = raw.agents;
    if (!Array.isArray(list)) {
        throw new Error('agents file must contain an "agents" array');
    }
    const agents = [];
    const hostIds = new Set();
    const tokens = new Set();
    for (const [index, entry] of list.entries()) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`agents[${index}] must be an object`);
        }
        const record = entry;
        const hostId = typeof record.hostId === 'string' ? record.hostId.trim() : '';
        if (!hostId)
            throw new Error(`agents[${index}].hostId must be a non-empty string`);
        if (hostIds.has(hostId))
            throw new Error(`duplicate agent hostId: ${hostId}`);
        hostIds.add(hostId);
        const token = typeof record.token === 'string' ? record.token : '';
        if (!token.trim())
            throw new Error(`agents[${index}].token must be a non-empty string`);
        const tokenDigest = digest(token);
        if (tokens.has(tokenDigest))
            throw new Error(`duplicate agent credential for hostId: ${hostId}`);
        tokens.add(tokenDigest);
        const projectId = typeof record.projectId === 'string' && record.projectId.trim() ? record.projectId : undefined;
        let profile;
        if (record.profile !== undefined) {
            const requested = typeof record.profile === 'string' ? record.profile : '';
            if (!TOOL_PROFILES.includes(requested)) {
                throw new Error(`agents[${index}].profile must be core, admin, or full`);
            }
            profile = requested;
        }
        agents.push({ hostId, token, projectId, profile });
    }
    return agents;
}
/**
 * Load the registry, or return undefined when the file does not exist. An
 * absent file is the single-agent case and not an error; a file that exists and
 * cannot be understood is an error, because silently ignoring it would serve
 * every agent as anonymous while the operator believed they were registered.
 */
export function loadAgentRegistry(path) {
    if (!existsSync(path))
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        throw new Error(`agents file is not valid JSON: ${path}`);
    }
    return createAgentRegistry(parseAgentRegistry(parsed));
}
/** `~/.cogmem/agents.json` — next to the config, and not inside it. */
export function defaultAgentRegistryPath(env = process.env) {
    return join(defaultCogmemHome(env), 'agents.json');
}
