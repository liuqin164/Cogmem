/**
 * Composition: the four sections stacked, plus the overlays and the states the spec calls special.
 *
 * The transcript is virtualized through `TranscriptCache`: an entry's rows are built once and cached,
 * so five visible rows of a ten-thousand-line conversation cost five rows of work, not ten thousand.
 * That cache is what makes the scroll benchmark a number instead of a shrug.
 */
import { boxGlyphs, cellWidth, compactNumber, fitRow, formatWakeAt, makeFrame, padTo, seg, truncate, type Frame, type RenderEnv, type Row } from './frame.ts';
import { flattenEntry, formatDuration, LIFECYCLE_WORD, TuiView, type TranscriptEntry } from './view.ts';
import type { LineEditor } from './editor.ts';
import { overlayRows, paletteRows } from './commands.ts';

export const MIN_WIDTH = 60;
export const MIN_HEIGHT = 16;
export const MAX_INPUT_LINES = 8;

export interface TuiSize {
  width: number;
  height: number;
}

/** Cached row layout per entry: invalidated on width change, expansion, or entry mutation. */
export class TranscriptCache {
  private rows = new Map<string, Row[]>();
  private heights = new Map<string, number>();
  private signatures = new Map<string, number>();
  private entryById = new Map<string, TranscriptEntry>();
  private order: string[] = [];
  private prefix: number[] = [0];
  private cachedWidth = -1;
  private env: RenderEnv;

  constructor(env: RenderEnv) {
    this.env = env;
  }

  setEnv(env: RenderEnv): void {
    if (env.color === this.env.color && env.unicode === this.env.unicode) return;
    this.env = env;
    this.clear();
  }

  clear(): void {
    this.rows.clear();
    this.heights.clear();
    this.signatures.clear();
    this.entryById.clear();
    this.order = [];
    this.prefix = [0];
    this.cachedWidth = -1;
  }

  /**
   * Bring the cache level with the entry list and the view's dirty set.
   *
   * Appends and in-place edits are the two things that happen while a conversation runs, so both are
   * handled on their own: an appended entry is flattened once, and a `dirty` entry is rebuilt by id.
   * No path scans the whole transcript unless the list itself changed underneath us, which is what
   * keeps a scroll frame over ten thousand entries independent of how many there are.
   */
  sync(entries: TranscriptEntry[], width: number, dirty?: Set<string>): void {
    // ponytail: a width change re-wraps every entry (~25ms per 2k entries, so ~0.1s at the 10k
    // ceiling). Resize is a human action, not a per-frame one; wrap lazily if that ever changes.
    if (width !== this.cachedWidth) {
      this.rows.clear();
      this.heights.clear();
      this.signatures.clear();
      this.entryById.clear();
      this.order = [];
      this.prefix = [0];
      this.cachedWidth = width;
    }
    const count = entries.length;
    const previous = this.order.length;
    const appendOnly = count >= previous && (previous === 0 || (count > 0 && entries[previous - 1].id === this.order[previous - 1]));
    let changed = false;
    if (appendOnly && count >= previous) {
      for (let index = previous; index < count; index += 1) {
        this.build(entries[index], width);
        this.order.push(entries[index].id);
        this.prefix.push((this.prefix[this.prefix.length - 1] ?? 0) + (this.heights.get(entries[index].id) ?? 0));
      }
      for (const id of dirty ?? []) {
        const entry = this.entryById.get(id);
        if (!entry || !this.rows.has(id)) continue;
        if (this.signatures.get(id) === signatureOf(entry)) continue;
        this.build(entry, width);
        changed = true;
      }
    } else {
      this.entryById.clear();
      this.order = [];
      this.prefix = [0];
      let total = 0;
      for (const entry of entries) {
        this.build(entry, width);
        this.order.push(entry.id);
        total += this.heights.get(entry.id) ?? 0;
        this.prefix.push(total);
      }
      changed = false;
    }
    if (changed) this.rebuildPrefix();
    dirty?.clear();
  }

