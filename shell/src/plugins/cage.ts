/**
 * The cage: per-run turn and token budgets plus a tool whitelist, enforced at the hook points.
 *
 * The whitelist is a `beforeToolCall` veto, not a suggestion: a blocked call never executes and the
 * model receives a tool error it can read. Budget overrun forces the run out of RUNNING with a
 * `budget_exceeded` transition, so the loop cannot outlive the policy by claiming it is finished.
 *
 * The cage owns the whole `cage_violation` vocabulary: all three overruns are recorded here, in one
 * shape, so the trace consumer reads the same fields whatever the policy was. The violation's name
 * goes in `violation`, not `kind`, because `kind` is the trace record's own field and a caller that
 * reuses the name has it silently overwritten (`TraceLog.append`).
 */
import type { EventBus } from '../bus.ts';
import type { RunBudget } from '../state/agent-loop.ts';
import type { TraceLog } from '../trace.ts';
import type { NativePlugin } from './host.ts';

export interface CageConfig {
  maxTurnsPerRun: number;
  maxTokensPerRun: number;
  toolWhitelist: string[] | null;
}

/** The one shape: `runId`, `reason`, `violation`, and exactly one detail field. */
export type CageViolation =
  | { violation: 'tool_whitelist'; toolName: string }
  | { violation: 'turn_budget'; turnIndex: number }
  | { violation: 'token_budget'; tokens: number };

export class RunCage implements RunBudget {
  private tokens = 0;
  private runId?: string;

  constructor(private readonly config: CageConfig, private readonly trace?: TraceLog) {}

  beginRun(runId: string): void {
    this.runId = runId;
    this.tokens = 0;
  }

  checkTurn(turnIndex: number): { exceeded: boolean; reason?: string } {
    if (turnIndex <= this.config.maxTurnsPerRun) return { exceeded: false };
    return this.overrun({ violation: 'turn_budget', turnIndex }, `turn_budget_exceeded: ${turnIndex} > ${this.config.maxTurnsPerRun}`);
  }

  addTokens(tokens: number): { exceeded: boolean; reason?: string } {
    this.tokens += tokens;
    if (this.tokens <= this.config.maxTokensPerRun) return { exceeded: false };
    return this.overrun({ violation: 'token_budget', tokens: this.tokens }, `token_budget_exceeded: ${this.tokens} > ${this.config.maxTokensPerRun}`);
  }

  toolAllowed(name: string): boolean {
    if (this.config.toolWhitelist === null) return true;
    return this.config.toolWhitelist.includes(name);
  }

  /** The registry-side half: every `beforeToolCall` is vetoed here, and the veto leaves a trace. */
  register(bus: EventBus): void {
    bus.on('beforeToolCall', (event: { toolName?: string; toolCallId?: string }) => {
      const name = event.toolName ?? '';
      if (this.toolAllowed(name)) return undefined;
      const reason = `tool_not_in_whitelist: "${name}" is not in [${(this.config.toolWhitelist ?? []).join(', ')}]`;
      this.record({ violation: 'tool_whitelist', toolName: name }, reason);
      return { block: true, reason };
    });
  }

  private record(violation: CageViolation, reason: string): void {
    this.trace?.append('cage_violation', { runId: this.runId, reason, ...violation });
  }

  /** An overrun is recorded once, here, and the loop gets its verdict from the same place. */
  private overrun(violation: CageViolation, reason: string): { exceeded: true; reason: string } {
    this.record(violation, reason);
    return { exceeded: true, reason };
  }
}

export function cagePlugin(config: CageConfig, trace?: TraceLog): NativePlugin {
  return {
    name: 'cage',
    provide: ['cage'],
    apply(ctx) {
      const cage = new RunCage(config, trace);
      cage.register(ctx.getService<EventBus>('eventBus'));
      ctx.provide('cage', cage);
    },
  };
}
