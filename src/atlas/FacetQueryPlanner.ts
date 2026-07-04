import { extractEntityCues } from '../utils/EntityCueExtractor.js';
import { ACTION_KIND_RULES } from '../utils/ActionKindRegistry.js';

export type FacetType = 'time' | 'topic' | 'issue' | 'entity' | 'session' | 'thread' | 'memoryKind' | 'actionKind';
export type FacetOperator = 'intersection' | 'union';

export interface PlannedFacet {
  type: FacetType;
  value: string;
  label: string;
  nodeId?: string;
  relation?: string;
  granularity?: 'year' | 'month' | 'day';
  from?: number;
  to?: number;
}

export interface FacetQueryPlan {
  intent: string;
  operator: FacetOperator;
  facets: PlannedFacet[];
  temporalIntent?: 'timeline';
  groupBy?: 'topic' | 'time' | 'issue';
  exactness: 'strict' | 'relaxed';
  requiresIntersection: boolean;
  keywords: string[];
  query: string;
}

export interface FacetQueryPlannerOptions {
  projectId: string;
  now?: number;
  localDateNow?: string;
  timeZone?: string;
}

const ISSUE_RULES = [
  {
    value: 'memory-context-blackbox',
    label: 'Memory Context 黑盒',
    test: (text: string) => /(memory context|sourcecontext|source context|上下文.*黑盒|记忆上下文|原文下钻|摘要.*原话)/i.test(text),
  },
  {
    value: 'graph-runtime-blackbox',
    label: 'Graph Runtime 黑盒',
    test: (text: string) => /(memory graph|graph.*卡死|database locked|sqlite.*lock|zombie|僵尸进程|锁冲突|卡死)/i.test(text),
  },
  {
    value: 'atlas-readability',
    label: 'Atlas 可读性黑盒',
    test: (text: string) => /(atlas|图谱|节点|事件名称|父主题|多维|facet|canonical|可读性|标题)/i.test(text),
  },
  {
    value: 'auto-injection-mismatch',
    label: '自动注入不一致',
    test: (text: string) => /(自动注入|before_prompt_build|manual recall|手动.*recall|注入.*不一致|COGMEM_RECALL_CONTEXT)/i.test(text),
  },
];

const TOPIC_RULES = [
  {
    value: 'memory-blackbox',
    label: '记忆黑盒',
    test: (text: string) => /(记忆黑盒|memory.*blackbox|memory context|sourcecontext|graph.*卡死|atlas|自动注入|上下文.*黑盒)/i.test(text),
  },
  {
    value: 'source-drilldown',
    label: '原文下钻',
    test: (text: string) => /(sourcecontext|source context|原文下钻|摘要.*原文)/i.test(text),
  },
  {
    value: 'context-injection',
    label: '上下文注入',
    test: (text: string) => /(自动注入|context injection|before_prompt_build|COGMEM_RECALL_CONTEXT|注入)/i.test(text),
  },
];

export class FacetQueryPlanner {
  plan(query: string, options: FacetQueryPlannerOptions): FacetQueryPlan {
    const normalized = query.trim();
    const facets: PlannedFacet[] = [];
    const actionHistory = isActionHistoryQuery(normalized);
    const timeFacet = parseTimeFacet(normalized, options);
    if (timeFacet) facets.push(withNodeId(timeFacet, options.projectId));
    const timeline = /(后来|继续|timeline|演化|发展|之后)/i.test(normalized);
    const matchedIssueValues = new Set<string>();

    for (const rule of TOPIC_RULES) {
      if (rule.test(normalized)) {
        facets.push(withNodeId({ type: 'topic', value: `PROJECT/${options.projectId}/${rule.value}`, label: rule.label, relation: 'ABOUT_TOPIC' }, options.projectId));
      }
    }

    for (const rule of ISSUE_RULES) {
      if (rule.test(normalized)) {
        facets.push(withNodeId({ type: 'issue', value: rule.value, label: rule.label, relation: 'PART_OF_ISSUE' }, options.projectId));
        matchedIssueValues.add(rule.value);
      }
    }

    if (!timeline && isBroadMemoryBlackbox(normalized) && matchedIssueValues.size === 0) {
      facets.push(withNodeId({ type: 'issue', value: 'memory-context-blackbox', label: 'Memory Context 黑盒', relation: 'PART_OF_ISSUE' }, options.projectId));
    }

    for (const entity of extractEntityCues(normalized)) {
      if (!actionHistory && !/[A-Za-z]/.test(entity.label)) continue;
      facets.push({ type: 'entity', value: `facet:${entity.id}`, label: entity.label, nodeId: `entity:${options.projectId}:facet:${entity.id}`, relation: 'INVOLVES_ENTITY' });
      if (actionHistory) {
        facets.push(withNodeId({ type: 'topic', value: `PROJECT/${options.projectId}/${entity.id}`, label: entity.label, relation: 'ABOUT_TOPIC' }, options.projectId));
      }
    }

    for (const facet of parseKindFacets(normalized, options.projectId)) facets.push(facet);
    if (actionHistory && (!facets.some((facet) => facet.type === 'actionKind') || !hasSpecificActionCue(normalized))) {
      for (const value of ['started', 'installed', 'configured', 'restarted', 'stopped', 'operated', 'implemented', 'debugged']) {
        facets.push(withNodeId({ type: 'actionKind', value, label: value, relation: 'HAS_ACTION_KIND' }, options.projectId));
      }
    }

    return {
      intent: actionHistory ? 'action_history' : /聊过|记得|还记得|讨论|原话|那次/i.test(normalized) ? 'historical_discussion' : 'graph_search',
      operator: 'intersection',
      facets: dedupeFacets(facets),
      temporalIntent: timeline ? 'timeline' : undefined,
      groupBy: timeline ? 'time' : timeFacet && facets.length === 1 ? 'topic' : facets.some((facet) => facet.type === 'issue') ? 'issue' : undefined,
      exactness: 'strict',
      requiresIntersection: facets.length > 1,
      keywords: extractKeywords(normalized),
      query: normalized,
    };
  }
}

