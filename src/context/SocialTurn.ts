/**
 * Social-turn gating: does this message carry anything to look up?
 *
 * The judgement is about content, not phrasing. Chinese small talk has unbounded variants — 这次谢谢你啦,
 * 太感谢了, 辛苦了, 麻烦你了, 不客气, 好的收到, 嗯嗯, 回头聊 — so a list of complete phrases always leaks.
 * What can be listed are the two ends: the fillers to strip (thanks, greetings, acknowledgements,
 * apologies, farewells, particles) and the cues that prove there is something to find (entities,
 * numbers, dates, content questions, memory cues, task verbs). Strip the fillers, then let the
 * residue decide: empty residue is small talk, a cue in the residue is a real turn, anything else is
 * the grey zone the caller handles with a relevance floor.
 *
 * This file is the canonical source. `ContextCortex` classifies with it (`social` intent, no layers),
 * `MemoryGate` shares its filler vocabulary, the Pi and Hermes adapters import it, and the OpenClaw
 * plugin's copy is generated from `socialTurnGateSource()` — there is no second hand-written list.
 *
 * Fail-open by construction, because the costs are asymmetric: suppressing a real question is an
 * incident, injecting one extra pleasantry is not. Anything the residue cannot disprove stays real.
 */

/** Fillers, longest-first at match time. Tokens, not whole phrases: the residue is what is left over. */
export const SOCIAL_FILLER_TOKENS: readonly string[] = [
  // thanks — the family the ticket measured as leaking in all three hosts
  '太感谢了', '太感谢', '非常感谢', '多谢了', '多谢', '谢谢你', '谢谢您', '谢谢啦', '谢谢', '謝謝',
  '感谢你', '感谢您', '感谢啦', '感谢', '感激', '辛苦了', '辛苦您', '辛苦啦', '辛苦', '麻烦你了',
  '麻烦您了', '麻烦你', '麻烦您', '麻烦啦', '麻烦', '劳驾', '费心', '有劳', 'thanks a lot', 'thank you',
  'thanks', 'thx', 'ty', 'arigatou',
  // greetings
  '早上好', '晚上好', '中午好', '下午好', '早安', '晚安', '哈喽', '你好呀', '你好', '您好', 'hi', 'hello',
  'hey', '嗨', '在吗', '在么',
  // acknowledgements and confirmations
  '好的呢', '好的呀', '好的', '好嘞', '好滴', '好呀', '收到啦', '收到', '明白啦', '明白', '明白了',
  '了解', '知道了', '晓得', '可以', '没问题', 'okay', 'ok', 'yes', '对的呢', '对的', '好', '行', '嗯嗯嗯',
  '嗯嗯', '嗯呢', '嗯', '哦哦', '哦', '噢', '是的', '对', '妥',
  // politeness and apologies
  '不客气', '别客气', '客气了', '客气', '没事', '没关系', '没关系啦', '抱歉', '对不起', '不好意思',
  'sorry', '打扰了', '打扰', '见谅',
  // farewells and soft closers
  '回头聊', '回头见', '下次聊', '晚点聊', '先这样', '就这样', '就这样吧', '再见', '拜拜', 'bye',
  'see you', 'later', '就这样了',
  // filler, laughter, softeners, particles
  '哈哈哈哈', '哈哈哈', '哈哈', '嘿嘿', '呵呵', '嘻嘻', '笑死', '厉害了', '不错', 'hmm', 'emmm', 'ehehe',
  '这次', '这回', '啦', '呀', '呢', '吧', '嘛', '咯', '咧', '耶', '滴', '哈', '哇', '哟', '唉', '诶',
  '喂', '了', '的', '啊', '哎',
].sort((a, b) => b.length - a.length);

/** What proves there is something to look up. Generous on purpose: failing to suppress is survivable. */
export const CONTENT_CUE_PATTERNS: readonly RegExp[] = [
  /\d/,                                                                    // numbers, versions, dates
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/,                                         // explicit dates
  /(今天|明天|昨天|前天|后天|上周|下周|本周|上个月|下个月|今年|去年|明年|周[一二三四五六日天]|星期[一二三四五六日天]|个月|年度)/,
  /(之前|以前|上次|上回|那次|那时候|那时|当时|记得|记不记得|说过|提过|讲过|曾经|原来的|原先)/,   // memory cues
  /(什么|啥|哪个|哪一个|哪里|哪儿|谁|多少|几个|几天|几点|怎么|怎样|如何|为什么|为何|是否|吗|呢\?|？|\?)/, // content questions
  /(部署|发布|上线|回滚|修复|修改|改动|更新|升级|迁移|配置|设置|安排|决定|处理|检查|排查|评审|复盘|写|加|删|实现|支持|调研|计划|方案|时间|日期|窗口|阈值|保留|归档|清理|权限|成本|预算|容量|告警|演练|值班|契约|接口|版本|依赖)/, // task verbs and domains
  /[A-Za-z][A-Za-z0-9_-]{2,}/,                                             // latin identifiers and names
];

