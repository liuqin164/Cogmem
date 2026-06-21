import { KernelAgentMemoryBackend } from '../agent/index.js';
import { createStableImportIdentityFactory } from '../episode/EpisodeImportIdentity.js';
import { createMemoryKernel, createMemoryKernelFromConfig, } from '../factory.js';
import { explainRecallWithKernel } from '../recall/RecallExplanation.js';
const STRING_SCHEMA = { type: 'string' };
const NUMBER_SCHEMA = { type: 'number' };
const STRING_ARRAY_SCHEMA = { type: 'array', items: STRING_SCHEMA };
const TURN_INGEST_MODE_SCHEMA = {
    type: 'string',
    enum: ['immediate_compile', 'selective_compile', 'raw_archive_only', 'raw_then_dream'],
};
const EPISODE_MESSAGE_SCHEMA = {
    type: 'object',
    properties: {
        role: { type: 'string', enum: ['user', 'assistant', 'agent', 'tool', 'system', 'narrator'] },
        text: STRING_SCHEMA,
        externalMessageId: STRING_SCHEMA,
        timestamp: NUMBER_SCHEMA,
    },
    required: ['role', 'text'],
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
            name: 'cogmem_episode_append',
            description: 'Append one bounded raw message and assign it to a session episode. This never runs Dream or promotes durable memory.',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: STRING_SCHEMA, sessionId: STRING_SCHEMA, sourceAgent: STRING_SCHEMA,
                    role: { type: 'string', enum: ['user', 'assistant', 'agent', 'tool', 'system', 'narrator'] },
                    text: STRING_SCHEMA, externalMessageId: STRING_SCHEMA, timestamp: NUMBER_SCHEMA,
                },
                required: ['projectId', 'sessionId', 'sourceAgent', 'role', 'text', 'externalMessageId'],
            },
            annotations: { title: 'Append Episode Message', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        {
            name: 'cogmem_episode_import',
            description: 'Import up to 200 bounded messages into Raw Ledger and the shared episode assembler. Dream is never implicit.',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: STRING_SCHEMA, sessionId: STRING_SCHEMA, sourceAgent: STRING_SCHEMA,
                    messages: { type: 'array', items: EPISODE_MESSAGE_SCHEMA, maxItems: 200 },
                    sealBatch: { type: 'boolean' },
                    forceSeal: { type: 'boolean' },
                },
                required: ['projectId', 'sessionId', 'sourceAgent', 'messages'],
            },
            annotations: { title: 'Import Episode Messages', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        {
            name: 'cogmem_episode_status',
            description: 'Inspect open and sealed episodes plus Dream backlog. Read-only.',
            inputSchema: { type: 'object', properties: { projectId: STRING_SCHEMA, sessionId: STRING_SCHEMA, limit: NUMBER_SCHEMA } },
            annotations: { title: 'Episode Status', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        {
            name: 'cogmem_topic_list',
            description: 'List project-scoped user-shaped topic nodes and audited relations. Read-only.',
            inputSchema: { type: 'object', properties: { projectId: STRING_SCHEMA }, required: ['projectId'] },
            annotations: { title: 'List Memory Topics', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        {
            name: 'cogmem_topic_operate',
            description: 'Apply an auditable user-explicit or model-candidate topic create/rename/alias/move/merge/split/relation operation. Model operations never activate directly.',
            inputSchema: {
                type: 'object', properties: {
                    projectId: STRING_SCHEMA, operationType: STRING_SCHEMA, actor: { type: 'string', enum: ['user_explicit', 'model_candidate', 'import', 'repair'] },
                    targetTopicId: STRING_SCHEMA, payload: { type: 'object' }, evidenceEventIds: STRING_ARRAY_SCHEMA,
                }, required: ['projectId', 'operationType', 'actor', 'payload'],
            },
            annotations: { title: 'Operate Memory Topic', readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        },
        {
            name: 'cogmem_topic_rollback',
            description: 'Revert one audited topic operation inside its original project scope.',
            inputSchema: {
                type: 'object', properties: { projectId: STRING_SCHEMA, operationId: STRING_SCHEMA },
                required: ['projectId', 'operationId'],
            },
            annotations: { title: 'Rollback Memory Topic Operation', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        },
        {
            name: 'cogmem_episode_repair',
            description: 'Run audited episode surgery: split, merge, move-event, reclassify, requeue-dream, or invalidate-dream-run.',
            inputSchema: {
                type: 'object', properties: {
                    projectId: STRING_SCHEMA, operation: STRING_SCHEMA, episodeId: STRING_SCHEMA, sourceEpisodeId: STRING_SCHEMA,
                    targetEpisodeId: STRING_SCHEMA, eventId: STRING_SCHEMA, eventIds: STRING_ARRAY_SCHEMA,
                    episodeType: STRING_SCHEMA, topicPath: STRING_SCHEMA, importance: NUMBER_SCHEMA, mode: STRING_SCHEMA,
                }, required: ['projectId', 'operation'],
            },
            annotations: { title: 'Repair Episode', readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        },
        {
            name: 'cogmem_episode_seal',
            description: 'Explicitly seal one episode and enqueue it for conditional Dream processing.',
            inputSchema: {
                type: 'object', properties: { episodeId: STRING_SCHEMA, mode: { type: 'string', enum: ['soft', 'hard', 'manual', 'batch'] }, reason: STRING_SCHEMA },
                required: ['episodeId'],
            },
            annotations: { title: 'Seal Episode', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        {
            name: 'cogmem_dream_tick',
            description: 'Maintenance-only conditional Dream tick over sealed episodes only. Do not call during normal answer generation. Without maintenanceMode=true it returns a recommendation and does not process backlog.',
            inputSchema: {
                type: 'object', properties: {
                    projectId: STRING_SCHEMA,
                    mode: { type: 'string', enum: ['auto', 'micro', 'normal', 'deep'] },
                    maxEpisodes: NUMBER_SCHEMA,
                    maintenanceMode: { type: 'boolean' },
                },
            },
            annotations: { title: 'Dream Tick', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        },
        {
            name: 'cogmem_dream_status',
            description: 'Inspect the episode Dream backlog without running consolidation.',
            inputSchema: { type: 'object', properties: { projectId: STRING_SCHEMA } },
            annotations: { title: 'Dream Status', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
            case 'cogmem_episode_append':
                return await episodeAppend(opened.kernel, input);
            case 'cogmem_episode_import':
                return await episodeImport(opened.kernel, input);
            case 'cogmem_episode_status':
                return episodeStatus(opened.kernel, input);
            case 'cogmem_topic_list': {
                const projectId = requiredString(input.projectId, 'projectId');
                return jsonResult({ topics: opened.kernel.userTopicPathRegistry.list(projectId), relations: opened.kernel.topicRelationGraph.list(projectId) });
            }
            case 'cogmem_topic_operate':
                return jsonResult(opened.kernel.topicGovernance.apply({
                    projectId: requiredString(input.projectId, 'projectId'),
                    operationType: requiredString(input.operationType, 'operationType'),
                    actor: requiredString(input.actor, 'actor'),
                    targetTopicId: optionalString(input.targetTopicId),
                    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
                    evidenceEventIds: Array.isArray(input.evidenceEventIds) ? input.evidenceEventIds.map(String) : [],
                }));
            case 'cogmem_topic_rollback':
                return jsonResult(opened.kernel.topicGovernance.rollback(requiredString(input.operationId, 'operationId'), requiredString(input.projectId, 'projectId')));
            case 'cogmem_episode_repair':
                return jsonResult(episodeRepair(opened.kernel, input));
            case 'cogmem_episode_seal':
                return jsonResult(opened.kernel.sealEpisode(requiredString(input.episodeId, 'episodeId'), {
                    mode: optionalEpisodeClosureMode(input.mode),
                    reason: optionalString(input.reason) || 'mcp_manual_seal',
                }));
            case 'cogmem_dream_tick':
                if (input.maintenanceMode !== true) {
                    return jsonResult(dreamRecommendation(opened.kernel, optionalString(input.projectId), optionalDreamMode(input.mode)));
                }
                return jsonResult(await opened.kernel.runDreamTick({
                    projectId: optionalString(input.projectId), mode: optionalDreamMode(input.mode), maxEpisodes: optionalNumber(input.maxEpisodes),
                }));
            case 'cogmem_dream_status':
                return jsonResult(opened.kernel.getEpisodeDreamStatus(optionalString(input.projectId)));
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
async function episodeAppend(kernel, input) {
    const text = requiredString(input.text, 'text');
    if (text.length > 16_000)
        throw new Error('text exceeds the 16000 character MCP episode limit');
    return jsonResult(await kernel.appendEpisodeMessageAsync({
        projectId: requiredString(input.projectId, 'projectId'),
        sessionId: requiredString(input.sessionId, 'sessionId'),
        sourceAgent: requiredString(input.sourceAgent, 'sourceAgent'),
        role: requiredEpisodeRole(input.role), text,
        externalMessageId: requiredString(input.externalMessageId, 'externalMessageId'), timestamp: optionalNumber(input.timestamp),
    }));
}
async function episodeImport(kernel, input) {
    if (!Array.isArray(input.messages))
        throw new Error('messages must be an array');
    if (input.messages.length > 200)
        throw new Error('messages exceeds the 200 item MCP import limit');
    const projectId = requiredString(input.projectId, 'projectId');
    const sessionId = requiredString(input.sessionId, 'sessionId');
    const sourceAgent = requiredString(input.sourceAgent, 'sourceAgent');
    const stableIdentity = createStableImportIdentityFactory(sourceAgent, sessionId);
    let totalChars = 0;
    let autoIdentityUsed = false;
    const messages = input.messages.map((value, index) => {
        if (!value || typeof value !== 'object')
            throw new Error(`messages[${index}] must be an object`);
        const message = value;
        const text = requiredString(message.text, `messages[${index}].text`);
        totalChars += text.length;
        if (text.length > 16_000 || totalChars > 1_000_000)
            throw new Error('episode import exceeds bounded text limits');
        const role = requiredEpisodeRole(message.role);
        const timestamp = optionalNumber(message.timestamp);
        const suppliedIdentity = optionalString(message.externalMessageId);
        if (!suppliedIdentity)
            autoIdentityUsed = true;
        return {
            role, text, timestamp,
            externalMessageId: suppliedIdentity
                || stableIdentity({ role, text, timestamp }),
        };
    });
    const results = [];
    const messageResults = [];
    for (const [index, message] of messages.entries()) {
        try {
            const result = await kernel.appendEpisodeMessageAsync({ projectId, sessionId, sourceAgent, ...message });
            results.push(result);
            messageResults.push({ index, processed: true, externalMessageId: message.externalMessageId, ...result });
        }
        catch (error) {
            const failedMessage = error instanceof Error ? error.message : String(error);
            messageResults.push({ index, processed: false, externalMessageId: message.externalMessageId, error: failedMessage });
            return jsonResult({
                processedCount: results.length, failedIndex: index, failedMessage,
                resumeFromIndex: index, messageResults,
                warnings: autoIdentityUsed ? ['auto_identity_not_safe_across_split_batches'] : [],
            }, true);
        }
    }
    const episodeIds = [...new Set(results.map((result) => result.episodeId).filter((id) => Boolean(id)))];
    const receipts = input.sealBatch === true
        ? episodeIds.map((episodeId) => kernel.sealImportedEpisode(episodeId, { reason: 'mcp_batch_boundary', force: input.forceSeal === true }))
        : [];
    return jsonResult({
        imported: results.filter((result) => result.created).length,
        duplicates: results.filter((result) => !result.created).length,
        episodeIds,
        unassignedEventIds: results.filter((result) => !result.assigned && !result.ignored).map((result) => result.eventId),
        ignoredEventIds: results.filter((result) => result.ignored).map((result) => result.eventId),
        closureReceipts: receipts, dreamRan: false,
        processedCount: results.length, messageResults,
        warnings: autoIdentityUsed ? ['auto_identity_not_safe_across_split_batches'] : [],
    });
}
function episodeStatus(kernel, input) {
    const projectId = optionalString(input.projectId);
    const episodes = kernel.listEpisodes({
        projectId, sessionId: optionalString(input.sessionId), limit: optionalNumber(input.limit),
    });
    const dream = kernel.getEpisodeDreamStatus(projectId);
    const dreamBacklogAvailable = dream.pending + dream.retryScheduled + dream.processing > 0;
    const failedDreamAvailable = dream.failedRetryable + dream.failedTerminal > 0;
    const recentRawAvailable = episodes.length > 0 || kernel.episodeStore.countUnassignedRawEvents(projectId) > 0;
    const recommendedActions = [];
    if (dreamBacklogAvailable)
        recommendedActions.push('cogmem_dream_tick_with_maintenance_mode');
    if (dream.failedRetryable > 0)
        recommendedActions.push('cogmem_dream_retry');
    if (dream.failedTerminal > 0)
        recommendedActions.push('inspect_terminal_dream_failure');
    if (kernel.episodeStore.countUnassignedRawEvents(projectId) > 0)
        recommendedActions.push('cogmem_episode_repair');
    const highValueOpen = episodes.some((episode) => episode.status === 'open' && episode.importance >= 0.8);
    const maturingSoftSeal = episodes.some((episode) => episode.status === 'soft_sealed');
    const semanticMemoryMayLag = dreamBacklogAvailable || failedDreamAvailable || highValueOpen || maturingSoftSeal
        || kernel.episodeStore.countUnassignedRawEvents(projectId) > 0;
    return jsonResult({
        episodes,
        dream,
        recentRawAvailable,
        recentEpisodesAvailable: episodes.length > 0,
        dreamBacklogAvailable,
        semanticMemoryMayLag,
        recommendedActions,
        recommendedAction: recommendedActions[0] || 'none',
        warnings: recentRawAvailable ? [] : ['no_recent_episode_ingestion_detected'],
    });
}
function episodeRepair(kernel, input) {
    const projectId = requiredString(input.projectId, 'projectId');
    const operation = requiredString(input.operation, 'operation');
    if (operation === 'move-event')
        return kernel.repairEpisode({
            operation, projectId, eventId: requiredString(input.eventId, 'eventId'), targetEpisodeId: requiredString(input.targetEpisodeId, 'targetEpisodeId'),
        });
    if (operation === 'split')
        return kernel.repairEpisode({
            operation, projectId, episodeId: requiredString(input.episodeId, 'episodeId'),
            eventIds: Array.isArray(input.eventIds) ? input.eventIds.map(String) : [],
        });
    if (operation === 'merge')
        return kernel.repairEpisode({
            operation, projectId, sourceEpisodeId: requiredString(input.sourceEpisodeId, 'sourceEpisodeId'),
            targetEpisodeId: requiredString(input.targetEpisodeId, 'targetEpisodeId'),
        });
    if (operation === 'reclassify')
        return kernel.repairEpisode({
            operation, projectId, episodeId: requiredString(input.episodeId, 'episodeId'),
            episodeType: optionalString(input.episodeType), topicPath: optionalString(input.topicPath), importance: optionalNumber(input.importance),
        });
    if (operation === 'requeue-dream' || operation === 'invalidate-dream-run')
        return kernel.repairEpisode({
            operation, projectId, episodeId: requiredString(input.episodeId, 'episodeId'), mode: optionalDreamMode(input.mode) === 'auto' ? 'normal' : optionalDreamMode(input.mode),
        });
    throw new Error(`invalid episode repair operation: ${operation}`);
}
function dreamRecommendation(kernel, projectId, requestedMode) {
    const status = kernel.getEpisodeDreamStatus(projectId);
    const backlog = status.pending + status.retryScheduled;
    return {
        dryRun: true,
        maintenanceModeRequired: true,
        requestedMode: requestedMode || 'auto',
        recommendedMode: backlog === 0 ? 'none' : backlog === 1 ? 'micro' : 'normal',
        backlog,
        status,
        instruction: 'Call only during idle maintenance or an explicit user/admin maintenance request with maintenanceMode=true.',
    };
}
function optionalEpisodeClosureMode(value) {
    const mode = optionalString(value) || 'manual';
    if (mode === 'soft' || mode === 'hard' || mode === 'manual' || mode === 'batch')
        return mode;
    throw new Error('mode must be soft, hard, manual, or batch');
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
        const episodes = kernel.listEpisodes({ projectId, limit: 20 });
        const recentEpisodeIngestion = episodes.length > 0;
        const semanticMemoryMayLag = !recentEpisodeIngestion
            || episodes.some((episode) => episode.status !== 'sealed' || episode.dreamStatus === 'queued' || episode.dreamStatus === 'failed')
            || kernel.episodeStore.countUnassignedRawEvents(projectId) > 0;
        const warnings = recentEpisodeIngestion ? [] : ['no_recent_episode_ingestion_detected', 'semantic_memory_may_lag'];
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
            warnings,
            semanticMemoryMayLag,
            suggestedTool: recentEpisodeIngestion ? undefined : 'cogmem_episode_append_or_import',
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
function requiredEpisodeRole(value) {
    const role = requiredString(value, 'role');
    if (role === 'user' || role === 'assistant' || role === 'agent' || role === 'tool' || role === 'system' || role === 'narrator')
        return role;
    throw new Error('role must be one of user, assistant, agent, tool, system, narrator');
}
function optionalDreamMode(value) {
    const mode = optionalString(value);
    if (!mode)
        return undefined;
    if (mode === 'auto' || mode === 'micro' || mode === 'normal' || mode === 'deep')
        return mode;
    throw new Error('mode must be one of auto, micro, normal, deep');
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
