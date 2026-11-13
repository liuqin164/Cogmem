/**
 * Raw-mode key decoding, self-owned like the rest of the renderer (no TUI framework, no `readline`
 * in raw mode). The parser is a small state machine because a chunk boundary can land in the middle
 * of an escape sequence, and a half-parsed arrow key must be buffered rather than inserted as text.
 */
export interface Key {
  name: 'char' | 'enter' | 'newline' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'backspace' | 'delete' | 'tab' | 'esc' | 'pageup' | 'pagedown' | 'paste' | 'ctrl';
  text?: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

const CSI: Record<string, Key['name']> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  '1~': 'home',
  '3~': 'delete',
  '4~': 'end',
  '5~': 'pageup',
  '6~': 'pagedown',
  '7~': 'home',
  '8~': 'end',
};

export class KeyDecoder {
  private buffer = '';

  /** True when a lone Escape is sitting in the buffer, waiting to see if a sequence follows. */
  get pendingEscape(): boolean {
    return this.buffer === '\u001b';
  }

  /**
   * Emit a pending lone Escape. A real terminal sends one byte for Esc and nothing for "no sequence
   * followed", so the app calls this on a short timer; without it Esc would only arrive once the
   * user pressed something else.
   */
  flush(): Key[] {
    if (this.buffer !== '\u001b') return [];
    this.buffer = '';
    return [{ name: 'esc' }];
  }

  push(chunk: string): Key[] {
    this.buffer += chunk;
    const keys: Key[] = [];
    for (;;) {
      const parsed = this.take();
      if (!parsed) break;
      keys.push(...parsed.keys);
      if (!parsed.consumed) break;
    }
    return keys;
  }

  /** `undefined` means "need more bytes"; an empty key list means "consumed, nothing to report". */
  private take(): { keys: Key[]; consumed: boolean } | undefined {
    if (this.buffer === '') return undefined;
    const first = this.buffer[0];
    if (first === '\u001b') return this.takeEscape();
    if (first === '\r' || first === '\n') {
      this.buffer = this.buffer.slice(1);
      return { keys: [{ name: 'enter' }], consumed: true };
    }
    if (first === '\u007f' || first === '\b') {
      this.buffer = this.buffer.slice(1);
      return { keys: [{ name: 'backspace' }], consumed: true };
    }
    if (first === '\t') {
      this.buffer = this.buffer.slice(1);
      return { keys: [{ name: 'tab' }], consumed: true };
    }
    const code = first.codePointAt(0)!;
    if (code >= 1 && code <= 26) {
      this.buffer = this.buffer.slice(1);
      // Ctrl+U/W are editing keys, not printable control characters.
      return { keys: [{ name: 'ctrl', ctrl: true, text: String.fromCharCode(code + 96) }], consumed: true };
    }
    // A printable code point: consume the whole surrogate pair when there is one.
    const size = code > 0xffff ? 2 : 1;
    if (this.buffer.length < size) return undefined;
    const text = this.buffer.slice(0, size);
    this.buffer = this.buffer.slice(size);
    return { keys: [{ name: 'char', text }], consumed: true };
  }

  private takeEscape(): { keys: Key[]; consumed: boolean } | undefined {
    const rest = this.buffer.slice(1);
    if (rest === '') return undefined;
    if (rest[0] === '\r' || rest[0] === '\n') {
      this.buffer = rest.slice(1);
      return { keys: [{ name: 'newline', alt: true }], consumed: true };
    }
    if (rest[0] === '\u001b') {
      // A bare Escape followed closely by another sequence is still one Esc for the user.
      this.buffer = rest;
      return { keys: [{ name: 'esc' }], consumed: true };
    }
    if (rest[0] === '[') return this.takeCsi(rest.slice(1));
    if (rest[0] === 'O') return this.takeSs3(rest.slice(1));
    // Alt+<char>
    this.buffer = rest.slice(1);
    return { keys: [{ name: 'char', text: rest[0], alt: true }], consumed: true };
  }

  private takeCsi(rest: string): { keys: Key[]; consumed: boolean } | undefined {
    // Bracketed paste: read until the terminator, which may not have arrived yet.
    if (rest.startsWith('200~')) {
      const end = rest.indexOf('\u001b[201~', 4);
      if (end === -1) return undefined;
      const text = rest.slice(4, end);
      this.buffer = rest.slice(end + 6);
      return { keys: [{ name: 'paste', text }], consumed: true };
    }
    const match = /^([0-9;]*)([A-Za-z~])/u.exec(rest);
    if (!match) {
      if (/^[0-9;]*$/u.test(rest)) return undefined; // still collecting parameters
      this.buffer = rest.slice(1);
      return { keys: [{ name: 'esc' }], consumed: true };
    }
    const modifier = match[1].includes(';') ? Number(match[1].split(';')[1] ?? '1') : 1;
    const name = CSI[`${match[1]}${match[2]}`] ?? CSI[match[2]];
    this.buffer = rest.slice(match[0].length);
    if (!name) return { keys: [], consumed: true };
    const shift = modifier === 2 || modifier === 4;
    if (name === 'up' && shift) return { keys: [{ name: 'up', shift: true }], consumed: true };
    return { keys: [{ name, shift }], consumed: true };
  }

  private takeSs3(rest: string): { keys: Key[]; consumed: boolean } | undefined {
    if (rest === '') return undefined;
    const name = rest[0] === 'A' ? 'up'
      : rest[0] === 'B' ? 'down'
      : rest[0] === 'C' ? 'right'
      : rest[0] === 'D' ? 'left'
      : rest[0] === 'H' ? 'home'
      : rest[0] === 'F' ? 'end'
      : undefined;
    this.buffer = rest.slice(1);
    return name ? { keys: [{ name }], consumed: true } : { keys: [], consumed: true };
  }
}
