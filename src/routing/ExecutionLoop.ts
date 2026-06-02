import type { BrainRecallResult } from '../types/BrainRecallResult.js';
import { RecallSufficiencyGate, type RecallSufficiencyDecision } from '../recall/RecallSufficiencyGate.js';
import { ConfidenceGate, type ConfidenceGateResult } from './ConfidenceGate.js';
import type { TaskPlan, TaskStep, TaskStepType } from './TaskPlan.js';
import type { AutonomyContext, ChatSessionLike } from '../types/ExtensionPoints.js';
import {
  IterativeLLMClarifier,
  type BrainToolDispatcherLike,
  type ToolCallRecord,
} from './IterativeLLMClarifier.js';
import type { ToolUsePolicy } from './ToolUsePolicy.js';
import type { EvidenceBudgetConfig } from './EvidenceBudgetManager.js';
import type { BoardEventBus } from '../boards/BoardEventBus.js';
import { buildCueDrivenSessionContext, selectCueDrivenSessionTurns } from './SessionContextSelector.js';

export type RecallFunction = (
  query: string,
  options?: {
    projectId?: string;
    entityHint?: string;
    limit?: number;
    topicPath?: string;
    enablePersistentGainEdges?: boolean;
    enableDeepWriteEdges?: boolean;
  }
) => BrainRecallResult | Promise<BrainRecallResult>;

export type LLMClarifyFunction = (
  prompt: string,
  evidence: BrainRecallResult
) => Promise<string>;

export interface StepExecutionRecord {
  stepId: string;
  stepType: TaskStepType;
  executed: boolean;
  skippedReason?: 'cpu_sufficient' | 'no_llm_callback' | 'condition_not_met';
  recallResult?: BrainRecallResult;
  confidenceResult?: ConfidenceGateResult;
  llmResponse?: string;
  durationMs: number;
  /** Tool calls made by IterativeLLMClarifier during this step (v1.1+). */
  toolCallLog?: ToolCallRecord[];
  /** Number of LLM iterations used in this step (v1.1+). */
  iterationsUsed?: number;
}

// Re-export ToolCallRecord so consumers can type-check the log
export type { ToolCallRecord };

export interface ExecutionResult {
  planId: string;
  query: string;
  steps: StepExecutionRecord[];
  finalRecallResult?: BrainRecallResult;
  finalConfidence?: ConfidenceGateResult;
  llmCallCount: number;
  totalDurationMs: number;
  verdict: 'cpu_resolved' | 'llm_assisted' | 'incomplete';
}

export class ExecutionLoop {
  constructor(
    private recallFn: RecallFunction,
    private options?: {
      onLLMClarify?: LLMClarifyFunction;
      confidenceThreshold?: number;
      defaultLimit?: number;
      /** Pre-loaded persona block injected at the top of every LLM prompt. */
      personaBlock?: string;
      /** Active chat session whose history is injected after the persona block. */
      session?: ChatSessionLike;
      /**
       * v1.1: Enable iterative ReAct loop. When > 0, uses IterativeLLMClarifier
       * instead of a single LLM call. Defaults to 0 (disabled, v1.0 behavior).
       */
      maxLLMIterations?: number;
      /**
       * v1.1: Brain tool dispatcher required when maxLLMIterations > 0.
       */
      toolDispatcher?: BrainToolDispatcherLike;
      /** v1.2: Optional CPU policy for iterative tool calls. */
      toolUsePolicy?: ToolUsePolicy;
      /** v1.2: Optional evidence budget config for iterative tool evidence. */
      evidenceBudgetConfig?: Partial<EvidenceBudgetConfig>;
      /** v1.2: Optional board event bus for reasoning trace events. */
      boardEventBus?: BoardEventBus;
      /** v1.3 reserved context; accepted and forwarded, but unused in v1.2.1. */
      autonomyContext?: AutonomyContext;
      recallGateDisabled?: boolean;
      recallGate?: RecallSufficiencyGate;
    }
  ) {}

