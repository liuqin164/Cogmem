/**
 * The view model: everything the TUI draws, and the only code that turns the shell's event stream
 * into it.
 *
 * The TUI is a view, not a second brain: every entry here comes from an event the shell already
 * emitted (`message_*`, `tool_execution_*`, `companion_transition`, …). Nothing in this file calls a
 * tool, decides a transition or writes memory, which is what keeps a crashed TUI harmless to the
 * resident process and keeps the two processes from disagreeing about what happened.
 */
import { type RenderEnv, type Row, cellWidth, seg } from './frame.ts';
import { renderMarkdown } from './markdown.ts';
import type { CommandProposal } from '../proposals.ts';

export type Lifecycle = 'DORMANT' | 'WAKING' | 'IDLE' | 'RUNNING' | 'DREAMING';

export const LIFECYCLE_WORD: Record<Lifecycle, string> = {
  DORMANT: '待机',
  WAKING: '唤醒中',
  IDLE: '空闲',
  RUNNING: '工作中',
  DREAMING: '做梦中',
};

export interface StatusState {
  name: string;
  lifecycle: Lifecycle;
  kernelConnected: boolean;
  nextWakeAt?: number;
  nextWakeReason?: string;
  model: string;
  workspace: string;
  showWorkspace: boolean;
  contextTokens: number;
  contextSweetSpot: number;
  /**
   * The provider's own prompt-cache account for the run in flight (#165 round 21). `null` when the
   * provider reported no cache field, and null is drawn as nothing: a provider that never reports
   * caching must not read as one that always misses. It is `null` rather than absent because this
   * crosses the attach socket as JSON, and JSON drops an `undefined` — the next run's "no report"
   * would then leave the previous run's ratio on screen as if it were this run's.
   */
  promptCache?: { hit: number; miss: number; percent: number } | null;
  costTokens: number;
  timeZone: string;
  /** `/pause`: the status bar shows it while it is true, because a silent pause looks like a bug. */
  capturePaused?: boolean;
}

export interface WorkState {
  active: boolean;
  label: string;
  startedAt?: number;
  turns: number;
  maxTurns: number;
  tokens: number;
  maxTokens: number;
}

export interface ToolBlock {
  toolCallId: string;
  toolName: string;
  input: string;
  output: string;
  status: 'running' | 'ok' | 'error';
  startedAt: number;
  endedAt?: number;
  /** A failed block opens on the error line by default; the user can still collapse it. */
  expanded: boolean;
}

export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; emergenceReason?: string }
  | { kind: 'tool'; id: string; block: ToolBlock }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'warn' }
  /**
   * The third visual style (spec §7): a system receipt for a command the shell ran. It is not agent
   * speech and not a banner — it is the shell telling the user what a command did, so it lives in the
   * transcript where the command was typed and reads differently from both.
   */
  | { kind: 'receipt'; id: string; text: string }
  /**
   * The agent's offer of a command (spec §7, #165 round 22). The receipt's visual family, but
   * actionable: while pending it is the element Enter executes and Esc discards; executed, discarded
   * or refused it is a receipt of that decision and nothing more. It is never a message: the command
   * text is structured state, not something the model said.
   */
  | { kind: 'proposal'; id: string; proposal: CommandProposal };

export interface PresenceReport {
  awaySince?: number;
  awayMs?: number;
  dreams: Array<{ localDate: string; summary: string; eventCount: number }>;
  emergence: Array<{ id: string; text: string; reason: string }>;
  commitments: Array<{ candidateId: string; title: string; status: string; updatedAt: number }>;
  nextWakeAt?: number;
  nextWakeReason?: string;
}

export interface ShellEvent {
  name: string;
  payload: any;
  ctx?: { runId?: string };
}

export type Overlay =
  | { kind: 'palette'; query: string }
  | { kind: 'status' }
  | { kind: 'context' }
  | { kind: 'dream' }
  | { kind: 'help' }
  | { kind: 'commitments' }
  | { kind: 'info'; title: string };

export const MAX_TOOL_OUTPUT_ROWS = 12;

