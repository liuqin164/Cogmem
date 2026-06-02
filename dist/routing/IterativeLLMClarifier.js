/**
 * IterativeLLMClarifier.ts
 * ReAct-style iterative LLM loop: LLM can issue brain tool calls between turns.
 * Phase 47 — v1.1
 */
import { buildToolSchemaBlock } from './LLMToolSchema.js';
import { parse as parseToolCall } from './ToolCallParser.js';
import { EvidenceBudgetManager } from './EvidenceBudgetManager.js';
import { ToolResultSanitizer } from './ToolResultSanitizer.js';
import { callSignature } from './ToolUsePolicy.js';
import { buildCueDrivenSessionContext } from './SessionContextSelector.js';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Absolute hard ceiling on iterations, regardless of options. */
export const MAX_ITERATIONS = 5;
// ---------------------------------------------------------------------------
// IterativeLLMClarifier
// ---------------------------------------------------------------------------
export class IterativeLLMClarifier {
    llmFn;
    dispatcher;
    options;
    maxIterations;
    toolSchemaBlock;
    constructor(llmFn, dispatcher, options = {}) {
        this.llmFn = llmFn;
        this.dispatcher = dispatcher;
        this.options = options;
        // Enforce hard cap
        const requested = options.maxIterations ?? 3;
        this.maxIterations = Math.min(requested, MAX_ITERATIONS);
        this.toolSchemaBlock = buildToolSchemaBlock();
    }
    async clarify(query, initialEvidence) {
        const toolCallLog = [];
        let evidence = initialEvidence;
        let lastLlmOutput = '';
        let stoppedByMaxIter = false;
        let stoppedByPolicy = false;
        let stoppedByPolicyReject = false;
        const evidenceBudget = new EvidenceBudgetManager(this.options.budgetConfig);
        const sanitizer = this.options.sanitizer ?? new ToolResultSanitizer();
        const policy = this.options.policy;
        const evidenceRefs = [initialEvidenceRef(initialEvidence)];
        const toolCallIds = [];
        let lastToolResultSummary;
        let llmIterationsUsed = 0;
        // Loop detection state: track (action, key) pairs to prevent infinite cycles
        const recentCallSignatures = [];
        let iterationOffset = 0;
        const seedQueries = Array.from(new Set((this.options.seedFollowupQueries || []).map((query) => query.trim()).filter(Boolean)))
            .slice(0, this.maxIterations);
        for (let seedIndex = 0; seedIndex < seedQueries.length; seedIndex++) {
            const toolCall = {
                action: 'brain_recall',
                query: seedQueries[seedIndex],
                limit: 6,
                reason: 'cpu_gate_seed'
            };
            const dispatchResult = await this.executeGovernedToolCall({
                toolCall,
                query,
                iterationIndex: seedIndex,
                toolCallLog,
                evidenceBudget,
                sanitizer,
                policy,
                recentCallSignatures,
                lastToolResultSummary
            });
            if (!dispatchResult.executed) {
                if (dispatchResult.stoppedByPolicy)
                    stoppedByPolicy = true;
                continue;
            }
            evidence = mergeEvidence(evidence, dispatchResult.result);
            toolCallIds.push(dispatchResult.result.callId);
            evidenceRefs.push(dispatchResult.evidenceRef);
            lastToolResultSummary = dispatchResult.summary;
        }
        iterationOffset = toolCallLog.length;
        for (let i = iterationOffset; i < this.maxIterations; i++) {
            this.emitIterationEvent('llm_iteration.started', { iterationIndex: i, query });
            const prompt = this.buildPrompt(query, evidence, toolCallLog, evidenceBudget);
            llmIterationsUsed++;
            lastLlmOutput = await this.llmFn(prompt);
            const toolCall = parseToolCall(lastLlmOutput);
            // No tool call → final answer
            if (toolCall === null) {
                return {
                    finalAnswer: lastLlmOutput,
                    iterationsUsed: llmIterationsUsed,
                    toolCallLog,
                    stoppedByMaxIter: false,
                    stoppedByPolicy,
                    evidenceTrace: this.buildEvidenceTrace(lastLlmOutput, evidenceRefs, llmIterationsUsed, toolCallIds, stoppedByPolicy, false, evidenceBudget.state().usedTokens),
                };
            }
            const dispatchResult = await this.executeGovernedToolCall({
                toolCall,
                query,
                iterationIndex: i,
                toolCallLog,
                evidenceBudget,
                sanitizer,
                policy,
                recentCallSignatures,
                lastToolResultSummary
            });
            if (!dispatchResult.executed) {
                if (dispatchResult.stoppedByPolicy) {
                    stoppedByPolicy = true;
                    stoppedByPolicyReject = true;
                    lastLlmOutput = `Tool call rejected by CPU policy: ${dispatchResult.rejectReason}`;
                    break;
                }
                stoppedByMaxIter = true;
                break;
            }
            toolCallIds.push(dispatchResult.result.callId);
            evidenceRefs.push(dispatchResult.evidenceRef);
            lastToolResultSummary = dispatchResult.summary;
            evidence = mergeEvidence(evidence, dispatchResult.result);
            this.emitIterationEvent('llm_iteration.completed', { iterationIndex: i, budget: evidenceBudget.state() });
        }
        // Reached max iterations (or cycle detected)
        stoppedByMaxIter = !stoppedByPolicyReject;
        const reportedLlmIterationsUsed = Math.max(1, llmIterationsUsed);
        return {
            finalAnswer: lastLlmOutput,
            iterationsUsed: reportedLlmIterationsUsed,
            toolCallLog,
            stoppedByMaxIter,
            stoppedByPolicy,
            evidenceTrace: this.buildEvidenceTrace(lastLlmOutput, evidenceRefs, reportedLlmIterationsUsed, toolCallIds, stoppedByPolicy, stoppedByMaxIter, evidenceBudget.state().usedTokens),
        };
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    buildPrompt(query, evidence, toolCallLog, evidenceBudget) {
        const parts = [];
        // Layer 1: persona
        const userContext = this.options.projectId
            ? this.options.userModelManager?.getUserContext(this.options.projectId).toPromptFragment()
            : '';
        if (userContext) {
            parts.push(userContext);
            parts.push('');
        }
        if (this.options.personaBlock) {
            parts.push(this.options.personaBlock);
            parts.push('');
        }
        // Layer 2: conversation history
        const history = buildCueDrivenSessionContext({
            session: this.options.session,
            query,
            projectId: this.options.projectId,
        });
        if (history) {
            parts.push('【对话历史】');
            parts.push(history);
            parts.push('');
        }
        // Layer 3: query
        parts.push(`【当前问题】\n${query}`);
        // Layer 4: initial + accumulated evidence
        const facts = evidence.compiledMemory.facts;
        const summaries = evidence.summaries || [];
        if (facts.length > 0) {
            const factsSummary = facts.map((f) => ({
                factId: f.factId,
                subject: f.subject,
                predicateFamily: f.predicateFamily,
                predicateValue: f.predicateValue,
                object: f.object,
                confidence: f.confidence,
            }));
            parts.push(`\n【记忆证据】\n${JSON.stringify(factsSummary, null, 2)}`);
        }
        else {
            parts.push('\n【记忆证据】\n（暂无相关编译记忆）');
        }
        if (summaries.length > 0) {
            parts.push(`\n【摘要证据】\n${JSON.stringify(summaries, null, 2)}`);
        }
        // Layer 5: previous tool call results
        if (toolCallLog.length > 0) {
            parts.push('\n【已执行工具查询】');
            if (evidenceBudget) {
                parts.push(evidenceBudget.pack().toPromptSummary(evidenceBudget.state().remainingTokens || 600));
            }
            else {
                for (const entry of toolCallLog) {
                    const status = entry.result.success ? '✓' : '✗';
                    const summary = entry.result.success
                        ? JSON.stringify(entry.result.result).slice(0, 500)
                        : `错误：${entry.result.errorMessage}`;
                    parts.push(`${status} ${entry.call.action}(${this.callKey(entry.call)}): ${summary}`);
                }
            }
        }
        // Layer 6: tool schema block
        parts.push('');
        parts.push(this.toolSchemaBlock);
        return parts.join('\n');
    }
    callKey(call) {
        if (call.action === 'brain_recall')
            return call.query ?? '';
        if (call.action === 'get_neuron_context')
            return call.neuron_id ?? '';
        if (call.action === 'expand_entity')
            return call.entity_name ?? '';
        if (call.action === 'find_file_assets')
            return [call.query, call.extension, call.mime_type].filter(Boolean).join(':');
        if (call.action === 'get_file_context')
            return [call.asset_id, call.chunk_index, call.radius].filter((value) => value !== undefined).join(':');
        return '';
    }
    callSignature(call) {
        return callSignature(call);
    }
    buildEvidenceTrace(finalAnswer, evidenceRefs, iterationCount, toolCallIds, stoppedByPolicy, stoppedByMaxIter, totalTokensUsed) {
        return {
            finalAnswer,
            evidenceRefs,
            iterationCount,
            toolCallIds,
            stoppedByPolicy,
            stoppedByMaxIter,
            totalTokensUsed,
        };
    }
    emitIterationEvent(eventType, payload) {
        if (!this.options.boardEventBus)
            return;
        this.options.boardEventBus.emit({
            boardId: 'reasoning_trace',
            eventType,
            payload,
            timestamp: Date.now(),
            workspaceId: this.options.projectId,
        });
    }
    async executeGovernedToolCall(input) {
        const toolCall = input.toolCall;
        if (input.policy) {
            const decision = input.policy.evaluate(toolCall, {
                currentIteration: input.iterationIndex,
                maxIterations: this.maxIterations,
                toolCallLog: input.toolCallLog,
                evidenceBudget: input.evidenceBudget.state(),
                projectId: this.options.projectId,
                topicPath: this.options.topicPath,
                originalQuery: input.query,
                lastToolResultSummary: input.lastToolResultSummary,
            });
            if (decision.verdict === 'reject') {
                this.emitIterationEvent('llm_iteration.policy_rejected', {
                    iterationIndex: input.iterationIndex,
                    call: toolCall,
                    reason: decision.reason,
                });
                return { executed: false, stoppedByPolicy: true, rejectReason: decision.reason };
            }
            if (decision.verdict === 'rewrite') {
                this.emitIterationEvent('llm_iteration.policy_rewritten', {
                    iterationIndex: input.iterationIndex,
                    originalCall: toolCall,
                    rewrittenCall: decision.call,
                    reason: decision.reason,
                });
                Object.assign(toolCall, decision.call);
            }
        }
        const sig = callSignature(toolCall);
        const sigCount = input.recentCallSignatures.filter((s) => s === sig).length;
        if (sigCount >= 1)
            return { executed: false };
        input.recentCallSignatures.push(sig);
        const result = await this.dispatcher.dispatch(toolCall, {
            projectId: this.options.projectId,
            topicPath: this.options.topicPath
        });
        const sanitization = input.sanitizer.sanitize(result);
        const governedResult = {
            ...result,
            result: sanitization.sanitizedResult,
        };
        if (this.options.onToolCall)
            this.options.onToolCall(toolCall, governedResult);
        input.toolCallLog.push({ call: { ...toolCall }, result: governedResult });
        this.emitIterationEvent('llm_iteration.tool_called', {
            iterationIndex: input.iterationIndex,
            call: toolCall,
            result: {
                toolName: governedResult.toolName,
                callId: governedResult.callId,
                success: governedResult.success,
                injectionRiskDetected: sanitization.injectionRiskDetected,
            },
        });
        const item = input.evidenceBudget.absorb({
            toolResult: governedResult,
            call: toolCall,
            sanitizedResult: sanitization.sanitizedResult,
            projectId: this.options.projectId,
            injectionRiskDetected: sanitization.injectionRiskDetected,
        });
        if (input.evidenceBudget.state().isOverBudget) {
            this.emitIterationEvent('llm_iteration.budget_compressed', {
                iterationIndex: input.iterationIndex,
                budget: input.evidenceBudget.state(),
            });
        }
        return {
            executed: true,
            result: governedResult,
            evidenceRef: {
                source: governedResult.toolName,
                toolCallId: governedResult.callId,
                iterationIndex: input.iterationIndex,
                factIds: item.facts.map((fact) => fact.factId),
                neuronIds: item.neurons.map((neuron) => neuron.neuronId),
                entityIds: item.entityIds,
            },
            summary: {
                toolName: governedResult.toolName,
                queryKey: callSignature(toolCall),
                newFactCount: item.facts.length,
                newEventCount: item.events.length,
                newNeuronCount: item.neurons.length,
            }
        };
    }
}
// ---------------------------------------------------------------------------
// mergeEvidence — append new tool result data into existing BrainRecallResult
// ---------------------------------------------------------------------------
function mergeEvidence(base, toolResult) {
    if (!toolResult.success || toolResult.result === undefined)
        return base;
    const extra = toolResult.result;
    // Merge facts
    const extraFacts = Array.isArray(extra['facts']) ? extra['facts'] : [];
    // Merge events
    const extraEvents = Array.isArray(extra['events']) ? extra['events'] : [];
    // Merge raw neurons (for get_neuron_context)
    const extraNeurons = Array.isArray(extra['neurons']) ? extra['neurons'] : [];
    const extraSummaries = Array.isArray(extra['summaries']) ? extra['summaries'] : [];
    const extraFileEvidence = Array.isArray(extra['fileEvidence']) ? extra['fileEvidence'] : [];
    if (extraFacts.length === 0 && extraEvents.length === 0 && extraNeurons.length === 0 && extraSummaries.length === 0 && extraFileEvidence.length === 0) {
        return base;
    }
    return {
        ...base,
        compiledMemory: {
            ...base.compiledMemory,
            facts: [...base.compiledMemory.facts, ...extraFacts],
            events: [...base.compiledMemory.events, ...extraEvents],
        },
        rawEvidence: [...base.rawEvidence, ...extraNeurons],
        summaries: [...(base.summaries || []), ...extraSummaries],
        fileEvidence: [...(base.fileEvidence || []), ...extraFileEvidence],
    };
}
function initialEvidenceRef(initialEvidence) {
    return {
        source: 'initial_recall',
        iterationIndex: 0,
        factIds: initialEvidence.compiledMemory.facts.map((fact) => fact.factId),
        neuronIds: initialEvidence.rawEvidence.map((neuron) => neuron.id),
        entityIds: initialEvidence.compiledMemory.entityTimeline.map((entity) => entity.entityId),
    };
}