  private build(entry: TranscriptEntry, width: number): void {
    const built = flattenEntry(entry, width, this.env);
    this.rows.set(entry.id, built);
    this.heights.set(entry.id, built.length);
    this.signatures.set(entry.id, signatureOf(entry));
    this.entryById.set(entry.id, entry);
  }

  private rebuildPrefix(): void {
    this.prefix = [0];
    let total = 0;
    for (const id of this.order) {
      total += this.heights.get(id) ?? 0;
      this.prefix.push(total);
    }
  }

  totalRows(): number {
    return this.prefix[this.prefix.length - 1] ?? 0;
  }

  /**
   * The visible slice. The binary search over the prefix sums is the whole virtualization story:
   * finding the first visible entry costs log(n), and only the visible rows are materialized.
   */
  slice(entries: TranscriptEntry[], top: number, count: number): Row[] {
    if (count <= 0) return [];
    const start = Math.max(0, Math.min(top, Math.max(0, this.totalRows())));
    const out: Row[] = [];
    let index = this.entryIndexAt(start);
    let offset = this.prefix[index] ?? 0;
    for (; index < entries.length && out.length < count; index += 1) {
      const id = entries[index].id;
      const height = this.heights.get(id) ?? 0;
      if (offset + height <= start) {
        offset += height;
        continue;
      }
      const rows = this.rows.get(id) ?? [];
      for (let local = Math.max(0, start - offset); local < rows.length && out.length < count; local += 1) out.push(rows[local]);
      offset += height;
    }
    while (out.length < count) out.push([]);
    return out;
  }

  /** The last entry whose prefix offset is <= row: `prefix` is sorted, so bisect it. */
  private entryIndexAt(row: number): number {
    let low = 0;
    let high = this.prefix.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.prefix[middle] ?? 0) <= row) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}

/** A cheap content fingerprint; only the streaming entry ever changes it during a run. */
function signatureOf(entry: TranscriptEntry): number {
  if (entry.kind === 'tool') return 1_000_000_000 + entry.block.output.length * 4 + (entry.block.expanded ? 2 : 0) + (entry.block.status === 'error' ? 1 : 0);
  // A proposal's rows change in place when its state settles; the status and the result are what move.
  if (entry.kind === 'proposal') return 2_000_000_000 + (entry.proposal.resultText?.length ?? 0) * 4 + entry.proposal.status.length;
  return entry.text.length;
}

/** A `/` at the start of an empty-ish draft is the palette; a space or a newline ends the command word. */
export function paletteQueryOf(editor: LineEditor): string | undefined {
  if (!editor.text.startsWith('/')) return undefined;
  if (/[\s]/u.test(editor.text)) return undefined;
  return editor.text;
}