export class TuiView {
  readonly entries: TranscriptEntry[] = [];
  status: StatusState = {
    name: 'companion',
    lifecycle: 'DORMANT',
    kernelConnected: true,
    model: 'unknown',
    workspace: process.cwd(),
    showWorkspace: true,
    contextTokens: 0,
    contextSweetSpot: 6_000,
    costTokens: 0,
    timeZone: 'UTC',
  };
  work: WorkState = { active: false, label: '', turns: 0, maxTurns: 0, tokens: 0, maxTokens: 0 };
  queued: string[] = [];
  presence?: PresenceReport;
  overlay?: Overlay;
  follow = true;
  scrollTop = 0;
  newMessages = false;
  selected = -1;
  /** The highlighted row in the derived `/` palette. */
  paletteIndex = 0;
  /**
   * Entries whose rendered rows may be stale. The transcript cache reads and clears this: it is the
   * difference between an O(1) scroll frame and a rescan of ten thousand immutable messages.
   */
  readonly dirty = new Set<string>();
  /** Set while the attached resident is unreachable or degraded; rendered as a banner. */
  degradedReason?: string;
  /** Commitments asked of the kernel on demand; the palette, not the transcript, shows them. */
  commitments: Array<{ candidateId: string; title: string; status: string; updatedAt: number }> = [];
  lastDream?: { localDate: string; eventCount: number; summary: string };
  commandResult?: { name: string; text: string };
  modelRoutes: string[] = [];
  /** Plugin commands the resident reported; the palette lists them beside the core table. */
  pluginCommands: Array<{ name: string; description?: string; argumentHint?: string }> = [];
  snapshotNote?: string;

  private nextId = 1;
  private activeAssistantId?: string;
  private runStartedAt?: number;
  private readonly createdAt = Date.now();
  private dreamingSince?: number;

  get lifecycle(): Lifecycle {
    return this.status.lifecycle;
  }

  /** The sleep screen's elapsed clock: from when DREAMING was entered, not from view construction. */
  sleepStartedAt(): number {
    return this.dreamingSince ?? this.work.startedAt ?? this.createdAt;
  }

  /** Attach-time state: the resident's history replaces whatever this view had. */
  load(snapshot: { status?: Partial<StatusState>; entries?: TranscriptEntry[]; queued?: string[]; work?: Partial<WorkState>; presence?: PresenceReport; commands?: Array<{ name: string; description?: string; argumentHint?: string }> }): void {
    if (snapshot.status) this.status = { ...this.status, ...snapshot.status };
    if (snapshot.entries) {
      this.entries.length = 0;
      this.entries.push(...snapshot.entries);
      this.dirty.clear();
      for (const entry of this.entries) this.dirty.add(entry.id);
    }
    if (snapshot.queued) this.queued = [...snapshot.queued];
    if (snapshot.work) this.work = { ...this.work, ...snapshot.work };
    if (snapshot.commands) this.pluginCommands = [...snapshot.commands];
    this.presence = snapshot.presence;
    if (snapshot.presence) this.pushPresence(snapshot.presence);
    this.follow = true;
    this.scrollTop = 0;
  }

  pushPresence(report: PresenceReport): void {
    const lines: string[] = [];
    const away = report.awaySince === undefined ? undefined : report.awayMs;
    lines.push(away === undefined ? '你不在时：这是第一次附着。' : `你不在时（离开 ${formatDuration(away)}）：`);
    if (report.dreams.length > 0) {
      for (const dream of report.dreams) lines.push(`· 做梦 ${dream.localDate}（${dream.eventCount} 条事件）：${firstLine(dream.summary)}`);
    } else lines.push('· 没有新的做梦产物。');
    if (report.emergence.length > 0) {
      for (const item of report.emergence) lines.push(`· 攒压浮现（${item.reason}）：${firstLine(item.text)}`);
    } else lines.push('· 没有攒压的浮现条目。');
    if (report.commitments.length > 0) {
      for (const item of report.commitments) lines.push(`· 已兑现承诺：${item.title}`);
    } else lines.push('· 没有在离开期间兑现的承诺。');
    this.push({ kind: 'notice', id: this.id(), text: lines.join('\n'), tone: 'info' });
  }

