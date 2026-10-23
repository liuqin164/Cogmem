import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';

import {
  callCogmemMcpTool,
  listCogmemMcpTools,
  type CogmemMcpRuntime,
} from './CoreMcpTools.js';
import { buildMcpInstructions, DEFAULT_TOOL_PROFILE, filterToolsByProfile, isToolAllowed, resolveProfile, type McpToolProfile } from './profiles.js';
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
import { SqliteSharedMemory } from '../adapters/sqlite/SqliteSharedMemory.js';
import { CORE_VERSION } from '../version.js';

export interface CogmemMcpServerOptions {
  /** Tool surface exposed to this client. Defaults to `core`. */
  profile?: McpToolProfile;
  /** Host this connection belongs to, e.g. `claude`, `cursor`, `codex`, `hermes`. */
  hostId?: string;
  /**
   * When set, this connection is bound to one project. Calls that omit
   * `projectId` are stamped with it; calls that name a different project are
   * rejected instead of silently reading someone else's memory.
   */
  projectId?: string;
  /**
   * Header that carries a per-request identity JSON blob (`hostId`,
   * `projectId`, `profile`). A request that presents one overrides the
   * session-bound identity for that call only. It may narrow the profile but
   * never widen it unless the transport authenticated the request.
   */
  identityHeader?: string;
  /**
   * Session-bound identity, looked up by the transport for sessions that were
   * opened with an identity header. Used when a request carries none of its own.
   */
  identityForSession?: (sessionId?: string) => SessionIdentity | undefined;
  /**
   * Whether the transport authenticated the request. Only a trusted request may
   * widen the profile through the identity header; an untrusted one can narrow
   * it but never escalate. Defaults to false.
   */
  identityTrusted?: boolean;
}

export interface SessionIdentity {
  hostId?: string;
  projectId?: string;
  profile?: string;
}

/** Narrower surfaces rank lower; a header may narrow but never widen. */
const PROFILE_RANK: Record<McpToolProfile, number> = { core: 0, admin: 1, full: 2 };

/**
 * Identity a call runs under, plus the transport-supplied request context.
 * `trusted` means the transport already authenticated the request (a bearer
 * token was configured and presented), so a header may widen the profile.
 */
export interface ResolvedIdentity {
  identity: SessionIdentity;
  /** The project this connection is bound to, if any. */
  boundProjectId?: string;
}

class IdentityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Parse the identity JSON blob. Unknown fields are ignored; a non-string value is dropped. */
export function parseSessionIdentity(raw: unknown): SessionIdentity | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const identity: SessionIdentity = {
    hostId: typeof record.hostId === 'string' ? record.hostId : undefined,
    projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
    profile: typeof record.profile === 'string' ? record.profile : undefined,
  };
  return identity.hostId === undefined && identity.projectId === undefined && identity.profile === undefined
    ? undefined
    : identity;
}

