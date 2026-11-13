/**
 * The installer's whole user interface: lines in, lines out. No TUI framework, no full-screen
 * wizard — the flow is six steps and a human at a terminal, and a script can drive the same prompts
 * through a pipe.
 *
 * One buffered line source, not a fresh readline per question: a pipe delivers several answers in one
 * chunk, and a reader that is torn down between questions drops the answers it already buffered
 * (measured: the install hung at the third prompt of a scripted run). The key enters through
 * `askSecret`, which reads a masked line on a terminal and never echoes on a pipe.
 */
export interface AskOptions {
  default?: string;
  choices?: string[];
}

export interface InstallIO {
  readonly tty: boolean;
  say(line?: string): void;
  ask(prompt: string, options?: AskOptions): Promise<string>;
  askSecret(prompt: string): Promise<string>;
  close(): void;
}

export interface TerminalStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/** Every line the stream has produced, handed out in order; extra lines wait instead of being lost. */
class LineSource {
  private buffer = '';
  private readonly ready: string[] = [];
  private readonly pending: Array<(line: string | null) => void> = [];
  private ended = false;

  constructor(private readonly input: NodeJS.ReadableStream) {
    input.on('data', (chunk: Buffer | string) => this.feed(chunk.toString('utf8')));
    input.on('end', () => {
      this.ended = true;
      if (this.buffer.length > 0) {
        this.ready.push(this.buffer);
        this.buffer = '';
      }
      this.pump();
    });
    input.resume?.();
  }

  private feed(text: string): void {
    this.buffer += text;
    const terminator = /\r\n|\r|\n/u;
    let match = terminator.exec(this.buffer);
    while (match) {
      this.ready.push(this.buffer.slice(0, match.index));
      this.buffer = this.buffer.slice(match.index + match[0].length);
      match = terminator.exec(this.buffer);
    }
    this.pump();
  }

  private pump(): void {
    while (this.ready.length > 0 && this.pending.length > 0) {
      const resolve = this.pending.shift()!;
      resolve(this.ready.shift()!);
    }
    if (this.ended && this.ready.length === 0) {
      for (const resolve of this.pending.splice(0)) resolve(null);
    }
  }

  next(): Promise<string | null> {
    if (this.ready.length > 0) return Promise.resolve(this.ready.shift()!);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => this.pending.push(resolve));
  }
}

/** Raw keystrokes on a terminal: no echo, backspace removes, escape sequences are ignored. */
function readMaskedLine(input: NodeJS.ReadStream, output: NodeJS.WritableStream, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    let value = '';
    let escape = false;
    const finish = (): void => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      for (const char of chunk.toString('utf8')) {
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') {
          output.write('\n');
          process.exit(130);
        }
        if (char === '\u001b') {
          escape = true;
          continue;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        value += char;
        output.write('*');
      }
    };
    input.on('data', onData);
  });
}

export function createTerminalIO(streams: TerminalStreams): InstallIO {
  const { input, output } = streams;
  const tty = Boolean((input as NodeJS.ReadStream).isTTY);
  let source: LineSource | undefined;

  return {
    tty,
    say(line = '') {
      output.write(`${line}\n`);
    },
    ask(prompt, options = {}) {
      const suffix = options.choices?.length ? ` [${options.choices.join('/')}]` : options.default !== undefined ? ` [${options.default}]` : '';
      output.write(`${prompt}${suffix} `);
      source ??= new LineSource(input);
      return source.next().then((line) => {
        const trimmed = (line ?? '').trim();
        return trimmed !== '' ? trimmed : options.default ?? '';
      });
    },
    async askSecret(prompt) {
      if (!tty) {
        // A pipe echoes nothing by itself; read the line from the same source so nothing is lost.
        source ??= new LineSource(input);
        return (await source.next())?.trim() ?? '';
      }
      return readMaskedLine(input as NodeJS.ReadStream, output, prompt);
    },
    close() {},
  };
}

/** A scripted terminal: every answer is fixed, every line is captured. Tests and CI drive this. */
export function createScriptedIO(answers: string[], options: { tty?: boolean } = {}): InstallIO & { lines: string[] } {
  const lines: string[] = [];
  let index = 0;
  const next = (prompt: string, secret: boolean): string => {
    const value = answers[index] ?? '';
    index += 1;
    lines.push(secret ? `${prompt} -> （钥匙已安全输入，未回显）` : `${prompt} -> ${value}`);
    return value;
  };
  return {
    lines,
    tty: options.tty ?? false,
    say(line = '') {
      lines.push(line);
    },
    async ask(prompt, askOptions = {}) {
      const value = next(prompt, false);
      return value !== '' ? value : askOptions.default ?? '';
    },
    async askSecret(prompt) {
      return next(prompt, true);
    },
    close() {},
  };
}