  /** The reducer. Unknown events are ignored on purpose: an older TUI must not crash on a newer shell. */
  applyEvent(event: ShellEvent): void {
    switch (event.name) {
      case 'companion_status':
        this.applyStatus(event.payload?.status);
        break;
      case 'companion_transition':
        this.applyTransition(event.payload?.state ?? event.payload?.to);
        break;
      case 'companion_work':
        this.work = { ...this.work, ...(event.payload as Partial<WorkState>) };
        break;
      case 'companion_emergence':
        this.pendingEmergence = { reason: String(event.payload?.reason ?? '浮现') };
        break;
      case 'companion_steering':
        this.queued = Array.isArray(event.payload?.queued) ? [...event.payload.queued] : [];
        break;
      case 'message_start':
        this.applyMessageStart(event.payload?.message);
        break;
      case 'message_update':
        this.applyMessageDelta(event.payload?.message, event.payload?.delta);
        break;
      case 'message_end':
        this.applyMessageEnd(event.payload?.message);
        break;
      case 'tool_execution_start':
        this.applyToolStart(event.payload);
        break;
      case 'tool_execution_end':
        this.applyToolEnd(event.payload);
        break;
      case 'companion_degraded':
        this.degradedReason = String(event.payload?.reason ?? 'degraded');
        this.push({ kind: 'notice', id: this.id(), text: `降级：${this.degradedReason}`, tone: 'warn' });
        break;
      case 'companion_commitments':
        this.commitments = Array.isArray(event.payload?.items) ? [...event.payload.items] : [];
        break;
      case 'companion_dream':
        this.lastDream = event.payload?.product;
        break;
      case 'companion_command_result':
        this.commandResult = { name: String(event.payload?.name ?? ''), text: String(event.payload?.text ?? '') };
        // The receipt style is the resident's call (`CommandReply.receipt`), not a second list here,
        // so an unknown `/foo` shows as a receipt on this face too instead of being swallowed.
        if (event.payload?.receipt === true) this.push({ kind: 'receipt', id: this.id(), text: this.commandResult.text });
        break;
      case 'companion_command_proposal':
        this.applyProposal(event.payload?.proposal);
        break;
      case 'companion_model_routes':
        this.modelRoutes = Array.isArray(event.payload?.routes) ? [...event.payload.routes] : [];
        break;
      case 'companion_snapshot_note':
        this.snapshotNote = String(event.payload?.note ?? '');
        break;
      default:
        break;
    }
  }

  private pendingEmergence?: { reason: string };

  private applyStatus(status: Partial<StatusState> | undefined): void {
    if (!status) return;
    const previous = this.status.lifecycle;
    this.status = { ...this.status, ...status };
    if (status.lifecycle && status.lifecycle !== previous) this.applyTransition(status.lifecycle);
  }

  private applyTransition(state: unknown): void {
    if (typeof state !== 'string' || !(state in LIFECYCLE_WORD)) return;
    const lifecycle = state as Lifecycle;
    this.status = { ...this.status, lifecycle };
    if (lifecycle === 'DREAMING') this.dreamingSince = Date.now();
    if (lifecycle === 'RUNNING') {
      this.runStartedAt = Date.now();
      this.work = { ...this.work, active: true, label: '思考中', startedAt: this.runStartedAt, turns: 0, tokens: 0 };
    } else if (this.work.active) {
      this.work = { ...this.work, active: false, label: '', startedAt: undefined };
    }
  }

  private applyMessageStart(message: { role?: string; content?: string } | undefined): void {
    if (!message) return;
    if (message.role === 'user') {
      this.push({ kind: 'user', id: this.id(), text: message.content ?? '' });
      return;
    }
    if (message.role === 'assistant') {
      const id = this.id();
      this.activeAssistantId = id;
      this.push({ kind: 'assistant', id, text: message.content ?? '', emergenceReason: this.pendingEmergence?.reason });
      this.pendingEmergence = undefined;
    }
  }

  private applyMessageDelta(message: { content?: string } | undefined, delta: unknown): void {
    if (!message || typeof delta !== 'string') return;
    const entry = this.activeAssistant();
    if (entry) {
      entry.text = message.content ?? `${entry.text}${delta}`;
      this.dirty.add(entry.id);
    }
  }

