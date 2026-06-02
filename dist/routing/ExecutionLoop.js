import { RecallSufficiencyGate } from '../recall/RecallSufficiencyGate.js';
import { ConfidenceGate } from './ConfidenceGate.js';
import { IterativeLLMClarifier, } from './IterativeLLMClarifier.js';
import { buildCueDrivenSessionContext, selectCueDrivenSessionTurns } from './SessionContextSelector.js';
export class ExecutionLoop {
    recallFn;
    options;
    constructor(recallFn, options) {
        this.recallFn = recallFn;
        this.options = options;
    }
    async execute(plan) {
        const startedAt = Date.now();
        const steps = [];
        let lastRecallResult;
        let lastConfidenceResult;
        let cpuSufficient = false;
        let llmCallCount = 0;
        let recallSufficiencyDecision;
        for (const step of plan.steps) {
            const stepStartedAt = Date.now();
            const record = {
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
                        topicPath: step.inputs.topicPath,
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
                        topicPath: step.inputs.topicPath,
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
                        topicPath: step.inputs.topicPath,
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
                        const conditionMet = typeof score === 'number'
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
                    const promptParts = [];
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
                    }
                    else {
                        promptParts.push('\n【记忆证据】\n（暂无相关编译记忆，请根据对话上下文和人格设定作答）');
                    }
                    const prompt = promptParts.join('\n');
                    // v1.1: iterative ReAct path
                    const maxIter = this.options?.maxLLMIterations ?? 0;
                    if (maxIter > 0 && this.options?.toolDispatcher) {
                        const clarifier = new IterativeLLMClarifier((p) => this.options.onLLMClarify(p, lastRecallResult), this.options.toolDispatcher, {
                            maxIterations: maxIter,
                            personaBlock: this.options?.personaBlock,
                            session: this.options?.session,
                            projectId: step.inputs.projectId,
                            topicPath: step.inputs.topicPath,
                            policy: this.options?.toolUsePolicy,
                            budgetConfig: this.options?.evidenceBudgetConfig,
                            boardEventBus: this.options?.boardEventBus,
                            autonomyContext: this.options?.autonomyContext,
                            seedFollowupQueries: recallSufficiencyDecision?.sufficient === false
                                ? recallSufficiencyDecision.suggestedFollowupQueries
                                : [],
                        });
                        const clarifierResult = await clarifier.clarify(plan.query, lastRecallResult);
                        llmCallCount += clarifierResult.iterationsUsed;
                        record.executed = true;
                        record.llmResponse = clarifierResult.finalAnswer;
                        record.toolCallLog = clarifierResult.toolCallLog;
                        record.iterationsUsed = clarifierResult.iterationsUsed;
                    }
                    else {
                        // v1.0 legacy single-call path
                        const llmResponse = await this.options.onLLMClarify(prompt, lastRecallResult);
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
        const verdict = llmCallCount > 0
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
    assertNever(step) {
        throw new Error(`Unsupported task step type: ${step.type}`);
    }
    collectRecallGateTurns(query, projectId) {
        const session = this.options?.session;
        if (!session)
            return [];
        return selectCueDrivenSessionTurns({ session, query, projectId, maxChars: 4000 }).map((turn) => ({
            role: turn.role,
            content: turn.content,
            timestamp: turn.timestamp
        }));
    }
}
