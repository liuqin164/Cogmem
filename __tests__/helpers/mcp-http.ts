import { expect } from 'bun:test';

/**
 * The Streamable-HTTP test client.
 *
 * Four MCP transport tests had grown their own copy of this — `parseRpcBody`
 * byte-for-byte identical in all of them. Each still owns its `startServer`,
 * because what a server is configured with is the thing under test; the wire
 * format is not.
 */

export const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'cogmem-test', version: '1.0.0' },
  },
};

export function parseRpcBody(contentType: string | null, body: string): any {
  if (contentType?.includes('text/event-stream')) {
    const dataLines = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (dataLines.length === 0) throw new Error(`empty_sse:${body.slice(0, 120)}`);
    return JSON.parse(dataLines[dataLines.length - 1]);
  }
  return JSON.parse(body);
}

export interface RpcOptions {
  sessionId?: string;
  token?: string;
  /** Sent as the `x-cogmem-identity` header when present. */
  identity?: Record<string, string>;
  extraHeaders?: Record<string, string>;
}

export async function rpc(url: string, payload: unknown, options: RpcOptions = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.identity ? { 'x-cogmem-identity': JSON.stringify(options.identity) } : {}),
      ...(options.extraHeaders ?? {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    sessionId: response.headers.get('mcp-session-id') ?? undefined,
    json: response.ok ? parseRpcBody(response.headers.get('content-type'), text) : null,
    text,
  };
}

/** Opens a session and fails loudly if the server refused it. */
export async function connect(url: string, options: RpcOptions = {}): Promise<string> {
  const init = await rpc(url, initializeRequest, options);
  expect(init.status).toBe(200);
  expect(init.sessionId).toBeTruthy();
  return init.sessionId as string;
}

export async function callTool(url: string, sessionId: string, name: string, args: object, options: RpcOptions = {}) {
  const response = await rpc(
    url,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    { sessionId, ...options },
  );
  const result = response.json?.result;
  const text = result?.content?.[0]?.text ?? response.text;
  return {
    status: response.status,
    isError: result?.isError === true,
    body: text.startsWith('{') ? JSON.parse(text) : text,
    raw: text,
  };
}
