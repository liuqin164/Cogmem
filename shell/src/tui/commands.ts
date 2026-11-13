/**
 * The command palette and its overlays. The palette is data — the core table in `../commands.ts`
 * plus the plugin commands the resident reported — and a fuzzy filter; the overlays are rendered
 * from what the view already knows, so opening one never blocks the resident.
 */
import { cellWidth, compactNumber, formatWakeAt, seg, truncate, type RenderEnv, type Row } from './frame.ts';
import { CORE_COMMANDS, availableCoreCommand, coreCommandFor, unknownCommandReply } from '../commands.ts';
import { LIFECYCLE_WORD, type Overlay, type TuiView } from './view.ts';

export interface TuiCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

/**
 * The palette half of the table; a conditional entry (`/model`) only joins once its condition holds.
 * It is `availableCoreCommand` that decides — the same rule the proposal path uses — so the panel
 * and "what the agent may propose" cannot drift apart.
 */
function corePaletteCommands(multipleRoutes: boolean): TuiCommand[] {
  return CORE_COMMANDS
    .filter((command) => availableCoreCommand(command.name, 'palette', { multipleRoutes }) !== undefined)
    .map(({ name, description, argumentHint }) => ({ name, description, argumentHint }));
}

/** The view-less default the fuzzy filter falls back to. */
const CORE_PALETTE = corePaletteCommands(false);

/** The palette for the current view: the core table, then the plugin commands the resident reported. */
export function paletteCommands(view: TuiView): TuiCommand[] {
  const plugins = view.pluginCommands.map((command) => ({ name: command.name, description: command.description ?? '插件命令', argumentHint: command.argumentHint }));
  return [...corePaletteCommands((view.modelRoutes?.length ?? 0) > 1), ...plugins];
}

