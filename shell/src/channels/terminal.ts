/**
 * The terminal channel: the simplest self-owned way to talk to the shell. No external platform, no
 * OpenMaus, no bot token — a line in, a turn out, and `/name args` reaching the same dispatch the
 * TUI and the attach socket use (`CompanionShell.runCommand`: core table, then plugin registry,
 * then the shared unknown-command receipt).
 *
 * It is a channel plugin like any future platform channel: it injects the shell control surface and
 * knows nothing about the state machine's internals.
 */
import { createInterface, type Interface } from 'node:readline';
import type {
  ChannelContract,
  ChannelDelivery,
  ChannelSession,
  ChannelSurfacingInput,
} from 'cogmem';
import type { NativePlugin } from '../plugins/host.ts';
import type { TraceLog } from '../trace.ts';
import type { CommandReply } from '../commands.ts';

export interface ShellControl {
  submit(text: string): Promise<unknown>;
  readonly state: string;
  runCommand(name: string, args?: string): Promise<CommandReply>;
}

export interface TerminalChannelOptions {
  shell: ShellControl;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  trace?: TraceLog;
  captureTerminalRecord?: (text: string) => Promise<void>;
  /** F12's contract face; when present every line enters through `ingest` and every surfacing
   * leaves through `deliver`, so `silence` never prints. */
  contract?: ChannelContract;
  session?: ChannelSession;
  accountId?: string;
}

export class TerminalChannel {
  private reader?: Interface;

  constructor(private readonly options: TerminalChannelOptions) {}

  start(): void {
    const input = this.options.input ?? process.stdin;
    const output = this.options.output ?? process.stdout;
    if (this.options.contract && this.options.session) {
      this.options.contract.presence(this.options.session, { reachability: 'online', ownerActivity: 'active' });
    }
    this.options.trace?.append('terminal_channel_started', {
      channelId: this.options.session?.channelId,
      contractVersion: this.options.session?.contractVersion,
    });
    this.reader = createInterface({ input, output, terminal: false });
    this.reader.on('line', (line: string) => {
      void this.handleLine(line.trim()).catch((error) => {
        this.options.trace?.append('terminal_line_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        this.print(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      });
    });
  }

  async handleLine(line: string): Promise<void> {
    if (line.length === 0) return;
    if (this.options.contract && this.options.session) {
      const ingress = this.options.contract.ingest(this.options.session, {
        accountId: this.options.accountId ?? 'terminal-owner',
        text: line,
      });
      this.options.trace?.append('terminal_ingress', { trace: ingress.decisionTrace });
    }
    if (line.startsWith('/')) {
      const [rawName, ...rest] = line.slice(1).split(/\s+/u);
      const args = rest.join(' ');
      // One dispatch for every face: core table first, plugin registry second, and an unknown name
      // comes back as the shared receipt instead of a silent fall-through to the model.
      const result = await this.options.shell.runCommand(rawName, args);
      this.print(`${result.text}\n`);
      await this.options.captureTerminalRecord?.(`/${rawName} ${args}`);
      return;
    }
    await this.options.shell.submit(line);
  }

  /**
   * F12's surfacing face: `silence` and an offline channel are silenced by the contract, so the
   * channel prints only what was actually delivered.
   */
  deliverSurfacing(input: ChannelSurfacingInput): ChannelDelivery | undefined {
    const { contract, session } = this.options;
    if (!contract || !session) return undefined;
    const delivery = contract.deliver(session, input);
    this.options.trace?.append('terminal_surfacing', { trace: delivery.decisionTrace });
    if (delivery.outcome === 'delivered' && input.text) {
      this.print(input.strength === 'incidental' ? `（想起）${input.text}\n` : `${input.text}\n`);
    }
    return delivery;
  }

  print(text: string): void {
    (this.options.output ?? process.stdout).write(text);
  }

  stop(): void {
    if (this.options.contract && this.options.session) {
      this.options.contract.presence(this.options.session, { reachability: 'offline', ownerActivity: 'away' });
    }
    this.reader?.close();
    this.reader = undefined;
  }
}

export function terminalPlugin(options: TerminalChannelOptions): NativePlugin {
  return {
    name: 'terminal-channel',
    provide: ['terminal'],
    inject: ['shell'],
    apply(ctx) {
      const channel = new TerminalChannel({
        shell: ctx.getService<ShellControl>('shell'),
        input: options.input,
        output: options.output,
        trace: options.trace,
        captureTerminalRecord: options.captureTerminalRecord,
        contract: options.contract,
        session: options.session,
        accountId: options.accountId,
      });
      ctx.on('terminal_print', (event: { text?: string }) => {
        if (typeof event.text === 'string') channel.print(event.text);
      });
      ctx.on('terminal_surfacing', (event: { surfacing?: ChannelSurfacingInput }) => {
        if (event.surfacing) channel.deliverSurfacing(event.surfacing);
      });
      ctx.dispose(() => channel.stop());
      ctx.provide('terminal', channel);
    },
  };
}
