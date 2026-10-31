import { KernelAgentMemoryBackend } from '../agent/index.js';
import { createStableImportIdentityFactory } from '../episode/EpisodeImportIdentity.js';
import type { EpisodeType } from '../episode/EpisodeTypes.js';
import {
  createMemoryKernel,
  createMemoryKernelFromConfig,
  type MemoryKernel,
} from '../factory.js';
import { explainRecallWithKernel } from '../recall/RecallExplanation.js';
import {
  OpenClawWorkspaceProfile,
  HermesWorkspaceProfile,
  MarkdownSourceLoader,
  ConversationMarkdownAdapter,
  HermesStateDbAdapter,
  SoulMarkdownAdapter,
  OpenClawDailyMemoryAdapter,
  OpenClawSessionAdapter,
  OpenClawMemoryIndexAdapter,
  OpenClawUserProfileAdapter,
  OpenClawPersonaAdapter,
  buildEpisodeEnvelope,
  type SourceDefinition,
  type SourceAdapterKind,
  type SourceAdapterDiagnostic,
  type SourceAdapter,
} from '../adapters/index.js';
import { InstalledBatchProcessor, type BatchProgressEvent } from '../batch/InstalledBatchProcessor.js';
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { resolve, join, basename, relative } from 'node:path';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

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
  /** Host identity this connection resolved to, e.g. `claude`, `cursor`, `codex`. */
  hostId?: string;
  /**
   * The identity a credential resolved to, when one did. Outranks `hostId`, and nothing a
   * caller sends may override it (ADR-0006).
   */
  authenticatedHostId?: string;
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
    threadId: STRING_SCHEMA,
    turnId: STRING_SCHEMA,
    turnSeq: NUMBER_SCHEMA,
    localDate: STRING_SCHEMA,
    eventOrdinal: NUMBER_SCHEMA,
  },
  required: ['role', 'text'],
};