function isActionHistoryQuery(query: string): boolean {
  return /(让你.{0,20}(对|给|把)?.{0,20}(做过|做了|启动|安装|配置|修改|重启|停止|操作|处理|执行)|对.{0,30}(做过什么|做了什么|哪些操作)|what did (i ask you to do|you do) to|operations? on)/i.test(query);
}

function hasSpecificActionCue(query: string): boolean {
  return /(启动|start|started|launch|launched|boot|安装|install|installed|setup|配置|config|configured|设置|修改配置|重启|restart|停止|stop|修复|实现|implemented|review|审查|debug|排查|卡死|locked|zombie)/i.test(query);
}

function isBroadMemoryBlackbox(query: string): boolean {
  return /(记忆黑盒|memory.*blackbox)/i.test(query) &&
    !/(memory graph|graph|database locked|sqlite|zombie|僵尸|卡死|atlas|图谱|节点|事件名称|自动注入|before_prompt_build|manual recall|手动.*recall)/i.test(query);
}

function parseKindFacets(query: string, projectId: string): PlannedFacet[] {
  const facets: PlannedFacet[] = [];
  const memoryKindRules: Array<[string, RegExp]> = [
    ['bug', /(bug|问题|卡死|failure|故障|错误|报错)/i],
    ['decision', /(decision|决定|方案|结论)/i],
    ['plan', /(计划|下一步|策略|plan)/i],
  ];
  for (const [value, test] of memoryKindRules) {
    if (test.test(query)) facets.push(withNodeId({ type: 'memoryKind', value, label: value, relation: 'HAS_MEMORY_KIND' }, projectId));
  }
  for (const rule of ACTION_KIND_RULES) {
    if (rule.pattern.test(query)) facets.push(withNodeId({ type: 'actionKind', value: rule.kind, label: rule.kind, relation: 'HAS_ACTION_KIND' }, projectId));
  }
  return facets;
}

function parseTimeFacet(query: string, options: FacetQueryPlannerOptions): PlannedFacet | undefined {
  const currentYear = localYear(options);
  const isoDay = query.match(/(20\d{2})[-年\/.](\d{1,2})[-月\/.](\d{1,2})日?/);
  if (isoDay) return dayFacet(Number(isoDay[1]), Number(isoDay[2]), Number(isoDay[3]));
  const cnDay = query.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})(?:号|日)?/);
  if (cnDay) return dayFacet(cnDay[1] ? Number(cnDay[1]) : currentYear, Number(cnDay[2]), Number(cnDay[3]));
  const isoMonth = query.match(/(20\d{2})[-年\/.](\d{1,2})月?/);
  if (isoMonth) return monthFacet(Number(isoMonth[1]), Number(isoMonth[2]));
  const year = query.match(/\b(20\d{2})\b|((20\d{2})年)/);
  if (year) return yearFacet(Number(year[1] ?? year[3]));
  if (/去年/.test(query)) return yearFacet(currentYear - 1);
  return undefined;
}

function localYear(options: FacetQueryPlannerOptions): number {
  const explicit = options.localDateNow?.match(/^(20\d{2})-\d{2}-\d{2}$/u)?.[1];
  if (explicit) return Number(explicit);
  const now = options.now ?? Date.now();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: options.timeZone || 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now));
    const year = parts.find((part) => part.type === 'year')?.value;
    if (year) return Number(year);
  } catch { /* fall back below */ }
  return new Date(now).getUTCFullYear();
}

function dayFacet(year: number, month: number, day: number): PlannedFacet {
  const label = `${year}-${pad(month)}-${pad(day)}`;
  return {
    type: 'time',
    value: label,
    label,
    relation: 'OCCURRED_ON',
    granularity: 'day',
    from: Date.UTC(year, month - 1, day),
    to: Date.UTC(year, month - 1, day + 1),
  };
}

function monthFacet(year: number, month: number): PlannedFacet {
  const label = `${year}-${pad(month)}`;
  return {
    type: 'time',
    value: label,
    label,
    relation: 'OCCURRED_IN',
    granularity: 'month',
    from: Date.UTC(year, month - 1, 1),
    to: Date.UTC(year, month, 1),
  };
}

function yearFacet(year: number): PlannedFacet {
  const label = String(year);
  return {
    type: 'time',
    value: label,
    label,
    relation: 'OCCURRED_IN',
    granularity: 'year',
    from: Date.UTC(year, 0, 1),
    to: Date.UTC(year + 1, 0, 1),
  };
}

function withNodeId(facet: PlannedFacet, projectId: string): PlannedFacet {
  return {
    ...facet,
    nodeId: `${facet.type}:${projectId}:${facet.value}`,
  };
}

function dedupeFacets(facets: PlannedFacet[]): PlannedFacet[] {
  const seen = new Set<string>();
  return facets.filter((facet) => {
    const key = `${facet.type}:${facet.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractKeywords(query: string): string[] {
  return query
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