export function renderTui(view: TuiView, editor: LineEditor, size: TuiSize, env: RenderEnv, cache?: TranscriptCache): Frame {
  const { width, height } = size;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return renderSmall(view, editor, size, env);
  const activeCache = cache ?? new TranscriptCache(env);
  activeCache.setEnv(env);
  activeCache.sync(view.entries, width, view.dirty);

  const inputRows = editor.displayRows(Math.max(1, width - 4));
  const contentLines = Math.max(1, Math.min(MAX_INPUT_LINES, inputRows.length));
  const inputHeight = contentLines + 2;
  const queueRows = view.queued.length > 0 ? 1 : 0;
  const workRows = view.work.active ? 1 : 0;
  const transcriptHeight = Math.max(1, height - 2 - queueRows - inputHeight);
  const contentHeight = Math.max(1, transcriptHeight - workRows);

  const rows: Row[] = [];
  rows.push(statusRow(view, width, env));

  const paletteQuery = paletteQueryOf(editor);
  if (paletteQuery !== undefined) {
    const palette = paletteRows(view, paletteQuery, Math.max(1, width - 2), env, view.paletteIndex);
    for (let index = 0; index < transcriptHeight; index += 1) rows.push(palette[index] ?? []);
  } else if (view.overlay) {
    const overlay = overlayRows(view, Math.max(1, width - 2), env);
    for (let index = 0; index < transcriptHeight; index += 1) rows.push(overlay[index] ?? []);
  } else if (view.lifecycle === 'DREAMING') {
    const sleep = sleepScreen(view, width, transcriptHeight, env);
    for (let index = 0; index < transcriptHeight; index += 1) rows.push(sleep.rows[index] ?? []);
  } else {
    const total = activeCache.totalRows();
    const top = total <= contentHeight
      ? 0
      : view.follow
        ? Math.max(0, total - contentHeight)
        : Math.max(0, total - contentHeight - view.scrollTop);
    rows.push(...activeCache.slice(view.entries, top, contentHeight));
    for (let index = 0; index < workRows; index += 1) rows.push(workRow(view, width, env));
  }

  if (queueRows > 0) rows.push(queueRow(view, width));
  rows.push(...inputBox(editor, width, contentLines, inputRows, env));
  rows.push(footerRow(view, width, env));
  return makeFrame(width, height, rows);
}

function renderSmall(view: TuiView, editor: LineEditor, size: TuiSize, env: RenderEnv): Frame {
  const { width, height } = size;
  const rows: Row[] = [];
  rows.push([seg(truncate(`${view.status.name} · ${LIFECYCLE_WORD[view.lifecycle]}`, width), 'bold')]);
  const cache = new TranscriptCache(env);
  const recent = view.entries.slice(-3);
  cache.sync(recent, Math.max(1, width), view.dirty);
  const budget = Math.max(1, height - 5);
  rows.push(...cache.slice(recent, Math.max(0, cache.totalRows() - budget), budget));
  while (rows.length < height - 4) rows.push([]);
  rows.push([seg('窗口太小（最小 60×16）', 'warn')]);
  const inputRows = editor.displayRows(Math.max(1, width - 4));
  const contentLines = Math.max(1, Math.min(3, inputRows.length));
  const g = boxGlyphs(env);
  rows.push([seg(`${g.tl}${g.h.repeat(Math.max(0, width - 2))}${g.tr}`, 'border')]);
  for (let index = 0; index < contentLines; index += 1) rows.push(inputLineRow(inputRows[index] ?? '', width, index === 0, env));
  rows.push([seg(`${g.bl}${g.h.repeat(Math.max(0, width - 2))}${g.br}`, 'border')]);
  return makeFrame(width, height, rows);
}

function statusRow(view: TuiView, width: number, env: RenderEnv): Row {
  const state = view.status.lifecycle;
  const kernel = view.status.kernelConnected ? '内核已连接' : '内核断开';
  // `/pause` is always visible: a pause the user cannot see is indistinguishable from a broken shell.
  // The glyph follows the same Unicode/ASCII fallback the rest of the frame does.
  const pause = view.status.capturePaused ? `${env.unicode ? '⏸' : '!'} 暂停捕获` : '';
  const left: Row = [
    seg(truncate(view.status.name, Math.max(1, width - 24)), 'bold'),
    seg(' · ', 'dim'),
    seg(LIFECYCLE_WORD[state], state === 'RUNNING' ? 'accent' : state === 'DREAMING' ? 'emergence' : 'plain'),
    seg(' · ', 'dim'),
    seg(kernel, view.status.kernelConnected ? 'dim' : 'warn'),
  ];
  if (pause !== '') left.push(seg(' · ', 'dim'), seg(pause, 'warn'));
  const wake = view.status.nextWakeAt === undefined ? '下次唤醒 无安排' : `下次唤醒 ${formatWakeAt(view.status.nextWakeAt, view.status.timeZone)}`;
  const leftWidth = left.reduce((sum, item) => sum + cellWidth(item.text), 0);
  if (cellWidth(wake) + leftWidth + 1 > width) {
    const compact = `${view.status.name} · ${LIFECYCLE_WORD[state]} · ${kernel}${pause === '' ? '' : ` · ${pause}`}`;
    return [seg(truncate(compact, width), 'bold')];
  }
  const gap = Math.max(1, width - leftWidth - cellWidth(wake) - 1);
  return [seg(' ', 'plain'), ...left, seg(' '.repeat(gap)), seg(wake, 'dim'), seg(' ', 'plain')];
}

