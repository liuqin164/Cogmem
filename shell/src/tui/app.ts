/**
 * The interactive TUI process: raw stdin, a diffing writer, and the key handling that turns both
 * into editing and sending.
 *
 * Everything that decides *what* is shown lives in `view`/`layout`; this file only decides *when* to
 * redraw and which keystroke means what. It holds the terminal for as long as it runs, so every exit
 * path — clean, Ctrl+C, or a crash — restores it.
 */
import type { ReadStream, WriteStream } from 'node:tty';
import { AttachClient } from '../attach/client.ts';
import type { AttachServerMessage, AttachSnapshot } from '../attach/server.ts';
import { DiffRenderer, defaultRenderEnv, type RenderEnv } from './frame.ts';
import { LineEditor, loadHistory, saveHistory } from './editor.ts';
import { KeyDecoder, type Key } from './keys.ts';
import { inputCursorPosition, renderTui, TranscriptCache, type TuiSize } from './layout.ts';
import { dispatchTuiCommand, filterCommands, paletteCommands } from './commands.ts';
import { TuiView, type ShellEvent } from './view.ts';

export interface TuiAppOptions {
  socketPath: string;
  input?: ReadStream;
  output?: WriteStream;
  env?: NodeJS.ProcessEnv;
  historyPath?: string;
  /** Injectable for tests: returns a client already connected, with its attach snapshot. */
  connect?: (path: string) => Promise<{ client: AttachClient; snapshot: AttachSnapshot }>;
  onExit?: (reason: string) => void;
}

export class TuiApp {
  private readonly view = new TuiView();
  private editor!: LineEditor;
  private decoder = new KeyDecoder();
  private renderer!: DiffRenderer;
  private cache!: TranscriptCache;
  private client!: AttachClient;
  private renderEnv!: RenderEnv;
  private renderTimer?: ReturnType<typeof setInterval>;
  private pendingRender = false;
  private detachArmed = false;
  private escapeTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private cursorWritten = false;

  constructor(private readonly options: TuiAppOptions) {}

  async start(): Promise<void> {
    const input = this.options.input ?? (process.stdin as unknown as ReadStream);
    const output = this.options.output ?? (process.stdout as unknown as WriteStream);
    this.renderEnv = defaultRenderEnv(this.options.env ?? process.env);
    this.editor = new LineEditor(this.options.historyPath ? loadHistory(this.options.historyPath) : []);
    this.renderer = new DiffRenderer((chunk) => output.write(chunk), this.renderEnv);
    this.cache = new TranscriptCache(this.renderEnv);

    const { client, snapshot } = this.options.connect
      ? await this.options.connect(this.options.socketPath)
      : await connectDefault(this.options.socketPath);
    this.client = client;
    this.view.load(snapshot);
    client.onEvent = (message) => this.onServerMessage(message);
    client.onClose = (reason) => this.stop(`attach_lost:${reason}`);

    enterTerminal(input, output);
    input.on('data', (chunk: string | Buffer) => this.onInput(chunk.toString()));
    output.on('resize', () => this.scheduleRender());
    this.renderTimer = setInterval(() => this.scheduleRender(), 500);
    this.render();

    process.once('exit', () => this.restoreTerminal());
  }

  private onServerMessage(message: AttachServerMessage): void {
    if (message.t === 'event') {
      this.view.applyEvent({ name: message.name, payload: message.payload, ctx: message.ctx } as ShellEvent);
      this.scheduleRender();
      return;
    }
    if (message.t === 'bye') this.stop(`resident:${message.reason}`);
  }

  private onInput(chunk: string): void {
    const { stripped, wheel } = extractWheel(chunk);
    if (wheel !== 0) {
      this.view.scrollBy(wheel * 3);
      this.scheduleRender();
    }
    for (const key of this.decoder.push(stripped)) this.handleKey(key);
    // Esc is one byte with no terminator; give a sequence a moment to arrive, then deliver it.
    if (this.decoder.pendingEscape) {
      if (this.escapeTimer) clearTimeout(this.escapeTimer);
      this.escapeTimer = setTimeout(() => {
        this.escapeTimer = undefined;
        for (const key of this.decoder.flush()) this.handleKey(key);
      }, 40);
    }
  }