export function listCogmemMcpTools(): CogmemMcpTool[] {
  return [
    {
      name: 'cogmem_remember_turn',
      description: 'Write one user/agent turn into cogmem memory. Pass the host\'s own turn id as '
        + 'turnId to make a retry a replay: the same turnId with the same text writes nothing the '
        + 'second time and returns the turn already recorded, while the same turnId with different '
        + 'text is refused as a conflict. Without turnId the turn is still written, named after a '
        + 'timestamp and a sequence, so a retry is a second copy.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: STRING_SCHEMA,
          projectId: STRING_SCHEMA,
          sessionId: STRING_SCHEMA,
          turnId: STRING_SCHEMA,
          userText: STRING_SCHEMA,
          assistantText: STRING_SCHEMA,
          ingestMode: TURN_INGEST_MODE_SCHEMA,
          collection: STRING_SCHEMA,
          timestamp: NUMBER_SCHEMA,
          localDate: STRING_SCHEMA,
          timeZone: STRING_SCHEMA,
          projectTimeZone: STRING_SCHEMA,
        },
        // Only what the caller owns. agentId/projectId/sessionId come from the
        // connection (ADR-0006, #92); advertising them as required is what stopped a
        // real host's agent from calling this tool at all — it had none of them to send.
        required: ['userText'],
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
          workspaceId: STRING_SCHEMA,
          sessionId: STRING_SCHEMA,
          threadId: STRING_SCHEMA,
          excludeSessionId: STRING_SCHEMA,
          collection: STRING_SCHEMA,
          limit: NUMBER_SCHEMA,
          since: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
          until: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
          now: NUMBER_SCHEMA,
          localDateNow: STRING_SCHEMA,
          timeZone: STRING_SCHEMA,
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
          workspaceId: STRING_SCHEMA,
          sessionId: STRING_SCHEMA,
          threadId: STRING_SCHEMA,
          excludeSessionId: STRING_SCHEMA,
          collection: STRING_SCHEMA,
          limit: NUMBER_SCHEMA,
          since: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
          until: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
          now: NUMBER_SCHEMA,
          localDateNow: STRING_SCHEMA,
          timeZone: STRING_SCHEMA,
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
          threadId: STRING_SCHEMA, turnId: STRING_SCHEMA, turnSeq: NUMBER_SCHEMA, localDate: STRING_SCHEMA, eventOrdinal: NUMBER_SCHEMA,
        },
        // Identity is the connection's; the message's own data is the caller's (#92).
        required: ['role', 'text', 'externalMessageId'],
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
        // Identity is the connection's; the messages are the caller's (#92).
        required: ['messages'],
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
      name: 'cogmem_episode_audit_boundaries',
      description: 'Read-only deterministic audit of episode boundary health. Does not write audit rows, repair, split, Dream, Atlas, or activation telemetry.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: STRING_SCHEMA, episodeId: STRING_SCHEMA, status: STRING_SCHEMA, limit: NUMBER_SCHEMA, cursor: STRING_SCHEMA,
          maxEvents: NUMBER_SCHEMA, maxDurationMs: NUMBER_SCHEMA, maxIdleGapMs: NUMBER_SCHEMA, timezone: STRING_SCHEMA,
        },
        required: ['projectId'],
      },
      annotations: { title: 'Audit Episode Boundaries', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cogmem_episode_boundary_decisions',
      description: 'Read-only project-scoped trace of episode boundary decisions, including CPU decision, reviewer decision, final decision, guard codes, and warnings.',
      inputSchema: {
        type: 'object',
        properties: { projectId: STRING_SCHEMA, primaryEventId: STRING_SCHEMA, limit: NUMBER_SCHEMA },
        required: ['projectId'],
      },
      annotations: { title: 'Episode Boundary Decisions', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cogmem_episode_split_plan',
      description: 'Read-only deterministic split preview for a single episode. Never calls repair or returns an apply command.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: STRING_SCHEMA, episodeId: STRING_SCHEMA, maxEvents: NUMBER_SCHEMA, maxDurationMs: NUMBER_SCHEMA,
          maxIdleGapMs: NUMBER_SCHEMA, timezone: STRING_SCHEMA, includeEventIds: { type: 'boolean' },
        },
        required: ['projectId', 'episodeId'],
      },
      annotations: { title: 'Plan Episode Split', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
        type: 'object', properties: { projectId: STRING_SCHEMA, episodeId: STRING_SCHEMA, mode: { type: 'string', enum: ['soft', 'hard', 'manual', 'batch'] }, reason: STRING_SCHEMA },
        required: ['projectId', 'episodeId'],
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
      name: 'cogmem_candidate_review',
      description: 'Apply one audited human review action to a needs-confirmation Dream candidate. approve and relink require confirmationEventId, a distinct same-project raw user event; relink additionally requires a correction candidate and an active same-project targetBeliefId, and it rebinds that correction to the named belief (correctedClaimKey, correctedBeliefCandidateIds, and targetBeliefId move together, and a previous target is kept as relinkedFromBeliefId); defer requires a future reviewAfter in epoch milliseconds; supersede requires a replacementCandidateId, which must be a different candidate in the same project, and omitting it fails with replacement_candidate_required. Each action consumes only its own inputs: confirmationEventId for approve and relink, targetBeliefId for relink, replacementCandidateId for supersede, reviewAfter for defer, and nothing for reject. Any of those four the chosen action does not consume is rejected with review_input_not_applicable and is never written into the audit row. Review never bypasses missing evidence or project scope.',
      inputSchema: {
        type: 'object',
        properties: {
          candidateId: STRING_SCHEMA,
          projectId: STRING_SCHEMA,
          action: { type: 'string', enum: ['approve', 'reject', 'defer', 'supersede', 'relink'] },
          actor: STRING_SCHEMA,
          reason: STRING_SCHEMA,
          confirmationEventId: STRING_SCHEMA,
          targetBeliefId: STRING_SCHEMA,
          replacementCandidateId: STRING_SCHEMA,
          reviewAfter: NUMBER_SCHEMA,
        },
        required: ['candidateId', 'projectId', 'action', 'actor', 'reason'],
      },
      annotations: {
        title: 'Review Memory Candidate',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    graphTool('cogmem_memory_frame_show', 'Show Memory Frame', 'Show an evidence-backed structured MemoryFrame for one episode.', {
      projectId: STRING_SCHEMA, episodeId: STRING_SCHEMA,
    }, ['projectId', 'episodeId']),
    graphTool('cogmem_memory_frame_review', 'Review Memory Frame', 'Approve or reject a needs-confirmation MemoryFrame with an auditable reason. Internal staged Dream frames cannot be reviewed.', {
      projectId: STRING_SCHEMA, frameId: STRING_SCHEMA, action: { type: 'string', enum: ['approve', 'reject'] }, actor: STRING_SCHEMA, reason: STRING_SCHEMA,
    }, ['projectId', 'frameId', 'action', 'actor', 'reason'], { readOnlyHint: false, destructiveHint: true, idempotentHint: false }),
    graphTool('cogmem_memory_dimensions', 'List Memory Dimensions', 'List bounded Atlas V2 dimension nodes for one project.', {
      projectId: STRING_SCHEMA, type: STRING_SCHEMA, limit: NUMBER_SCHEMA,
    }, ['projectId']),
    graphTool('cogmem_graph_overview', 'Overview Memory Atlas', 'List a bounded content map of remembered topics, entities, clusters, episodes, actions, and time nodes.', {
      projectId: STRING_SCHEMA, limit: NUMBER_SCHEMA,
    }, ['projectId']),
    graphTool('cogmem_graph_search', 'Search Memory Atlas', 'Locate matching Memory Atlas nodes without expanding the graph.', {
      projectId: STRING_SCHEMA, query: STRING_SCHEMA, limit: NUMBER_SCHEMA, now: NUMBER_SCHEMA, localDateNow: STRING_SCHEMA, timeZone: STRING_SCHEMA,
    }, ['projectId', 'query']),
    graphTool('cogmem_graph_explore', 'Explore Memory Atlas', 'Use for broad memory inventory, project-state, or historical questions; returns a bounded local graph and drilldown actions.', {
      projectId: STRING_SCHEMA, query: STRING_SCHEMA, limit: NUMBER_SCHEMA, evidenceLimit: NUMBER_SCHEMA, now: NUMBER_SCHEMA, localDateNow: STRING_SCHEMA, timeZone: STRING_SCHEMA,
    }, ['projectId', 'query']),
    graphTool('cogmem_memory_query_plan', 'Plan Multidimensional Memory Query', 'Build a bounded structured query frame and evidence-backed Atlas result across dimensions.', {
      projectId: STRING_SCHEMA, query: STRING_SCHEMA, limit: NUMBER_SCHEMA, now: NUMBER_SCHEMA, localDateNow: STRING_SCHEMA, timeZone: STRING_SCHEMA,
    }, ['projectId', 'query']),
    graphTool('cogmem_graph_node', 'Inspect Memory Node', 'Inspect one source-anchored node, its neighbors, evidence event ids, and exact raw drilldown commands.', {
      projectId: STRING_SCHEMA, id: STRING_SCHEMA, includeEvidence: { type: 'boolean' }, evidenceLimit: NUMBER_SCHEMA,
    }, ['projectId', 'id']),
    graphTool('cogmem_graph_neighbors', 'Expand Memory Neighbors', 'Expand one Memory Atlas node by one or two bounded hops.', {
      projectId: STRING_SCHEMA, id: STRING_SCHEMA, hops: NUMBER_SCHEMA, limit: NUMBER_SCHEMA,
    }, ['projectId', 'id']),
    graphTool('cogmem_graph_path', 'Find Memory Path', 'Find an evidence-backed bounded path between two Memory Atlas nodes.', {
      projectId: STRING_SCHEMA, from: STRING_SCHEMA, to: STRING_SCHEMA, maxHops: NUMBER_SCHEMA,
    }, ['projectId', 'from', 'to']),
    graphTool('cogmem_graph_timeline', 'Reconstruct Memory Timeline', 'Reconstruct timestamped memory with the available query facets; action frames are included when applicable but are not required.', {
      projectId: STRING_SCHEMA, query: STRING_SCHEMA, limit: NUMBER_SCHEMA, includeEvidence: { type: 'boolean' }, evidenceLimit: NUMBER_SCHEMA, now: NUMBER_SCHEMA, localDateNow: STRING_SCHEMA, timeZone: STRING_SCHEMA,
    }, ['projectId', 'query']),
    {
      name: 'cogmem_graph_touch',
      description: 'Explicitly record that selected Atlas nodes were used in an answer or decision. Discovery queries stay read-only; call this only for nodes actually consumed.',
      inputSchema: { type: 'object', properties: {
        projectId: STRING_SCHEMA, nodeIds: STRING_ARRAY_SCHEMA, reason: STRING_SCHEMA, query: STRING_SCHEMA,
      }, required: ['projectId', 'nodeIds', 'reason'] },
      annotations: { title: 'Touch Used Memory Nodes', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cogmem_maintenance_tick',
      description: 'Run one explicit host-owned maintenance tick. This decays activation and returns suggested upkeep commands such as dream, govern, embedding backfill status, or cogmem memory bind for unbound raw events; it never starts a hidden daemon.',
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
    {
      name: 'cogmem_import_preview',
      description: 'Dry-run scan agent memory sources (OpenClaw/Hermes) and return estimated record counts without ingesting. Use before import to verify source discovery.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: ['openclaw', 'hermes'] },
          workspaceRoot: STRING_SCHEMA,
          projectId: STRING_SCHEMA,
          configPath: STRING_SCHEMA,
          date: STRING_SCHEMA,
          sessionPaths: { type: 'array', items: STRING_SCHEMA },
          memoryPaths: { type: 'array', items: STRING_SCHEMA },
          stateDbPath: STRING_SCHEMA,
          profilePath: STRING_SCHEMA,
          sessionsDir: STRING_SCHEMA,
          since: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
          until: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
          now: NUMBER_SCHEMA,
          localDateNow: STRING_SCHEMA,
          timeZone: STRING_SCHEMA,
        },
        required: ['agent', 'workspaceRoot'],
      },
      annotations: {
        title: 'Import Preview',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    {
      name: 'cogmem_import_apply',
      description: 'Execute idempotent import of agent memory sources into cogmem. Runs the full pipeline: recordRawEvent -> ingest (vectorize+graph) -> consolidate -> rebuildMemoryAtlas. Returns ingested/skipped counts per source.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: ['openclaw', 'hermes'] },
          workspaceRoot: STRING_SCHEMA,
          projectId: STRING_SCHEMA,
          configPath: STRING_SCHEMA,
          date: STRING_SCHEMA,
          sessionPaths: { type: 'array', items: STRING_SCHEMA },
          memoryPaths: { type: 'array', items: STRING_SCHEMA },
          stateDbPath: STRING_SCHEMA,
          profilePath: STRING_SCHEMA,
          sessionsDir: STRING_SCHEMA,
          since: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
          until: { oneOf: [STRING_SCHEMA, NUMBER_SCHEMA] },
          now: NUMBER_SCHEMA,
          localDateNow: STRING_SCHEMA,
          timeZone: STRING_SCHEMA,
          reindexRaw: { type: 'boolean', default: false },
        },
        required: ['agent', 'workspaceRoot'],
      },
      annotations: {
        title: 'Import Apply',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    {
      name: 'cogmem_import_status',
      description: 'Get the import state of a project: every registered source with its path, adapter kind, last processed timestamp and how many records it has already ingested. Sources are ordered most recently processed first; limit truncates the list while totalSources still reports the full count.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: STRING_SCHEMA,
          limit: NUMBER_SCHEMA,
        },
        required: ['projectId'],
      },
      annotations: {
        title: 'Import Status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
  ];
}

const COGMEM_TOOL_NAMES = new Set(listCogmemMcpTools().map((tool) => tool.name));

/**
 * Whether `name` is a tool this build ships, independent of any profile.
 *
 * Both entry points need this question answered before they answer a
 * profile question, and they must not disagree about the answer, so the set
 * lives here and the protocol handler asks for it rather than rebuilding it.
 * A name outside this set is answered as missing before a runtime kernel is
 * opened: a host config that still names a tool this release does not ship
 * must not touch (or create) a database to be told the tool does not exist.
 */
export function isCogmemMcpTool(name: string): boolean {
  return COGMEM_TOOL_NAMES.has(name);
}

/**
 * The tools that need an agent and a session to write with.
 *
 * Only these get identity defaults: `cogmem_recall` reads `agentId` as a *filter*,
 * so filling it there would silently narrow what a connection can recall.
 */
const IDENTITY_WRITE_TOOLS = new Set([
  'cogmem_remember_turn',
  'cogmem_episode_append',
  'cogmem_episode_import',
]);

/**
 * The agent identity of this connection — the one authority for both reading and writing
 * (ADR-0006, #92 direction ①).
 *
 * Three sources, in order of authority:
 *
 * 1. `runtime.authenticatedHostId` — set when a credential resolved the connection. It is
 *    the only source that may never be overridden.
 * 2. `runtime.hostId` — the host adapter's fixed identity (stdio `--host`, the bridge's
 *    `agentId`). A fact about how the process was started, not a caller's claim.
 * 3. The project the connection is bound to. A single-agent install has no host name of
 *    its own, and its writes are recorded under the project it serves — which is also how
 *    the CLI reads it back, so one installation still finds its own memory.
 *
 * A client-supplied `agentId` is **not** in that list. It used to be honoured on the write
 * side only, so a host like pi (which sends `pi:default`) wrote memory that its own recall
 * could not see: `isAgentRawEvent()` compares the event's `source_id` against the reader's
 * agent, and the two disagreed (#92).
 */
function connectionAgentId(
  runtime: CogmemMcpRuntime,
  input: Record<string, unknown>,
): string | undefined {
  const authenticated = runtime.authenticatedHostId?.trim();
  if (authenticated) return authenticated;
  const host = runtime.hostId?.trim();
  if (host) return host;
  return optionalString(input.projectId);
}

/**
 * Apply the connection's identity to a tool call.
 *
 * A caller may still *label* a turn with its own agent id, but only in metadata: the value
 * it sends is kept as `clientAgentId` and the authoritative `agentId` is the connection's.
 * Refusing a conflicting id outright would break hosts that always send one (pi does), and
 * accepting it as the stored identity is the defect. Labelling keeps both facts.
 */
function withConnectionIdentity(
  input: Record<string, unknown>,
  runtime: CogmemMcpRuntime,
): Record<string, unknown> {
  const agent = connectionAgentId(runtime, input);
  if (!agent) return input;
  const clientAgentId = optionalString(input.agentId);
  return {
    ...input,
    agentId: agent,
    ...(clientAgentId && clientAgentId !== agent ? { clientAgentId } : {}),
    sourceAgent: agent,
    sessionId: input.sessionId ?? `${agent}-session`,
  };
}

export async function callCogmemMcpTool(
  name: string,
  args: Record<string, unknown> | undefined,
  runtime: CogmemMcpRuntime = {},
): Promise<CogmemMcpCallResult> {
  const input = IDENTITY_WRITE_TOOLS.has(name)
    ? withConnectionIdentity(args || {}, runtime)
    : (args || {});
  let opened: { kernel: MemoryKernel; shouldClose: boolean } | undefined;
  try {
    if (!isCogmemMcpTool(name)) {
      return jsonResult({ error: `Unknown cogmem MCP tool: ${name}` }, true);
    }
    opened = openRuntimeKernel(runtime);
    switch (name) {
      case 'cogmem_remember_turn':
        return await rememberTurn(opened.kernel, input);
      case 'cogmem_recall':
        return recall(opened.kernel, input, false, runtime);
      case 'cogmem_explain_recall':
        return recall(opened.kernel, input, true, runtime);
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
      case 'cogmem_episode_audit_boundaries':
        return jsonResult(opened.kernel.auditEpisodeBoundaries({
          projectId: requiredString(input.projectId, 'projectId'), episodeId: optionalString(input.episodeId),
          status: optionalEpisodeStatus(input.status), limit: optionalNumber(input.limit), cursor: optionalString(input.cursor),
          maxEvents: optionalNumber(input.maxEvents), maxDurationMs: optionalNumber(input.maxDurationMs),
          maxIdleGapMs: optionalNumber(input.maxIdleGapMs), timezone: optionalString(input.timezone),
        }));
      case 'cogmem_episode_boundary_decisions':
        return jsonResult({ decisions: opened.kernel.listEpisodeBoundaryDecisions({
          projectId: requiredString(input.projectId, 'projectId'),
          primaryEventId: optionalString(input.primaryEventId),
          limit: optionalNumber(input.limit),
        }) });
      case 'cogmem_episode_split_plan':
        return jsonResult(opened.kernel.planEpisodeSplit({
          projectId: requiredString(input.projectId, 'projectId'), episodeId: requiredString(input.episodeId, 'episodeId'),
          maxEvents: optionalNumber(input.maxEvents), maxDurationMs: optionalNumber(input.maxDurationMs),
          maxIdleGapMs: optionalNumber(input.maxIdleGapMs), timezone: optionalString(input.timezone),
          includeEventIds: input.includeEventIds === true,
        }));
      case 'cogmem_topic_list': {
        const projectId = requiredString(input.projectId, 'projectId');
        return jsonResult({ topics: opened.kernel.userTopicPathRegistry.list(projectId), relations: opened.kernel.topicRelationGraph.list(projectId) });
      }
      case 'cogmem_topic_operate':
        return jsonResult(opened.kernel.topicGovernance.apply({
          projectId: requiredString(input.projectId, 'projectId'),
          operationType: requiredString(input.operationType, 'operationType') as never,
          actor: requiredString(input.actor, 'actor') as never,
          targetTopicId: optionalString(input.targetTopicId),
          payload: input.payload && typeof input.payload === 'object' ? input.payload as Record<string, unknown> : {},
          evidenceEventIds: Array.isArray(input.evidenceEventIds) ? input.evidenceEventIds.map(String) : [],
        }));
      case 'cogmem_topic_rollback':
        return jsonResult(opened.kernel.topicGovernance.rollback(
          requiredString(input.operationId, 'operationId'), requiredString(input.projectId, 'projectId'),
        ));
      case 'cogmem_episode_repair':
        return jsonResult(episodeRepair(opened.kernel, input));
      case 'cogmem_episode_seal':
        return jsonResult(sealProjectEpisode(opened.kernel, requiredString(input.projectId, 'projectId'), requiredString(input.episodeId, 'episodeId'), {
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
      case 'cogmem_import_preview':
        return await handleImportPreview(opened.kernel, input);
      case 'cogmem_import_apply':
        return await handleImportApply(opened.kernel, input);
      case 'cogmem_import_status':
        return handleImportStatus(opened.kernel, input);
      case 'cogmem_candidate_review':
        return jsonResult(opened.kernel.reviewDreamCandidate({
          candidateId: requiredString(input.candidateId, 'candidateId'),
          projectId: requiredString(input.projectId, 'projectId'),
          action: requiredCandidateReviewAction(input.action),
          actor: requiredString(input.actor, 'actor'),
          reason: requiredString(input.reason, 'reason'),
          confirmationEventId: optionalString(input.confirmationEventId),
          targetBeliefId: optionalString(input.targetBeliefId),
          replacementCandidateId: optionalString(input.replacementCandidateId),
          reviewAfter: optionalNumber(input.reviewAfter),
        }));
      case 'cogmem_graph_overview': {
        const projectId = requiredString(input.projectId, 'projectId');
        return jsonResult(opened.kernel.graphOverview({ projectId, limit: optionalNumber(input.limit), refresh: false, staleOk: true }));
      }
      case 'cogmem_memory_frame_show': {
        return jsonResult(opened.kernel.getMemoryFrame(requiredString(input.episodeId, 'episodeId'), requiredString(input.projectId, 'projectId')) ?? { error: 'memory_frame_not_found' });
      }
      case 'cogmem_memory_frame_review': {
        return jsonResult({ applied: opened.kernel.reviewMemoryFrame({
          frameId: requiredString(input.frameId, 'frameId'),
          projectId: requiredString(input.projectId, 'projectId'),
          action: (() => { const action = requiredString(input.action, 'action'); if (action !== 'approve' && action !== 'reject') throw new Error('action must be approve or reject'); return action; })(),
          actor: requiredString(input.actor, 'actor'),
          reason: requiredString(input.reason, 'reason'),
        }) });
      }
      case 'cogmem_memory_dimensions': {
        return jsonResult(opened.kernel.listMemoryDimensions(requiredString(input.projectId, 'projectId'), optionalString(input.type), optionalNumber(input.limit)));
      }
      case 'cogmem_graph_search': {
        const projectId = requiredString(input.projectId, 'projectId');
        return jsonResult(opened.kernel.graphSearch(requiredString(input.query, 'query'), { projectId, limit: optionalNumber(input.limit), now: optionalNumber(input.now), localDateNow: optionalString(input.localDateNow), timeZone: optionalString(input.timeZone), refresh: false, staleOk: true }));
      }
      case 'cogmem_graph_explore': {
        const projectId = requiredString(input.projectId, 'projectId');
        return jsonResult(opened.kernel.graphExplore(requiredString(input.query, 'query'), { projectId, limit: optionalNumber(input.limit),
          evidenceLimit: optionalNumber(input.evidenceLimit), now: optionalNumber(input.now), localDateNow: optionalString(input.localDateNow), timeZone: optionalString(input.timeZone), refresh: false, staleOk: true }));
      }
      case 'cogmem_memory_query_plan': {
        const projectId = requiredString(input.projectId, 'projectId');
        return jsonResult(opened.kernel.planMemoryQuery(requiredString(input.query, 'query'), {
          projectId, limit: optionalNumber(input.limit), now: optionalNumber(input.now), localDateNow: optionalString(input.localDateNow), timeZone: optionalString(input.timeZone), refresh: false, staleOk: true,
        }));
      }
      case 'cogmem_graph_node': {
        const projectId = requiredString(input.projectId, 'projectId');
        const result = opened.kernel.graphNode(requiredString(input.id, 'id'), { projectId, includeEvidence: input.includeEvidence === true, evidenceLimit: optionalNumber(input.evidenceLimit), refresh: false, staleOk: true });
        if (!result) throw new Error('Memory Atlas node not found in the requested project');
        return jsonResult(result);
      }
      case 'cogmem_graph_neighbors': {
        const projectId = requiredString(input.projectId, 'projectId');
        return jsonResult(opened.kernel.graphNeighbors(requiredString(input.id, 'id'), { projectId, hops: optionalNumber(input.hops), limit: optionalNumber(input.limit), refresh: false, staleOk: true }));
      }
      case 'cogmem_graph_path': {
        const projectId = requiredString(input.projectId, 'projectId');
        return jsonResult(opened.kernel.graphPath(requiredString(input.from, 'from'), requiredString(input.to, 'to'), { projectId, maxHops: optionalNumber(input.maxHops), refresh: false, staleOk: true }));
      }
      case 'cogmem_graph_timeline': {
        const projectId = requiredString(input.projectId, 'projectId');
        return jsonResult(opened.kernel.graphTimeline(requiredString(input.query, 'query'), { projectId, limit: optionalNumber(input.limit), includeEvidence: input.includeEvidence === true, evidenceLimit: optionalNumber(input.evidenceLimit), now: optionalNumber(input.now), localDateNow: optionalString(input.localDateNow), timeZone: optionalString(input.timeZone), refresh: false, staleOk: true }));
      }
      case 'cogmem_graph_touch':
        return jsonResult(opened.kernel.touchMemoryAtlas({
          projectId: requiredString(input.projectId, 'projectId'),
          nodeIds: requiredStringArray(input.nodeIds, 'nodeIds'),
          reason: requiredString(input.reason, 'reason'), query: optionalString(input.query),
        }));
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
    if (opened?.shouldClose) opened.kernel.close();
  }
}

function graphTool(
  name: string,
  title: string,
  description: string,
  properties: Record<string, object>,
  required: string[],
  annotationOverrides: Partial<CogmemMcpTool['annotations']> = {},
): CogmemMcpTool {
  return {
    name,
    description: `${description} Canonical memory and activation telemetry remain unchanged until cogmem_graph_touch explicitly records selected nodes.`,
    inputSchema: { type: 'object', properties, required },
    annotations: { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, ...annotationOverrides },
  };
}

async function episodeAppend(kernel: MemoryKernel, input: Record<string, unknown>): Promise<CogmemMcpCallResult> {
  const text = requiredString(input.text, 'text');
  if (text.length > 16_000) throw new Error('text exceeds the 16000 character MCP episode limit');
  return jsonResult(await kernel.appendEpisodeMessageAsync({
    projectId: requiredString(input.projectId, 'projectId'),
    sessionId: requiredString(input.sessionId, 'sessionId'),
    sourceAgent: requiredString(input.sourceAgent, 'sourceAgent'),
    role: requiredEpisodeRole(input.role), text,
    externalMessageId: requiredString(input.externalMessageId, 'externalMessageId'), timestamp: optionalNumber(input.timestamp),
    threadId: optionalString(input.threadId), turnId: optionalString(input.turnId), turnSeq: optionalNumber(input.turnSeq),
    localDate: optionalString(input.localDate), eventOrdinal: optionalNumber(input.eventOrdinal),
  }));
}

async function episodeImport(kernel: MemoryKernel, input: Record<string, unknown>): Promise<CogmemMcpCallResult> {
  if (!Array.isArray(input.messages)) throw new Error('messages must be an array');
  if (input.messages.length > 200) throw new Error('messages exceeds the 200 item MCP import limit');
  const projectId = requiredString(input.projectId, 'projectId');
  const sessionId = requiredString(input.sessionId, 'sessionId');
  const sourceAgent = requiredString(input.sourceAgent, 'sourceAgent');
  const stableIdentity = createStableImportIdentityFactory(sourceAgent, sessionId);
  let totalChars = 0;
  let autoIdentityUsed = false;
  const messages = input.messages.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`messages[${index}] must be an object`);
    const message = value as Record<string, unknown>;
    const text = requiredString(message.text, `messages[${index}].text`);
    totalChars += text.length;
    if (text.length > 16_000 || totalChars > 1_000_000) throw new Error('episode import exceeds bounded text limits');
    const role = requiredEpisodeRole(message.role);
      const timestamp = optionalNumber(message.timestamp);
      const suppliedIdentity = optionalString(message.externalMessageId);
      if (!suppliedIdentity) autoIdentityUsed = true;
      return {
        role, text, timestamp,
        threadId: optionalString(message.threadId),
        turnId: optionalString(message.turnId),
        turnSeq: optionalNumber(message.turnSeq),
        localDate: optionalString(message.localDate),
        eventOrdinal: optionalNumber(message.eventOrdinal),
        externalMessageId: suppliedIdentity
        || stableIdentity({ role, text, timestamp, sourcePosition: optionalString(message.sourceRange) || optionalString(message.recordId) || index }),
    };
  });
  const results: Awaited<ReturnType<MemoryKernel['appendEpisodeMessageAsync']>>[] = [];
  const messageResults: Array<Record<string, unknown>> = [];
  for (const [index, message] of messages.entries()) {
    try {
      const result = await kernel.appendEpisodeMessageAsync({ projectId, sessionId, sourceAgent, ...message });
      results.push(result);
      messageResults.push({ index, processed: true, externalMessageId: message.externalMessageId, ...result });
    } catch (error) {
      const failedMessage = error instanceof Error ? error.message : String(error);
      messageResults.push({ index, processed: false, externalMessageId: message.externalMessageId, error: failedMessage });
      return jsonResult({
        processedCount: results.length, failedIndex: index, failedMessage,
        resumeFromIndex: index, messageResults,
        warnings: autoIdentityUsed ? ['auto_identity_not_safe_across_split_batches'] : [],
      }, true);
    }
  }
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
    processedCount: results.length, messageResults,
    warnings: autoIdentityUsed ? ['auto_identity_not_safe_across_split_batches'] : [],
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
  const recommendedActions: string[] = [];
  // Callers read this list as "call these", so every `cogmem_*` value has to be a
  // registered tool. One tick drains pending backlog, retry-scheduled work, and
  // retryable failures alike (DreamScheduler counts all three), so both
  // conditions name the same tool once.
  if (dreamBacklogAvailable || dream.failedRetryable > 0) recommendedActions.push('cogmem_dream_tick');
  if (dream.failedTerminal > 0) recommendedActions.push('inspect_terminal_dream_failure');
  if (kernel.episodeStore.countUnassignedRawEvents(projectId) > 0) recommendedActions.push('cogmem_episode_repair');
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

function episodeRepair(kernel: MemoryKernel, input: Record<string, unknown>) {
  const projectId = requiredString(input.projectId, 'projectId');
  const operation = requiredString(input.operation, 'operation');
  if (operation === 'move-event') return kernel.repairEpisode({
    operation, projectId, eventId: requiredString(input.eventId, 'eventId'), targetEpisodeId: requiredString(input.targetEpisodeId, 'targetEpisodeId'),
  });
  if (operation === 'split') return kernel.repairEpisode({
    operation, projectId, episodeId: requiredString(input.episodeId, 'episodeId'),
    eventIds: Array.isArray(input.eventIds) ? input.eventIds.map(String) : [],
  });
  if (operation === 'merge') return kernel.repairEpisode({
    operation, projectId, sourceEpisodeId: requiredString(input.sourceEpisodeId, 'sourceEpisodeId'),
    targetEpisodeId: requiredString(input.targetEpisodeId, 'targetEpisodeId'),
  });
  if (operation === 'reclassify') return kernel.repairEpisode({
    operation, projectId, episodeId: requiredString(input.episodeId, 'episodeId'),
    episodeType: optionalEpisodeType(input.episodeType), topicPath: optionalString(input.topicPath), importance: optionalNumber(input.importance),
  });
  if (operation === 'requeue-dream' || operation === 'invalidate-dream-run') return kernel.repairEpisode({
    operation, projectId, episodeId: requiredString(input.episodeId, 'episodeId'), mode: optionalDreamMode(input.mode) === 'auto' ? 'normal' : optionalDreamMode(input.mode) as never,
  });
  throw new Error(`invalid episode repair operation: ${operation}`);
}

function sealProjectEpisode(kernel: MemoryKernel, projectId: string, episodeId: string, input: { mode: 'soft' | 'hard' | 'manual' | 'batch'; reason: string }) {
  const episode = kernel.getEpisode(episodeId);
  if (!episode || episode.projectId !== projectId) throw new Error(`episode_project_mismatch:${episodeId}`);
  return kernel.sealEpisode(episodeId, input);
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
    turnId: optionalString(input.turnId),
    userText: requiredString(input.userText, 'userText'),
    assistantText: optionalString(input.assistantText),
    ingestMode: optionalTurnIngestMode(input.ingestMode),
    collection: optionalString(input.collection),
    timestamp: optionalNumber(input.timestamp),
    localDate: optionalString(input.localDate),
    timeZone: optionalString(input.timeZone),
    projectTimeZone: optionalString(input.projectTimeZone),
  });

  return jsonResult({ ok: true, ...result });
}

function recall(
  kernel: MemoryKernel,
  input: Record<string, unknown>,
  includeExplanation: boolean,
  runtime: CogmemMcpRuntime,
): CogmemMcpCallResult {
  const query = requiredString(input.query, 'query');
  const requestedProjectId = optionalString(input.projectId);
  const limit = optionalNumber(input.limit);
  const startTime = optionalTime(input.since, 'since');
  const endTime = optionalTime(input.until, 'until');
  // The same authority the write side uses, so a connection reads exactly what it wrote
  // (#92). The caller's `agentId` is not consulted: honouring it here is how a connection
  // could ask for another agent's memory.
  const agentId = connectionAgentId(runtime, input) || 'openclaw';
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
      workspaceId: optionalString(input.workspaceId),
      sessionId: optionalString(input.sessionId),
      threadId: optionalString(input.threadId),
      excludeSessionId: optionalString(input.excludeSessionId),
      limit,
      startTime,
      endTime,
      now: optionalNumber(input.now),
      localDateNow: optionalString(input.localDateNow),
      timeZone: optionalString(input.timeZone),
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
      suggestedTool: recentEpisodeIngestion ? undefined : 'cogmem_episode_append',
    });
  }

  const explanation = explainRecallWithKernel(kernel, {
    query,
    agentId,
    projectId,
    collection: optionalString(input.collection),
    workspaceId: optionalString(input.workspaceId),
    sessionId: optionalString(input.sessionId),
    threadId: optionalString(input.threadId),
    excludeSessionId: optionalString(input.excludeSessionId),
    limit,
    startTime,
    endTime,
    now: optionalNumber(input.now),
    localDateNow: optionalString(input.localDateNow),
    timeZone: optionalString(input.timeZone),
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

type AgentKind = 'openclaw' | 'hermes';

interface ParsedArgs {
  values: Record<string, string | boolean>;
  lists: Record<string, string[]>;
}

interface AgentImportResult {
  agent: AgentKind;
  workspaceRoot: string;
  projectId: string;
  dbPath?: string;
  dryRun: boolean;
  window: {
    start: number;
    end: number;
    label: string;
  };
  sourcesScanned: number;
  sourcesChanged: number;
  recordsParsed: number;
  recordsWouldIngest: number;
  recordsIngested: number;
  skippedRecords: number;
  rawRecordsAnchored?: number;
  emptyEpisodesSkipped?: number;
  reindexRaw?: boolean;
  processedSourceIds: string[];
  diagnostics: SourceAdapterDiagnostic[];
  sourceResults: Array<{
    sourceId: string;
    sourcePath: string;
    adapterKind: SourceAdapterKind;
    recordsParsed: number;
    recordsWouldIngest: number;
    recordsIngested: number;
    skippedRecords: number;
    diagnostics: SourceAdapterDiagnostic[];
  }>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string | boolean> = {};
  const lists: Record<string, string[]> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }
    if (values[key] !== undefined) {
      lists[key] = [...(lists[key] || []), next];
    } else {
      values[key] = next;
    }
    index += 1;
  }
  return { values, lists };
}

