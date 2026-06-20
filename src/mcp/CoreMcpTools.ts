import { KernelAgentMemoryBackend } from '../agent/index.js';
import { createStableImportIdentityFactory } from '../episode/EpisodeImportIdentity.js';
import {
  createMemoryKernel,
  createMemoryKernelFromConfig,
  type MemoryKernel,
} from '../factory.js';
import { explainRecallWithKernel } from '../recall/RecallExplanation.js';

export interface CogmemMcpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, object>;
    required?: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

export interface CogmemMcpCallResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: object;
  isError?: boolean;
}

export interface CogmemMcpRuntime {
  kernel?: MemoryKernel;
  dbPath?: string;
  configPath?: string;
  cwd?: string;
}

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

export function listCogmemMcpTools(): CogmemMcpTool[] {
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

export async function callCogmemMcpTool(
  name: string,
  args: Record<string, unknown> | undefined,
  runtime: CogmemMcpRuntime = {},
): Promise<CogmemMcpCallResult> {
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
        return episodeAppend(opened.kernel, input);
      case 'cogmem_episode_import':
        return episodeImport(opened.kernel, input);
      case 'cogmem_episode_status':
        return episodeStatus(opened.kernel, input);
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
  } catch (error) {
    return jsonResult({ error: error instanceof Error ? error.message : String(error) }, true);
  } finally {
    if (opened.shouldClose) opened.kernel.close();
  }
}

function episodeAppend(kernel: MemoryKernel, input: Record<string, unknown>): CogmemMcpCallResult {
  const text = requiredString(input.text, 'text');
  if (text.length > 16_000) throw new Error('text exceeds the 16000 character MCP episode limit');
  return jsonResult(kernel.appendEpisodeMessage({
    projectId: requiredString(input.projectId, 'projectId'),
    sessionId: requiredString(input.sessionId, 'sessionId'),
    sourceAgent: requiredString(input.sourceAgent, 'sourceAgent'),
    role: requiredEpisodeRole(input.role), text,
    externalMessageId: requiredString(input.externalMessageId, 'externalMessageId'), timestamp: optionalNumber(input.timestamp),
  }));
}

function episodeImport(kernel: MemoryKernel, input: Record<string, unknown>): CogmemMcpCallResult {
  if (!Array.isArray(input.messages)) throw new Error('messages must be an array');
  if (input.messages.length > 200) throw new Error('messages exceeds the 200 item MCP import limit');
  const projectId = requiredString(input.projectId, 'projectId');
  const sessionId = requiredString(input.sessionId, 'sessionId');
  const sourceAgent = requiredString(input.sourceAgent, 'sourceAgent');
  const stableIdentity = createStableImportIdentityFactory(sourceAgent, sessionId);
  let totalChars = 0;
  const messages = input.messages.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`messages[${index}] must be an object`);
    const message = value as Record<string, unknown>;
    const text = requiredString(message.text, `messages[${index}].text`);
    totalChars += text.length;
    if (text.length > 16_000 || totalChars > 1_000_000) throw new Error('episode import exceeds bounded text limits');
    const role = requiredEpisodeRole(message.role);
    const timestamp = optionalNumber(message.timestamp);
    return {
      role, text, timestamp,
      externalMessageId: optionalString(message.externalMessageId)
        || stableIdentity({ role, text, timestamp }),
    };
  });
  const results = messages.map((message) => kernel.appendEpisodeMessage({ projectId, sessionId, sourceAgent, ...message }));
  const episodeIds = [...new Set(results.map((result) => result.episodeId).filter((id): id is string => Boolean(id)))];
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
  });
}

function episodeStatus(kernel: MemoryKernel, input: Record<string, unknown>): CogmemMcpCallResult {
  const projectId = optionalString(input.projectId);
  const episodes = kernel.listEpisodes({
    projectId, sessionId: optionalString(input.sessionId), limit: optionalNumber(input.limit),
  });
  const dream = kernel.getEpisodeDreamStatus(projectId);
  const dreamBacklogAvailable = dream.pending + dream.retryScheduled + dream.processing > 0;
  const failedDreamAvailable = dream.failedRetryable + dream.failedTerminal > 0;
  const recentRawAvailable = episodes.length > 0 || kernel.episodeStore.countUnassignedRawEvents(projectId) > 0;
  const recommendedAction = dreamBacklogAvailable
    ? 'cogmem_dream_tick_with_maintenance_mode'
    : dream.failedRetryable > 0
      ? 'cogmem_dream_retry'
      : dream.failedTerminal > 0
        ? 'inspect_terminal_dream_failure'
        : 'none';
  return jsonResult({
    episodes,
    dream,
    recentRawAvailable,
    recentEpisodesAvailable: episodes.length > 0,
    dreamBacklogAvailable,
    semanticMemoryMayLag: dreamBacklogAvailable || failedDreamAvailable,
    recommendedAction,
    warnings: recentRawAvailable ? [] : ['no_recent_episode_ingestion_detected'],
  });
}

