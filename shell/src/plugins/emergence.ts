/**
 * The emergence decision point, in conservative mode until F6 (#160) and F8 (#162) land.
 *
 * The kernel offers recall, not a candidate surface: no reason, no confidence, no sensitivity grade,
 * no "is this suppressed" flag on an item. So this service takes recall items, applies a deterministic
 * low-sensitivity filter of its own, and either hands back one candidate or records why it stayed
 * quiet. It never asks the model a question to manufacture a candidate — the query is always the last
 * thing the user actually said.
 */
import type { KernelAgentMemoryBackend } from 'cogmem';
import type { TraceLog } from '../trace.ts';
import type { NativePlugin } from './host.ts';

export interface EmergenceConfig {
  limit: number;
  /** F10's list is not landed; these are the conservative stand-ins for high-sensitivity life topics. */
  highSensitivityTerms: string[];
}

export interface EmergenceCandidate {
  id: string;
  text: string;
  reason: string;
  sensitivity: 'low';
  sourceRefs: Array<{ eventId?: string; sourceId?: string; contentHash?: string }>;
}

export interface EmergenceDecision {
  mode: 'conservative';
  query: string;
  candidates: EmergenceCandidate[];
  suppressed: Array<{ id: string; reason: string }>;
  decidedAt: number;
}

export class EmergenceService {
  constructor(
    private readonly backend: KernelAgentMemoryBackend,
    private readonly options: { agentId: string; projectId: string; trace?: TraceLog; config?: Partial<EmergenceConfig> },
  ) {}

  private get config(): EmergenceConfig {
    return {
      limit: this.options.config?.limit ?? 5,
      highSensitivityTerms: this.options.config?.highSensitivityTerms ?? DEFAULT_HIGH_SENSITIVITY_TERMS,
    };
  }

  /**
   * `query` is the last observed user text; an empty query produces no candidate at all. That is the
   * line against "定时自问自答": without something the user said, there is nothing to surface.
   */
  decide(query: string | undefined, now = Date.now()): EmergenceDecision {
    const text = (query ?? '').trim();
    if (!text) {
      const decision: EmergenceDecision = { mode: 'conservative', query: '', candidates: [], suppressed: [], decidedAt: now };
      this.options.trace?.append('emergence_decision', { ...decision, reason: 'no_user_query' });
      return decision;
    }
    const result = this.backend.recall({ agentId: this.options.agentId, projectId: this.options.projectId, query: text, limit: this.config.limit });
    const suppressed: Array<{ id: string; reason: string }> = [];
    const candidates: EmergenceCandidate[] = [];
    for (const item of result.items) {
      const reason = suppressReason(item, this.config);
      if (reason) {
        suppressed.push({ id: item.id, reason });
        continue;
      }
      candidates.push({
        id: item.id,
        text: item.text,
        reason: item.whyMatched ?? 'recall item matched the last user topic',
        sensitivity: 'low',
        sourceRefs: item.sourceAnchor?.eventId ? [{ eventId: item.sourceAnchor.eventId, sourceId: item.source }] : [],
      });
    }
    const decision: EmergenceDecision = { mode: 'conservative', query: text, candidates, suppressed, decidedAt: now };
    this.options.trace?.append('emergence_decision', {
      query: text,
      candidates: candidates.map((candidate) => candidate.id),
      suppressed,
      recallMode: result.recallMode,
    });
    return decision;
  }
}

export const DEFAULT_HIGH_SENSITIVITY_TERMS: string[] = [
  // Health
  '病历', '诊断', '处方', '药', '手术', '体检', '抑郁', '焦虑', '住院', 'diagnosis', 'medication', 'therapy',
  // Money
  '工资', '薪水', '银行卡', '信用卡', '转账', '借款', '负债', 'salary', 'bank', 'debt', 'invoice',
  // Family / private life
  '离婚', '吵架', '家庭', '孩子', '怀孕', 'divorce', 'pregnan',
];

function suppressReason(item: { id: string; text: string; tags?: string[]; redaction?: unknown }, config: EmergenceConfig): string | undefined {
  if (item.redaction) return 'redacted_content';
  const haystack = `${item.text} ${(item.tags ?? []).join(' ')}`.toLowerCase();
  const term = config.highSensitivityTerms.find((candidate) => haystack.includes(candidate.toLowerCase()));
  if (term) return `high_sensitivity_term:${term}`;
  return undefined;
}

/** The decision point as a plugin: it can be swapped for a stricter policy without touching the shell. */
export function emergencePlugin(options: { agentId: string; projectId: string; config?: Partial<EmergenceConfig> }): NativePlugin {
  return {
    name: 'emergence',
    inject: ['memory', 'trace'],
    provide: ['emergence'],
    apply(ctx) {
      const service = new EmergenceService(ctx.getService<KernelAgentMemoryBackend>('memory'), {
        agentId: options.agentId,
        projectId: options.projectId,
        trace: ctx.getService<TraceLog>('trace'),
        config: options.config,
      });
      ctx.provide('emergence', service);
    },
  };
}
