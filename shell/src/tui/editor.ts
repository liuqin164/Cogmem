/**
 * The input editor: a plain text buffer with a cursor, because the terminal has no one to tell it
 * where the text should go. It owns exactly the editing behaviours the spec names (multi-line with
 * Enter/Shift+Enter, history, Ctrl+U/Ctrl+W, paste folding) and nothing about sending — the app
 * decides what a submitted line means.
 *
 * History is durable but deliberately not in the memory ledger: a draft is not a memory, so it is a
 * JSON file beside the checkpoint rather than a kernel row.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cellWidth, wrapText } from './frame.ts';
import type { Key } from './keys.ts';

const PASTE_FOLD_LINES = 3;

export class LineEditor {
  text = '';
  cursor = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private draftBeforeHistory = '';
  private pastes: Array<{ token: string; content: string; lines: number }> = [];

  constructor(history: string[] = []) {
    this.history = history.slice(-200);
  }

  get lines(): string[] {
    return this.text.split('\n');
  }

  isEmpty(): boolean {
    return this.text.trim() === '';
  }

  setText(text: string): void {
    this.text = text;
    this.cursor = text.length;
  }

  /** The submitted text, with every paste placeholder expanded back to what was actually pasted. */
  value(): string {
    let out = this.text;
    for (const paste of this.pastes) out = out.split(paste.token).join(paste.content);
    return out;
  }

  /** Display text: placeholders stay folded so a 500-line paste does not take the screen. */
  display(): string {
    return this.text;
  }

  submit(): string | undefined {
    const value = this.value();
    const trimmed = value.trim();
    this.text = '';
    this.cursor = 0;
    this.pastes = [];
    this.historyIndex = -1;
    if (trimmed === '') return undefined;
    this.history.push(value);
    if (this.history.length > 200) this.history = this.history.slice(-200);
    return value;
  }

  historyList(): string[] {
    return [...this.history];
  }

  insert(text: string): void {
    this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
    this.cursor += text.length;
  }

  insertPasted(text: string): void {
    const clean = text.replace(/\r\n?/gu, '\n');
    const lineCount = clean.split('\n').length;
    if (lineCount <= PASTE_FOLD_LINES) {
      this.insert(clean);
      return;
    }
    const token = `[粘贴 ${lineCount} 行]`;
    this.pastes.push({ token, content: clean, lines: lineCount });
    this.insert(token);
  }

  newline(): void {
    this.insert('\n');
  }

  backspace(): void {
    if (this.cursor === 0) return;
    const start = this.prevIndex(this.cursor);
    this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
    this.cursor = start;
  }

  deleteForward(): void {
    if (this.cursor >= this.text.length) return;
    const end = this.nextIndex(this.cursor);
    this.text = this.text.slice(0, this.cursor) + this.text.slice(end);
  }

  moveLeft(): void {
    this.cursor = this.prevIndex(this.cursor);
  }

  moveRight(): void {
    this.cursor = this.nextIndex(this.cursor);
  }

  home(): void {
    const lineStart = this.text.lastIndexOf('\n', Math.max(0, this.cursor - 1)) + 1;
    this.cursor = lineStart;
  }

  end(): void {
    const lineEnd = this.text.indexOf('\n', this.cursor);
    this.cursor = lineEnd === -1 ? this.text.length : lineEnd;
  }

  killLine(): void {
    const lineStart = this.text.lastIndexOf('\n', Math.max(0, this.cursor - 1)) + 1;
    if (this.cursor === lineStart) {
      // At the start of a line Ctrl+U joins it with the previous one, which is what readline does.
      if (lineStart === 0) return;
      this.text = this.text.slice(0, lineStart - 1) + this.text.slice(this.cursor);
      this.cursor = lineStart - 1;
      return;
    }
    this.text = this.text.slice(0, lineStart) + this.text.slice(this.cursor);
    this.cursor = lineStart;
  }

  killWord(): void {
    if (this.cursor === 0) return;
    let start = this.cursor;
    while (start > 0 && /\s/u.test(this.text[start - 1])) start -= 1;
    while (start > 0 && !/\s/u.test(this.text[start - 1])) start -= 1;
    this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
    this.cursor = start;
  }

  /**
   * The "smart" up/down the spec asks for: inside a multi-line draft the cursor moves between lines;
   * on a single line (or at the first/last line) the same key walks history.
   */
  moveUp(): void {
    const lineStart = this.text.lastIndexOf('\n', Math.max(0, this.cursor - 1)) + 1;
    if (lineStart > 0) {
      const column = this.cursor - lineStart;
      const previousStart = this.text.lastIndexOf('\n', lineStart - 2) + 1;
      this.cursor = Math.min(previousStart + column, lineStart - 1);
      return;
    }
    this.historyUp();
  }

  moveDown(): void {
    const lineEnd = this.text.indexOf('\n', this.cursor);
    if (lineEnd !== -1) {
      const lineStart = this.text.lastIndexOf('\n', Math.max(0, this.cursor - 1)) + 1;
      const column = this.cursor - lineStart;
      const nextStart = lineEnd + 1;
      const nextEnd = this.text.indexOf('\n', nextStart);
      const bound = nextEnd === -1 ? this.text.length : nextEnd;
      this.cursor = Math.min(nextStart + column, bound);
      return;
    }
    this.historyDown();
  }

  historyUp(): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      this.draftBeforeHistory = this.text;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1;
    } else return;
    this.setText(this.history[this.historyIndex]);
  }

  historyDown(): void {
    if (this.historyIndex === -1) return;
    if (this.historyIndex >= this.history.length - 1) {
      this.historyIndex = -1;
      this.setText(this.draftBeforeHistory);
      return;
    }
    this.historyIndex += 1;
    this.setText(this.history[this.historyIndex]);
  }

  /** Apply an editing key; returns true when the key was consumed by the editor. */
  applyKey(key: Key): boolean {
    switch (key.name) {
      case 'char':
        this.insert(key.text ?? '');
        return true;
      case 'newline':
        this.newline();
        return true;
      case 'backspace':
        this.backspace();
        return true;
      case 'delete':
        this.deleteForward();
        return true;
      case 'left':
        this.moveLeft();
        return true;
      case 'right':
        this.moveRight();
        return true;
      case 'up':
        this.moveUp();
        return true;
      case 'down':
        this.moveDown();
        return true;
      case 'home':
        this.home();
        return true;
      case 'end':
        this.end();
        return true;
      case 'paste':
        this.insertPasted(key.text ?? '');
        return true;
      case 'ctrl':
        if (key.text === 'u') {
          this.killLine();
          return true;
        }
        if (key.text === 'w') {
          this.killWord();
          return true;
        }
        if (key.text === 'a') {
          this.home();
          return true;
        }
        if (key.text === 'e') {
          this.end();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  /** Wrapped display rows of the whole draft; the layout caps how many of these it shows. */
  displayRows(width: number): string[] {
    if (this.text === '') return [''];
    return wrapText(this.text, Math.max(1, width));
  }

  /** Cursor row/column (visible cells) inside `displayRows(width)`. */
  cursorPosition(width: number): { row: number; column: number } {
    const bound = Math.max(1, width);
    const before = this.text.slice(0, this.cursor);
    const logical = before.split('\n');
    let row = 0;
    for (let index = 0; index < logical.length - 1; index += 1) {
      row += Math.max(1, wrapText(logical[index], bound).length);
    }
    const wrapped = wrapText(logical[logical.length - 1], bound);
    return { row: row + wrapped.length - 1, column: cellWidth(wrapped[wrapped.length - 1] ?? '') };
  }

  private prevIndex(index: number): number {
    if (index <= 0) return 0;
    const code = this.text.charCodeAt(index - 1);
    if (code >= 0xdc00 && code <= 0xdfff && index >= 2) return index - 2;
    return index - 1;
  }

  private nextIndex(index: number): number {
    if (index >= this.text.length) return this.text.length;
    const code = this.text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < this.text.length) return index + 2;
    return index + 1;
  }
}

export function loadHistory(path: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function saveHistory(path: string, history: string[]): void {
  try {
    writeFileSync(path, `${JSON.stringify(history.slice(-200), null, 0)}\n`, 'utf8');
  } catch {
    // A draft history that cannot be written is not a memory loss; the conversation is unaffected.
  }
}
