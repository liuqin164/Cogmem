/**
 * The resident-side half of `cog`: a control socket in the shell's data directory that streams the
 * shell's own event bus and accepts input.
 *
 * The TUI is a separate process on purpose. The spec's hard line is that a TUI crash must not touch
 * the resident, and the only way to make that true is to make the TUI killable — so nothing here
 * awaits a client, and a client that dies mid-write is dropped, never propagated.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EventBus } from '../bus.ts';
import type { TraceLog } from '../trace.ts';
import type { CommandReply } from '../commands.ts';
import type { CommandProposal } from '../proposals.ts';
import { TuiView, type PresenceReport, type StatusState, type TranscriptEntry, type WorkState } from '../tui/view.ts';

/** Every event the TUI consumes. One list, so a new event is forwarded by adding it here. */
export const TUI_EVENTS = [
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_end',
  'companion_transition',
  'companion_status',
  'companion_work',
  'companion_emergence',
  'companion_steering',
  'companion_degraded',
  'companion_commitments',
  'companion_dream',
  'companion_command_result',
  'companion_command_proposal',
  'companion_model_routes',
  'companion_snapshot_note',
] as const;

export interface AttachSnapshot {
  status: StatusState;
  entries: TranscriptEntry[];
  queued: string[];
  work: WorkState;
  presence?: PresenceReport;
  commitments: Array<{ candidateId: string; title: string; status: string; updatedAt: number }>;
  lastDream?: { localDate: string; eventCount: number; summary: string };
  modelRoutes: string[];
  /** The plugin half of the palette, which only the resident can enumerate (spec §7). */
  commands: Array<{ name: string; description?: string; argumentHint?: string }>;
  snapshotNote?: string;
}

export type AttachClientMessage =
  | { t: 'submit'; text: string }
  | { t: 'command'; name: string; args?: string }
  /** The user's answer to a command proposal (spec §7): Enter or Esc on the element. */
  | { t: 'command-confirm'; id: string }
  | { t: 'command-discard'; id: string }
  | { t: 'withdraw' }
  | { t: 'wake' }
  | { t: 'detach' }
  // The install's first-wake probe (#203): a deterministic write / recall the resident runs on its
  // own in-process kernel, because the installer is out of process and a second kernel on the same
  // file is the two-writer case CONCURRENT_ACCESS.md forbids. `turnId` is the probe's token, so a
  // replay of the same attempt is a replay instead of a second row.
  | { t: 'probe-remember'; text: string; turnId?: string }
  | { t: 'probe-recall'; query: string };

export type AttachServerMessage =
  | ({ t: 'snapshot' } & AttachSnapshot)
  | { t: 'event'; name: string; payload: any; ctx?: { runId?: string } }
  | { t: 'probe'; op: 'remember' | 'recall'; ok: boolean; text: string }
  | { t: 'bye'; reason: string };

/** What the server needs from the shell; `CompanionShell` implements it. */
export interface AttachShell {
  submit(text: string): Promise<unknown>;
  /** One dispatch for core and plugin commands alike; an unknown name answers with a receipt. */
  runCommand(name: string, args?: string): Promise<CommandReply>;
  /** The user's confirmation of a command proposal; the only path that runs one. */
  confirmProposal(id: string): Promise<{ ok: boolean; proposal?: CommandProposal; reason?: string }>;
  /** The user's discard of a command proposal; it is retired and never runs. */
  discardProposal(id: string): CommandProposal | undefined;
  withdrawSteering(): string | undefined;
  sleep(): Promise<void>;
  awayReport(): PresenceReport;
  currentStatus(): StatusState;
  currentWork(): WorkState;
  currentQueued(): string[];
  commitments(): Array<{ candidateId: string; title: string; status: string; updatedAt: number }>;
  modelRoutes(): string[];
  pluginCommands(): Array<{ name: string; description?: string; argumentHint?: string }>;
  snapshotNote(): string | undefined;
  /** Called when the attached-client count changes, so the shell can date its own absence. */
  attachChanged(count: number): void;
  probeRemember(text: string, turnId?: string): Promise<{ ok: boolean; text: string }>;
  probeRecall(query: string): Promise<{ ok: boolean; text: string }>;
}

export interface AttachServerOptions {
  socketPath: string;
  shell: AttachShell;
  bus: EventBus;
  trace?: TraceLog;
}

export class AttachServer {
  readonly path: string;
  readonly mirror = new TuiView();
  private server?: Server;
  private readonly clients = new Set<Socket>();
  private started = false;

