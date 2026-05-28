import { KernelAgentMemoryBackend } from '../agent/index.js';
import { createMemoryKernel, createMemoryKernelFromConfig, } from '../factory.js';
import { explainRecallWithKernel } from '../recall/RecallExplanation.js';
const STRING_SCHEMA = { type: 'string' };
const NUMBER_SCHEMA = { type: 'number' };
export function listCogmemMcpTools() {
    return [
        {
            name: 'cogmem_remember_turn',
            description: 'Write one user/agent turn into CognitiveOS-core memory.',
            inputSchema: {
                type: 'object',
                properties: {
                    agentId: STRING_SCHEMA,
                    projectId: STRING_SCHEMA,
                    sessionId: STRING_SCHEMA,
                    userText: STRING_SCHEMA,
                    assistantText: STRING_SCHEMA,
                    timestamp: NUMBER_SCHEMA,
                },
                required: ['agentId', 'projectId', 'sessionId', 'userText'],
            },
            annotations: {
                title: 'Remember Turn',
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
            },
        },
        {
            name: 'cogmem_recall',
            description: 'Recall prepared memory context from CognitiveOS-core using pulse, temporal, graph, and narrative retrieval.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: STRING_SCHEMA,
                    agentId: STRING_SCHEMA,
                    projectId: STRING_SCHEMA,
                    limit: NUMBER_SCHEMA,
                    since: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
                    until: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
                },
                required: ['query'],
            },
            annotations: {
                title: 'Recall Memory',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
            },
        },
        {
            name: 'cogmem_explain_recall',
            description: 'Explain why CognitiveOS-core recalled specific memory context, including pulse trace, temporal traversal, runtime path, and evidence.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: STRING_SCHEMA,
                    agentId: STRING_SCHEMA,
                    projectId: STRING_SCHEMA,
                    limit: NUMBER_SCHEMA,
                    since: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
                    until: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
                },
                required: ['query'],
            },
            annotations: {
                title: 'Explain Recall',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
            },
        },
    ];
}
export async function callCogmemMcpTool(name, args, runtime = {}) {
    const input = args || {};
    const opened = openRuntimeKernel(runtime);
    try {
        switch (name) {
            case 'cogmem_remember_turn':
                return await rememberTurn(opened.kernel, input);
            case 'cogmem_recall':
                return recall(opened.kernel, input, false);
            case 'cogmem_explain_recall':
                return recall(opened.kernel, input, true);
            default:
                return jsonResult({ error: `Unknown cogmem MCP tool: ${name}` }, true);
        }
    }
    catch (error) {
        return jsonResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
    finally {
        if (opened.shouldClose)
            opened.kernel.close();
    }
}
async function rememberTurn(kernel, input) {
    const memory = new KernelAgentMemoryBackend(kernel);
    await memory.rememberTurn({
        agentId: requiredString(input.agentId, 'agentId'),
        projectId: requiredString(input.projectId, 'projectId'),
        sessionId: requiredString(input.sessionId, 'sessionId'),
        userText: requiredString(input.userText, 'userText'),
        assistantText: optionalString(input.assistantText),
        timestamp: optionalNumber(input.timestamp),
    });
    return jsonResult({ ok: true });
}
function recall(kernel, input, includeExplanation) {
    const explanation = explainRecallWithKernel(kernel, {
        query: requiredString(input.query, 'query'),
        agentId: optionalString(input.agentId),
        projectId: optionalString(input.projectId),
        limit: optionalNumber(input.limit),
        startTime: optionalTime(input.since, 'since'),
        endTime: optionalTime(input.until, 'until'),
    });
    const payload = includeExplanation
        ? explanation
        : {
            query: explanation.query,
            projectId: explanation.projectId,
            agentId: explanation.agentId,
            recallMode: explanation.recallMode,
            fallbackUsed: explanation.fallbackUsed,
            narrative: explanation.narrative,
            temporalLabels: explanation.temporalTraversal?.labels,
            items: explanation.evidence,
        };
    return jsonResult(payload);
}
function openRuntimeKernel(runtime) {
    if (runtime.kernel)
        return { kernel: runtime.kernel, shouldClose: false };
    if (runtime.dbPath) {
        return { kernel: createMemoryKernel({ dbPath: runtime.dbPath }), shouldClose: true };
    }
    return {
        kernel: createMemoryKernelFromConfig({
            configPath: runtime.configPath,
            cwd: runtime.cwd,
        }),
        shouldClose: true,
    };
}
function jsonResult(payload, isError = false) {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        isError: isError || undefined,
    };
}
function requiredString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${field} must be a non-empty string`);
    }
    return value;
}
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function optionalTime(value, field) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        if (/^\d+$/.test(value))
            return Number(value);
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    throw new Error(`${field} must be a timestamp or parseable date`);
}
