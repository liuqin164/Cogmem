import { KernelAgentMemoryBackend } from '../agent/index.js';
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
const TURN_INGEST_MODE_SCHEMA = {
  type: 'string',
  enum: ['immediate_compile', 'selective_compile', 'raw_archive_only', 'raw_then_dream'],
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
      description: 'Recall governed agent-facing memory context from cogmem using the same path as cogmem memory recall, including raw ledger fallback with sourceContext when vectors or compiled evidence are unavailable. Suppressed evidence is omitted from active context; use cogmem_explain_recall to inspect filteredEvidence.',
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
      description: 'Run one explicit host-owned maintenance tick. This decays activation and returns suggested upkeep commands; it never starts a hidden daemon.',
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
      case 'cogmem_memory_map':
        return jsonResult(opened.kernel.buildMemoryMap({ projectId: optionalString(input.projectId) }));
      case 'cogmem_maintenance_tick':
        return jsonResult(opened.kernel.runMaintenanceTick({ projectId: optionalString(input.projectId) }));
      default:
        return jsonResult({ error: `Unknown cogmem MCP tool: ${name}` }, true);
    }
  } catch (error) {
    return jsonResult({ error: error instanceof Error ? error.message : String(error) }, true);
  } finally {
    if (opened.shouldClose) opened.kernel.close();
  }
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

  if (!includeExplanation) {
    const agentId = requestedAgentId || requestedProjectId || 'openclaw';
    const projectId = requestedProjectId || agentId;
    const memory = new KernelAgentMemoryBackend(kernel);
    const result = memory.recall({
      agentId,
      projectId,
      collection: optionalString(input.collection),
      query,
      limit,
      startTime,
      endTime,
    });

    return jsonResult({
      query,
      projectId,
      agentId,
      recallMode: result.recallMode,
      fallbackUsed: result.fallbackUsed,
      queryPlan: result.queryPlan,
      narrative: result.narrative,
      temporalLabels: result.temporalTraversal?.labels,
      items: result.items,
    });
  }

  const explanation = explainRecallWithKernel(kernel, {
    query,
    agentId: requestedAgentId,
    projectId: requestedProjectId,
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