  private handleKey(key: Key): void {
    if (key.name === 'ctrl' && key.text === 'c') {
      if (this.detachArmed) {
        this.stop('ctrl_c');
        return;
      }
      this.detachArmed = true;
      this.view.push({ kind: 'notice', id: `detach-${Date.now()}`, text: '再按一次 Ctrl+C 断开附着（常驻进程继续）。', tone: 'warn' });
      this.scheduleRender();
      return;
    }
    this.detachArmed = false;

    // The sleep screen promises any key wakes it. `wake` is a submit with no text, so the resident
    // takes the existing DREAMING -> WAKING edge; the key itself is swallowed, not typed.
    if (this.view.lifecycle === 'DREAMING') {
      this.client.send({ t: 'wake' });
      this.view.applyEvent({ name: 'companion_transition', payload: { state: 'WAKING' } });
      this.scheduleRender();
      return;
    }

    const palette = this.paletteOpen();
    // A pending proposal is the actionable element: Enter runs it, Esc retires it. Both keys act on
    // the selected proposal, or on the newest pending one when nothing is selected.
    const pendingProposal = this.editor.isEmpty() ? this.view.pendingProposal() : undefined;
    if (key.name === 'esc') {
      if (this.view.overlay) this.view.overlay = undefined;
      else if (palette) this.editor.setText('');
      else if (pendingProposal) this.client.send({ t: 'command-discard', id: pendingProposal.proposal.id });
      else if (this.view.queued.length > 0) {
        this.client.send({ t: 'withdraw' });
        this.view.queued = this.view.queued.slice(0, -1);
      }
      this.scheduleRender();
      return;
    }
    if (key.name === 'pageup') {
      this.view.scrollBy(10);
      this.scheduleRender();
      return;
    }
    if (key.name === 'pagedown') {
      this.view.scrollBy(-10);
      this.scheduleRender();
      return;
    }
    if (palette && (key.name === 'up' || key.name === 'down')) {
      const matches = filterCommands(this.editor.text, paletteCommands(this.view));
      const count = Math.max(1, matches.length);
      this.view.paletteIndex = (this.view.paletteIndex + (key.name === 'down' ? 1 : count - 1)) % count;
      this.scheduleRender();
      return;
    }
    if (palette && key.name === 'tab') {
      const matches = filterCommands(this.editor.text, paletteCommands(this.view));
      const command = matches[this.view.paletteIndex] ?? matches[0];
      if (command) this.editor.setText(`/${command.name} `);
      this.scheduleRender();
      return;
    }
    if (key.name === 'enter') {
      if (palette) {
        const matches = filterCommands(this.editor.text, paletteCommands(this.view));
        const command = matches[this.view.paletteIndex] ?? matches[0];
        if (command) this.runCommand(`/${command.name}`);
        return;
      }
      if (!this.editor.isEmpty()) {
        this.submit();
        return;
      }
      if (pendingProposal) {
        this.client.send({ t: 'command-confirm', id: pendingProposal.proposal.id });
        this.scheduleRender();
        return;
      }
      this.view.toggleSelected();
      this.scheduleRender();
      return;
    }
    if ((key.name === 'up' || key.name === 'down') && this.editor.isEmpty() && !this.view.overlay) {
      this.view.moveSelection(key.name === 'up' ? -1 : 1);
      this.followIfAtBottom();
      this.scheduleRender();
      return;
    }
    if (this.editor.applyKey(key)) {
      this.view.paletteIndex = 0;
      this.scheduleRender();
    }
  }

  private followIfAtBottom(): void {
    if (this.view.scrollTop <= 0) this.view.followTail();
  }

  private paletteOpen(): boolean {
    return this.editor.text.startsWith('/') && !/\s/u.test(this.editor.text) && !this.view.overlay;
  }