/** Merge a per-call header identity over the session binding, field by field. */
function mergeIdentity(base: SessionIdentity | undefined, override: SessionIdentity | undefined): SessionIdentity | undefined {
  if (!base) return override;
  if (!override) return base;
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
function resolveRequestIdentity(
  extra: { sessionId?: string; requestInfo?: { headers?: Record<string, string | string[] | undefined> } } | undefined,
  options: CogmemMcpServerOptions,
): ResolvedIdentity {
  const headerName = options.identityHeader ?? 'x-cogmem-identity';
  const fromRequest = parseSessionIdentity(extra?.requestInfo?.headers?.[headerName.toLowerCase()]);
  const fromSession = options.identityForSession?.(extra?.sessionId);
  const identity = mergeIdentity(fromSession, fromRequest) ?? {};
  const boundProjectId = options.projectId ?? fromSession?.projectId;
  return { identity, boundProjectId };
}

/**
 * Apply the identity to the server options, enforcing the security boundary:
 * the configured profile is a ceiling unless the request is trusted, and a
 * project binding may not be silently overridden.
 */
function applyIdentity(
  baseOptions: CogmemMcpServerOptions,
  resolved: ResolvedIdentity,
  trusted: boolean,
): CogmemMcpServerOptions & { profile: McpToolProfile } {
  const { identity, boundProjectId } = resolved;
  const configured = baseOptions.profile ?? 'core';

  if (identity.projectId !== undefined && boundProjectId !== undefined && identity.projectId !== boundProjectId) {
    throw new IdentityError(
      `project_scope_violation: this connection is bound to project "${boundProjectId}" but the call asked for "${identity.projectId}".`,
    );
  }

  let profile = configured;
  if (identity.profile !== undefined) {
    let requested: McpToolProfile;
    try {
      requested = resolveProfile(identity.profile);
    } catch {
      throw new IdentityError(`unknown_tool_profile:${identity.profile}`);
    }
    profile = trusted || PROFILE_RANK[requested] <= PROFILE_RANK[configured] ? requested : configured;
  }

  return {
    ...baseOptions,
    profile,
    hostId: identity.hostId ?? baseOptions.hostId,
    projectId: identity.projectId ?? boundProjectId ?? baseOptions.projectId,
  };
}

export function createCogmemMcpServer(
  runtime: CogmemMcpRuntime = {},
  options: CogmemMcpServerOptions = {},
): Server {
  const server = new Server(
    {
      name: options.hostId ? `cogmem-${options.hostId}` : 'cogmem-core',
      version: CORE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: buildMcpInstructions(options.profile ?? DEFAULT_TOOL_PROFILE),
    },
  );

  // A request is trusted when the transport authenticated it (a bearer token was
  // configured and presented), so only then may an identity header widen the
  // profile the server was started with.
  const trusted = options.identityTrusted === true;

  function identityResult(
    extra: { sessionId?: string; requestInfo?: { headers?: Record<string, string | string[] | undefined> } } | undefined,
  ): { effective: CogmemMcpServerOptions & { profile: McpToolProfile } } | { error: string } {
    try {
      return { effective: applyIdentity(options, resolveRequestIdentity(extra, options), trusted) };
    } catch (error) {
      if (error instanceof IdentityError) return { error: error.code };
      throw error;
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra): Promise<ListToolsResult> => {
    const resolved = identityResult(extra);
    if ('error' in resolved) throw new Error(resolved.error);
    return {
      tools: filterToolsByProfile(resolved.effective.profile, listCogmemMcpTools()),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const resolved = identityResult(extra);
    if ('error' in resolved) {
      return {
        isError: true,
        content: [{ type: 'text', text: resolved.error }],
      };
    }
    const effectiveOptions = resolved.effective;

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

    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
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
    const sessionRuntime: CogmemMcpRuntime = {
      ...runtime,
      hostId: effectiveOptions.hostId ?? runtime.hostId,
    };

    const result = await callCogmemMcpTool(request.params.name, args, sessionRuntime);
    return result as CallToolResult;
  });

  return server;
}

export interface CogmemMcpStdioHandle {
  server: Server;
  stop(): void;
}

export async function startCogmemMcpServer(
  runtime: CogmemMcpRuntime = {},
  options: CogmemMcpServerOptions = {},
): Promise<CogmemMcpStdioHandle> {
  // Resolve kernel upfront (single writer per process, like HTTP server)
  const kernel = (() => {
    if (runtime.kernel) return runtime.kernel;
    if (runtime.dbPath) return createMemoryKernel({ dbPath: runtime.dbPath });
    return createMemoryKernelFromConfig({
      configPath: runtime.configPath,
      cwd: runtime.cwd,
    });
  })();

  const sharedRuntime: CogmemMcpRuntime = {
    ...runtime,
    kernel,
    hostId: options.hostId ?? runtime.hostId,
    shared: runtime.shared ?? new SqliteSharedMemory(kernel.eventStore.getDatabase()),
  };

  const server = createCogmemMcpServer(sharedRuntime, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    server,
    stop() {
      transport.close();
      // Close kernel if we created it (not injected by caller)
      if (!runtime.kernel) kernel.close();
    },
  };
}

export { resolveProfile };