const SKIPPABLE = /[\s\p{P}\p{S}]/u;

function isPunctuationOnly(text: string): boolean {
  return /^[\s\p{P}\p{S}]*$/u.test(text);
}

/**
 * Longest-match segmentation over the filler vocabulary, with backtracking, so a word is only
 * removed when the whole message can be covered by fillers. 「好看」 therefore survives (看 is not a
 * filler) while 「这次谢谢你啦」 dissolves completely — the property that makes a token list safe here.
 */
function fillerSpans(text: string): Array<{ start: number; end: number }> {
  const lowered = text.toLowerCase();
  const length = text.length;
  const reachable = new Array<boolean>(length + 1).fill(false);
  const from = new Array<number>(length + 1).fill(-1);
  reachable[0] = true;
  for (let index = 0; index < length; index += 1) {
    if (!reachable[index]) continue;
    // Punctuation, symbols and spaces are not content: a comma between two fillers must not turn
    // 「好的，就这样吧」 into a turn with a residue.
    if (SKIPPABLE.test(text[index]!)) {
      reachable[index + 1] = true;
      from[index + 1] = index;
    }
    for (const token of SOCIAL_FILLER_TOKENS) {
      const end = index + token.length;
      if (end <= length && lowered.slice(index, end) === token.toLowerCase()) {
        reachable[end] = true;
        from[end] = index;
      }
    }
  }
  if (reachable[length]) {
    const spans: Array<{ start: number; end: number }> = [];
    let cursor = length;
    while (cursor > 0) {
      const start = from[cursor]!;
      spans.push({ start, end: cursor });
      cursor = start;
    }
    return spans.reverse();
  }
  // A message with real content in it cannot be covered by fillers, and that is the normal case.
  // Longest-match from the left still removes the fillers around it; being greedy can only leave a
  // filler behind, never eat a content word, which is the direction this gate is allowed to fail in.
  const greedy: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < length) {
    const token = SOCIAL_FILLER_TOKENS.find((candidate) => lowered.startsWith(candidate.toLowerCase(), index));
    if (token) {
      greedy.push({ start: index, end: index + token.length });
      index += token.length;
      continue;
    }
    if (SKIPPABLE.test(text[index]!)) {
      greedy.push({ start: index, end: index + 1 });
    }
    index += 1;
  }
  return greedy;
}

/** The message with its social fillers removed, and the cue that survived, if any. */
export function socialTurnResidue(text: string): { residue: string; cue?: string } {
  const spans = fillerSpans(text);
  let residue = '';
  let cursor = 0;
  for (const span of spans) {
    residue += text.slice(cursor, span.start);
    cursor = span.end;
  }
  residue += text.slice(cursor);
  const cue = CONTENT_CUE_PATTERNS.map((pattern) => pattern.exec(residue)?.[0]).find(Boolean);
  return cue === undefined ? { residue } : { residue, cue };
}

/**
 * Whether the turn is an acknowledgement pointing back at what is already on the table.
 *
 * 「好的，就按上次那个方案」 refers to the conversation, not to history: it should stay in the session
 * layer instead of dredging every past plan. The test is deliberately narrow — the only cue may be a
 * back-reference, and nothing new (number, date, latin entity, task verb) may come with it — so
 * 「上次部署时间改了吗」 remains a real question and keeps normal recall.
 */
const BACK_REFERENCE = /(上次|上回|刚才|刚刚|上面|那个|这个|之前|原先|原来|前一版|刚说|刚提)/;
const NEW_CONTENT = /(部署|发布|上线|回滚|修复|改动|更新|升级|迁移|配置|安排|决定|处理|检查|排查|评审|复盘|写|实现|支持|调研|时间|日期|窗口|阈值|保留|归档|清理|权限|成本|预算|容量|告警|演练|值班|契约|接口|版本|依赖|为什么|怎么|如何|多少|几点|哪个|什么时候|是否)/;
const ACK_LEAD = /^[\s\p{P}\p{S}]*(好的|好嘞|好滴|好|行|可以|没问题|嗯|收到|ok|okay)/iu;

export function isContinuationReference(text: string): boolean {
  const { residue, cue } = socialTurnResidue(text);
  if (cue === undefined || !BACK_REFERENCE.test(cue)) return false;
  const rest = residue.split(cue).join('');
  if (/\d/.test(rest) || /[A-Za-z][A-Za-z0-9_-]{2,}/.test(rest) || NEW_CONTENT.test(rest)) return false;
  return ACK_LEAD.test(text);
}

export type SocialTurnVerdict = 'social' | 'real' | 'grey';

/**
 * `social` — nothing but fillers is left, so there is nothing to look up.
 * `real`   — a cue survived, so the turn is about something.
 * `grey`   — words are left that prove nothing either way; the caller decides with a relevance floor.
 */
