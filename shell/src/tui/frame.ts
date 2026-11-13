/**
 * The rendering primitive the whole TUI is built on: a frame is rows of styled segments, and the
 * only thing that ever touches ANSI is the serializer at the end.
 *
 * Keeping style as a name instead of an escape sequence is what makes `NO_COLOR` a serialization
 * choice rather than a second renderer, and what makes a layout snapshot a text comparison. Widths
 * are measured in terminal cells, not code points, because a CJK conversation in a column-counted
 * layout goes diagonal otherwise.
 */

export type StyleName =
  | 'plain'
  | 'dim'
  | 'bold'
  | 'accent'
  | 'user'
  | 'assistant'
  | 'emergence'
  | 'tool'
  | 'error'
  | 'warn'
  | 'border'
  | 'barFull'
  | 'barEmpty';

export interface Segment {
  text: string;
  style: StyleName;
}

export type Row = Segment[];
export interface Frame {
  width: number;
  height: number;
  rows: Row[];
}

export interface RenderEnv {
  /** Color is off for NO_COLOR, TERM=dumb and non-TTY. */
  color: boolean;
  /** Box-drawing characters are off for TERM=dumb; ASCII borders and markers replace them. */
  unicode: boolean;
}

export function defaultRenderEnv(env: NodeJS.ProcessEnv = process.env): RenderEnv {
  const color = env.NO_COLOR === undefined && env.TERM !== 'dumb' && env.FORCE_COLOR !== '0';
  const unicode = env.TERM !== 'dumb' && env.LANG !== 'C' && env.LC_ALL !== 'C' && env.COG_TUI_ASCII !== '1';
  return { color, unicode };
}

// A frame's styles collapse to one ANSI parameter each; the palette is deliberately tiny and fixed.
const ANSI: Record<StyleName, string> = {
  plain: '0',
  dim: '2',
  bold: '1',
  accent: '36',
  user: '7',
  assistant: '0',
  emergence: '35',
  tool: '33',
  error: '31',
  warn: '33',
  border: '2',
  barFull: '32',
  barEmpty: '2',
};

/** Visible cells, not code points: CJK and emoji are two, combining marks are zero. */
export function cellWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0x200d || (code >= 0x0300 && code <= 0x036f) || (code >= 0xfe00 && code <= 0xfe0f)) continue;
    if (
      (code >= 0x1100 && code <= 0x115f)
      || (code >= 0x2e80 && code <= 0x303e)
      || (code >= 0x3041 && code <= 0x33ff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0xa000 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x1f300 && code <= 0x1faff)
      || (code >= 0x20000 && code <= 0x3fffd)
    ) {
      width += 2;
      continue;
    }
    width += 1;
  }
  return width;
}

/** Greedy word wrap that never splits a double-width character and breaks over-long tokens. */
export function wrapText(text: string, width: number): string[] {
  if (width < 1) return [text];
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine === '') {
      out.push('');
      continue;
    }
    let line = '';
    let lineWidth = 0;
    let token = '';
    let tokenWidth = 0;
    const flushToken = () => {
      if (token === '') return;
      if (lineWidth + tokenWidth > width && line !== '') {
        out.push(line);
        line = '';
        lineWidth = 0;
      }
      line += token;
      lineWidth += tokenWidth;
      token = '';
      tokenWidth = 0;
    };
    for (const char of rawLine) {
      const charWidth = cellWidth(char);
      // Whitespace is the break opportunity; a run of it collapses at a wrap boundary.
      if (char === ' ' || char === '\t') {
        flushToken();
        if (lineWidth + 1 <= width) {
          line += ' ';
          lineWidth += 1;
        } else {
          out.push(line);
          line = '';
          lineWidth = 0;
        }
        continue;
      }
      if (tokenWidth + charWidth > width) {
        // The token alone cannot fit: emit what is in hand and hard-break the token.
        flushToken();
        if (line !== '') {
          out.push(line);
          line = '';
          lineWidth = 0;
        }
      }
      token += char;
      tokenWidth += charWidth;
    }
    flushToken();
    out.push(line);
  }
  return out;
}

/** Cut to `width` visible cells, appending the ellipsis only when something was actually lost. */
export function truncate(text: string, width: number, ellipsis = '…'): string {
  if (cellWidth(text) <= width) return text;
  const ellipsisWidth = cellWidth(ellipsis);
  let out = '';
  let used = 0;
  for (const char of text) {
    const charWidth = cellWidth(char);
    if (used + charWidth > width - ellipsisWidth) break;
    out += char;
    used += charWidth;
  }
  return out + ellipsis;
}

/** Pad to exactly `width` cells; the overflow is the caller's mistake and is truncated away. */
export function padTo(text: string, width: number): string {
  const clipped = cellWidth(text) > width ? truncate(text, width) : text;
  return clipped + ' '.repeat(Math.max(0, width - cellWidth(clipped)));
}

export interface Glyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
}