  constructor(private readonly options: AttachServerOptions) {
    this.path = options.socketPath;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (existsSync(this.path)) rmSync(this.path, { force: true });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const server = createServer((socket) => this.onConnection(socket));
      server.on('error', rejectPromise);
      server.listen(this.path, () => {
        try {
          chmodSync(this.path, 0o600);
        } catch {
          // A socket whose mode cannot be tightened is still usable by this user; the trace names it.
          this.options.trace?.append('attach_chmod_failed', { path: this.path });
        }
        resolvePromise();
      });
      this.server = server;
    });
    for (const name of TUI_EVENTS) {
      this.options.bus.on(name, (payload: any, ctx: any) => {
        this.mirror.applyEvent({ name, payload, ctx });
        this.broadcast({ t: 'event', name, payload, ctx });
      });
    }
    this.started = true;
    this.options.trace?.append('attach_server_started', { path: this.path });
  }

  private onConnection(socket: Socket): void {
    this.clients.add(socket);
    this.options.trace?.append('attach_client_connected', { clients: this.clients.size });
    this.options.shell.attachChanged(this.clients.size);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.write(`${JSON.stringify({ t: 'snapshot', ...this.snapshot() })}\n`);
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline === -1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() !== '') void this.onMessage(socket, line);
      }
    });
    const drop = () => {
      if (!this.clients.delete(socket)) return;
      this.options.trace?.append('attach_client_disconnected', { clients: this.clients.size });
      this.options.shell.attachChanged(this.clients.size);
    };
    socket.on('close', drop);
    socket.on('error', drop);
  }

  private async onMessage(socket: Socket, line: string): Promise<void> {
    let message: AttachClientMessage;
    try {
      message = JSON.parse(line) as AttachClientMessage;
    } catch {
      this.send(socket, { t: 'bye', reason: 'malformed_message' });
      return;
    }
    try {
      await this.dispatch(socket, message);
    } catch (error) {
      // A failing client request is reported to that client and nowhere else: the resident must not
      // inherit a view's bad input.
      this.send(socket, { t: 'event', name: 'companion_degraded', payload: { reason: error instanceof Error ? error.message : String(error) } });
    }
  }

  private async dispatch(socket: Socket, message: AttachClientMessage): Promise<void> {
    switch (message.t) {
      case 'submit':
        await this.options.shell.submit(message.text);
        this.pushSteering();
        break;
      case 'command': {
        const result = await this.options.shell.runCommand(message.name, message.args ?? '');
        this.send(socket, { t: 'event', name: 'companion_command_result', payload: { name: message.name, text: result.text, receipt: result.receipt === true } });
        if (result.data) {
          for (const [name, payload] of Object.entries(result.data)) this.send(socket, { t: 'event', name, payload });
        }
        break;
      }
      case 'command-confirm': {
        // The shell emits the updated proposal on the bus (mirror included), so only a refusal needs
        // its own line: an accepted proposal's element already carries the command's receipt text.
        const result = await this.options.shell.confirmProposal(message.id);
        if (!result.ok) {
          this.send(socket, { t: 'event', name: 'companion_command_result', payload: { name: 'proposal', text: `提议未执行：${result.reason ?? 'unknown'}`, receipt: true } });
        }
        break;
      }
      case 'command-discard':
        this.options.shell.discardProposal(message.id);
        break;
      case 'withdraw': {
        const withdrawn = this.options.shell.withdrawSteering();
        this.pushSteering();
        if (withdrawn === undefined) this.send(socket, { t: 'event', name: 'companion_command_result', payload: { name: 'withdraw', text: '没有可撤回的排队消息。' } });
        break;
      }
      case 'wake':
        // A wake is a submit with no text: DREAMING -> WAKING is the legal message_received edge.
        await this.options.shell.submit('');
        break;
      case 'probe-remember': {
        const result = await this.options.shell.probeRemember(message.text, message.turnId);
        this.send(socket, { t: 'probe', op: 'remember', ok: result.ok, text: result.text });
        break;
      }
      case 'probe-recall': {
        const result = await this.options.shell.probeRecall(message.query);
        this.send(socket, { t: 'probe', op: 'recall', ok: result.ok, text: result.text });
        break;
      }
      case 'detach':
        this.send(socket, { t: 'bye', reason: 'detached' });
        socket.end();
        break;
      default:
        break;
    }
  }

  private pushSteering(): void {
    const queued = this.options.shell.currentQueued();
    this.mirror.applyEvent({ name: 'companion_steering', payload: { queued } });
    this.broadcast({ t: 'event', name: 'companion_steering', payload: { queued } });
  }

  snapshot(): AttachSnapshot {
    const presence = this.options.shell.awayReport();
    return {
      status: this.options.shell.currentStatus(),
      entries: this.mirror.entries.map((entry) => ({ ...entry })),
      queued: this.options.shell.currentQueued(),
      work: this.options.shell.currentWork(),
      presence,
      commitments: this.options.shell.commitments(),
      lastDream: this.mirror.lastDream,
      modelRoutes: this.options.shell.modelRoutes(),
      commands: this.options.shell.pluginCommands(),
      snapshotNote: this.options.shell.snapshotNote(),
    };
  }

  broadcast(message: AttachServerMessage): void {
    const line = `${JSON.stringify(message)}\n`;
    for (const socket of [...this.clients]) {
      try {
        socket.write(line);
      } catch {
        this.clients.delete(socket);
      }
    }
  }

  send(socket: Socket, message: AttachServerMessage): void {
    try {
      socket.write(`${JSON.stringify(message)}\n`);
    } catch {
      this.clients.delete(socket);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    for (const socket of [...this.clients]) socket.destroy();
    this.clients.clear();
    await new Promise<void>((resolvePromise) => this.server?.close(() => resolvePromise()) ?? resolvePromise());
    this.server = undefined;
    try {
      rmSync(this.path, { force: true });
    } catch {
      // A socket file left behind is reclaimed by the next start, which removes it first.
    }
    this.options.trace?.append('attach_server_stopped', { path: this.path });
  }
}

export function defaultSocketPath(dataDir: string): string {
  return join(dataDir, 'attach.sock');
}