export function classifySocialTurn(text: string): SocialTurnVerdict {
  const { residue, cue } = socialTurnResidue(text);
  if (cue !== undefined) return 'real';
  if (isPunctuationOnly(residue)) return 'social';
  return 'grey';
}

/** Whether the turn is pure small talk — the verdict that suppresses recall entirely. */
export function isSocialTurn(text: string): boolean {
  return classifySocialTurn(text) === 'social';
}

/**
 * The rules as a standalone JavaScript function body, for the OpenClaw plugin, whose file is written
 * by the installer and cannot import TypeScript. The installer embeds this, so the plugin carries the
 * same vocabulary rather than a hand-copied third version.
 */
export function socialTurnGateSource(): string {
  return [
    `const SOCIAL_FILLER_TOKENS = ${JSON.stringify(SOCIAL_FILLER_TOKENS)};`,
    `const CONTENT_CUE_SOURCES = ${JSON.stringify(CONTENT_CUE_PATTERNS.map((pattern) => pattern.source))};`,
    `const SKIPPABLE = /[\\s\\p{P}\\p{S}]/u;`,
    `function fillerSpans(text, lowered) {`,
    `  const length = lowered.length;`,
    `  const reachable = new Array(length + 1).fill(false);`,
    `  const from = new Array(length + 1).fill(-1);`,
    `  reachable[0] = true;`,
    `  for (let index = 0; index < length; index += 1) {`,
    `    if (!reachable[index]) continue;`,
    `    if (SKIPPABLE.test(text[index])) { reachable[index + 1] = true; from[index + 1] = index; }`,
    `    for (const token of SOCIAL_FILLER_TOKENS) {`,
    `      const end = index + token.length;`,
    `      if (end <= length && lowered.slice(index, end) === token) { reachable[end] = true; from[end] = index; }`,
    `    }`,
    `  }`,
    `  if (reachable[length]) {`,
    `    const spans = [];`,
    `    let cursor = length;`,
    `    while (cursor > 0) { const start = from[cursor]; spans.push([start, cursor]); cursor = start; }`,
    `    return spans.reverse();`,
    `  }`,
    `  const greedy = [];`,
    `  let index = 0;`,
    `  while (index < length) {`,
    `    const token = SOCIAL_FILLER_TOKENS.find((candidate) => lowered.startsWith(candidate, index));`,
    `    if (token) { greedy.push([index, index + token.length]); index += token.length; continue; }`,
    `    if (SKIPPABLE.test(text[index])) greedy.push([index, index + 1]);`,
    `    index += 1;`,
    `  }`,
    `  return greedy;`,
    `}`,
    `function classifySocialTurn(text) {`,
    `  const CONTENT_CUE_PATTERNS = CONTENT_CUE_SOURCES.map((source) => new RegExp(source));`,
    `  const raw = String(text ?? '');`,
    `  const lowered = raw.toLowerCase();`,
    `  const spans = fillerSpans(raw, lowered);`,
    `  let residue = '';`,
    `  let cursor = 0;`,
    `  for (const span of spans) { residue += lowered.slice(cursor, span[0]); cursor = span[1]; }`,
    `  residue += lowered.slice(cursor);`,
    `  if (CONTENT_CUE_PATTERNS.some((pattern) => pattern.test(residue))) return 'real';`,
    `  return /^[\\s\\p{P}\\p{S}]*$/u.test(residue) ? 'social' : 'grey';`,
    `}`,
    `const BACK_REFERENCE = ${JSON.stringify(BACK_REFERENCE.source)};`,
    `const NEW_CONTENT = ${JSON.stringify(NEW_CONTENT.source)};`,
    `const ACK_LEAD = ${JSON.stringify(ACK_LEAD.source)};`,
    `function socialTurnResidue(text) {`,
    `  const raw = String(text ?? '');`,
    `  const lowered = raw.toLowerCase();`,
    `  const spans = fillerSpans(raw, lowered);`,
    `  let residue = '';`,
    `  let cursor = 0;`,
    `  for (const span of spans) { residue += lowered.slice(cursor, span[0]); cursor = span[1]; }`,
    `  residue += lowered.slice(cursor);`,
    `  const cue = CONTENT_CUE_SOURCES.map((source) => new RegExp(source).exec(residue)).map((match) => match && match[0]).find(Boolean);`,
    `  return { residue, cue };`,
    `}`,
    `function isContinuationReference(text) {`,
    `  const { residue, cue } = socialTurnResidue(text);`,
    `  if (cue === undefined || !new RegExp(BACK_REFERENCE).test(cue)) return false;`,
    `  const rest = residue.split(cue).join('');`,
    `  if (/\\d/.test(rest) || /[A-Za-z][A-Za-z0-9_-]{2,}/.test(rest) || new RegExp(NEW_CONTENT).test(rest)) return false;`,
    `  return new RegExp(ACK_LEAD, 'iu').test(String(text ?? ''));`,
    `}`,
  ].join('\n');
}
