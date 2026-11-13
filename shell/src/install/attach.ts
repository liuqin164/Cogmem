/**
 * The installer's window into a *running* resident: the shell's own attach control socket.
 *
 * The first-wake probe goes through the resident rather than opening a second kernel, because one
 * database has one writer (CONCURRENT_ACCESS.md) — the resident holds that writer, and asking it to
 * remember and to recall is what keeps that true. This is not a second outward face: the socket is
 * loopback-only, mode `0600`, and already the channel `cog` speaks. (Before #200 R2 the probe spoke
 * the shell's MCP endpoint; that endpoint is gone and this one request/reply pair replaced it.)
 */
import { connect, type Socket } from 'node:net';

export interface ProbeReply {
  ok: boolean;
  text: string;
}

export interface ProbeSession {
  /** `turnId` is the probe's token: a replay of one attempt answers instead of writing again. */
  remember(text: string, turnId?: string): Promise<ProbeReply>;
  recall(query: string): Promise<ProbeReply>;
  close(): void;
}

/**
 * Connect and lease a probe session. The resident answers the connection with its snapshot on
 * purpose (the TUI reads it first), and building that snapshot consumes the away queue — empty at
 * install time, which is the only time this client runs. The probe ignores everything that is not
 * its own reply and matches by message type, not by position.
 */
export async function openProbeSession(socketPath: string, timeoutMs = 10_000): Promise<ProbeSession> {
  const socket = await connectWithRetry(socketPath, timeoutMs);
  const pending: Array<{ resolve: (reply: ProbeReply) => void; reject: (error: Error) => void }> = [];
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() === '') continue;
      let message: { t?: string; ok?: unknown; text?: unknown };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue; // A malformed line is not this client's to fix; it is not a probe reply either.
      }
      if (message.t !== 'probe') continue;
      pending.shift()?.resolve({ ok: message.ok === true, text: String(message.text ?? '') });
    }
  });
  // A resident that dies mid-probe must fail this request, not take the installer down with an
  // unhandled socket error.
  const fail = (error: Error) => {
    for (const entry of pending.splice(0)) entry.reject(error);
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error(`attach_probe_closed: ${socketPath}`)));

  const request = (message: Record<string, unknown>): Promise<ProbeReply> =>
    new Promise<ProbeReply>((resolvePromise, rejectPromise) => {
      const reject = (error: Error) => {
        clearTimeout(timer);
        rejectPromise(error);
      };
      const timer = setTimeout(() => {
        const index = pending.findIndex((entry) => entry.reject === reject);
        if (index >= 0) pending.splice(index, 1);
        reject(new Error(`attach_probe_timeout: ${socketPath}`));
      }, timeoutMs);
      pending.push({ resolve: (reply) => { clearTimeout(timer); resolvePromise(reply); }, reject });
      socket.write(`${JSON.stringify(message)}\n`);
    });

  return {
    remember: (text, turnId) => request({ t: 'probe-remember', text, ...(turnId ? { turnId } : {}) }),
    recall: (query) => request({ t: 'probe-recall', query }),
    close: () => {
      socket.destroy();
    },
  };
}

/** The socket file appears when the resident binds it; right after a restart it is a moment late. */
async function connectWithRetry(socketPath: string, timeoutMs: number): Promise<Socket> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await new Promise<Socket>((resolvePromise, rejectPromise) => {
        const socket = connect(socketPath);
        socket.once('connect', () => resolvePromise(socket));
        socket.once('error', rejectPromise);
      });
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    }
  }
}
