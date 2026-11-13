/**
 * The transcript's Markdown subset, rendered straight to frame rows.
 *
 * A full Markdown engine is what settled TUIs bring and what the spec forbids ("界面代码全部自研");
 * the subset here is exactly the spec's list — headings, lists, fenced code, bold/italic — and an
 * unknown construct degrades to its literal text rather than disappearing.
 */
import { cellWidth, padTo, seg, truncate, type RenderEnv, type Row, type Segment, type StyleName } from './frame.ts';

export function renderMarkdown(text: string, width: number, env: RenderEnv, base: StyleName = 'assistant'): Row[] {
  const rows: Row[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^\s*```(\S*)\s*$/u.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      rows.push(...codeBlock(body, language, width, env));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading) {
      const prefix = '#'.repeat(heading[1].length);
      rows.push(...inline(`${prefix} ${heading[2]}`, width, env, 'bold'));
      continue;
    }
    const bullet = /^\s*([-*+])\s+(.*)$/u.exec(line);
    if (bullet) {
      rows.push(...listItem('•', bullet[2], width, env, base));
      continue;
    }
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/u.exec(line);
    if (ordered) {
      rows.push(...listItem(`${ordered[1]}.`, ordered[2], width, env, base));
      continue;
    }
    const quote = /^\s*>\s?(.*)$/u.exec(line);
    if (quote) {
      rows.push(...prefixRows(inline(quote[1], Math.max(1, width - 2), env, 'dim'), '│ ', 'dim'));
      continue;
    }
    if (line.trim() === '') {
      rows.push([]);
      continue;
    }
    rows.push(...inline(line, width, env, base));
  }
  return rows;
}

/** Inline emphasis: `code`, **bold**, *italic*. Unmatched markers stay literal. */
function inline(text: string, width: number, env: RenderEnv, base: StyleName): Row[] {
  const segments: Segment[] = [];
  let index = 0;
  const push = (value: string, style: StyleName) => {
    if (value !== '') segments.push(seg(value, style));
  };
  while (index < text.length) {
    const rest = text.slice(index);
    const code = /^`([^`]+)`/u.exec(rest);
    if (code) {
      push(` ${code[1]} `, 'tool');
      index += code[0].length;
      continue;
    }
    const bold = /^\*\*([^*]+)\*\*/u.exec(rest) ?? /^__([^_]+)__/u.exec(rest);
    if (bold) {
      push(bold[1], 'bold');
      index += bold[0].length;
      continue;
    }
    const italic = /^\*([^*]+)\*/u.exec(rest) ?? /^_([^_]+)_/u.exec(rest);
    if (italic) {
      push(italic[1], 'dim');
      index += italic[0].length;
      continue;
    }
    const next = rest.search(/[`*_]/u);
    if (next === -1) {
      push(rest, base);
      break;
    }
    if (next === 0) {
      push(rest[0], base);
      index += 1;
      continue;
    }
    push(rest.slice(0, next), base);
    index += next;
  }
  return wrapSegments(segments, width);
}

/** Wrap styled segments to `width` cells without dropping any style run. */
export function wrapSegments(segments: Segment[], width: number): Row[] {
  const rows: Row[] = [];
  let current: Row = [];
  let used = 0;
  const newline = () => {
    rows.push(current);
    current = [];
    used = 0;
  };
  for (const part of segments) {
    const pieces = part.text.split('\n');
    for (let index = 0; index < pieces.length; index += 1) {
      if (index > 0) newline();
      let buffer = '';
      for (const char of pieces[index]) {
        const charWidth = cellWidth(char);
        if (used + charWidth > width) {
          if (buffer !== '') {
            current.push(seg(buffer, part.style));
            buffer = '';
          }
          newline();
        }
        buffer += char;
        used += charWidth;
      }
      if (buffer !== '') current.push(seg(buffer, part.style));
    }
  }
  rows.push(current);
  return rows;
}

function prefixRows(rows: Row[], prefix: string, style: StyleName): Row[] {
  return rows.map((row) => [{ text: prefix, style }, ...row]);
}

function listItem(marker: string, text: string, width: number, env: RenderEnv, base: StyleName): Row[] {
  const body = inline(text, Math.max(1, width - 2), env, base);
  return body.map((row, index) => [{ text: index === 0 ? `${marker} ` : '  ', style: 'dim' }, ...row]);
}

/** Deep-cut library-style boxed code, drawn with box-drawing or ASCII depending on the terminal. */
function codeBlock(body: string[], language: string, width: number, env: RenderEnv): Row[] {
  const glyphs = env.unicode
    ? { topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘', horizontal: '─', vertical: '│' }
    : { topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+', horizontal: '-', vertical: '|' };
  const inner = Math.max(1, width - 2);
  const label = language ? ` ${truncate(language, Math.max(1, inner - 3))} ` : '';
  const top = `${glyphs.topLeft}${label}${glyphs.horizontal.repeat(Math.max(0, inner - label.length))}${glyphs.topRight}`;
  const rows: Row[] = [[seg(top, 'border')]];
  for (const line of body) {
    const wrapped = wrapPlain(line, inner);
    for (const part of wrapped) {
      rows.push([seg(glyphs.vertical, 'border'), seg(padTo(part, inner), 'tool'), seg(glyphs.vertical, 'border')]);
    }
  }
  const bottom = `${glyphs.bottomLeft}${glyphs.horizontal.repeat(inner)}${glyphs.bottomRight}`;
  rows.push([seg(bottom, 'border')]);
  return rows;
}

function wrapPlain(text: string, width: number): string[] {
  if (text === '') return [''];
  const out: string[] = [];
  let rest = text;
  while (cellWidth(rest) > width) {
    let taken = '';
    let used = 0;
    for (const char of rest) {
      const charWidth = cellWidth(char);
      if (used + charWidth > width) break;
      taken += char;
      used += charWidth;
    }
    out.push(taken);
    rest = rest.slice(taken.length);
  }
  out.push(rest);
  return out;
}