/** One place the box-drawing/ASCII choice is made, so every bordered surface degrades together. */
export function boxGlyphs(env: RenderEnv): Glyphs {
  return env.unicode
    ? { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' }
    : { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
}

export function seg(text: string, style: StyleName = 'plain'): Segment {
  return { text, style };
}

/** Token/byte counts are noise at full width; the TUI shows one decimal at most. */
export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** A wake time the user can act on: a clock today/tomorrow, a date beyond that. */
export function formatWakeAt(at: number, timeZone: string, now = Date.now()): string {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));
  const dayOf = (value: number) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  if (dayOf(at) === dayOf(now)) return `今天 ${time}`;
  if (dayOf(at) === dayOf(now + 86_400_000)) return Number(time.slice(0, 2)) < 9 ? `明早 ${time}` : `明天 ${time}`;
  return `${new Intl.DateTimeFormat('en-CA', { timeZone, month: '2-digit', day: '2-digit' }).format(new Date(at))} ${time}`;
}

export function rowOf(text: string, style: StyleName = 'plain'): Row {
  return [seg(text, style)];
}

export function rowWidth(row: Row): number {
  return row.reduce((total, segment) => total + cellWidth(segment.text), 0);
}

export function rowText(row: Row): string {
  return row.map((segment) => segment.text).join('');
}

/** Pad/truncate a row to exactly `width` cells so every frame row has the same shape. */
export function fitRow(row: Row, width: number): Row {
  const out: Row = [];
  let used = 0;
  for (const segment of row) {
    if (used >= width) break;
    const room = width - used;
    const widthOf = cellWidth(segment.text);
    if (widthOf <= room) {
      out.push(segment);
      used += widthOf;
      continue;
    }
    const clipped = truncate(segment.text, room);
    out.push({ text: clipped, style: segment.style });
    used += cellWidth(clipped);
  }
  if (used < width) out.push(seg(' '.repeat(width - used)));
  return out;
}

/** Build a frame, fitting every row to the fixed size so the diff never depends on ragged rows. */
export function makeFrame(width: number, height: number, rows: Row[]): Frame {
  const fitted = rows.slice(0, height).map((row) => fitRow(row, width));
  while (fitted.length < height) fitted.push(fitRow([], width));
  return { width, height, rows: fitted };
}

/**
 * The one place a frame becomes bytes. Without color the output is plain text, and the styles that
 * carried meaning (the emergence marker, the user block) are still legible because the layout itself
 * put a symbol or a left border there rather than relying on tint alone.
 */
export function serializeFrame(frame: Frame, env: RenderEnv = { color: true, unicode: true }, options: { clear?: boolean } = {}): string {
  const lines = frame.rows.map((row) => serializeRow(row, env));
  const body = lines.join('\r\n');
  const prefix = options.clear ? `${env.unicode ? '' : ''}\u001b[2J\u001b[H` : '';
  return `${prefix}${body}`;
}

export function serializeRow(row: Row, env: RenderEnv): string {
  if (!env.color) return row.map((segment) => segment.text).join('');
  let out = '';
  let active: StyleName | undefined;
  for (const segment of row) {
    if (segment.text === '') continue;
    if (segment.style !== active) {
      out += `\u001b[${ANSI[segment.style]}m`;
      active = segment.style;
    }
    out += segment.text;
  }
  if (active !== undefined && active !== 'plain') out += '\u001b[0m';
  return out;
}

/** Plain text of a frame: no escapes, one string per row. This is what a snapshot compares. */
export function frameText(frame: Frame): string {
  return frame.rows.map((row) => rowText(row)).join('\n');
}

/**
 * The differential renderer: rows that did not change are not rewritten, and the cursor is moved
 * only across the gaps. Full-screen clears are what make a terminal flicker, so there is none here —
 * the first frame clears once, every frame after it patches.
 */
export class DiffRenderer {
  private previous: string[] | undefined;
  private first = true;

  constructor(private readonly out: (chunk: string) => void, private env: RenderEnv) {}

  setEnv(env: RenderEnv): void {
    this.env = env;
    this.previous = undefined;
    this.first = true;
  }

  /** Rows rewritten this frame; the scroll benchmark asserts this stays bounded. */
  lastChangedRows = 0;

  render(frame: Frame): void {
    const lines = frame.rows.map((row) => serializeRow(row, this.env));
    let buffer = '';
    if (this.first || this.previous === undefined || this.previous.length !== lines.length) {
      buffer += '\u001b[2J\u001b[H';
      this.previous = undefined;
      this.first = false;
    }
    let changed = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (this.previous?.[index] === lines[index]) continue;
      changed += 1;
      buffer += `\u001b[${index + 1};1H\u001b[2K${lines[index]}`;
    }
    this.lastChangedRows = changed;
    this.previous = lines;
    if (buffer !== '') this.out(buffer);
  }

  reset(): void {
    this.previous = undefined;
    this.first = true;
  }
}