  private applyMessageEnd(message: { role?: string; content?: string } | undefined): void {
    if (!message) return;
    if (message.role === 'user') {
      // A user message arrives as a start/end pair carrying the same text. The start may be empty
      // (the fixture shape) or already full (the runtime's `emitUserMessage`): fill the empty one,
      // ignore the duplicate, and only append when the pair really is two messages.
      const content = message.content ?? '';
      const last = this.entries[this.entries.length - 1];
      if (last?.kind === 'user') {
        if (last.text === '') last.text = content;
        else if (last.text !== content) this.push({ kind: 'user', id: this.id(), text: content });
        return;
      }
      this.push({ kind: 'user', id: this.id(), text: content });
      return;
    }
    if (message.role === 'assistant') {
      const entry = this.activeAssistant();
      if (entry) {
        entry.text = message.content ?? entry.text;
        this.dirty.add(entry.id);
      } else {
        this.push({ kind: 'assistant', id: this.id(), text: message.content ?? '', emergenceReason: this.pendingEmergence?.reason });
        this.pendingEmergence = undefined;
      }
      this.activeAssistantId = undefined;
    }
  }

  private applyToolStart(payload: { toolCallId?: string; toolName?: string; input?: unknown } | undefined): void {
    if (!payload?.toolCallId || !payload.toolName) return;
    const block: ToolBlock = {
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      input: summarizeInput(payload.input),
      output: '',
      status: 'running',
      startedAt: Date.now(),
      expanded: false,
    };
    this.push({ kind: 'tool', id: `tool-${payload.toolCallId}`, block });
  }

  private applyToolEnd(payload: { toolCallId?: string; toolName?: string; result?: { output?: string; isError?: boolean }; isError?: boolean } | undefined): void {
    if (!payload?.toolCallId) return;
    const entry = this.entries.find((item): item is Extract<TranscriptEntry, { kind: 'tool' }> => item.kind === 'tool' && item.block.toolCallId === payload.toolCallId);
    if (!entry) return;
    entry.block.output = payload.result?.output ?? '';
    entry.block.status = (payload.result?.isError ?? payload.isError) ? 'error' : 'ok';
    entry.block.endedAt = Date.now();
    this.dirty.add(entry.id);
    // A failed block opens to the error line so the failure is visible without a keystroke.
    if (entry.block.status === 'error') entry.block.expanded = true;
  }

  private activeAssistant(): Extract<TranscriptEntry, { kind: 'assistant' }> | undefined {
    if (!this.activeAssistantId) return undefined;
    return this.entries.find((item): item is Extract<TranscriptEntry, { kind: 'assistant' }> => item.kind === 'assistant' && item.id === this.activeAssistantId);
  }

  /**
   * The proposal event is both the birth and every later state of one element: the entry is keyed by
   * the proposal id, so executed/discarded/refused updates land in place instead of appending a
   * second element. A fresh pending proposal becomes the selected element, because it is the one
   * thing the keyboard is for right now — but only while the user is following the tail.
   */
  private applyProposal(proposal: CommandProposal | undefined): void {
    if (!proposal || typeof proposal.id !== 'string') return;
    const existing = this.entries.find(
      (item): item is Extract<TranscriptEntry, { kind: 'proposal' }> => item.kind === 'proposal' && item.proposal.id === proposal.id,
    );
    if (existing) {
      existing.proposal = proposal;
      this.dirty.add(existing.id);
      return;
    }
    this.push({ kind: 'proposal', id: `proposal-${proposal.id}`, proposal });
    if (proposal.status === 'pending' && this.follow) this.selected = this.entries.length - 1;
  }

