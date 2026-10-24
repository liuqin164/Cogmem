import { serializeUntrustedMemory } from '../../agent/UntrustedMemorySerializer.js';
import { clampRecallContext } from '../RecallBlock.js';
/** Anything arriving from a host as JSON. */
type Payload = any;
/**
 * What a host calls itself. The adapter supplies these; the shared code never
 * invents a host name, because the fallback would silently label another host's
 * turns as OpenClaw's.
 */
export interface HostIdentity {
    /** Recorded as `agentId` on every write. */
    agentId: string;
    /** Project/workspace a turn belongs to when the host names none. */
    projectId: string;
    /** Session a turn belongs to when the host names none. */
    sessionId: string;
    /** `metadata.source`, so a stored turn says which adapter recorded it. */
    memorySource: string;
    /** `metadata.pluginId`, when the host has a plugin identity to record. */
    pluginId?: string;
}
export interface HostBridgeRuntime {
    /** Kernel instance; the orchestration below uses its cortex services. */
    kernel: Payload;
    /** `KernelAgentMemoryBackend`, or anything with the same recall/remember shape. */
    memory: Payload;
    /** Renders the strategy capsule that precedes the recall block. */
    formatStrategyContext: (capsule: Payload) => string;
}
export interface RecallForHostResult {
    /** The text the host puts in front of the model. Empty when nothing surfaced. */
    context: string;
    items: Payload[];
    itemCount: number;
    recallMode?: unknown;
    fallbackUsed?: unknown;
    intent: unknown;
    anchorEventId?: unknown;
    anchorText?: unknown;
    queryPlan?: unknown;
    decisionTrace?: unknown;
    atlasCards?: unknown;
    selectedEpisodeCards: Payload[];
    relatedButNotSelected?: unknown;
    relaxationTrace?: unknown;
    activationReceipt: Payload;
    strategyCapsule?: unknown;
    strategyReplanned: boolean;
    strategyReplanReason?: unknown;
    recallLatencyMs: number;
}
/**
 * Recall for a host: decide the retrieval policy, recall, let the context cortex
 * choose what fits the budget, then render one block.
 *
 * The order matters and is deliberate. The strategy cortex plans before the
 * first recall; if its replan says the evidence was too thin, the recall runs
 * again with the new policy rather than the caller seeing a thin first attempt.
 * The context cortex then decides what actually reaches the model, and a strict
 * facet match is re-inserted if the planner dropped it — a memory the query
 * matched exactly must not disappear because a budget planner did not like it.
 */
export declare function recallForHost(runtime: HostBridgeRuntime, input: Payload, config: Payload, identity: HostIdentity): Promise<RecallForHostResult>;
export interface RememberForHostResult {
    hygiene: Payload;
    toolCallCount: number;
    toolResultCount: number;
    taskEventCount: number;
    contextOutcomeId?: string;
    [key: string]: unknown;
}
/**
 * Record one finished turn, plus the tool traffic and task events around it.
 *
 * The order of writes is the causality the store needs: the assistant event
 * first, then tool calls against it, then observations against their call, and a
 * tool result with no matching call becomes a task event rather than being lost.
 * Any Cogmem block the host echoed back is stripped here, because re-ingesting a
 * recall block as new memory would launder injected context into evidence.
 */
export declare function rememberForHost(runtime: Omit<HostBridgeRuntime, 'formatStrategyContext'>, payload: Payload, config: Payload, identity: HostIdentity): Promise<RememberForHostResult>;
/** Re-exported so an adapter can clamp without importing two modules. */
export { clampRecallContext, serializeUntrustedMemory };
//# sourceMappingURL=HostBridge.d.ts.map