function workRow(view: TuiView, width: number, env: RenderEnv): Row {
  const work = view.work;
  const turns = `回合 ${bar(work.turns, work.maxTurns, env)} ${work.turns}/${work.maxTurns}`;
  const tokens = `token ${bar(work.tokens, work.maxTokens, env)} ${compactNumber(work.tokens)}/${compactNumber(work.maxTokens)}`;
  const elapsed = work.startedAt === undefined ? '' : ` · 已用 ${formatDuration(Date.now() - work.startedAt)}`;
  const label = work.label === '' ? '工作中' : work.label;
  const text = `${env.unicode ? '⏳' : '*'} ${label}${elapsed} · ${turns} · ${tokens}`;
  const status = Math.max(ratio(work.turns, work.maxTurns), ratio(work.tokens, work.maxTokens)) > 0.8 ? 'warn' : 'accent';
  return [seg(` ${truncate(text, Math.max(1, width - 2))}`, status)];
}

function queueRow(view: TuiView, width: number): Row {
  const text = `排队中 ${view.queued.length} 条 · 将在当前回合结束后注入 · Esc 撤回`;
  return [seg(` ${truncate(text, Math.max(1, width - 2))}`, 'warn')];
}

function inputBox(editor: LineEditor, width: number, contentLines: number, inputRows: string[], env: RenderEnv): Row[] {
  const g = boxGlyphs(env);
  const inner = Math.max(1, width - 2);
  const rows: Row[] = [[seg(`${g.tl}${g.h.repeat(inner)}${g.tr}`, 'border')]];
  // Inner scroll: the visible window follows the cursor once the draft passes the cap.
  const cursor = editor.cursorPosition(Math.max(1, width - 4));
  const start = Math.max(0, Math.min(cursor.row - contentLines + 1, Math.max(0, inputRows.length - contentLines)));
  const visible: string[] = [];
  for (let index = 0; index < contentLines; index += 1) visible.push(inputRows[start + index] ?? '');
  if (inputRows.length > contentLines) visible[visible.length - 1] = `… ${inputRows.length - contentLines} 行内滚`;
  for (let index = 0; index < contentLines; index += 1) rows.push(inputLineRow(visible[index], width, start + index === 0, env));
  rows.push([seg(`${g.bl}${g.h.repeat(inner)}${g.br}`, 'border')]);
  return rows;
}

function inputLineRow(text: string, width: number, first: boolean, env: RenderEnv): Row {
  const inner = Math.max(1, width - 2);
  const body = padTo(`${first ? '> ' : '  '}${text}`, inner);
  const v = boxGlyphs(env).v;
  return [seg(v, 'border'), seg(body, 'plain'), seg(v, 'border')];
}