  async execute(plan: TaskPlan): Promise<ExecutionResult> {
    const startedAt = Date.now();
    const steps: StepExecutionRecord[] = [];
    let lastRecallResult: BrainRecallResult | undefined;
    let lastConfidenceResult: ConfidenceGateResult | undefined;
    let cpuSufficient = false;
    let llmCallCount = 0;
    let recallSufficiencyDecision: RecallSufficiencyDecision | undefined;

    for (const step of plan.steps) {
      const stepStartedAt = Date.now();
      const record: StepExecutionRecord = {
        stepId: step.id,
        stepType: step.type,
        executed: false,
        durationMs: 0
      };

      switch (step.type) {
        case 'memory_recall': {
          const recallResult = await this.recallFn(step.inputs.query ?? plan.query, {
            projectId: step.inputs.projectId,
            entityHint: step.inputs.entityHint,
            topicPath: (step.inputs as { topicPath?: string }).topicPath,
            limit: this.options?.defaultLimit ?? 8
          });
          lastRecallResult = recallResult;
          record.executed = true;
          record.recallResult = recallResult;
          break;
        }
        case 'graph_traverse': {
          const recallResult = await this.recallFn(step.inputs.query ?? plan.query, {
            projectId: step.inputs.projectId,
            entityHint: step.inputs.entityHint,
            topicPath: (step.inputs as { topicPath?: string }).topicPath,
            limit: this.options?.defaultLimit ?? 8,
            enablePersistentGainEdges: true
          });
          lastRecallResult = recallResult;
          record.executed = true;
          record.recallResult = recallResult;
          break;
        }
        case 'fact_check': {
          const query = [step.inputs.subjectHint, step.inputs.predicateHint, step.inputs.query]
            .filter(Boolean)
            .join(' ');
          const recallResult = await this.recallFn(query, {
            projectId: step.inputs.projectId,
            entityHint: step.inputs.entityHint,
            topicPath: (step.inputs as { topicPath?: string }).topicPath,
            limit: this.options?.defaultLimit ?? 8
          });
          lastRecallResult = recallResult;
          record.executed = true;
          record.recallResult = recallResult;
          break;
        }
        case 'confidence_check': {
          if (!lastRecallResult) {
            break;
          }
          const gate = new ConfidenceGate({
            threshold: this.options?.confidenceThreshold ?? 0.6
          });
          const confidenceResult = gate.evaluate(lastRecallResult, {
            entityHint: step.inputs.entityHint ?? plan.steps[0]?.inputs.entityHint
          });
          lastConfidenceResult = confidenceResult;
          if (confidenceResult.verdict === 'cpu_sufficient') {
            cpuSufficient = true;
          }
          record.executed = true;
          record.confidenceResult = confidenceResult;
          break;
        }
        case 'llm_clarify': {
          if (lastRecallResult && !this.options?.recallGateDisabled) {
            const gate = this.options?.recallGate ?? new RecallSufficiencyGate();
            recallSufficiencyDecision = gate.evaluate({
              query: plan.query,
              layer1Result: lastRecallResult,
              recentTurns: this.collectRecallGateTurns(plan.query, plan.steps[0]?.inputs.projectId),
              projectId: plan.steps[0]?.inputs.projectId
            });
            this.options?.boardEventBus?.emit({
              boardId: 'reasoning_trace',
              eventType: recallSufficiencyDecision.sufficient ? 'recall_gate.skip' : 'recall_gate.escalation',
              payload: {
                signals: recallSufficiencyDecision.signals,
                reason: recallSufficiencyDecision.reason,
                suggestedFollowupQueryCount: recallSufficiencyDecision.suggestedFollowupQueries.length
              },
              timestamp: Date.now(),
              workspaceId: plan.steps[0]?.inputs.projectId
            });
          }

          if (cpuSufficient && recallSufficiencyDecision?.sufficient !== false) {
            record.skippedReason = 'cpu_sufficient';
            break;
          }

          if (step.triggerCondition) {
            const dependencyRecord = steps.find((entry) => entry.stepId === step.triggerCondition?.dependsOnStepId);
            const score = dependencyRecord?.confidenceResult?.score;
            const conditionMet =
              typeof score === 'number'
              && step.triggerCondition.operator === 'lt'
              && score < step.triggerCondition.threshold;

            if (!conditionMet) {
              record.skippedReason = 'condition_not_met';
              break;
            }
          }

          if (!this.options?.onLLMClarify) {
            record.skippedReason = 'no_llm_callback';
            break;
          }

          const factsSummary = lastRecallResult?.compiledMemory.facts.map((fact) => ({
            factId: fact.factId,
            subject: fact.subject,
            predicateFamily: fact.predicateFamily,
            predicateValue: fact.predicateValue,
            object: fact.object,
            confidence: fact.confidence,
            status: fact.status,
            validFrom: fact.validFrom
          })) ?? [];

          // Build three-layer prompt: persona → history → query+evidence
          const promptParts: string[] = [];
          if (this.options?.personaBlock) {
            promptParts.push(this.options.personaBlock);
            promptParts.push('');
          }
          const history = buildCueDrivenSessionContext({
            session: this.options?.session,
            query: plan.query,
            projectId: step.inputs.projectId,
          });
          if (history) {
            promptParts.push('【对话历史】');
            promptParts.push(history);
            promptParts.push('');
          }
          promptParts.push(`【当前问题】\n${plan.query}`);
          if (factsSummary.length) {
            promptParts.push(`\n【记忆证据】\n${JSON.stringify(factsSummary, null, 2)}`);
          } else {
            promptParts.push('\n【记忆证据】\n（暂无相关编译记忆，请根据对话上下文和人格设定作答）');
          }
          const prompt = promptParts.join('\n');

          // v1.1: iterative ReAct path
          const maxIter = this.options?.maxLLMIterations ?? 0;
          if (maxIter > 0 && this.options?.toolDispatcher) {
            const clarifier = new IterativeLLMClarifier(
              (p) => this.options!.onLLMClarify!(p, lastRecallResult!),
              this.options.toolDispatcher,
              {
                maxIterations: maxIter,
                personaBlock: this.options?.personaBlock,
                session: this.options?.session,
                projectId: step.inputs.projectId,
                topicPath: (step.inputs as { topicPath?: string }).topicPath,
                policy: this.options?.toolUsePolicy,
                budgetConfig: this.options?.evidenceBudgetConfig,
                boardEventBus: this.options?.boardEventBus,
                autonomyContext: this.options?.autonomyContext,
                seedFollowupQueries: recallSufficiencyDecision?.sufficient === false
                  ? recallSufficiencyDecision.suggestedFollowupQueries
                  : [],
              }
            );
            const clarifierResult = await clarifier.clarify(plan.query, lastRecallResult!);
            llmCallCount += clarifierResult.iterationsUsed;
            record.executed = true;
            record.llmResponse = clarifierResult.finalAnswer;
            record.toolCallLog = clarifierResult.toolCallLog;
            record.iterationsUsed = clarifierResult.iterationsUsed;
          } else {
            // v1.0 legacy single-call path
            const llmResponse = await this.options.onLLMClarify(prompt, lastRecallResult!);
            llmCallCount += 1;
            record.executed = true;
            record.llmResponse = llmResponse;
          }
          break;
        }
        case 'answer_assemble': {
          record.executed = true;
          break;
        }
        default: {
          this.assertNever(step);
        }
      }

      record.durationMs = Math.max(0, Date.now() - stepStartedAt);
      steps.push(record);
    }

    const verdict =
      llmCallCount > 0
        ? 'llm_assisted'
        : lastConfidenceResult?.verdict === 'cpu_sufficient'
          ? 'cpu_resolved'
          : 'incomplete';

    return {
      planId: plan.planId,
      query: plan.query,
      steps,
      finalRecallResult: lastRecallResult,
      finalConfidence: lastConfidenceResult,
      llmCallCount,
      totalDurationMs: Math.max(0, Date.now() - startedAt),
      verdict
    };
  }

  private assertNever(step: TaskStep): never {
    throw new Error(`Unsupported task step type: ${step.type}`);
  }

  private collectRecallGateTurns(query: string, projectId?: string): Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }> {
    const session = this.options?.session;
    if (!session) return [];
    return selectCueDrivenSessionTurns({ session, query, projectId, maxChars: 4000 }).map((turn) => ({
      role: turn.role,
      content: turn.content,
      timestamp: turn.timestamp
    }));
  }
}
