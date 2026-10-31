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
  how: 'mcp_handshake';
  detail: string;
  tools?: number;
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
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(entry.command, entry.args, {
        env: (options.env ?? process.env) as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ ok: false, how: 'mcp_handshake', detail: `could not start ${entry.command}: ${message(error)}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    const finish = (result: McpEntryVerification): void => {
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
      () => finish({ ok: false, how: 'mcp_handshake', detail: `no answer within ${timeoutMs}ms${firstLine(stderr)}` }),
      timeoutMs,
    );

    child.on('error', (error) => finish({ ok: false, how: 'mcp_handshake', detail: `could not start ${entry.command}: ${message(error)}` }));
    child.on('exit', (code) => finish({ ok: false, how: 'mcp_handshake', detail: `exited with code ${code} before answering${firstLine(stderr)}` }));
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      for (const line of stdout.split('\n')) {
        if (!line.includes('"tools"')) continue;
        try {
          const parsed = JSON.parse(line) as { result?: { tools?: unknown } };
          const tools = parsed.result?.tools;
          if (Array.isArray(tools)) {
            finish({ ok: true, how: 'mcp_handshake', detail: `answered tools/list with ${tools.length} tool(s)`, tools: tools.length });
          }
        } catch {
          // A partial line arrives before the newline does; the next chunk completes it.
        }
      }
    });

    // Newline-delimited JSON-RPC, which is what the MCP stdio transport speaks.
    const send = (payload: unknown): void => {
      try {
        child.stdin?.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        finish({ ok: false, how: 'mcp_handshake', detail: `could not write to ${entry.command}: ${message(error)}` });
      }
    };
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cogmem-connect', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  });
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0]?.trim();
  return line ? `: ${line}` : '';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
