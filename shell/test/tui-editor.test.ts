/**
 * The input editor and the key decoder: multi-line editing, history, paste folding, the `/` palette
 * filter, and the raw escape sequences a real terminal sends.
 */
import { describe, expect, test } from 'bun:test';
import { LineEditor } from '../src/tui/editor.ts';
import { KeyDecoder } from '../src/tui/keys.ts';
import { filterCommands, fuzzyMatch, paletteCommands } from '../src/tui/commands.ts';
import { TuiView } from '../src/tui/view.ts';

describe('editor (spec §5)', () => {
  test('Enter is the app\'s to send; Shift+Enter inserts a newline', () => {
    const editor = new LineEditor();
    editor.setText('第一行');
    expect(editor.applyKey({ name: 'newline', alt: true })).toBe(true);
    editor.insert('第二行');
    expect(editor.text).toBe('第一行\n第二行');
    expect(editor.lines).toHaveLength(2);
    // `enter` is deliberately not consumed by the editor, so the app can submit.
    expect(editor.applyKey({ name: 'enter' })).toBe(false);
  });

  test('history walks with up/down and restores the unfinished draft', () => {
    const editor = new LineEditor();
    editor.setText('第一句');
    expect(editor.submit()).toBe('第一句');
    editor.setText('第二句');
    expect(editor.submit()).toBe('第二句');
    editor.setText('草稿');
    editor.moveUp();
    expect(editor.text).toBe('第二句');
    editor.moveUp();
    expect(editor.text).toBe('第一句');
    editor.moveUp();
    expect(editor.text).toBe('第一句');
    editor.moveDown();
    editor.moveDown();
    expect(editor.text).toBe('草稿');
  });

  test('up/down stay inside a multi-line draft instead of jumping to history', () => {
    const editor = new LineEditor(['历史一']);
    editor.setText('a\nb');
    editor.moveUp();
    expect(editor.text).toBe('a\nb');
    expect(editor.cursor).toBe(1);
    editor.moveDown();
    expect(editor.cursor).toBe(3);
  });

  test('a large paste folds to a placeholder but sends whole', () => {
    const editor = new LineEditor();
    const pasted = `${Array.from({ length: 5 }, (_, index) => `line-${index}`).join('\n')}\n`;
    editor.insertPasted(pasted);
    expect(editor.text).toBe('[粘贴 6 行]');
    expect(editor.displayRows(40)).toHaveLength(1);
    expect(editor.value()).toBe(pasted);
    expect(editor.submit()).toBe(pasted);
  });

  test('a short paste stays inline', () => {
    const editor = new LineEditor();
    editor.insertPasted('one\ntwo');
    expect(editor.text).toBe('one\ntwo');
  });

  test('Ctrl+U clears to the line start, Ctrl+W deletes a word', () => {
    const editor = new LineEditor();
    editor.setText('abc\ndef');
    editor.killLine();
    expect(editor.text).toBe('abc\n');
    editor.killLine();
    expect(editor.text).toBe('abc');
    editor.setText('hello world');
    editor.killWord();
    expect(editor.text).toBe('hello ');
  });

  test('cursor math counts CJK cells, not code points', () => {
    const editor = new LineEditor();
    editor.setText('你好');
    expect(editor.cursorPosition(20)).toEqual({ row: 0, column: 4 });
    const wrapped = new LineEditor();
    wrapped.setText('aaaaaaaaaa\n你');
    expect(wrapped.cursorPosition(5)).toEqual({ row: 2, column: 2 });
  });
});

describe('key decoder', () => {
  test('decodes arrows, modifiers, control keys, paste and multi-byte text', () => {
    const decoder = new KeyDecoder();
    expect(decoder.push('\u001b[A')).toEqual([{ name: 'up', shift: false }]);
    expect(decoder.push('\u001b[1;2A')).toEqual([{ name: 'up', shift: true }]);
    expect(decoder.push('\u001b[5~')[0].name).toBe('pageup');
    expect(decoder.push('\u0003')).toEqual([{ name: 'ctrl', ctrl: true, text: 'c' }]);
    expect(decoder.push('你')).toEqual([{ name: 'char', text: '你' }]);
    const paste = decoder.push('\u001b[200~a\nb\u001b[201~');
    expect(paste).toEqual([{ name: 'paste', text: 'a\nb' }]);
  });

  test('an escape sequence split across chunks is buffered, not typed', () => {
    const decoder = new KeyDecoder();
    expect(decoder.push('\u001b[')).toEqual([]);
    expect(decoder.push('B')).toEqual([{ name: 'down', shift: false }]);
    // An un-terminated paste waits for the rest rather than emitting half a document.
    expect(decoder.push('\u001b[200~half')).toEqual([]);
    expect(decoder.push(' done\u001b[201~')).toEqual([{ name: 'paste', text: 'half done' }]);
  });

  test('Alt+Enter is a newline, bare Escape is Escape', () => {
    const decoder = new KeyDecoder();
    expect(decoder.push('\u001b\r')).toEqual([{ name: 'newline', alt: true }]);
    expect(decoder.push('\u001b')).toEqual([]);
    expect(decoder.pendingEscape).toBe(true);
    expect(decoder.flush()).toEqual([{ name: 'esc' }]);
    expect(decoder.push('\u001b\u001b')).toEqual([{ name: 'esc' }]);
    expect(decoder.pendingEscape).toBe(true);
    expect(decoder.flush()).toEqual([{ name: 'esc' }]);
  });
});

describe('command palette (spec §7)', () => {
  test('the first batch is exactly the spec list', () => {
    const names = paletteCommands(new TuiView()).map((command) => command.name);
    for (const required of ['soul', 'memory', 'commitments', 'status', 'context', 'sleep', 'dream', 'help', 'exit']) {
      expect(names).toContain(required);
    }
    expect(names).not.toContain('model');
  });

  test('a second model route adds the model switch', () => {
    const view = new TuiView();
    view.modelRoutes = ['mg/auto/deepseek-v4.1-flash', 'mg/auto/gpt-5'];
    expect(paletteCommands(view).map((command) => command.name)).toContain('model');
  });

  test('fuzzy filtering keeps order and matches subsequences', () => {
    expect(filterCommands('/sl').map((command) => command.name)).toEqual(['soul', 'sleep']);
    expect(filterCommands('/status').map((command) => command.name)).toEqual(['status']);
    expect(filterCommands('/zzz')).toHaveLength(0);
    expect(fuzzyMatch('sml', 'soul-memory-lane')).toBe(true);
    expect(fuzzyMatch('xyz', 'soul')).toBe(false);
  });
});
