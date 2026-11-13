/**
 * The view-side half of `cog`: connect to the resident's control socket, take the attach snapshot,
 * then stream events until the user closes the window.
 *
 * Deliberately not a supervisor. It never restarts the resident, never writes memory and never
 * throws into the render loop — when the socket dies the TUI says so and exits, which is the whole
 * promise of not taking the resident down with it.
 */
import { connect, type Socket } from 'node:net';
import type { AttachClientMessage, AttachServerMessage, AttachSnapshot } from './server.ts';

export class AttachClient {
  private socket?: Socket;
  private buffer = '';
  private snapshotResolve?: (snapshot: AttachSnapshot) => void;
  private snapshotReject?: (error: Error) => void;
  private closed = false;

  onEvent: (message: AttachServerMessage) => void = () => {};
  onClose: (reason: string) => void = () => {};

  /** Resolves with the first message, which the protocol requires to be the snapshot. */
  connect(path: string, timeoutMs = 5_000): Promise<AttachSnapshot> {
    return new Promise<AttachSnapshot>((resolvePromise, rejectPromise) => {
      this.snapshotResolve = resolvePromise;
      this.snapshotReject = rejectPromise;
      const timer = setTimeout(() => {
        this.fail(new Error(`attach_connect_timeout: ${path}`));
      }, timeoutMs);
      this.socket = connect(path);
      this.socket.setEncoding('utf8');
      this.socket.on('connect', () => clearTimeout(timer));
      this.socket.on('data', (chunk: string) => this.onData(chunk));
      this.socket.on('error', (error) => {
        clearTimeout(timer);
        this.fail(error);
      });
      this.socket.on('close', () => {
        this.closed = true;
        this.onClose('socket_closed');
      });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim() === '') continue;
      let message: AttachServerMessage;
      try {
        message = JSON.parse(line) as AttachServerMessage;
      } catch {
        continue; // A malformed line is the resident's bug; dropping it must not kill the view.
      }
      if (message.t === 'snapshot' && this.snapshotResolve) {
        const resolvePromise = this.snapshotResolve;
        this.snapshotResolve = undefined;
        this.snapshotReject = undefined;
        resolvePromise(message);
      } else {
        this.onEvent(message);
      }
    }
  }

  private fail(error: Error): void {
    if (this.snapshotReject) {
      const rejectPromise = this.snapshotReject;
      this.snapshotReject = undefined;
      this.snapshotResolve = undefined;
      rejectPromise(error);
      return;
    }
    if (!this.closed) {
      this.closed = true;
      this.onClose(error.message);
    }
  }

  send(message: AttachClientMessage): void {
    if (!this.socket || this.socket.destroyed) return;
    try {
      this.socket.write(`${JSON.stringify(message)}\n`);
    } catch {
      // The close handler reports the loss; a write failure here is not a second report.
    }
  }

  close(): void {
    if (!this.socket) return;
    this.closed = true;
    try {
      this.socket.end();
      this.socket.destroy();
    } catch {
      // Already gone.
    }
    this.socket = undefined;
  }

  get isOpen(): boolean {
    return this.socket !== undefined && !this.socket.destroyed;
  }
}
