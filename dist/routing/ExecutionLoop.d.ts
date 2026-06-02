import type { BrainRecallResult } from '../types/BrainRecallResult.js';
import { RecallSufficiencyGate } from '../recall/RecallSufficiencyGate.js';
import { type ConfidenceGateResult } from './ConfidenceGate.js';
import type { TaskPlan, TaskStepType } from './TaskPlan.js';
import type { AutonomyContext, ChatSessionLike } from '../types/ExtensionPoints.js';
import { type BrainToolDispatcherLike, type ToolCallRecord } from './IterativeLLMClarifier.js';
import type { ToolUsePolicy } from './ToolUsePolicy.js';
import type { EvidenceBudgetConfig } from './EvidenceBudgetManager.js';
import type { BoardEventBus } from '../boards/BoardEventBus.js';
export type RecallFunction = (query: string, options?: {
    projectId?: string;
    entityHint?: string;
    limit?: number;
    topicPath?: string;
    enablePersistentGainEdges?: boolean;
    enableDeepWriteEdges?: boolean;
}) => BrainRecallResult | Promise<BrainRecallResult>;
export type LLMClarifyFunction = (prompt: string, evidence: BrainRecallResult) => Promise<string>;
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
export declare class ExecutionLoop {
    private recallFn;
    private options?;
    constructor(recallFn: RecallFunction, options?: {
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
    } | undefined);
    execute(plan: TaskPlan): Promise<ExecutionResult>;
    private assertNever;
    private collectRecallGateTurns;
}
//# sourceMappingURL=ExecutionLoop.d.ts.map