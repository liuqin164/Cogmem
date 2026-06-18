export type AgentRecallIntent = 'memory_recall' | 'previous_session_summary' | 'forensic_quote';

export interface AgentRecallQueryCompileInput {
  query: string;
  intent?: AgentRecallIntent;
  anchorText?: string;
}

export interface AgentRecallQueryPlan {
  originalQuery: string;
  intent: AgentRecallIntent;
  primarySearchText: string;
  searchTexts: string[];
  keywords: string[];
  semanticCuePhrases: string[];
  temporalHints: string[];
  anchorUsed: boolean;
}

const PROTECTED_PHRASES = [
  'CogMem Memory Context',
  'Memory Context',
  'OpenClaw',
  'Hermes',
  'cogmem',
  'Obsidian',
  '记忆内核',
  '记忆黑盒',
  '黑盒',
  '记忆',
  '因果链',
  '原话',
  '上下文',
  '上下文噪声',
  '偏好',
  '项目',
  '约束',
  '边界',
  '库存',
  '配置',
  '安装',
  '更新',
  '重启',
  '报错',
  '错误',
  '工具',
];

const QUERY_FILLERS = [
  '我现在不是问你泛泛解释',
  '不是问你泛泛解释',
  '泛泛解释',
  '我不是要你',
  '我是问',
  '我想知道',
  '你还记不记得',
  '还记不记得',
  '你还记得',
  '还记得',
  '你记得吗',
  '记得吗',
  '我们之前讨论过关于',
  '我们之前讨论过',
  '之前讨论过',
  '当时我问你的',
  '当时的',
  '这个问题时',
  '这个问题',
  '的问题',
  '问题',
  '是什么',
  '什么',
  'the',
  'a',
  'an',
  'please',
];

const QUOTE_TERMS = new Set(['原话', 'exact', 'quote', 'verbatim']);

export function compileAgentRecallQuery(input: AgentRecallQueryCompileInput): AgentRecallQueryPlan {
  const originalQuery = normalizeWhitespace(input.query);
  const intent = input.intent ?? inferAgentRecallIntent(originalQuery);
  const anchorText = normalizeWhitespace(input.anchorText || '');
  const queryKeywords = extractRecallKeywords(originalQuery);
  const anchorKeywords = extractRecallKeywords(anchorText);
  const keywordSource = anchorKeywords.length > 0 && isVagueForensicFollowup(originalQuery)
    ? anchorKeywords
    : mergeKeywords(queryKeywords, anchorKeywords);
  const keywords = intent === 'forensic_quote'
    ? keywordSource.filter((keyword) => !QUOTE_TERMS.has(keyword.toLowerCase()))
    : keywordSource;
  const residual = stripFillers(originalQuery);
  const anchorResidual = stripFillers(anchorText);
  const semanticCuePhrases = buildSemanticCuePhrases(keywords, originalQuery, anchorText);
  const temporalHints = extractTemporalHints(originalQuery);
  const searchTexts = uniqueNonEmpty([
    joinKeywords(keywords),
    joinKeywords(queryKeywords.filter((keyword) => !QUOTE_TERMS.has(keyword.toLowerCase()))),
    joinKeywords(anchorKeywords.filter((keyword) => !QUOTE_TERMS.has(keyword.toLowerCase()))),
    ...semanticCuePhrases,
    residual && keywords.length === 0 ? residual : '',
    anchorResidual && keywords.length === 0 ? anchorResidual : '',
  ]).filter((candidate) => !containsFiller(candidate));

  return {
    originalQuery,
    intent,
    primarySearchText: searchTexts[0] || residual || originalQuery,
    searchTexts: searchTexts.length > 0 ? searchTexts : [originalQuery],
    keywords,
    semanticCuePhrases,
    temporalHints,
    anchorUsed: anchorKeywords.length > 0,
  };
}

export function inferAgentRecallIntent(query: string): AgentRecallIntent {
  const text = query.toLowerCase();
  if (/(上一个|上个|上一|上次).{0,12}(会话|session)|previous session|last session/.test(text)) {
    return 'previous_session_summary';
  }
  if (/原话|怎么说的|完整对话|上一句|下一句|exact quote|verbatim/.test(text)) {
    return 'forensic_quote';
  }
  return 'memory_recall';
}