  private submit(): void {
    const text = this.editor.submit();
    if (text === undefined) return;
    const history = this.editor.historyList();
    if (this.options.historyPath) saveHistory(this.options.historyPath, history);
    if (text.startsWith('/')) {
      this.runCommand(text);
      return;
    }
    // A line sent while it is working is a steer; the queue bar shows it immediately and the server
    // confirms with the authoritative pending list.
    if (this.view.lifecycle === 'RUNNING') this.view.queued = [...this.view.queued, text];
    this.client.send({ t: 'submit', text });
    this.scheduleRender();
  }

  private runCommand(text: string): void {
    const [name = '', ...rest] = text.slice(1).trim().split(/\s+/u);
    const args = rest.join(' ');
    this.editor.setText('');
    // One decision function for every `/name`: which overlay it opens, whether the resident answers,
    // and — for a name no face owns — the same receipt the terminal and the resident give.
    const dispatch = dispatchTuiCommand(name, args, this.view);
    if (dispatch.exit) {
      this.stop('exit');
      return;
    }
    if (dispatch.unknown !== undefined) {
      this.view.push({ kind: 'receipt', id: `receipt-${name}-${Date.now()}`, text: dispatch.unknown });
      this.scheduleRender();
      return;
    }
    if (dispatch.overlay) this.view.overlay = dispatch.overlay;
    if (dispatch.notice) this.view.push({ kind: 'notice', id: `notice-${name}-${Date.now()}`, text: dispatch.notice, tone: 'info' });
    if (dispatch.forward) this.client.send({ t: 'command', name, args });
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.pendingRender || this.stopped) return;
    this.pendingRender = true;
    setImmediate(() => {
      this.pendingRender = false;
      if (!this.stopped) this.render();
    });
  }

  private size(): TuiSize {
    const output = (this.options.output ?? process.stdout) as WriteStream;
    return { width: output.columns ?? 80, height: output.rows ?? 24 };
  }

  render(): void {
    const output = this.options.output ?? (process.stdout as unknown as WriteStream);
    const size = this.size();
    const frame = renderTui(this.view, this.editor, size, this.renderEnv, this.cache);
    this.renderer.render(frame);
    const position = inputCursorPosition(this.view, this.editor, size);
    if (position) {
      output.write(`\u001b[?25h\u001b[${position.row};${position.column}H`);
      this.cursorWritten = true;
    }
  }

  stop(reason: string): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.renderTimer) clearInterval(this.renderTimer);
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    try {
      if (this.options.historyPath) saveHistory(this.options.historyPath, this.editor.historyList());
    } catch {
      // History is a convenience; losing it must not block the exit.
    }
    this.client?.close();
    this.restoreTerminal();
    this.options.onExit?.(reason);
  }

  private restoreTerminal(): void {
    if (!this.cursorWritten) return;
    this.cursorWritten = false;
    const output = this.options.output ?? (process.stdout as unknown as WriteStream);
    const input = this.options.input ?? (process.stdin as unknown as ReadStream);
    try {
      output.write('\u001b[?1000l\u001b[?1006l\u001b[?1049l\u001b[?25h\r\n');
      (input as unknown as { setRawMode?(mode: boolean): void }).setRawMode?.(false);
      input.pause();
    } catch {
      // A terminal that cannot be restored is already gone.
    }
  }
}

async function connectDefault(path: string): Promise<{ client: AttachClient; snapshot: AttachSnapshot }> {
  const client = new AttachClient();
  const snapshot = await client.connect(path);
  return { client, snapshot };
}

function enterTerminal(input: ReadStream, output: WriteStream): void {
  output.write('\u001b[?1049h\u001b[?25l\u001b[?1000h\u001b[?1006h');
  (input as unknown as { setRawMode?(mode: boolean): void }).setRawMode?.(true);
  input.resume();
}

/** SGR mouse: button 64 is wheel-up, 65 wheel-down. Returns the chunk with those sequences removed. */
export function extractWheel(chunk: string): { stripped: string; wheel: number } {
  let wheel = 0;
  const stripped = chunk.replace(/\u001b\[<(\d+);(\d+);(\d+)([Mm])/gu, (_match, button: string) => {
    const code = Number(button) & 0b11000011;
    if (code === 64) wheel += 1;
    if (code === 65) wheel -= 1;
    return '';
  });
  return { stripped, wheel };
}