/** Fuzzy match: every query character appears in order, which is all a command palette needs. */
export function fuzzyMatch(query: string, name: string): boolean {
  if (query === '') return true;
  const haystack = name.toLowerCase();
  let index = 0;
  for (const char of query.toLowerCase()) {
    index = haystack.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

export function filterCommands(query: string, commands: TuiCommand[] = CORE_PALETTE): TuiCommand[] {
  const trimmed = query.replace(/^\//u, '');
  return commands.filter((command) => fuzzyMatch(trimmed, command.name));
}

/**
 * Where a `/name` typed in the TUI goes. It is a pure decision so the "every declared surface
 * dispatches the same command" check can run without a terminal: the modulator only applies it.
 */
export interface TuiDispatch {
  /** `/exit`: detach instead of asking the resident. */
  exit?: boolean;
  /** A local notice pushed before the resident answers (`/sleep`). */
  notice?: string;
  /** The overlay this command's answer renders in, if any. */
  overlay?: Overlay;
  /** The unknown-command receipt, when no face owns the name. */
  unknown?: string;
  /** Ask the resident (core commands with a resident surface, and every plugin command). */
  forward: boolean;
}

/** The TUI presentation of a core command; the handler itself is the table's, not this map's. */
const TUI_OVERLAYS: Record<string, Overlay> = {
  help: { kind: 'help' },
  status: { kind: 'status' },
  context: { kind: 'context' },
  dream: { kind: 'dream' },
  commitments: { kind: 'commitments' },
  soul: { kind: 'info', title: 'soul' },
  memory: { kind: 'info', title: 'memory' },
  model: { kind: 'info', title: 'model' },
};

export function dispatchTuiCommand(name: string, args: string, view: TuiView): TuiDispatch {
  const core = coreCommandFor(name, 'tui');
  if (!core) {
    if (view.pluginCommands.some((command) => command.name === name)) return { forward: true };
    // Never a silent drop and never a model prompt: the same receipt the other two faces give.
    return { unknown: unknownCommandReply(name).text, forward: false };
  }
  const overlay = TUI_OVERLAYS[name];
  const notice = name === 'sleep' ? '正在让它进 DORMANT……关窗只是你走了，/sleep 才是让它睡。' : undefined;
  return {
    ...(overlay ? { overlay } : {}),
    ...(notice ? { notice } : {}),
    exit: name === 'exit',
    forward: core.surfaces.includes('resident'),
  };
}

export function overlayRows(view: TuiView, width: number, env: RenderEnv): Row[] {
  const overlay = view.overlay;
  if (!overlay) return [];
  switch (overlay.kind) {
    case 'palette':
      return paletteRows(view, overlay.query, width, env, view.paletteIndex);
    case 'status':
      return boxed('状态', statusLines(view), width, env);
    case 'context':
      return boxed('上下文', contextLines(view), width, env);
    case 'dream':
      return boxed('做梦产物', dreamLines(view), width, env);
    case 'commitments':
      return boxed('承诺册', commitmentLines(view), width, env);
    case 'help':
      return boxed('帮助', helpLines(view), width, env);
    case 'info':
      return boxed(overlay.title, [view.commandResult?.text ?? '（等待常驻进程回答……）'], width, env);
    default:
      return [];
  }
}

export function paletteRows(view: TuiView, query: string, width: number, env: RenderEnv, index = 0): Row[] {
  const matches = filterCommands(query, paletteCommands(view));
  const rows: Row[] = [[seg(' 命令', 'bold')]];
  rows.push([seg(` > ${query}`, 'accent')]);
  matches.forEach((command, at) => {
    const selected = at === index;
    // The argument hint rides in the palette row (`/model <名称>`), which is the whole point of
    // carrying it: a plugin command that needs an argument says so where the user completes it.
    const label = truncate(command.argumentHint ? `${command.name} ${command.argumentHint}` : command.name, 16).padEnd(16, ' ');
    rows.push([
      seg(`  ${selected ? '>' : ' '} /${label}`, selected ? 'accent' : 'plain'),
      seg(truncate(command.description, Math.max(1, width - 21)), selected ? 'accent' : 'dim'),
    ]);
  });
  if (matches.length === 0) rows.push([seg('   （无匹配）', 'dim')]);
  rows.push([seg(' ↑↓ 选择 · Tab 补全 · Enter 运行 · Esc 关闭', 'dim')]);
  return clip(rows, width);
}

function statusLines(view: TuiView): string[] {
  const presence = view.presence;
  const dreams = view.lastDream ? `${view.lastDream.localDate}（${view.lastDream.eventCount} 条事件）` : presence?.dreams[0] ? `${presence.dreams[0].localDate}（${presence.dreams[0].eventCount} 条事件）` : '本会话暂无记录';
  const pending = view.commitments.filter((item) => item.status === 'pending' || item.status === 'confirmed').length;
  const dueSoon = view.commitments.filter((item) => item.status === 'confirmed' && item.updatedAt > 0).length;
  return [
    `生命周期：${LIFECYCLE_WORD[view.lifecycle]}`,
    `内核：${view.status.kernelConnected ? '已连接' : '断开（只读降级）'}`,
    `最近做梦：${dreams}`,
    `快照新鲜度：${view.snapshotNote ?? '由常驻进程在下次附着时报告'}`,
    `本日预算消耗：${compactNumber(view.status.costTokens)} token`,
    `待浮现攒压：${presence?.emergence.length ?? 0} 条`,
    `临期承诺：${dueSoon} 条（待办 ${pending} 条）`,
    `下次唤醒：${view.status.nextWakeAt === undefined ? '无安排' : formatWakeAt(view.status.nextWakeAt, view.status.timeZone)}`,
  ];
}

function contextLines(view: TuiView): string[] {
  const status = view.status;
  const ratios = Math.round((status.contextTokens / Math.max(1, status.contextSweetSpot)) * 100);
  const cache = status.promptCache;
  return [
    `当前组装上下文：约 ${compactNumber(status.contextTokens)} token（甜点带宽 ${compactNumber(status.contextSweetSpot)}，${ratios}%）`,
    // Reported, not estimated (#165 round 21): the line exists only when the provider sent a cache
    // field, and it is labelled as the provider's number so the estimate above is never read as it.
    ...(cache ? [`prompt 缓存（provider 实报）：命中 ${cache.percent}%（命中 ${compactNumber(cache.hit)} / 未命中 ${compactNumber(cache.miss)} token）`] : []),
    '车道构成：钉死 / 画像 / 摘要 / 工作集 / 召回 / 尾巴',
    '本壳未接入 F14 车道控制器，上面是总量估算，不是车道明细。',
    `模型路线：${status.model}`,
  ];
}

function dreamLines(view: TuiView): string[] {
  const product = view.lastDream ?? view.presence?.dreams[0];
  if (!product) return ['本会话尚无做梦产物。', view.commandResult?.name === 'dream' ? view.commandResult.text : ''];
  return [`${product.localDate} · ${product.eventCount} 条事件`, ...product.summary.split('\n')];
}

function commitmentLines(view: TuiView): string[] {
  const items = view.commitments.length > 0 ? view.commitments : (view.presence?.commitments ?? []);
  if (items.length === 0) return ['承诺册为空。'];
  return items.map((item) => `${statusWord(item.status)} · ${item.title}`);
}

function statusWord(status: string): string {
  return ({ pending: '待确认', confirmed: '已确认', deferred: '已推迟', completed: '已兑现', rejected: '已拒绝', expired: '已过期' } as Record<string, string>)[status] ?? status;
}

function helpLines(view: TuiView): string[] {
  return [
    'Enter 发送 · Shift+Enter 换行',
    '↑↓ 历史 / 多行移动；输入为空时选择工具块',
    'Enter 展开或折叠选中的工具块',
    'PageUp/PageDown 滚动对话；回到底部恢复跟随',
    'Ctrl+U 清行 · Ctrl+W 删词 · Esc 撤回排队消息',
    '/ 命令面板 · @ 文件补全',
    '提议出现时：Enter 执行 · Esc 放弃（提议不会自己执行）',
    '',
    `关窗只是断开附着；让它睡是 /sleep。当前状态 ${LIFECYCLE_WORD[view.lifecycle]}。`,
  ];
}

function boxed(title: string, lines: string[], width: number, env: RenderEnv): Row[] {
  const glyphs = env.unicode
    ? { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' }
    : { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
  const inner = Math.max(1, width - 2);
  const heading = ` ${title} `;
  const rows: Row[] = [[seg(`${glyphs.tl}${heading}${glyphs.h.repeat(Math.max(0, inner - cellWidth(heading)))}${glyphs.tr}`, 'border')]];
  for (const line of lines) {
    for (const wrapped of wrapPlain(line, inner - 2)) {
      rows.push([seg(glyphs.v, 'border'), seg(` ${truncate(wrapped, inner - 2).padEnd(Math.max(0, inner - 2))} `, 'plain'), seg(glyphs.v, 'border')]);
    }
  }
  rows.push([seg(`${glyphs.bl}${glyphs.h.repeat(inner)}${glyphs.br}`, 'border')]);
  rows.push([seg(' Esc 关闭', 'dim')]);
  return clip(rows, width);
}

function clip(rows: Row[], width: number): Row[] {
  return rows.map((row) => {
    const text = row.map((segment) => segment.text).join('');
    if (cellWidth(text) <= width) return row;
    return [seg(truncate(text, width), row[0]?.style ?? 'plain')];
  });
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