export function extractRecallKeywords(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  const found: string[] = [];
  const lower = normalized.toLowerCase();
  for (const phrase of PROTECTED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      if (phrase === '记忆黑盒') {
        found.push('记忆', '黑盒');
      } else if (phrase === '记忆内核') {
        found.push('记忆');
      } else if (phrase === 'cogmem' && lower.includes('cogmem memory context')) {
        continue;
      } else if (phrase === 'Memory Context' && lower.includes('cogmem memory context')) {
        continue;
      } else if (phrase !== '上下文' && phrase !== '问题') {
        found.push(phrase);
      }
    }
  }

  for (const token of normalized.split(/[^\p{L}\p{N}_-]+/u)) {
    const cleaned = token.trim();
    if (!cleaned || cleaned.length < 3) continue;
    if (/^[\u4e00-\u9fff]+$/u.test(cleaned)) continue;
    if (lower.includes('cogmem memory context') && /^(cogmem|memory|context)$/i.test(cleaned)) continue;
    if (QUERY_FILLERS.some((filler) => filler.toLowerCase() === cleaned.toLowerCase())) continue;
    found.push(cleaned);
  }
  const existingKeywords = mergeKeywords(found);
  found.push(...extractCjkCueTerms(normalized).filter((term) => !existingKeywords.some((keyword) => (
    term.includes(keyword) || keyword.includes(term)
  ))));
  return mergeKeywords(found);
}

function isVagueForensicFollowup(query: string): boolean {
  const withoutFillers = stripFillers(query);
  const keywords = extractRecallKeywords(withoutFillers).filter((keyword) => !QUOTE_TERMS.has(keyword.toLowerCase()));
  return /原话|exact quote|verbatim/.test(query.toLowerCase()) && keywords.length === 0;
}

function stripFillers(value: string): string {
  let output = normalizeWhitespace(value);
  for (const filler of QUERY_FILLERS) {
    output = output.replace(new RegExp(escapeRegExp(filler), 'giu'), ' ');
  }
  return normalizeWhitespace(output.replace(/[，。？！、；：,.?!;:]/g, ' '));
}

function containsFiller(value: string): boolean {
  return QUERY_FILLERS.some((filler) => value.toLowerCase().includes(filler.toLowerCase()));
}

function joinKeywords(keywords: string[]): string {
  return mergeKeywords(keywords).join(' ');
}

function buildSemanticCuePhrases(keywords: string[], query: string, anchorText: string): string[] {
  const merged = mergeKeywords(keywords);
  const text = `${query}\n${anchorText}`;
  const out: string[] = [];
  const hasMemory = merged.includes('记忆') || /memory|CogMem|记忆/u.test(text);
  const hasBlackBox = merged.includes('黑盒') || /黑盒|black\s*box/iu.test(text);

  if (hasMemory && hasBlackBox) {
    out.push('记忆 黑盒');
    out.push('存档 黑盒');
    out.push('对话 存档 黑盒');
    out.push('上下文 黑盒');
    out.push('黑盒');
  } else if (hasBlackBox) {
    out.push('黑盒');
    out.push('存档 黑盒');
  }

  if (/原话|exact quote|verbatim/iu.test(text) && hasBlackBox) {
    out.push('黑盒 原话');
  }
  if (/CogMem Memory Context/iu.test(text)) {
    out.push('CogMem Memory Context');
    out.push('Memory Context');
  }
  if (merged.includes('库存') || /库存|inventory|stock/iu.test(text)) {
    out.push('库存管理');
    out.push('在库');
    out.push('产品コード');
    out.push('数量');
  }

  return uniqueNonEmpty(out);
}

function extractTemporalHints(query: string): string[] {
  const hints: string[] = [];
  if (/之前|以前|过去|几个月前|半年前|上个月|前几天|昨天|上次|上个|还记得|previous|before|last/i.test(query)) {
    hints.push('past');
  }
  if (/昨天|yesterday/i.test(query)) hints.push('yesterday');
  if (/上一个|上个|上次|previous|last/i.test(query)) hints.push('previous');
  return uniqueNonEmpty(hints);
}

function mergeKeywords(...groups: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const keyword of groups.flat()) {
    const normalized = normalizeWhitespace(keyword);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    if (normalized === '记忆内核' && seen.has('记忆')) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

const CJK_QUERY_STOP_PHRASES = [
  ...QUERY_FILLERS,
  '我们',
  '你们',
  '你',
  '我',
  '是否',
  '是不是',
  '有没有',
  '哪些',
  '哪个',
  '什么',
  '多少',
  '记录过',
  '聊过',
  '讨论过',
  '之前',
  '以前',
  '关于',
  '和',
  '这个',
  '那个',
  '问题',
  '的吗',
  '吗',
  '呢',
  '的',
  '了',
  '过',
];

function extractCjkCueTerms(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(/[\u3040-\u30ff\u3400-\u9fff]{2,}/gu)) {
    let chunk = match[0];
    for (const filler of CJK_QUERY_STOP_PHRASES) {
      chunk = chunk.replace(new RegExp(escapeRegExp(filler), 'giu'), ' ');
    }
    for (const part of chunk.split(/\s+/)) {
      const trimmed = part.trim();
      if (trimmed.length >= 2 && trimmed.length <= 12) candidates.push(trimmed);
      if (trimmed.length > 12) {
        for (let index = 0; index <= trimmed.length - 2 && candidates.length < 12; index += 2) {
          candidates.push(trimmed.slice(index, Math.min(index + 4, trimmed.length)));
        }
      }
    }
  }
  return candidates;
}

function uniqueNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map(normalizeWhitespace)) {
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
