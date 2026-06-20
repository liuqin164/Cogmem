import { KernelAgentMemoryBackend } from '../agent/index.js';
import { createMemoryKernel, createMemoryKernelFromConfig, } from '../factory.js';
import { explainRecallWithKernel } from '../recall/RecallExplanation.js';
const STRING_SCHEMA = { type: 'string' };
const NUMBER_SCHEMA = { type: 'number' };
const STRING_ARRAY_SCHEMA = { type: 'array', items: STRING_SCHEMA };
const TURN_INGEST_MODE_SCHEMA = {
    type: 'string',
    enum: ['immediate_compile', 'selective_compile', 'raw_archive_only', 'raw_then_dream'],
};
export function listCogmemMcpTools() {
    return [
        {
            name: 'cogmem_remember_turn',
            description: 'Write one user/agent turn into cogmem memory.',
            inputSchema: {
                type: 'object',
                properties: {
                    agentId: STRING_SCHEMA,
                    projectId: STRING_SCHEMA,
                    sessionId: STRING_SCHEMA,
                    userText: STRING_SCHEMA,
                    assistantText: STRING_SCHEMA,
                    ingestMode: TURN_INGEST_MODE_SCHEMA,
                    collection: STRING_SCHEMA,
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
            description: 'Recall governed agent-facing memory context from cogmem using the same path as cogmem memory recall, including raw ledger fallback with labeled sourceContext events, sourceContext.window metadata, char/source ranges when available, and locator commands when vectors or compiled evidence are unavailable. Suppressed evidence is omitted from active context; use cogmem_explain_recall to inspect filteredEvidence.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: STRING_SCHEMA,
                    agentId: STRING_SCHEMA,
                    projectId: STRING_SCHEMA,
                    collection: STRING_SCHEMA,
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
            description: 'Explain why cogmem recalled specific memory context, including pulse trace, temporal traversal, runtime path, evidence, filteredEvidence, and governanceReason for suppressed candidates.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: STRING_SCHEMA,
                    agentId: STRING_SCHEMA,
                    projectId: STRING_SCHEMA,
                    collection: STRING_SCHEMA,
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
        {
            name: 'cogmem_strategy_plan',
            description: 'Return the deterministic current-turn memory strategy capsule with no instruction authority. This tool does not recall, write, or mutate memory.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: STRING_SCHEMA,
                    projectId: STRING_SCHEMA,
                },
                required: ['query'],
            },
            annotations: {
                title: 'Plan Memory Strategy',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
            },
        },
        {
            name: 'cogmem_memory_map',
            description: 'Return the self-describing cogmem memory map: anatomy, data lanes, bounds, counters, and commands an agent should use.',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: STRING_SCHEMA,
                },
            },
            annotations: {
                title: 'Memory Map',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
            },
        },
        {
            name: 'cogmem_maintenance_tick',
            description: 'Run one explicit host-owned maintenance tick. This decays activation and returns suggested upkeep commands such as dream, govern, re-embed, or cogmem memory bind for unbound raw events; it never starts a hidden daemon.',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: STRING_SCHEMA,
                },
            },
            annotations: {
                title: 'Maintenance Tick',
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
            },
        },
        {
            name: 'cogmem_prospective',
            description: 'Manage evidence-backed future-memory candidates. It lists due state but never executes tasks or tools; confirmation requires a distinct Raw Ledger user event.',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'due', 'create', 'confirm', 'reject', 'defer', 'complete', 'expire'] },
                    projectId: STRING_SCHEMA,
                    statuses: STRING_ARRAY_SCHEMA,
                    candidateId: STRING_SCHEMA,
                    candidateType: { type: 'string', enum: ['intention', 'commitment', 'reminder', 'open_loop', 'plan'] },
                    canonicalKey: STRING_SCHEMA,
                    title: STRING_SCHEMA,
                    details: STRING_SCHEMA,
                    evidenceEventIds: STRING_ARRAY_SCHEMA,
                    confirmationEvidenceEventId: STRING_SCHEMA,
                    dueAt: NUMBER_SCHEMA,
                    deferredUntil: NUMBER_SCHEMA,
                    atTime: NUMBER_SCHEMA,
                    limit: NUMBER_SCHEMA,
                },
                required: ['action'],
            },
            annotations: {
                title: 'Prospective Memory',
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
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
            case 'cogmem_strategy_plan': {
                const query = requiredString(input.query, 'query');
                const intent = opened.kernel.contextCortex.classifyIntent(query);
                return jsonResult(opened.kernel.strategyCortex.plan({
                    query,
                    intent,
                    projectId: optionalString(input.projectId),
                }));
            }
            case 'cogmem_memory_map':
                return jsonResult(opened.kernel.buildMemoryMap({ projectId: optionalString(input.projectId) }));
            case 'cogmem_maintenance_tick':
                return jsonResult(opened.kernel.runMaintenanceTick({ projectId: optionalString(input.projectId) }));
            case 'cogmem_prospective':
                return prospective(opened.kernel, input);
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
function prospective(kernel, input) {
    const service = kernel.prospectiveMemoryService;
    const action = requiredString(input.action, 'action');
    if (action === 'list') {
        const statuses = optionalProspectiveStatuses(input.statuses);
        return jsonResult({ items: service.list({
                projectId: requiredString(input.projectId, 'projectId'),
                statuses,
                limit: optionalNumber(input.limit),
            }) });
    }
    if (action === 'due') {
        return jsonResult({ items: service.listDue({
                projectId: requiredString(input.projectId, 'projectId'),
                atTime: optionalNumber(input.atTime),
                limit: optionalNumber(input.limit),
            }) });
    }
    if (action === 'create') {
        return jsonResult(service.propose({
            projectId: requiredString(input.projectId, 'projectId'),
            candidateType: requiredString(input.candidateType, 'candidateType'),
            canonicalKey: requiredString(input.canonicalKey, 'canonicalKey'),
            title: requiredString(input.title, 'title'),
            details: optionalString(input.details),
            evidenceEventIds: requiredStringArray(input.evidenceEventIds, 'evidenceEventIds'),
            proposedBy: 'operator',
            dueAt: optionalNumber(input.dueAt),
        }));
    }
    const candidateId = requiredString(input.candidateId, 'candidateId');
    const projectId = requiredString(input.projectId, 'projectId');
    if (action === 'confirm') {
        return jsonResult(service.resolve(candidateId, {
            action,
            confirmationEvidenceEventId: requiredString(input.confirmationEvidenceEventId, 'confirmationEvidenceEventId'),
        }, projectId));
    }
    if (action === 'defer') {
        const deferredUntil = optionalNumber(input.deferredUntil);
        if (deferredUntil === undefined)
            throw new Error('deferredUntil must be a finite number');
        return jsonResult(service.resolve(candidateId, { action, deferredUntil }, projectId));
    }
    if (action === 'reject' || action === 'complete' || action === 'expire') {
        return jsonResult(service.resolve(candidateId, { action }, projectId));
    }
    throw new Error(`Unknown prospective action: ${action}`);
}
async function rememberTurn(kernel, input) {
    const memory = new KernelAgentMemoryBackend(kernel);
    const result = await memory.rememberTurnWithResult({
        agentId: requiredString(input.agentId, 'agentId'),
        projectId: requiredString(input.projectId, 'projectId'),
        sessionId: requiredString(input.sessionId, 'sessionId'),
        userText: requiredString(input.userText, 'userText'),
        assistantText: optionalString(input.assistantText),
        ingestMode: optionalTurnIngestMode(input.ingestMode),
        collection: optionalString(input.collection),
        timestamp: optionalNumber(input.timestamp),
    });
    return jsonResult({ ok: true, ...result });
}
function recall(kernel, input, includeExplanation) {
    const query = requiredString(input.query, 'query');
    const requestedAgentId = optionalString(input.agentId);
    const requestedProjectId = optionalString(input.projectId);
    const limit = optionalNumber(input.limit);
    const startTime = optionalTime(input.since, 'since');
    const endTime = optionalTime(input.until, 'until');
    const agentId = requestedAgentId || requestedProjectId || 'openclaw';
    const projectId = requestedProjectId || agentId;
    if (!includeExplanation) {
        const memory = new KernelAgentMemoryBackend(kernel);
        const intent = kernel.contextCortex.classifyIntent(query);
        const strategyCapsule = kernel.strategyCortex.plan({ query, intent, projectId });
        const result = memory.recall({
            agentId,
            projectId,
            collection: optionalString(input.collection),
            query,
            limit,
            startTime,
            endTime,
            retrievalPolicy: strategyCapsule.retrievalPolicy,
        });
        return jsonResult({
            query,
            projectId,
            agentId,
            recallMode: result.recallMode,
            fallbackUsed: result.fallbackUsed,
            queryPlan: result.queryPlan,
            decisionTrace: result.decisionTrace,
            strategyCapsule,
            narrative: result.narrative,
            temporalLabels: result.temporalTraversal?.labels,
            items: result.items,
        });
    }
    const explanation = explainRecallWithKernel(kernel, {
        query,
        agentId,
        projectId,
        collection: optionalString(input.collection),
        limit,
        startTime,
        endTime,
    });
    return jsonResult(explanation);
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
function requiredStringArray(value, field) {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
        throw new Error(`${field} must be a non-empty string array`);
    }
    return value;
}
function optionalProspectiveStatuses(value) {
    if (value === undefined)
        return undefined;
    const statuses = requiredStringArray(value, 'statuses');
    const allowed = new Set(['pending', 'confirmed', 'deferred', 'rejected', 'completed', 'expired']);
    if (statuses.some((status) => !allowed.has(status)))
        throw new Error('statuses contains an invalid prospective status');
    return statuses;
}
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function optionalTurnIngestMode(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (value === 'immediate_compile'
        || value === 'selective_compile'
        || value === 'raw_archive_only'
        || value === 'raw_then_dream') {
        return value;
    }
    throw new Error('ingestMode must be one of immediate_compile, selective_compile, raw_archive_only, raw_then_dream');
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
