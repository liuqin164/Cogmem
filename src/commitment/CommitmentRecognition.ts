/**
 * Commitment recognition (F16 of #193): the deterministic rules the hot path runs.
 *
 * No model decides whether a turn is a promise. The rules are lexical and structural: a future
 * marker, an action, and a first person (or a third party's promise verb with a recipient) — plus a
 * small set of refusals for questions, hypotheticals, hedges, habits, the past and negation. The
 * same clause yields its owner, its content and its due instant or event condition.
 *
 * Recognition is deliberately conservative. A miss is silent, so the seed evaluation set in
 * `__tests__/fixtures/commitment-seed.ts` measures precision and recall rather than trusting the
 * rules by inspection.
 */

import { profileCues } from '../profile/ProfileCompiler.js';
import type { MemoryEventRole } from '../types/index.js';

export const COMMITMENT_OWNERS = ['user', 'agent', 'third-party'] as const;
export type CommitmentOwner = (typeof COMMITMENT_OWNERS)[number];

export type CommitmentConfidence = 'explicit' | 'tentative';

export interface CommitmentSignal {
  owner: CommitmentOwner;
  /** The clause, quoted. Never a paraphrase. */
  content: string;
  dueAt?: number;
  dueCondition?: string;
  confidence: CommitmentConfidence;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** A future marker. `这周`/`本周` are deadlines as much as `下周` is. */
const FUTURE = /(明天|后天|大后天|今晚|今天|这周|本周|下周|下个?月|月底|周[一二三四五六日天]|星期[一二三四五六日天]|稍后|晚点|回头|尽快|等会|一会儿|马上|会|要|将|打算|[\d一二三四五六七八九十两]+\s*(天|日|小时|钟头|周|星期|个月)(后|之后|之内|以内)|tomorrow|tonight|today|next\s+week|next\s+month|soon|later|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i;

/** An action a promise can be about. Copulas and movement alone are not obligations. */
const ACTION = /(发|回|回复|答复|交|提交|送|寄|转|给|做|弄|处理|安排|确认|联系|上传|准备|续|签|订|约|问|查|修|改|写|跑|打|完成|跟进|催|通知|告诉|更新|还|补|整理|放|send|reply|finish|complete|follow\s+up|update|prepare|book|cancel|check)/i;

/** A promise needs a subject; a bare imperative ("明天记得带伞") is not one. */
const FIRST_PERSON = /我(?!们)/;
const FIRST_PERSON_PLURAL = /我们/;
const FIRST_PERSON_ENGLISH = /\bI(?:'ll| will| am going to|'m going to)\b/i;

const PAST = /(昨天|前天|上周|上个月|上次|之前|以前|刚才|刚刚|已经|早就|used to|yesterday|last\s+week|last\s+month)/i;
const HYPOTHETICAL = /(如果|要是|假如|万一|倘若|一旦|若能|if\s+)/i;
const HEDGE = /(可能|也许|说不定|大概|估计|或许|应该|不确定|不一定|说不准|可能性|尽量|maybe|perhaps|probably|might|may\b)/i;
const HABIT = /(一般|通常|每次|总是|平时|从不|usually|always|every\s+time)/i;
const NEGATION = /(不会|不打算|不准备|没打算|不用|不需要|没法|不能|不想|不去|won't|will\s+not|not\s+going\s+to)/i;
const WISH = /(希望|但愿|要是能|想(?:要|去|把)?|wish|hope)/i;

/** A third party's promise verb. */
const THIRD_PARTY = /(他|她|他们|她们|客服|对方|供应商|房东|同事|朋友|商家|银行|平台|卖家|买家)(说|答应|承诺|表示|称|会|将|said|promised)/i;
/** A third party's promise must be *to the owner*; a plan is not a promise. */
const THIRD_PARTY_RECIPIENT = /(给|向|对|回|答复|回复|发|联系|通知|告诉|还|送|寄|转|交|send|reply|answer|contact)(我|你|me|you)/i;

const CONDITION = /(发货|到货|收到|收货|开完会|会议结束|签约|审批通过|确认后)(之?后|以后|后)/;

const QUESTION_START = /^(你|您|能否|是否|可不可以|能不能|要不要|would\s+you|could\s+you|can\s+you|do\s+you)/i;

function clausesOf(text: string): string[] {
  return text
    .split(/[。！!；;\n]+/u)
    .map((clause) => clause.trim().replace(/^[，,、\s]+/u, ''))
    .filter(Boolean);
}

function isQuestion(clause: string): boolean {
  return /[？?]/u.test(clause) || /(吗|呢|么)\s*$/u.test(clause) || QUESTION_START.test(clause);
}

function isRefused(clause: string): boolean {
  return isQuestion(clause)
    || HYPOTHETICAL.test(clause)
    || HEDGE.test(clause)
    || HABIT.test(clause)
    || WISH.test(clause)
    || NEGATION.test(clause)
    // A past statement is not a promise; a clause with a future marker and a past one is left to
    // the future marker ("我昨天发了，明天再发一份" is not supported and fails closed).
    || (PAST.test(clause) && !FUTURE.test(clause));
}

function ownerFor(role: MemoryEventRole): CommitmentOwner {
  if (role === 'assistant' || role === 'agent') return 'agent';
  if (role === 'other') return 'third-party';
  return 'user';
}

/** The soft deadline the vague markers get; the document freezes this horizon. */
export const COMMITMENT_SOFT_DUE_MS = DAY_MS;

function startOfUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function weekdayIndex(token: string): number {
  const map: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  return map[token] ?? 1;
}

function chineseNumber(token: string): number {
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^\d+$/u.test(token)) return Number(token);
  if (token === '十') return 10;
  if (token.includes('十')) {
    const [tens, ones] = token.split('十');
    return (tens ? digits[tens] ?? 0 : 1) * 10 + (ones ? digits[ones] ?? 0 : 0);
  }
  return digits[token] ?? 1;
}

/**
 * The due instant or event condition a clause names. Explicit dates win over vague ones; an event
 * condition (`发货后`) yields no instant, because only the event can start its clock.
 */
export function parseCommitmentDue(text: string, now: number): { dueAt?: number; dueCondition?: string } {
  const condition = CONDITION.exec(text);
  if (condition) return { dueCondition: condition[0] };

  const clock = (value: number): { dueAt: number } => ({ dueAt: value });
  const dayStart = startOfUtcDay(now);

  let match = /([\d一二三四五六七八九十两]+)\s*(天|日)(?:之?后|之内|以内)/u.exec(text);
  if (match) return clock(now + chineseNumber(match[1]!) * DAY_MS);
  match = /([\d一二三四五六七八九十两]+)\s*(小时|钟头)(?:之?后|之内|以内)/u.exec(text);
  if (match) return clock(now + chineseNumber(match[1]!) * HOUR_MS);
  match = /([\d一二三四五六七八九十两]+)\s*(周|星期)(?:之?后|之内|以内)/u.exec(text);
  if (match) return clock(now + chineseNumber(match[1]!) * 7 * DAY_MS);
  match = /([\d一二三四五六七八九十两]+)\s*个?月(?:之?后|之内|以内)/u.exec(text);
  if (match) return clock(now + chineseNumber(match[1]!) * 30 * DAY_MS);

  match = /(\d{4})-(\d{2})-(\d{2})/u.exec(text);
  if (match) return clock(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 18));

  if (/大后天/u.test(text)) return clock(dayStart + 3 * DAY_MS + 18 * HOUR_MS);
  if (/后天/u.test(text)) return clock(dayStart + 2 * DAY_MS + 18 * HOUR_MS);
  if (/明天/u.test(text)) return clock(dayStart + DAY_MS + 18 * HOUR_MS);
  if (/今晚/u.test(text)) return clock(dayStart + 22 * HOUR_MS);
  if (/今天/u.test(text)) return clock(now + 8 * HOUR_MS);

  match = /下周([一二三四五六日天])/u.exec(text);
  if (match) {
    const current = new Date(dayStart).getUTCDay();
    const target = weekdayIndex(match[1]!);
    return clock(dayStart + (((target - current + 7) % 7) + 7) * DAY_MS + 18 * HOUR_MS);
  }
  match = /(?:周|星期)([一二三四五六日天])/u.exec(text);
  if (match) {
    const current = new Date(dayStart).getUTCDay();
    const target = weekdayIndex(match[1]!);
    return clock(dayStart + ((target - current + 7) % 7) * DAY_MS + 18 * HOUR_MS);
  }
  if (/下周/u.test(text)) return clock(now + 7 * DAY_MS);
  if (/这周|本周/u.test(text)) {
    const current = new Date(dayStart).getUTCDay();
    const end = dayStart + (7 - current) * DAY_MS + 18 * HOUR_MS;
    return clock(end > now ? end : now + DAY_MS);
  }
  if (/月底/u.test(text)) {
    const date = new Date(now);
    return clock(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 18));
  }
  if (/下个?月/u.test(text)) return clock(now + 30 * DAY_MS);

