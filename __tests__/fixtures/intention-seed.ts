import type { MemoryEventRole } from '../../src/types/index.js';

/**
 * The F22 seed evaluation set (#216): the agent's own plans that must be captured beside the
 * shapes that must not be. It is data so the recognition gate measures precision and recall
 * instead of trusting the rules by inspection.
 *
 * The negatives include the two books' boundary: a dated first-person promise is F16's, not an
 * intention, and another speaker's plan is not the agent's plan.
 */

export const INTENTION_SEED_NOW = Date.UTC(2026, 10, 15, 9);

export interface IntentionSeedPositive {
  text: string;
  role: MemoryEventRole;
}

export interface IntentionSeedNegative {
  text: string;
  role: MemoryEventRole;
}

export const INTENTION_SEED_POSITIVES: IntentionSeedPositive[] = [
  { text: '我准备把报告整理一下。', role: 'assistant' },
  { text: '我计划先把接口文档补上。', role: 'assistant' },
  { text: '我决定把这段重构一下。', role: 'assistant' },
  { text: '我准备把测试补齐。', role: 'assistant' },
  { text: '我准备把这批日志清掉。', role: 'assistant' },
  { text: '我计划先跑一遍回归。', role: 'assistant' },
  { text: '我安排先把缓存层换掉。', role: 'assistant' },
  { text: '我准备把依赖升级。', role: 'assistant' },
];

export const INTENTION_SEED_NEGATIVES: IntentionSeedNegative[] = [
  // F16 owns promise shape, including a dated first-person plan.
  { text: '我明天把文件发你。', role: 'assistant' },
  { text: '我周五前把报告整理好。', role: 'assistant' },
  { text: '我准备明天把文件发你。', role: 'assistant' },
  // The plan is the owner's, not the agent's.
  { text: '我准备把报告整理一下。', role: 'user' },
  // Questions, hypotheticals, hedges, habits, the past, wishes and negation.
  { text: '我准备明天去吗？', role: 'assistant' },
  { text: '如果明天下雨，我准备不去了。', role: 'assistant' },
  { text: '我可能准备把报告整理一下。', role: 'assistant' },
  { text: '我一般准备周五交报告。', role: 'assistant' },
  { text: '我昨天准备把报告整理一下。', role: 'assistant' },
  { text: '我希望把报告整理好。', role: 'assistant' },
  { text: '我不准备把报告整理一下。', role: 'assistant' },
  // A plural subject is not the agent's own plan.
  { text: '我们准备把报告整理一下。', role: 'assistant' },
  // Ordinary talk with no plan.
  { text: '今天好累。', role: 'assistant' },
  { text: '他说他明天要去跑步。', role: 'assistant' },
];
