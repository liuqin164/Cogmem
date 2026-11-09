import { spawn } from 'node:child_process';

/**
 * The result of running the entry a host will run, rather than reading the file that
 * names it.
 *
 * `installed` and `verified` are different claims, and only one of them is checkable by
 * writing a file: #86, #94 and #96 were all cases where `connect` reported success and
 * the command it wrote could not start — a bare name Hermes could not resolve, an
 * absolute path whose prefix had been removed, a config the server never found. The file
 * was there every time.
 */
export interface McpEntryVerification {
  ok: boolean;
  /** What was actually done, so a reader can weigh the claim. */
  how: 'mcp_handshake' | 'plugin_files_and_config_entry' | 'plugin_files_and_config_entry_and_agent_identity';
  detail: string;
  tools?: number;
}

/**
 * What one Cogmem server entry says it is, asked over the protocol its host speaks.
 *
 * The per-agent wiring (#148) is only worth having if the entry really runs as its agent:
 * a config that names `--host bot-a` and a server that answers as somebody else is the
 * silent merge the wiring exists to prevent, and reading the file would never show it.
 */
export interface McpIdentityVerification {
  ok: boolean;
  expectedAgentId: string;
  /** The identity the server answered with, when it answered. */
  agentId?: string;
  projectId?: string;
  detail: string;
}

/**
 * Start the entry and ask it what it serves, over the same stdio protocol a host uses.
 *
 * Deliberately the real thing: the written command, its written arguments, a real
 * `initialize` and a real `tools/list`. A server that cannot find its config exits
 * before answering, which is exactly the failure this is here to catch.
 */
export async function verifyMcpEntry(
  entry: { command: string; args: string[] },
  options: { env?: Record<string, string | undefined>; timeoutMs?: number } = {},
): Promise<McpEntryVerification> {
  const timeoutMs = options.timeoutMs ?? 5000;
  return converseWithMcpEntry<McpEntryVerification>(
    entry,
    { env: options.env, timeoutMs },
    [initializeRequest(), initializedNotification(), { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }],
    (message) => {
      const result = answerTo(message, 2);
      const tools = result?.tools;
      return Array.isArray(tools)
        ? { ok: true, how: 'mcp_handshake', detail: `answered tools/list with ${tools.length} tool(s)`, tools: tools.length }
        : undefined;
    },
    (reason) => ({ ok: false, how: 'mcp_handshake', detail: reason }),
  );
}

/**
 * Ask one written entry to recall, and read the identity it answers with.
 *
 * This is the ticket's self-check (#148) for the half the config cannot show: each agent's
 * own entry must report its own `agentId`. A query nothing matches still answers —
 * `no_match` or `scope_filtered` — and the identity in that answer is the fact being
 * checked, so the probe writes nothing.
 */
export async function verifyMcpEntryIdentity(
  entry: { command: string; args: string[] },
  options: { expectedAgentId: string; query?: string; env?: Record<string, string | undefined>; timeoutMs?: number },
): Promise<McpIdentityVerification> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const expectedAgentId = options.expectedAgentId;
  return converseWithMcpEntry<McpIdentityVerification>(
    entry,
    { env: options.env, timeoutMs },
    [
      initializeRequest(),
      initializedNotification(),
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'cogmem_recall',
          arguments: { query: options.query ?? 'cogmem identity self-check', limit: 1 },
        },
      },
    ],
    (message) => {
      if (!isRecord(message) || message.id !== 2) return undefined;
      if (message.error !== undefined) {
        return { ok: false, expectedAgentId, detail: `cogmem_recall was refused: ${describe(message.error)}` };
      }
      const result = resultOf(message);
      if (!result) return undefined;
      const payload = structuredPayload(result);
      const agentId = typeof payload?.agentId === 'string' ? payload.agentId : undefined;
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId : undefined;
      if (!agentId) {
        return {
          ok: false,
          expectedAgentId,
          projectId,
          detail: `cogmem_recall answered without an agentId: ${describe(payload?.warnings ?? payload ?? result)}`,
        };
      }
      return {
        ok: agentId === expectedAgentId,
        expectedAgentId,
        agentId,
        projectId,
        detail: agentId === expectedAgentId
          ? `cogmem_recall through this entry answered as agentId=${agentId}${projectId ? ` projectId=${projectId}` : ''}`
          : `cogmem_recall through this entry answered as agentId=${agentId}, not ${expectedAgentId}`,
      };
    },
    (reason) => ({ ok: false, expectedAgentId, detail: reason }),
  );
}

function initializeRequest(): unknown {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cogmem-connect', version: '1' } },
  };
}

function initializedNotification(): unknown {
  return { jsonrpc: '2.0', method: 'notifications/initialized' };
}

/**
 * Speak newline-delimited JSON-RPC to a stdio MCP server until the caller recognizes an
 * answer, or the process dies.
 *
 * One implementation for both checks above, because "the entry a host runs, started the
 * way the host starts it" is the point of each: a second copy of the spawn, the timeout
 * and the error handling would be a second place for those to drift apart.
 */
function converseWithMcpEntry<T>(
  entry: { command: string; args: string[] },
  options: { env?: Record<string, string | undefined>; timeoutMs: number },
  requests: unknown[],
  readAnswer: (message: unknown) => T | undefined,
  onNoAnswer: (reason: string) => T,
): Promise<T> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(entry.command, entry.args, {
        env: (options.env ?? process.env) as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve(onNoAnswer(`could not start ${entry.command}: ${message(error)}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    const finish = (result: T): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // A process that already exited is the normal case.
      }
      resolve(result);
    };
    const timer = setTimeout(
      () => finish(onNoAnswer(`no answer within ${options.timeoutMs}ms${firstLine(stderr)}`)),
      options.timeoutMs,
    );

    child.on('error', (error) => finish(onNoAnswer(`could not start ${entry.command}: ${message(error)}`)));
    child.on('exit', (code) => finish(onNoAnswer(`exited with code ${code} before answering${firstLine(stderr)}`)));
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      for (const line of stdout.split('\n')) {
        if (!line.includes('"result"') && !line.includes('"error"')) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          // A partial line arrives before the newline does; the next chunk completes it.
          continue;
        }
        const answer = readAnswer(parsed);
        if (answer !== undefined) {
          finish(answer);
          return;
        }
      }
    });

    const send = (payload: unknown): void => {
      try {
        child.stdin?.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        finish(onNoAnswer(`could not write to ${entry.command}: ${message(error)}`));
      }
    };
    for (const request of requests) send(request);
  });
}

function resultOf(message: unknown): Record<string, unknown> | undefined {
  if (!isRecord(message)) return undefined;
  return isRecord(message.result) ? message.result : undefined;
}

/**
 * The reply to one of our requests, and only that one.
 *
 * The `initialize` reply carries a `result` too, so "some result arrived" is not "the
 * answer arrived": matching the id is what keeps a capability handshake from being read as
 * a recall that reported no identity.
 */
function answerTo(message: unknown, id: number): Record<string, unknown> | undefined {
  if (!isRecord(message) || message.id !== id) return undefined;
  return resultOf(message);
}

/**
 * The recall answer, as the server structured it.
 *
 * `structuredContent` is the payload itself; the text block carries the same JSON for
 * clients that only read `content`. Either is enough, and a server that sends neither is
 * not reporting an identity.
 */
function structuredPayload(result: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const content = result.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (!isRecord(block) || typeof block.text !== 'string') continue;
    try {
      const parsed = JSON.parse(block.text) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Not JSON: this block is prose, not the structured answer.
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0]?.trim();
  return line ? `: ${line}` : '';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