function footerRow(view: TuiView, width: number, env: RenderEnv): Row {
  const status = view.status;
  const ratioValue = ratio(status.contextTokens, status.contextSweetSpot);
  const newMessage = view.newMessages ? '有新消息 ↓ ' : '';
  // The cache segment exists only while a provider has reported one (#165 round 21). No report, no
  // segment: a fabricated 0% would look like a measured all-miss.
  const cache = status.promptCache ? [seg(` 缓存 ${status.promptCache.percent}%`, 'dim')] : [];
  const left: Row = [
    seg(`${newMessage}上下文 `, 'dim'),
    seg(`${bar(status.contextTokens, status.contextSweetSpot, env)} ${Math.round(ratioValue * 100)}% ${compactNumber(status.contextTokens)}/${compactNumber(status.contextSweetSpot)}`, ratioValue > 1 ? 'error' : ratioValue > 0.8 ? 'warn' : 'barFull'),
    ...cache,
  ];
  const middle = `模型 ${status.model}`;
  const cost = `本日 ${compactNumber(status.costTokens)} tok`;
  const workspace = status.showWorkspace ? status.workspace : '';
  // Degrade right-to-left: the workspace goes first, then the cost, and the model last; the bandwidth
  // gauge never changes width because it is the instrument this footer exists for.
  const candidates = [[cost, workspace].filter(Boolean).join(' · '), cost, ''];
  const used = left.reduce((sum, item) => sum + cellWidth(item.text), 0);
  let right = '';
  for (const candidate of candidates) {
    if (used + cellWidth(middle) + cellWidth(candidate) + 4 <= width) {
      right = candidate;
      break;
    }
  }
  const remaining = width - used - cellWidth(middle) - cellWidth(right) - 2;
  if (remaining < 0) return [seg(truncate(`${newMessage}上下文 `, width), 'dim')];
  return fitRow([...left, seg('  ', 'dim'), seg(middle, 'dim'), seg(' '.repeat(Math.max(0, remaining))), seg(right, 'dim')], width);
}

/** A mini progress bar; the ASCII fallback keeps the shape without the glyphs. */
function bar(value: number, max: number, env: RenderEnv = { color: true, unicode: true }): string {
  const cells = 5;
  const filled = max <= 0 ? 0 : Math.min(cells, Math.round((value / max) * cells));
  const [full, empty] = env.unicode ? ['▮', '▯'] : ['#', '-'];
  return `${full.repeat(filled)}${empty.repeat(cells - filled)}`;
}

function ratio(value: number, max: number): number {
  return max <= 0 ? 0 : value / max;
}

export function sleepScreen(view: TuiView, width: number, height: number, env: RenderEnv): { rows: Row[] } {
  const elapsed = Date.now() - view.sleepStartedAt();
  const phase = elapsed < 60_000 ? '整理今日' : elapsed < 5 * 60_000 ? '编译' : '浮现准备';
  const lines = [
    `${env.unicode ? '✦' : '*'} 它在做梦`,
    `已进行 ${formatDuration(elapsed)} · 阶段：${phase}`,
    '',
    '[等它醒] 留屏观察      [任意键] 唤醒它',
  ];
  const rows: Row[] = [];
  const top = Math.max(0, Math.floor((height - lines.length) / 2));
  for (let index = 0; index < top; index += 1) rows.push([]);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    rows.push([seg(' '.repeat(Math.max(0, Math.floor((width - cellWidth(line)) / 2)))), seg(line, index === 0 ? 'emergence' : 'dim')]);
  }
  return { rows };
}

/** Where the real terminal cursor belongs after a frame, so typing lands inside the input box. */
export function inputCursorPosition(view: TuiView, editor: LineEditor, size: TuiSize): { row: number; column: number } | undefined {
  const { width, height } = size;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return undefined;
  const inputRows = editor.displayRows(Math.max(1, width - 4));
  const contentLines = Math.max(1, Math.min(MAX_INPUT_LINES, inputRows.length));
  const queueRows = view.queued.length > 0 ? 1 : 0;
  const transcriptHeight = Math.max(1, height - 2 - queueRows - (contentLines + 2));
  const boxTop = 1 + transcriptHeight + queueRows;
  const cursor = editor.cursorPosition(Math.max(1, width - 4));
  const start = Math.max(0, Math.min(cursor.row - contentLines + 1, Math.max(0, inputRows.length - contentLines)));
  return { row: boxTop + 2 + (cursor.row - start), column: 4 + cursor.column };
}
