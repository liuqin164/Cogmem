/**
 * BrainToolDispatcher.ts
 * Routes BrainToolCall to the correct tool implementation.
 * Phase 48 — v1.1
 */
import { SecondaryRecallTool } from './tools/SecondaryRecallTool.js';
import { NeuronContextTool } from './tools/NeuronContextTool.js';
import { EntityExpandTool } from './tools/EntityExpandTool.js';
import { SkillDiscoveryTool } from './tools/SkillDiscoveryTool.js';
/** Unique monotonic counter for call IDs (per process lifetime) */
let callSeq = 0;
function nextCallId() {
    return `tool-call-${Date.now()}-${++callSeq}`;
}
export class BrainToolDispatcher {
    deps;
    secondaryRecall;
    neuronContext;
    entityExpand;
    skillDiscovery;
    constructor(deps) {
        this.deps = deps;
        this.secondaryRecall = new SecondaryRecallTool(deps.recallFn);
        this.neuronContext = new NeuronContextTool(deps.memoryGraph, deps.graphEdgeStore);
        this.entityExpand = new EntityExpandTool(deps.factStore, deps.entityStore, deps.beliefStore);
        this.skillDiscovery = deps.skillDiscoveryEngine ? new SkillDiscoveryTool(deps.skillDiscoveryEngine) : undefined;
    }
    async dispatch(call, context = {}) {
        const callId = nextCallId();
        const startedAt = Date.now();
        try {
            switch (call.action) {
                case 'brain_recall': {
                    if (!call.query) {
                        return this.error(call.action, callId, 'brain_recall requires a query parameter', startedAt);
                    }
                    const output = await this.secondaryRecall.execute({
                        query: call.query,
                        entityHint: call.entity_hint,
                        limit: call.limit,
                        projectId: context.projectId,
                        topicPath: context.topicPath,
                    });
                    return {
                        toolName: call.action,
                        callId,
                        success: true,
                        result: output,
                        durationMs: Math.max(0, Date.now() - startedAt),
                    };
                }
                case 'get_neuron_context': {
                    if (!call.neuron_id) {
                        return this.error(call.action, callId, 'get_neuron_context requires a neuron_id parameter', startedAt);
                    }
                    const output = this.neuronContext.execute(call.neuron_id, context.projectId);
                    if (!output) {
                        return this.error(call.action, callId, `Neuron not found: ${call.neuron_id}`, startedAt);
                    }
                    return {
                        toolName: call.action,
                        callId,
                        success: true,
                        result: output,
                        durationMs: Math.max(0, Date.now() - startedAt),
                    };
                }
                case 'expand_entity': {
                    if (!call.entity_name) {
                        return this.error(call.action, callId, 'expand_entity requires an entity_name parameter', startedAt);
                    }
                    const output = this.entityExpand.execute(call.entity_name, call.entity_type, context.projectId);
                    if (!output) {
                        return this.error(call.action, callId, `Entity not found: ${call.entity_name}`, startedAt);
                    }
                    return {
                        toolName: call.action,
                        callId,
                        success: true,
                        result: output,
                        durationMs: Math.max(0, Date.now() - startedAt),
                    };
                }
                case 'find_file_assets': {
                    if (!this.deps.fileAssetStore) {
                        return this.error(call.action, callId, 'find_file_assets is not available in this runtime', startedAt);
                    }
                    if (!call.query) {
                        return this.error(call.action, callId, 'find_file_assets requires a query parameter', startedAt);
                    }
                    const output = this.deps.fileAssetStore.listByQuery({
                        query: call.query,
                        projectId: context.projectId,
                        extension: call.extension,
                        mimeType: call.mime_type,
                        limit: call.limit
                    });
                    return {
                        toolName: call.action,
                        callId,
                        success: true,
                        result: { assets: output },
                        durationMs: Math.max(0, Date.now() - startedAt),
                    };
                }
                case 'get_file_context': {
                    if (!this.deps.fileChunkStore) {
                        return this.error(call.action, callId, 'get_file_context is not available in this runtime', startedAt);
                    }
                    if (!call.asset_id || typeof call.chunk_index !== 'number') {
                        return this.error(call.action, callId, 'get_file_context requires asset_id and chunk_index parameters', startedAt);
                    }
                    const evidence = this.deps.fileChunkStore.listContext(call.asset_id, call.chunk_index, call.radius ?? 1, context.projectId);
                    return {
                        toolName: call.action,
                        callId,
                        success: true,
                        result: { fileEvidence: this.deps.fileChunkStore.groupEvidenceByAsset(evidence) },
                        durationMs: Math.max(0, Date.now() - startedAt),
                    };
                }
                case 'find_skills': {
                    if (!this.skillDiscovery) {
                        return this.error(call.action, callId, 'find_skills is not available in this runtime', startedAt);
                    }
                    if (!call.query) {
                        return this.error(call.action, callId, 'find_skills requires a query parameter', startedAt);
                    }
                    const output = this.skillDiscovery.execute({
                        query: call.query,
                        limit: call.limit,
                        projectId: context.projectId
                    });
                    return {
                        toolName: call.action,
                        callId,
                        success: true,
                        result: output,
                        durationMs: Math.max(0, Date.now() - startedAt),
                    };
                }
                default: {
                    const unknownAction = call.action;
                    return this.error(
                    // Cast to handle unknown actions gracefully
                    'brain_recall', callId, `Unknown tool action: ${unknownAction}`, startedAt);
                }
            }
        }
        catch (err) {
            return this.error(call.action, callId, err instanceof Error ? err.message : String(err), startedAt);
        }
    }
    error(toolName, callId, message, startedAt) {
        return {
            toolName,
            callId,
            success: false,
            errorMessage: message,
            durationMs: Math.max(0, Date.now() - startedAt),
        };
    }
}