function dreamRecommendation(kernel: MemoryKernel, projectId: string | undefined, requestedMode: string | undefined) {
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

function optionalEpisodeClosureMode(value: unknown): 'soft' | 'hard' | 'manual' | 'batch' {
  const mode = optionalString(value) || 'manual';
  if (mode === 'soft' || mode === 'hard' || mode === 'manual' || mode === 'batch') return mode;
  throw new Error('mode must be soft, hard, manual, or batch');
}

function prospective(kernel: MemoryKernel, input: Record<string, unknown>): CogmemMcpCallResult {
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
      candidateType: requiredString(input.candidateType, 'candidateType') as never,
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
    if (deferredUntil === undefined) throw new Error('deferredUntil must be a finite number');
    return jsonResult(service.resolve(candidateId, { action, deferredUntil }, projectId));
  }
  if (action === 'reject' || action === 'complete' || action === 'expire') {
    return jsonResult(service.resolve(candidateId, { action }, projectId));
  }
  throw new Error(`Unknown prospective action: ${action}`);
}

async function rememberTurn(kernel: MemoryKernel, input: Record<string, unknown>): Promise<CogmemMcpCallResult> {
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

function recall(
  kernel: MemoryKernel,
  input: Record<string, unknown>,
  includeExplanation: boolean,
): CogmemMcpCallResult {
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

function openRuntimeKernel(runtime: CogmemMcpRuntime): { kernel: MemoryKernel; shouldClose: boolean } {
  if (runtime.kernel) return { kernel: runtime.kernel, shouldClose: false };
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

function jsonResult(payload: object, isError = false): CogmemMcpCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: isError || undefined,
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${field} must be a non-empty string array`);
  }
  return value;
}

function optionalProspectiveStatuses(value: unknown): Array<'pending' | 'confirmed' | 'deferred' | 'rejected' | 'completed' | 'expired'> | undefined {
  if (value === undefined) return undefined;
  const statuses = requiredStringArray(value, 'statuses');
  const allowed = new Set(['pending', 'confirmed', 'deferred', 'rejected', 'completed', 'expired']);
  if (statuses.some((status) => !allowed.has(status))) throw new Error('statuses contains an invalid prospective status');
  return statuses as Array<'pending' | 'confirmed' | 'deferred' | 'rejected' | 'completed' | 'expired'>;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalTurnIngestMode(value: unknown): 'immediate_compile' | 'selective_compile' | 'raw_archive_only' | 'raw_then_dream' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (
    value === 'immediate_compile'
    || value === 'selective_compile'
    || value === 'raw_archive_only'
    || value === 'raw_then_dream'
  ) {
    return value;
  }
  throw new Error('ingestMode must be one of immediate_compile, selective_compile, raw_archive_only, raw_then_dream');
}

function requiredEpisodeRole(value: unknown): 'user' | 'assistant' | 'agent' | 'tool' | 'system' | 'narrator' {
  const role = requiredString(value, 'role');
  if (role === 'user' || role === 'assistant' || role === 'agent' || role === 'tool' || role === 'system' || role === 'narrator') return role;
  throw new Error('role must be one of user, assistant, agent, tool, system, narrator');
}

function optionalDreamMode(value: unknown): 'auto' | 'micro' | 'normal' | 'deep' | undefined {
  const mode = optionalString(value);
  if (!mode) return undefined;
  if (mode === 'auto' || mode === 'micro' || mode === 'normal' || mode === 'deep') return mode;
  throw new Error('mode must be one of auto, micro, normal, deep');
}

function optionalTime(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number(value);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new Error(`${field} must be a timestamp or parseable date`);
}