  match = /(\d{1,2})月(\d{1,2})[日号]/u.exec(text);
  if (match) {
    const date = new Date(now);
    let due = Date.UTC(date.getUTCFullYear(), Number(match[1]) - 1, Number(match[2]), 18);
    if (due <= now) due = Date.UTC(date.getUTCFullYear() + 1, Number(match[1]) - 1, Number(match[2]), 18);
    return clock(due);
  }

  if (/稍后|晚点|回头|等会|一会儿|马上|尽快|soon|later/u.test(text)) return clock(now + COMMITMENT_SOFT_DUE_MS);
  if (/tomorrow/u.test(text)) return clock(dayStart + DAY_MS + 18 * HOUR_MS);
  if (/tonight|today/u.test(text)) return clock(now + 8 * HOUR_MS);
  if (/next\s+week/u.test(text)) return clock(now + 7 * DAY_MS);
  if (/next\s+month/u.test(text)) return clock(now + 30 * DAY_MS);
  match = /(?:by|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.exec(text);
  if (match) {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const current = new Date(dayStart).getUTCDay();
    const target = names.indexOf(match[1]!.toLowerCase());
    return clock(dayStart + ((target - current + 7) % 7) * DAY_MS + 18 * HOUR_MS);
  }
  return {};
}

function contentOf(clause: string): string {
  return clause
    .replace(/^(好的|嗯|行|可以|那)[，,、\s]*/u, '')
    .replace(/[，,、\s]+$/u, '')
    .trim();
}

/**
 * Every explicit promise in one turn, in clause order. Empty when the turn makes none. At most one
 * signal per clause: a clause is the unit a due instant attaches to.
 */
export function recognizeCommitments(input: {
  text: string;
  role: MemoryEventRole;
  occurredAt: number;
}): CommitmentSignal[] {
  const out: CommitmentSignal[] = [];
  const roleOwner = ownerFor(input.role);
  for (const clause of clausesOf(input.text)) {
    if (isRefused(clause)) continue;

    // A third party's promise to the owner. Checked before the first-person rule because the owner
    // (`我`) is the recipient here, not the promiser.
    if (THIRD_PARTY.test(clause) && THIRD_PARTY_RECIPIENT.test(clause) && (FUTURE.test(clause) || CONDITION.test(clause))) {
      const due = parseCommitmentDue(clause, input.occurredAt);
      out.push({
        owner: 'third-party',
        content: contentOf(clause),
        dueAt: due.dueAt,
        dueCondition: due.dueCondition,
        // A reported promise is not the promiser's turn: it is recorded, but as the weaker grade.
        confidence: 'tentative',
      });
      continue;
    }

    const firstPerson = FIRST_PERSON.test(clause) || FIRST_PERSON_PLURAL.test(clause) || FIRST_PERSON_ENGLISH.test(clause);
    if (firstPerson && (FUTURE.test(clause) || CONDITION.test(clause)) && ACTION.test(clause)) {
      const due = parseCommitmentDue(clause, input.occurredAt);
      out.push({
        owner: roleOwner,
        content: contentOf(clause),
        dueAt: due.dueAt,
        dueCondition: due.dueCondition,
        // A promise whose trigger is an event is conditional until that event happens.
        confidence: due.dueCondition ? 'tentative' : 'explicit',
      });
    }
  }
  return out;
}

/** The single strongest signal, or null. */
export function recognizeCommitment(input: {
  text: string;
  role: MemoryEventRole;
  occurredAt: number;
}): CommitmentSignal | null {
  return recognizeCommitments(input)[0] ?? null;
}

export type CompletionEvidenceKind = 'completed' | 'ambiguous';

/** `completed` is the owner saying it is done; `ambiguous` is a hedge that needs one question. */
export function completionEvidence(text: string): CompletionEvidenceKind | null {
  const ambiguous = /(应该|好像|似乎|可能|大概|也许|不确定|记不清).{0,12}(发|回|交|提交|做完|弄完|搞定|完成|处理|办|续|签|订|送|寄)|(发|回|交|提交|完成|处理|办|续|签|订|送|寄)(过|了吧)|\b(should\s+have|might\s+have|probably)\b/iu;
  if (ambiguous.test(text)) return 'ambiguous';
  const explicit = /(已经|早就|刚刚|刚|终于)\s*(把)?.{0,10}(发|回|回复|答复|交|提交|做完|弄完|搞定|完成|处理好|办好|续|签|订|送到|更新|打|寄|转)|(发|回|回复|答复|交|提交|做完|弄完|搞定|完成|处理好|办好|续|签|订|送到|更新|寄|转)(了|好啦|好了|完了)|\b(done|sent|finished|completed)\b/iu;
  if (explicit.test(text)) return 'completed';
  return null;
}

/** Time words and pronouns are not content: two promises about Friday are not the same promise. */
const CUE_STOP = new Set([
  '明天', '后天', '今天', '今晚', '这周', '本周', '下周', '月底', '下周', '周一', '周二', '周三',
  '周四', '周五', '周六', '周日', '周天', '星期', '一会', '稍后', '晚点', '回头', '马上', '尽快',
  '我们', '你们', '他们', '她们', '这个', '那个', '时候',
  '已经', '然后', '并且', '还是', '就是', '可以', '应该', '可能', '自己',
]);

/** The content cues a completion turn must share with the promise before it may close it. */
export function commitmentContentCues(text: string): string[] {
  return profileCues(text).filter((cue) => cue.length >= 2 && !CUE_STOP.has(cue));
}

export function sharesCommitmentContent(promise: string, evidence: string): boolean {
  const wanted = new Set(commitmentContentCues(promise));
  if (wanted.size === 0) return true;
  return commitmentContentCues(evidence).some((cue) => wanted.has(cue));
}