  /** The proposal the keyboard acts on: the selected one, else the newest still-pending one. */
  pendingProposal(): Extract<TranscriptEntry, { kind: 'proposal' }> | undefined {
    const selected = this.entries[this.selected];
    if (selected?.kind === 'proposal' && selected.proposal.status === 'pending') return selected;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (entry.kind === 'proposal' && entry.proposal.status === 'pending') return entry;
    }
    return undefined;
  }

  push(entry: TranscriptEntry): void {
    this.entries.push(entry);
    this.dirty.add(entry.id);
    if (!this.follow) this.newMessages = true;
  }

  private id(): string {
    return `e${this.nextId++}`;
  }

  toggleSelected(): void {
    const entry = this.entries[this.selected];
    if (entry?.kind === 'tool') {
      entry.block.expanded = !entry.block.expanded;
      this.dirty.add(entry.id);
    }
  }

  moveSelection(delta: number): void {
    if (this.entries.length === 0) return;
    const next = this.selected < 0 ? this.entries.length - 1 : this.selected + delta;
    this.selected = Math.max(0, Math.min(this.entries.length - 1, next));
  }

  scrollBy(delta: number): void {
    this.scrollTop = Math.max(0, this.scrollTop + delta);
    this.follow = false;
  }

  followTail(): void {
    this.follow = true;
    this.newMessages = false;
    this.scrollTop = 0;
  }
}

export function summarizeInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  if (typeof input !== 'object') return String(input);
  const record = input as Record<string, unknown>;
  for (const key of ['command', 'path', 'query', 'url', 'text']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function toolSummary(block: ToolBlock): string {
  const status = block.status === 'running' ? '进行中' : block.status === 'ok' ? '完成' : '失败';
  const duration = block.endedAt === undefined ? '' : ` · ${formatDuration(block.endedAt - block.startedAt)}`;
  const input = block.input === '' ? '' : ` ${block.input}`;
  return `${block.toolName}${input} · ${status}${duration}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
}

/**
 * Flatten transcript entries to frame rows. This is the virtualization seam: the caller renders only
 * the slice it needs, and the rows off screen are never built for a ten-thousand-line conversation
 * beyond the entries the slice covers (the scroll test measures exactly this).
 */
export function flattenEntry(entry: TranscriptEntry, width: number, env: RenderEnv): Row[] {
  const rows: Row[] = [];
  if (entry.kind === 'user') {
    for (const line of renderMarkdown(entry.text, Math.max(1, width - 2), env, 'plain')) {
      rows.push([seg(env.unicode ? '▌ ' : '| ', 'user'), ...line.map((segment) => ({ ...segment, style: segment.style === 'plain' ? ('user' as const) : segment.style }))]);
    }
    rows.push([]);
    return rows;
  }
  if (entry.kind === 'assistant') {
    if (entry.emergenceReason !== undefined) {
      rows.push([seg(`${env.unicode ? '✦' : '*'} 主动 · `, 'emergence'), seg(entry.emergenceReason, 'dim')]);
    }
    const body = renderMarkdown(entry.text, Math.max(1, width - (entry.emergenceReason !== undefined ? 2 : 0)), env, 'assistant');
    for (const line of body) rows.push(entry.emergenceReason !== undefined ? [seg(env.unicode ? '│ ' : '| ', 'emergence'), ...line] : line);
    rows.push([]);
    return rows;
  }
  if (entry.kind === 'notice') {
    const tone = entry.tone === 'warn' ? 'warn' : 'accent';
    for (const line of entry.text.split('\n')) {
      for (const wrapped of wrapPlain(line, Math.max(1, width - 2))) rows.push([seg('· ', tone), seg(wrapped, tone)]);
    }
    rows.push([]);
    return rows;
  }
  if (entry.kind === 'receipt') {
    // The receipt's marker carries the meaning when color is off: an accent `⌁` (ASCII `#`) and an
    // indented body, so it is never mistaken for the agent speaking or for the notice banner.
    const marker = env.unicode ? '⌁ ' : '# ';
    const lines: string[] = [];
    for (const line of entry.text.split('\n')) lines.push(...wrapPlain(line, Math.max(1, width - 2)));
    lines.forEach((line, index) => {
      rows.push(index === 0 ? [seg(marker, 'accent'), seg(line, 'plain')] : [seg('  ', 'dim'), seg(line, 'plain')]);
    });
    rows.push([]);
    return rows;
  }
  if (entry.kind === 'proposal') return renderProposal(entry.proposal, width, env);
  return renderTool(entry.block, width, env);
}

