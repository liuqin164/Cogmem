import { randomUUID } from 'node:crypto';

import type { ContextIntent, ContextLayer } from '../../context/ContextCortex.js';
import type { StrategyCapsule, StrategyTemplateId } from '../../strategy/StrategyCapsule.js';

export type MemoryUseViolation =
  | 'exact_quote_without_source'
  | 'superseded_memory_used'
  | 'cross_project_memory_used'
  | 'assistant_only_user_belief'
  | 'memory_budget_exceeded'
  | 'required_layer_missing'
  | 'strategy_layer_mismatch'
  | 'unconfirmed_prospective_used'
  | 'strategy_context_persisted';

export interface JudgedMemorySelection {
  id: string;
  layer: ContextLayer;
  hasSourceEvidence: boolean;
  superseded?: boolean;
  crossProject?: boolean;
  ownership?: 'user' | 'project' | 'system';
  sourceRoles?: string[];
  prospectiveConfirmed?: boolean;
  containsStrategyContext?: boolean;
}

export interface MemoryUseJudgeInput {
  receiptId: string;
  capsule: StrategyCapsule;
  selected: JudgedMemorySelection[];
  usedTokens: number;
  budgetTokens: number;
  latencyMs: number;
  exactSourceMatched?: boolean;
  createdAt?: number;
}

export interface StrategyRolloutOutcome {
  outcomeId: string;
  receiptId: string;
  projectId?: string;
  strategyId: string;
  strategyTemplate: StrategyTemplateId;
  intent: ContextIntent;
  score: number;
  followedStrategy: boolean;
  violations: MemoryUseViolation[];
  usefulMemoryIds: string[];
  harmfulMemoryIds: string[];
  missingLayers: ContextLayer[];
  sourceFidelity: number;
  unsafeLeak: boolean;
  staleLeak: boolean;
  crossProjectLeak: boolean;
  overBudget: boolean;
  latencyMs: number;
  createdAt: number;
}

const SEVERE = new Set<MemoryUseViolation>([
  'exact_quote_without_source',
  'cross_project_memory_used',
  'assistant_only_user_belief',
  'unconfirmed_prospective_used',
  'strategy_context_persisted',
]);

export class MemoryUseJudge {
  judge(input: MemoryUseJudgeInput): StrategyRolloutOutcome {
    const violations = new Set<MemoryUseViolation>();
    const allowedLayers = new Set([...input.capsule.primaryLayers, ...input.capsule.secondaryLayers]);
    const harmful = new Set<string>();
    const missingLayers: ContextLayer[] = [];

    for (const selected of input.selected) {
      if (selected.superseded) mark('superseded_memory_used', selected.id);
      if (selected.crossProject) mark('cross_project_memory_used', selected.id);
      if (selected.ownership === 'user' && !selected.sourceRoles?.includes('user')) {
        mark('assistant_only_user_belief', selected.id);
      }
      if (selected.layer === ('prospective' as ContextLayer) && selected.prospectiveConfirmed !== true) {
        mark('unconfirmed_prospective_used', selected.id);
      }
      if (selected.containsStrategyContext) mark('strategy_context_persisted', selected.id);
      if (!allowedLayers.has(selected.layer)) mark('strategy_layer_mismatch', selected.id);
    }

    const rawSourceSelected = input.selected.some((item) => (
      item.layer === 'raw_source' || item.layer === 'graph'
    ) && item.hasSourceEvidence);
    if (input.capsule.sourcePolicy === 'required' && !rawSourceSelected) {
      violations.add('exact_quote_without_source');
      violations.add('required_layer_missing');
      missingLayers.push('raw_source');
    }
    if (input.usedTokens > input.budgetTokens) violations.add('memory_budget_exceeded');

    const severeCount = [...violations].filter((violation) => SEVERE.has(violation)).length;
    const ordinaryCount = violations.size - severeCount;
    const score = clamp01(1 - severeCount * 0.25 - ordinaryCount * 0.12);
    const unsafeLeak = [...violations].some((violation) => SEVERE.has(violation) && violation !== 'exact_quote_without_source');
    const sourceFidelity = input.capsule.sourcePolicy === 'required'
      ? (input.exactSourceMatched ?? rawSourceSelected ? 1 : 0)
      : (input.exactSourceMatched === false ? 0 : 1);

    return {
      outcomeId: `context-outcome-${randomUUID()}`,
      receiptId: input.receiptId,
      projectId: input.capsule.projectId,
      strategyId: input.capsule.capsuleId,
      strategyTemplate: input.capsule.templateId,
      intent: input.capsule.intent,
      score,
      followedStrategy: violations.size === 0,
      violations: [...violations].sort(),
      usefulMemoryIds: input.selected.map((item) => item.id).filter((id) => !harmful.has(id)),
      harmfulMemoryIds: [...harmful].sort(),
      missingLayers,
      sourceFidelity,
      unsafeLeak,
      staleLeak: violations.has('superseded_memory_used'),
      crossProjectLeak: violations.has('cross_project_memory_used'),
      overBudget: violations.has('memory_budget_exceeded'),
      latencyMs: Math.max(0, input.latencyMs),
      createdAt: input.createdAt ?? Date.now(),
    };

    function mark(violation: MemoryUseViolation, id: string): void {
      violations.add(violation);
      harmful.add(id);
    }
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
