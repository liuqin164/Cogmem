import { localDateRange, localDateFor, resolveTimeZone } from '../utils/LocalDateContext.js';

export interface CompiledAtlasQuery {
  text: string;
  tokens: string[];
  keywords: string[];
  target?: string;
  actionIntent: boolean;
  range?: { from: number; to: number; label: string };
  memoryKinds: string[];
}

const STOP_WORDS = new Set(['我', '你', '让', '对', '的', '年', '做过', '什么', '去年', '今年', 'the', 'a', 'an', 'what', 'did', 'do', 'to', 'last', 'year']);
const CJK_ACTIONS = '启动|重启|停止|执行|配置|连接|安装|修复|更新|升级|比较|操作|设置|调试|起動';
const LATIN_ACTIONS = [
  'restarted', 'launched', 'configured', 'connected', 'installed', 'repaired', 'updated', 'upgraded',
  'compared', 'stopped', 'started', 'restart', 'configure', 'connect', 'install', 'repair', 'update',
  'upgrade', 'compare', 'launch', 'stopped', 'setup', 'debug', 'start', 'stop', 'boot', 'run', 'ran', 'fix',
].sort((left, right) => right.length - left.length).join('|');
const ACTION_MARKERS = new RegExp(
  `${CJK_ACTIONS}|(?<![\\p{L}\\p{N}_])(?:${LATIN_ACTIONS})(?![\\p{L}\\p{N}_])`,
  'iu',
);
const MEMORY_KIND_MARKERS: Array<[RegExp, string]> = [
  [/决策|决定|decision/iu, 'decision'], [/修正|纠正|correction/iu, 'correction'],
  [/目标|goal/iu, 'goal'], [/偏好|preference/iu, 'preference'], [/计划|plan/iu, 'plan'],
  [/事件|经历|event/iu, 'event'], [/证据|原文|evidence/iu, 'evidence'],
  [/人物|person/iu, 'person'], [/地点|place/iu, 'place'], [/项目|project/iu, 'project'],
  [ACTION_MARKERS, 'action'],
];

export function compileAtlasQuery(query: string, context: number | { now?: number; localDateNow?: string; timeZone?: string } = {}): CompiledAtlasQuery {
  const options = typeof context === 'number' ? { now: context } : context;
  const now = options.now ?? Date.now();
  const text = String(query || '').trim().slice(0, 1000);
  const tokens = Array.from(new Set((text.match(/[\p{L}\p{N}_-]+/gu) || [])
    .map((item) => item.trim())
    .filter((item) => item.length > 1 && !STOP_WORDS.has(item.toLowerCase())))).slice(0, 24);
  const explicitYear = text.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/u)?.[1];
  let range: CompiledAtlasQuery['range'];
  if (explicitYear) {
    const year = Number(explicitYear);
    const resolved = localDateRange(year, 1, 1, year + 1, 1, 1, options.timeZone);
    range = { ...resolved, label: explicitYear };
  } else if (/去年|last year/iu.test(text)) {
    const currentYear = Number((options.localDateNow ?? localDateFor(now, resolveTimeZone(options.timeZone))).slice(0, 4));
    const year = currentYear - 1;
    const resolved = localDateRange(year, 1, 1, year + 1, 1, 1, options.timeZone);
    range = { ...resolved, label: String(year) };
  }
  const target = tokens.find((token) => /^[A-Z][\p{L}\p{N}_.-]*$/u.test(token))
    ?? tokens.find((token) => !/^\d{4}$/u.test(token)
      && !ACTION_MARKERS.test(token)
      && !MEMORY_KIND_MARKERS.some(([pattern]) => pattern.test(token)));
  const memoryKinds = MEMORY_KIND_MARKERS.filter(([pattern]) => pattern.test(text)).map(([, kind]) => kind);
  const keywords = tokens.filter((token) => token !== target
    && token !== explicitYear
    && !ACTION_MARKERS.test(token)
    && !MEMORY_KIND_MARKERS.some(([pattern]) => pattern.test(token)));
  return { text, tokens, keywords, target, actionIntent: ACTION_MARKERS.test(text), range, memoryKinds };
}

export function actionMarker(value: string): { frameType: string; action: string } | undefined {
  return actionMarkers(value)[0];
}

export function actionMarkers(value: string): Array<{ frameType: string; action: string; index: number; end: number; clause: string; ordinal: number }> {
  const matches = [...value.matchAll(new RegExp(ACTION_MARKERS.source, 'giu'))];
  return matches.map((match, ordinal) => {
    const index = match.index;
    const end = index + match[0].length;
    const action = normalizeAction(match[0].toLocaleLowerCase());
    return {
      frameType: frameTypeForAction(action),
      action,
      index,
      end,
      clause: actionClause(value, index, end),
      ordinal,
    };
  });
}

function frameTypeForAction(lower: string): string {
  const frameType = /修复|fix|repair|调试|debug/u.test(lower) ? 'repair'
    : /重启|restart/u.test(lower) ? 'restart'
      : /启动|起動|start|launch|boot/u.test(lower) ? 'start'
        : /停止|stop/u.test(lower) ? 'stop'
          : /安装|install/u.test(lower) ? 'install'
            : /连接|connect/u.test(lower) ? 'connect'
              : /更新|升级|update|upgrade/u.test(lower) ? 'update'
                : /比较|compare/u.test(lower) ? 'compare'
                  : /配置|设置|configure|setup/u.test(lower) ? 'configuration'
                    : 'operation';
  return frameType;
}

function normalizeAction(action: string): string {
  const normalized: Record<string, string> = {
    started: 'start', launched: 'launch', restarted: 'restart', stopped: 'stop',
    configured: 'configure', connected: 'connect', installed: 'install', repaired: 'repair',
    updated: 'update', upgraded: 'upgrade', compared: 'compare', ran: 'run',
  };
  return normalized[action] ?? action;
}

function actionClause(value: string, index: number, end: number): string {
  const separators = [...value.matchAll(/[。！？!?；;，,\n]+|(?:然后|随后|并且|同时|そして|また|して|并|和|及|再)|(?:\s+(?:and|then)\s+)/giu)];
  let start = 0;
  let finish = value.length;
  for (const separator of separators) {
    const separatorStart = separator.index;
    const separatorEnd = separatorStart + separator[0].length;
    if (separatorEnd <= index) start = separatorEnd;
    else if (separatorStart >= end) {
      finish = separatorStart;
      break;
    }
  }
  return value.slice(start, finish).trim();
}