function stringArg(args: ParsedArgs, key: string): string | undefined {
  const value = args.values[key];
  return typeof value === 'string' ? value : undefined;
}

function listArgs(args: ParsedArgs, key: string): string[] {
  const value = args.values[key];
  const first = typeof value === 'string' ? [value] : [];
  return [...first, ...(args.lists[key] || [])];
}

function buildWindow(args: ParsedArgs): AgentImportResult['window'] {
  const start = parseTime(stringArg(args, 'since'), 0, '--since');
  const end = parseTime(stringArg(args, 'until'), Number.MAX_SAFE_INTEGER, '--until');
  if (end <= start) throw new Error('--until must be later than --since');
  return {
    start,
    end,
    label: stringArg(args, 'date') || 'full-history',
  };
}

function parseTime(value: string | undefined, fallback: number, flag: string): number {
  if (!value) return fallback;
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid ${flag}: ${value}`);
  return parsed;
}

function buildAdapterMap(): Map<SourceAdapterKind, SourceAdapter> {
  return new Map<SourceAdapterKind, SourceAdapter>([
    ['conversation_markdown', new ConversationMarkdownAdapter()],
    ['hermes_state_db', new HermesStateDbAdapter()],
    ['soul_markdown', new SoulMarkdownAdapter()],
    ['openclaw_daily_memory', new OpenClawDailyMemoryAdapter()],
    ['openclaw_session', new OpenClawSessionAdapter()],
    ['openclaw_memory_index', new OpenClawMemoryIndexAdapter()],
    ['openclaw_user_profile', new OpenClawUserProfileAdapter()],
    ['openclaw_persona', new OpenClawPersonaAdapter()],
  ]);
}

function openKernel(
  args: ParsedArgs,
  workspaceRoot: string,
): { kernel: MemoryKernel; dbPath: string; diagnostics: SourceAdapterDiagnostic[] } {
  const explicitDb = stringArg(args, 'db');
  if (explicitDb) {
    const explicitTimeZone = stringArg(args, 'timezone');
    const diagnostics: SourceAdapterDiagnostic[] = explicitTimeZone ? [] : [{
      severity: 'warning',
      code: 'project_timezone_missing_using_host_environment',
      message: 'The explicit --db import did not provide --timezone; dates use the host environment timezone.',
      filePath: explicitDb,
      adapterKind: 'conversation_markdown',
      fallbackHint: 'Pass --timezone <IANA> or use --config with project.timezone for reproducible imports.',
    }];
    return {
      kernel: createMemoryKernel({ dbPath: explicitDb, projectTimeZone: explicitTimeZone }),
      dbPath: explicitDb,
      diagnostics,
    };
  }

  const explicitConfig = stringArg(args, 'config');
  const configResolution = explicitConfig
    ? resolveCogmemConfigPath({ configPath: resolve(explicitConfig) })
    : resolveCogmemConfigPath({ cwd: workspaceRoot });
  if (configResolution.kind === 'toml') {
    const loaded = loadCogmemConfig({ configPath: configResolution.path, cwd: workspaceRoot });
    const error = loaded.diagnostics.find((item) => item.severity === 'error');
    if (error) throw new Error(`${error.code}: ${error.message}`);
    if (!loaded.options.dbPath) {
      throw new Error(`Missing core.db_path in ${configResolution.path}. Run cogmem-init again or pass --db <memory.db>.`);
    }
    return {
      kernel: createMemoryKernelFromConfig({ configPath: configResolution.path, cwd: workspaceRoot }),
      dbPath: loaded.options.dbPath,
      diagnostics: [],
    };
  }

  throw new Error(`Missing cogmem config at ${configResolution.path}. Run cogmem-init first or pass --db <memory.db> / --config <config.toml>.`);
}

function buildSources(
  agent: AgentKind,
  workspaceRoot: string,
  args: ParsedArgs,
  projectId: string,
): SourceDefinition[] {
  if (agent === 'openclaw') {
    const profile = new OpenClawWorkspaceProfile(workspaceRoot);
    return profile.buildInstalledBatchSources({
      projectId,
      date: stringArg(args, 'date'),
      sessionPaths: listArgs(args, 'session').map((item) => resolve(workspaceRoot, item)),
      optionalMemoryPaths: listArgs(args, 'memory').map((item) => resolve(workspaceRoot, item)),
    });
  }
  const profile = new HermesWorkspaceProfile(workspaceRoot);
  return profile.buildSourceDefinitions({
    projectId,
    profilePath: stringArg(args, 'profile'),
    sessionDir: stringArg(args, 'sessions'),
    sessionPaths: listArgs(args, 'session').map((item) => resolve(workspaceRoot, item)),
    stateDbPath: stringArg(args, 'state-db') ? resolve(workspaceRoot, stringArg(args, 'state-db') as string) : undefined,
  });
}

async function handleImportPreview(
  kernel: MemoryKernel,
  input: Record<string, unknown>,
): Promise<CogmemMcpCallResult> {
  const agent = requiredString(input.agent, 'agent') as AgentKind;
  const workspaceRoot = requiredString(input.workspaceRoot, 'workspaceRoot');
  const projectId = requiredString(input.projectId, 'projectId');
  const configPath = optionalString(input.configPath);
  const date = optionalString(input.date);
  const sessionPaths = (input.sessionPaths as string[]) || [];
  const memoryPaths = (input.memoryPaths as string[]) || [];
  const stateDbPath = optionalString(input.stateDbPath);
  const profilePath = optionalString(input.profilePath);
  const sessionsDir = optionalString(input.sessionsDir);
  const since = optionalString(input.since) || optionalNumber(input.since)?.toString();
  const until = optionalString(input.until) || optionalNumber(input.until)?.toString();
  const now = optionalNumber(input.now);
  const localDateNow = optionalString(input.localDateNow);
  const timeZone = optionalString(input.timeZone);

  const args = parseArgs([
    ...(configPath ? ['--config', configPath] : []),
    ...(date ? ['--date', date] : []),
    ...sessionPaths.flatMap((p) => ['--session', p]),
    ...memoryPaths.flatMap((p) => ['--memory', p]),
    ...(stateDbPath ? ['--state-db', stateDbPath] : []),
    ...(profilePath ? ['--profile', profilePath] : []),
    ...(sessionsDir ? ['--sessions', sessionsDir] : []),
    ...(since ? ['--since', since] : []),
    ...(until ? ['--until', until] : []),
    ...(now ? ['--now', String(now)] : []),
    ...(localDateNow ? ['--localDateNow', localDateNow] : []),
    ...(timeZone ? ['--timeZone', timeZone] : []),
  ]);

  const sources = buildSources(agent, workspaceRoot, args, projectId);
  if (sources.length === 0) {
    throw new Error(`No ${agent} memory sources found in ${workspaceRoot}.`);
  }

  const window = buildWindow(args);

  const loader = new MarkdownSourceLoader();
  const adapters = buildAdapterMap();
  const diagnostics: SourceAdapterDiagnostic[] = [];
  const sourceResults: AgentImportResult['sourceResults'] = [];
  let recordsParsed = 0;

  for (const source of sources) {
    const adapter = adapters.get(source.adapterKind);
    if (!adapter) continue;
    const snapshot = loader.read(source);
    const adapted = adapter.adapt(source, snapshot, { start: window.start, end: window.end });
    diagnostics.push(...(adapted.diagnostics || []));
    recordsParsed += adapted.records.length;
    sourceResults.push({
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      adapterKind: source.adapterKind,
      recordsParsed: adapted.records.length,
      recordsWouldIngest: adapted.records.length,
      recordsIngested: 0,
      skippedRecords: 0,
      diagnostics: adapted.diagnostics || [],
    });
  }

  return jsonResult({
    agent,
    workspaceRoot,
    projectId,
    dryRun: true,
    window,
    sourcesScanned: sources.length,
    sourcesChanged: sources.length,
    recordsParsed,
    recordsWouldIngest: recordsParsed,
    recordsIngested: 0,
    skippedRecords: 0,
    rawRecordsAnchored: 0,
    emptyEpisodesSkipped: 0,
    reindexRaw: false,
    processedSourceIds: [],
    diagnostics,
    sourceResults,
  });
}

async function handleImportApply(
  kernel: MemoryKernel,
  input: Record<string, unknown>,
): Promise<CogmemMcpCallResult> {
  const agent = requiredString(input.agent, 'agent') as AgentKind;
  const workspaceRoot = requiredString(input.workspaceRoot, 'workspaceRoot');
  const projectId = requiredString(input.projectId, 'projectId');
  const configPath = optionalString(input.configPath);
  const date = optionalString(input.date);
  const sessionPaths = (input.sessionPaths as string[]) || [];
  const memoryPaths = (input.memoryPaths as string[]) || [];
  const stateDbPath = optionalString(input.stateDbPath);
  const profilePath = optionalString(input.profilePath);
  const sessionsDir = optionalString(input.sessionsDir);
  const since = optionalString(input.since) || optionalNumber(input.since)?.toString();
  const until = optionalString(input.until) || optionalNumber(input.until)?.toString();
  const now = optionalNumber(input.now);
  const localDateNow = optionalString(input.localDateNow);
  const timeZone = optionalString(input.timeZone);
  const reindexRaw = Boolean(input.reindexRaw);

  const args = parseArgs([
    ...(configPath ? ['--config', configPath] : []),
    ...(date ? ['--date', date] : []),
    ...sessionPaths.flatMap((p) => ['--session', p]),
    ...memoryPaths.flatMap((p) => ['--memory', p]),
    ...(stateDbPath ? ['--state-db', stateDbPath] : []),
    ...(profilePath ? ['--profile', profilePath] : []),
    ...(sessionsDir ? ['--sessions', sessionsDir] : []),
    ...(since ? ['--since', since] : []),
    ...(until ? ['--until', until] : []),
    ...(now ? ['--now', String(now)] : []),
    ...(localDateNow ? ['--localDateNow', localDateNow] : []),
    ...(timeZone ? ['--timeZone', timeZone] : []),
    ...(reindexRaw ? ['--reindex-raw'] : []),
  ]);

  const sources = buildSources(agent, workspaceRoot, args, projectId);
  if (sources.length === 0) {
    throw new Error(`No ${agent} memory sources found in ${workspaceRoot}.`);
  }

  const window = buildWindow(args);

  if (reindexRaw) {
    return await reindexRawSources({ agent, args, workspaceRoot, projectId, sources, window, kernel });
  }

  return await importSources({ agent, args, workspaceRoot, projectId, sources, window, kernel });
}

async function importSources(input: {
  agent: AgentKind;
  args: ParsedArgs;
  workspaceRoot: string;
  projectId: string;
  sources: SourceDefinition[];
  window: AgentImportResult['window'];
  kernel: MemoryKernel;
}): Promise<CogmemMcpCallResult> {
  const importedEpisodeIds = new Set<string>();
  let emptyEpisodesSkipped = 0;
  const processor = new InstalledBatchProcessor({
    cursorStore: input.kernel.cursorStore,
    ingestBatch: async (items) => {
      const neurons = [];
      for (const item of items) neurons.push(await input.kernel.ingest(item));
      return neurons;
    },
    recordRawEvidence: async (envelope) => {
      const anchored = await recordRawImportedEvidence(input.kernel, input.projectId, envelope);
      if (anchored.episodeId) importedEpisodeIds.add(anchored.episodeId);
      return anchored.event;
    },
    runOfflineWindow: (window) => input.kernel.consolidate({
      projectId: input.projectId,
      startTime: window.start,
      endTime: window.end,
    }),
    onProgress: undefined,
  });

  const summary = await processor.runOnce({
    window: input.window,
    sources: input.sources,
  });
  for (const episodeId of importedEpisodeIds) {
    const episode = input.kernel.getEpisode(episodeId);
    if (episode?.status !== 'sealed') {
      emptyEpisodesSkipped += sealImportedEpisodeIfReady(
        input.kernel,
        episodeId,
        `${input.agent}_import_batch_boundary`,
      ) ? 0 : 1;
    }
  }
  return jsonResult({
    agent: input.agent,
    workspaceRoot: input.workspaceRoot,
    projectId: input.projectId,
    dryRun: false,
    window: input.window,
    sourcesScanned: summary.sourcesScanned,
    sourcesChanged: summary.sourcesChanged,
    recordsParsed: summary.recordsParsed,
    recordsWouldIngest: summary.recordsIngested,
    recordsIngested: summary.recordsIngested,
    skippedRecords: summary.skippedRecords,
    rawRecordsAnchored: summary.recordsIngested,
    emptyEpisodesSkipped,
    reindexRaw: false,
    processedSourceIds: summary.processedSourceIds,
    diagnostics: summary.adapterDiagnostics,
    sourceResults: summary.sourceResults.map((item) => ({
      sourceId: item.sourceId,
      sourcePath: item.sourcePath,
      adapterKind: item.adapterKind,
      recordsParsed: item.recordsParsed,
      recordsWouldIngest: item.recordsIngested,
      recordsIngested: item.recordsIngested,
      skippedRecords: item.skippedRecords,
      diagnostics: item.diagnostics,
    })),
  });
}

async function reindexRawSources(input: {
  agent: AgentKind;
  args: ParsedArgs;
  workspaceRoot: string;
  projectId: string;
  sources: SourceDefinition[];
  window: AgentImportResult['window'];
  kernel: MemoryKernel;
}): Promise<CogmemMcpCallResult> {
  const loader = new MarkdownSourceLoader();
  const adapters = buildAdapterMap();
  const diagnostics: SourceAdapterDiagnostic[] = [];
  const sourceResults: AgentImportResult['sourceResults'] = [];
  const processedSourceIds: string[] = [];
  let recordsParsed = 0;
  let rawRecordsAnchored = 0;
  let skippedRecords = 0;
  const importedEpisodeIds = new Set<string>();
  let emptyEpisodesSkipped = 0;

  for (const source of input.sources) {
    const adapter = adapters.get(source.adapterKind);
    if (!adapter) continue;
    const snapshot = loader.read(source);
    const adapted = adapter.adapt(source, snapshot, { start: input.window.start, end: input.window.end });
    diagnostics.push(...(adapted.diagnostics || []));
    recordsParsed += adapted.records.length;
    let sourceAnchored = 0;
    let sourceSkipped = 0;
    for (const record of adapted.records) {
      const envelope = buildEpisodeEnvelope(source, record);
      const anchored = await recordRawImportedEvidence(input.kernel, input.projectId, envelope);
      if (anchored.episodeId) importedEpisodeIds.add(anchored.episodeId);
      if (anchored.created) {
        sourceAnchored += 1;
      } else {
        sourceSkipped += 1;
      }
    }
    rawRecordsAnchored += sourceAnchored;
    skippedRecords += sourceSkipped;
    if (adapted.records.length > 0) processedSourceIds.push(source.sourceId);
    sourceResults.push({
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      adapterKind: source.adapterKind,
      recordsParsed: adapted.records.length,
      recordsWouldIngest: adapted.records.length,
      recordsIngested: sourceAnchored,
      skippedRecords: sourceSkipped,
      diagnostics: adapted.diagnostics || [],
    });
  }
  for (const episodeId of importedEpisodeIds) {
    const episode = input.kernel.getEpisode(episodeId);
    if (episode?.status !== 'sealed') {
      emptyEpisodesSkipped += sealImportedEpisodeIfReady(
        input.kernel,
        episodeId,
        `${input.agent}_reindex_batch_boundary`,
      ) ? 0 : 1;
    }
  }

  return jsonResult({
    agent: input.agent,
    workspaceRoot: input.workspaceRoot,
    projectId: input.projectId,
    dryRun: false,
    reindexRaw: true,
    window: input.window,
    sourcesScanned: input.sources.length,
    sourcesChanged: processedSourceIds.length,
    recordsParsed,
    recordsWouldIngest: recordsParsed,
    recordsIngested: rawRecordsAnchored,
    skippedRecords,
    rawRecordsAnchored,
    emptyEpisodesSkipped,
    processedSourceIds,
    diagnostics,
    sourceResults,
  });
}

function sealImportedEpisodeIfReady(kernel: MemoryKernel, episodeId: string, reason: string): boolean {
  if (kernel.listEpisodeEventLinks(episodeId).length === 0) return false;
  kernel.sealImportedEpisode(episodeId, { reason });
  return true;
}

async function recordRawImportedEvidence(
  kernel: MemoryKernel,
  projectId: string,
  envelope: any,
): Promise<{ event: any; created: boolean; episodeId?: string }> {
  const sourceRef = envelope.ingestInput.sourceRefs?.[0];
  const record = envelope.record;
  const metadata = record.metadata || {};
  const sourceLocalDate = typeof metadata.localDate === 'string' ? metadata.localDate : undefined;
  const sourceTimeZone = typeof metadata.timeZone === 'string' ? metadata.timeZone : undefined;
  const role = sourceRef?.role === 'assistant'
    ? 'assistant'
    : sourceRef?.role === 'tool'
      ? 'tool'
      : sourceRef?.role === 'system'
        ? 'system'
        : record.role === 'agent'
          ? 'assistant'
          : record.role === 'user'
            ? 'user'
            : 'system';
  const threadId = sourceRef?.threadId || (typeof metadata.threadId === 'string' ? metadata.threadId : undefined) || record.provenance.sourceId;
  const sessionId = sourceRef?.sessionId || (typeof metadata.sessionId === 'string' ? metadata.sessionId : undefined) || record.provenance.sourceId;
  const eventOrdinal = sourceRef?.eventOrdinal ?? sourceRef?.sourceOffset;
  const allowNonUserEpisodeStart = metadata.importedSummarySupport === true || record.provenance.reliabilityClass === 'imported_summary';
  const importAnchor = createHash('sha256').update(JSON.stringify({
    sourceId: record.provenance.sourceId,
    recordId: record.recordId ?? null,
    sourcePath: sourceRef?.sourcePath ?? null,
    lineStart: sourceRef?.lineStart ?? null,
    lineEnd: sourceRef?.lineEnd ?? null,
    eventOrdinal: eventOrdinal ?? null,
  })).digest('hex');
  const contentHash = createHash('sha256').update(record.text).digest('hex');
  const existing = findImportedRawAnchor(kernel, {
    projectId,
    threadId,
    sourceId: record.provenance.sourceId,
    importAnchor,
    contentHash,
  });
  if (existing) {
    if (existing.contentHash !== contentHash) throw new Error(`import_anchor_content_conflict:${importAnchor}`);
    let link = kernel.episodeStore.getEventLink(existing.eventId);
    if (!link && !kernel.episodeStore.hasEventDisposition(existing.eventId)) {
      await kernel.assembleEpisodeTurnAsync([existing], {
        projectId,
        sessionId,
        sourceAgent: record.provenance.sourceType || record.provenance.sourceId,
        now: record.timestamp,
        allowNonUserEpisodeStart,
      });
      link = kernel.episodeStore.getEventLink(existing.eventId);
    }
    return { event: existing, created: false, episodeId: link?.episodeId };
  }

  const event = kernel.recordRawEvent({
    projectId,
    workspaceId: projectId,
    threadId,
    sessionId,
    turnId: sourceRef?.turnId || record.turnId || record.recordId,
    turnSeq: sourceRef?.turnSeq,
    role,
    rawEventType: 'message',
    content: record.text,
    eventOrdinal,
    occurredAt: record.timestamp,
    localDate: sourceLocalDate,
    timeZone: sourceTimeZone,
    sourceId: record.provenance.sourceId,
    sourceOffset: sourceRef?.sourceOffset,
    lineStart: sourceRef?.lineStart,
    lineEnd: sourceRef?.lineEnd,
    charStart: sourceRef?.charStart,
    charEnd: sourceRef?.charEnd,
    metadata: {
      ...metadata,
      imported: true,
      importAnchor,
      sourcePath: record.provenance.sourcePath,
      sourceType: record.provenance.sourceType,
      sourceAgent: record.provenance.sourceType || record.provenance.sourceId,
      adapterVersion: record.provenance.adapterVersion,
      reliabilityClass: record.provenance.reliabilityClass,
      sourceRef,
      tags: envelope.ingestInput.tags || [],
    },
  });
  const assembly = await kernel.assembleEpisodeTurnAsync([event], {
    projectId,
    sessionId,
    sourceAgent: record.provenance.sourceType || record.provenance.sourceId,
    now: record.timestamp,
    allowNonUserEpisodeStart,
  });
  return { event, created: true, episodeId: assembly.episode?.episodeId };
}

function findImportedRawAnchor(
  kernel: MemoryKernel,
  input: {
    projectId: string;
    threadId: string;
    sourceId: string;
    importAnchor: string;
    contentHash?: string;
  },
): any {
  const indexed = kernel.eventStore.findImportedEventAnchor(input.projectId, input.sourceId, input.importAnchor);
  if (indexed) return indexed;
  return kernel.getThreadEvents(input.threadId, { projectId: input.projectId, limit: 10_000 }).find((event) => {
    const payload = event.payload as { metadata?: Record<string, unknown> };
    return event.sourceId === input.sourceId
      && payload.metadata?.importAnchor === input.importAnchor;
  });
}

function handleImportStatus(
  kernel: MemoryKernel,
  input: Record<string, unknown>,
): CogmemMcpCallResult {
  const projectId = requiredString(input.projectId, 'projectId');
  const requested = optionalNumber(input.limit);
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) {
    throw new Error('limit must be a positive integer');
  }
  const limit = requested ?? 50;

  const cursors = kernel.cursorStore.listRegisteredSources().filter((c) => c.projectId === projectId);
  const processedRecords = cursors.map((cursor) => {
    const hashes = kernel.cursorStore.listProcessedRecordHashes(cursor.sourceId, cursor.contentWindowStart || 0, cursor.contentWindowEnd || 0, projectId);
    return {
      sourceId: cursor.sourceId,
      sourcePath: cursor.sourcePath,
      sourceType: cursor.sourceType,
      lastProcessedAt: cursor.lastProcessedAt,
      lastSeenHash: cursor.lastSeenHash,
      lastSeenMtime: cursor.lastSeenMtime,
      contentWindowStart: cursor.contentWindowStart,
      contentWindowEnd: cursor.contentWindowEnd,
      processedRecordCount: hashes.size,
    };
  });
  // listRegisteredSources() is ordered updated_at DESC, source_id ASC, so slicing is stable
  // and the newest sources are the ones a caller with a small limit sees.
  const sources = processedRecords.slice(0, limit);

  return jsonResult({
    projectId,
    sources,
    totalSources: cursors.length,
    returnedSources: sources.length,
    limit,
  });
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

function requiredCandidateReviewAction(value: unknown): 'approve' | 'reject' | 'defer' | 'supersede' | 'relink' {
  const action = requiredString(value, 'action');
  if (action === 'approve' || action === 'reject' || action === 'defer' || action === 'supersede' || action === 'relink') return action;
  throw new Error('action must be approve, reject, defer, supersede, or relink');
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
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('value must be a finite number');
}

function optionalEpisodeType(value: unknown): EpisodeType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const allowed = new Set<EpisodeType>(['discussion', 'decision', 'correction', 'preference', 'goal', 'debugging', 'planning', 'prospective', 'general']);
  if (typeof value !== 'string' || !allowed.has(value as EpisodeType)) throw new Error('episodeType must be a valid episode type');
  return value as EpisodeType;
}

function optionalEpisodeStatus(value: unknown): 'open' | 'soft_sealed' | 'sealed' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'open' || value === 'soft_sealed' || value === 'sealed') return value;
  throw new Error('status must be open, soft_sealed, or sealed');
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
