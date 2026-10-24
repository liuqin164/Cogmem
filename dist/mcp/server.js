import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { callCogmemMcpTool, isCogmemMcpTool, listCogmemMcpTools, } from './CoreMcpTools.js';
import { buildMcpInstructions, DEFAULT_TOOL_PROFILE, filterToolsByProfile, isToolAllowed, resolveProfile } from './profiles.js';
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
import { CORE_VERSION } from '../version.js';
/** Narrower surfaces rank lower; a header may narrow but never widen. */
const PROFILE_RANK = { core: 0, admin: 1, full: 2 };
class IdentityError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
/** Parse the identity JSON blob. Unknown fields are ignored; a non-string value is dropped. */
export function parseSessionIdentity(raw) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.length === 0)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return undefined;
    const record = parsed;
    const identity = {
        hostId: typeof record.hostId === 'string' ? record.hostId : undefined,
        projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
        profile: typeof record.profile === 'string' ? record.profile : undefined,
    };
    return identity.hostId === undefined && identity.projectId === undefined && identity.profile === undefined
        ? undefined
        : identity;
}
/** Merge a per-call header identity over the session binding, field by field. */
function mergeIdentity(base, override) {
    if (!base)
        return override;
    if (!override)
        return base;
    return {
        hostId: override.hostId ?? base.hostId,
        projectId: override.projectId ?? base.projectId,
        profile: override.profile ?? base.profile,
    };
}
/**
 * The identity a call runs under. The transport hands us the original HTTP
 * request headers and the session id; the JSON-RPC params object carries
 * neither, which is why this cannot be read off `request`.
 */
function resolveRequestIdentity(extra, options) {
    const headerName = options.identityHeader ?? 'x-cogmem-identity';
    const fromRequest = parseSessionIdentity(extra?.requestInfo?.headers?.[headerName.toLowerCase()]);
    const fromSession = options.identityForSession?.(extra?.sessionId);
    const identity = mergeIdentity(fromSession, fromRequest) ?? {};
    const boundProjectId = options.projectId ?? fromSession?.projectId;
    return { identity, boundProjectId };
}
/**
 * Apply the identity to the server options, enforcing the security boundary:
 * the configured profile is a ceiling unless the request is trusted, a project
 * binding may not be silently overridden, and a hostId may only be asserted by
 * an authenticated connection.
 *
 * Exported because "who is this call running as" is the security boundary of
 * this module, and it is decided by a pure function rather than by the
 * transport that happens to be in front of it.
 */
export function applyIdentity(baseOptions, resolved, trusted) {
    const { identity, boundProjectId } = resolved;
    const configured = baseOptions.profile ?? 'core';
    if (identity.projectId !== undefined && boundProjectId !== undefined && identity.projectId !== boundProjectId) {
        throw new IdentityError(`project_scope_violation: this connection is bound to project "${boundProjectId}" but the call asked for "${identity.projectId}".`);
    }
    let profile = configured;
    if (identity.profile !== undefined) {
        let requested;
        try {
            requested = resolveProfile(identity.profile);
        }
        catch {
            throw new IdentityError(`unknown_tool_profile:${identity.profile}`);
        }
        profile = trusted || PROFILE_RANK[requested] <= PROFILE_RANK[configured] ? requested : configured;
    }
    // A hostId says *which agent* a call runs as, so an unauthenticated
    // connection may not assert one: on loopback a header that names a host is
    // ignored and the call runs as the server, never as the name in the header.
    // The project and profile fields stay usable without a credential because
    // they narrow what the connection may do instead of inventing who it is.
    const hostId = trusted && identity.hostId !== undefined ? identity.hostId : baseOptions.hostId;
    return {
        ...baseOptions,
        profile,
        hostId,
        projectId: identity.projectId ?? boundProjectId ?? baseOptions.projectId,
    };
}
export function createCogmemMcpServer(runtime = {}, options = {}) {
    const server = new Server({
        name: options.hostId ? `cogmem-${options.hostId}` : 'cogmem-core',
        version: CORE_VERSION,
    }, {
        capabilities: {
            tools: {},
        },
        instructions: buildMcpInstructions(options.profile ?? DEFAULT_TOOL_PROFILE),
    });
    // A request is trusted when the transport authenticated it (a bearer token was
    // configured and presented), so only then may an identity header widen the
    // profile the server was started with.
    const trusted = options.identityTrusted === true;
    function identityResult(extra) {
        try {
            return { effective: applyIdentity(options, resolveRequestIdentity(extra, options), trusted) };
        }
        catch (error) {
            if (error instanceof IdentityError)
                return { error: error.code };
            throw error;
        }
    }
    server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
        const resolved = identityResult(extra);
        if ('error' in resolved)
            throw new Error(resolved.error);
        return {
            tools: filterToolsByProfile(resolved.effective.profile, listCogmemMcpTools()),
        };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const resolved = identityResult(extra);
        if ('error' in resolved) {
            return {
                isError: true,
                content: [{ type: 'text', text: resolved.error }],
            };
        }
        const effectiveOptions = resolved.effective;
        // Registration is checked before the profile: a name no profile can reach
        // has to say so, because "not in this profile" implies widening reveals it.
        if (!isCogmemMcpTool(request.params.name)) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `tool_not_found: ${request.params.name} is not a cogmem MCP tool.`,
                    },
                ],
            };
        }
        if (!isToolAllowed(effectiveOptions.profile, request.params.name)) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `tool_not_in_profile: ${request.params.name} is not exposed by profile "${effectiveOptions.profile}". Start the server with --profile admin or --profile full to use it.`,
                    },
                ],
            };
        }
        const rawArgs = (request.params.arguments ?? {});
        let args = rawArgs;
        if (effectiveOptions.projectId) {
            const requested = typeof rawArgs.projectId === 'string' ? rawArgs.projectId : undefined;
            if (requested && requested !== effectiveOptions.projectId) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `project_scope_violation: this connection is bound to project "${effectiveOptions.projectId}" but the call asked for "${requested}".`,
                        },
                    ],
                };
            }
            args = { ...rawArgs, projectId: effectiveOptions.projectId };
        }
        // Create runtime with session identity for proper authorization
        const sessionRuntime = {
            ...runtime,
            hostId: effectiveOptions.hostId ?? runtime.hostId,
        };
        const result = await callCogmemMcpTool(request.params.name, args, sessionRuntime);
        return result;
    });
    return server;
}
export async function startCogmemMcpServer(runtime = {}, options = {}) {
    // Resolve kernel upfront (single writer per process, like HTTP server)
    const kernel = (() => {
        if (runtime.kernel)
            return runtime.kernel;
        if (runtime.dbPath)
            return createMemoryKernel({ dbPath: runtime.dbPath });
        return createMemoryKernelFromConfig({
            configPath: runtime.configPath,
            cwd: runtime.cwd,
        });
    })();
    const serverRuntime = {
        ...runtime,
        kernel,
        hostId: options.hostId ?? runtime.hostId,
    };
    const server = createCogmemMcpServer(serverRuntime, options);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return {
        server,
        stop() {
            transport.close();
            // Close kernel if we created it (not injected by caller)
            if (!runtime.kernel)
                kernel.close();
        },
    };
}
export { resolveProfile };
