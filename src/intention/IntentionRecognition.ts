/**
 * Intention recognition (F22 of #216): the deterministic rules the hot path runs.
 *
 * An intention is the agent's own plan. The commitment recognizer is the authority on promise
 * shape: a clause it claims is a commitment, so the intention rules refuse it. That is what keeps
 * the two books isolated without changing F16.
 *
 * The rules are lexical and structural: an agent/assistant clause with a first person, a plan
 * marker and an action. Questions, hypotheticals, hedges, habits, the past, negation and wishes are
 * refused. A miss is silent; the seed set measures precision and recall instead of trusting the
 * rules by inspection.
 */

import {
  parseCommitmentDue,
  recognizeCommitments,
} from '../commitment/index.js';
import type { MemoryEventRole } from '../types/index.js';

export const INTENTION_ORIGINS = ['conversation', 'dream'] as const;
export type IntentionOrigin = (typeof INTENTION_ORIGINS)[number];

export interface IntentionSignal {
  /** The clause, quoted. Never a paraphrase. */
  content: string;
  dueAt?: number;
}

/** A plan marker. These are the self-plan verbs F16's promise rule does not claim. */
const PLAN = /(计划|准备|决定|安排)/;

/** What the plan is about. The marker alone ("我准备一下") is not a plan. */
const ACTION = /(整理|补|重构|跑|清|换|升级|写|改|做|弄|处理|安排|确认|联系|上传|准备|检查|测试|提交|完成|跟进|更新|修|删|迁移|部署|验证|review|refactor|write|fix|update|test|migrate|deploy|clean|build|ship)/i;

/** An intention needs a subject; a bare imperative is not the agent's plan. */
const FIRST_PERSON = /我(?!们)/;

const PAST = /(昨天|前天|上周|上个月|上次|之前|以前|刚才|刚刚|已经|早就|used to|yesterday|last\s+week|last\s+month)/i;
const HYPOTHETICAL = /(如果|要是|假如|万一|倘若|一旦|若能|if\s+)/i;
const HEDGE = /(可能|也许|说不定|大概|估计|或许|应该|不确定|不一定|说不准|可能性|尽量|maybe|perhaps|probably|might|may\b)/i;
const HABIT = /(一般|通常|每次|总是|平时|从不|usually|always|every\s+time)/i;
const NEGATION = /(不会|不打算|不准备|没打算|不用|不需要|没法|不能|不想|不去|won't|will\s+not|not\s+going\s+to)/i;
const WISH = /(希望|但愿|要是能|想(?:要|去|把)?|wish|hope)/i;

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
    || PAST.test(clause);
}

function contentOf(clause: string): string {
  return clause
    .replace(/^(好的|嗯|行|可以|那)[，,、\s]*/u, '')
    .replace(/[，,、\s]+$/u, '')
    .trim();
}

/**
 * Every self-plan in one agent turn, in clause order. Empty when the turn makes none, when the
 * speaker is not the agent, or when the clause is a promise F16 already owns.
 */
export function recognizeIntentions(input: {
  text: string;
  role: MemoryEventRole;
  occurredAt: number;
}): IntentionSignal[] {
  if (input.role !== 'assistant' && input.role !== 'agent') return [];
  const out: IntentionSignal[] = [];
  for (const clause of clausesOf(input.text)) {
    if (isRefused(clause)) continue;
    if (!FIRST_PERSON.test(clause) || !PLAN.test(clause) || !ACTION.test(clause)) continue;
    // A plan marker alone is not a plan; the clause needs something it is about.
    if (clause.replace(PLAN, '').replace(/[我，,、\s]/gu, '').length < 4) continue;
    // F16 owns promise shape. A clause it claims is a commitment, not an intention.
    if (recognizeCommitments({ text: clause, role: input.role, occurredAt: input.occurredAt }).length > 0) continue;
    const due = parseCommitmentDue(clause, input.occurredAt);
    out.push({ content: contentOf(clause), dueAt: due.dueAt });
  }
  return out;
}