/**
 * A proposal in the receipt's visual family: the same `⌁` marker, but the pending one carries its
 * answer keys inline so "this is an offer, not an execution" is legible at a glance and in ASCII
 * (the marker degrades to `#`, the labels are words). The command text is drawn even after it
 * settled, so the receipt always says what was offered before it says what happened.
 */
function renderProposal(proposal: CommandProposal, width: number, env: RenderEnv): Row[] {
  const marker = env.unicode ? '⌁ ' : '# ';
  const target = `/${proposal.command}${proposal.args === '' ? '' : ` ${proposal.args}`}`;
  const head = `提议 ${target} · ${proposal.reason}`;
  const body = (text: string, style: 'plain' | 'dim' = 'plain'): Row[] =>
    wrapPlain(text, Math.max(1, width - 2)).map((line) => [seg('  ', 'dim'), seg(line, style)]);
  switch (proposal.status) {
    case 'pending':
      return [
        [seg(marker, 'accent'), seg(truncatePlain(head, Math.max(1, width - 2)), 'accent')],
        ...body('Enter 执行 · Esc 放弃（尚未执行）', 'dim'),
        [],
      ];
    case 'executed':
      return [
        [seg(marker, 'accent'), seg(truncatePlain(`${head} · 已执行`, Math.max(1, width - 2)), 'accent')],
        ...body(proposal.resultText ?? '（命令已执行）'),
        [],
      ];
    case 'discarded':
      return [
        [seg(marker, 'dim'), seg(truncatePlain(`${head} · 已放弃，提议失效`, Math.max(1, width - 2)), 'dim')],
        [],
      ];
    default:
      return [
        [seg(marker, 'warn'), seg(truncatePlain(`${head} · 已拒绝，未执行`, Math.max(1, width - 2)), 'warn')],
        ...body(proposal.rejectedReason ?? '命令不可用。', 'dim'),
        [],
      ];
  }
}

function renderTool(block: ToolBlock, width: number, env: RenderEnv): Row[] {
  const arrow = block.expanded ? (env.unicode ? '▾' : 'v') : env.unicode ? '▸' : '>';
  const style = block.status === 'error' ? 'error' : block.status === 'running' ? 'warn' : 'tool';
  const rows: Row[] = [[seg(`${arrow} `, style), seg(toolSummary(block), style)]];
  if (!block.expanded) {
    if (block.status === 'error' && block.output !== '') {
      const line = firstLine(block.output);
      rows.push([seg('  ! ', 'error'), seg(truncatePlain(line, Math.max(1, width - 4)), 'error')]);
    }
    rows.push([]);
    return rows;
  }
  if (block.input !== '') {
    for (const line of wrapPlain(block.input, Math.max(1, width - 4))) rows.push([seg('  ', 'dim'), seg(line, 'dim')]);
  }
  const outputLines = block.output === '' ? ['(no output)'] : block.output.split('\n');
  const capped = outputLines.slice(0, MAX_TOOL_OUTPUT_ROWS);
  for (const line of capped) {
    for (const wrapped of wrapPlain(line, Math.max(1, width - 4))) {
      rows.push([seg('  ', 'plain'), seg(wrapped, block.status === 'error' ? 'error' : 'plain')]);
    }
  }
  if (outputLines.length > capped.length) {
    const pointer = fullOutputPointer(block.output) ?? `已截断 ${outputLines.length - capped.length} 行`;
    rows.push([seg('  … ', 'dim'), seg(pointer, 'dim')]);
  }
  rows.push([]);
  return rows;
}

/** Whatever the bash tool already wrote to disk is the honest pointer; otherwise name the ledger. */
export function fullOutputPointer(output: string): string | undefined {
  const match = /full output: (\S+)/u.exec(output);
  if (match) return `全文在 ${match[1]}`;
  return undefined;
}

function truncatePlain(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  let out = '';
  let used = 0;
  for (const char of text) {
    if (used + cellWidth(char) > width - 1) break;
    out += char;
    used += cellWidth(char);
  }
  return `${out}…`;
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
