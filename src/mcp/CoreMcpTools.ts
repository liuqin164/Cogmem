import { KernelAgentMemoryBackend } from '../agent/index.js';
import { createStableImportIdentityFactory } from '../episode/EpisodeImportIdentity.js';
import type { EpisodeType } from '../episode/EpisodeTypes.js';
import {
  createMemoryKernel,
  createMemoryKernelFromConfig,
  type MemoryKernel,
} from '../factory.js';
import { applyImport, previewImport, type ImportBridgeRequest } from '../import/ImportBridge.js';
import { explainRecallWithKernel } from '../recall/RecallExplanation.js';
import { recallIndexFields } from '../host/RecallBlock.js';

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
      description: 'Recall governed agent-facing memory context from cogmem using the same path as cogmem memory recall, including raw ledger fallback with labeled sourceContext events, sourceContext.window metadata, char/source ranges when available, and locator commands when vectors or compiled evidence are unavailable. Suppressed evidence is omitted from active context; use cogmem_explain_recall to inspect filteredEvidence. Recall is scoped to an agent identity: memory written through a host adapter belongs to that agent\'s scope, so on a database a host has been writing to, a recall carries its own agentId (or the writing host\'s) — 0 results can mean the scope is wrong rather than that nothing was stored.',
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
          granularity: {
            type: 'string',
            enum: ['full', 'index'],
            description: "How much of each result to return. `full` (default) is the whole item. `index` returns one entry per memory — id, title, date and the locator that fetches the whole thing — for a caller that wants to see what is available before paying for it; fetch the ones it picks with cogmem_graph_node's batch `ids`, or the locator itself.",
          },
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
      projectId: STRING_SCHEMA, id: STRING_SCHEMA, ids: { type: 'array', items: STRING_SCHEMA }, includeEvidence: { type: 'boolean' }, evidenceLimit: NUMBER_SCHEMA,
    }, ['projectId']),
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
    {
      name: 'cogmem_shared_publish',
      description: 'Publish memory items into a shared collection other hosts can subscribe to. Only the collection\'s owner may publish into it, and the first publisher of a collection becomes its owner. Disabled entirely unless the install set `[shared] enabled`; a refused publish answers `shared_disabled`. The publishing host is the identity of this connection — it is not taken from the arguments.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: STRING_SCHEMA,
          items: { type: 'array', items: { type: 'object' }, description: 'Items to publish: each needs itemHash, sourceItem and payload.' },
        },
        required: ['collection', 'items'],
      },
      annotations: { title: 'Shared Publish', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cogmem_shared_retract',
      description: 'Retract an item from a shared collection. Soft: the item leaves subscriptions, stays explainable, and only the host that published it may retract it. Disabled unless `[shared] enabled`.',
      inputSchema: {
        type: 'object',
        properties: { itemHash: STRING_SCHEMA },
        required: ['itemHash'],
      },
      annotations: { title: 'Shared Retract', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'cogmem_shared_subscribe',
      description: 'Read items from shared collections. While `[shared] enabled` is true, every agent that can connect reads every shared collection (#146); an install with sharing off returns nothing rather than refusing.',
      inputSchema: {
        type: 'object',
        properties: { collections: { type: 'array', items: { type: 'string' } }, limit: NUMBER_SCHEMA },
        required: ['collections'],
      },
      annotations: { title: 'Shared Subscribe', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cogmem_shared_explain',
      description: 'Look up one shared item by hash, including whether and when it was retracted. Read-only.',
      inputSchema: {
        type: 'object',
        properties: { itemHash: STRING_SCHEMA },
        required: ['itemHash'],
      },
      annotations: { title: 'Shared Explain', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
      case 'cogmem_recall': {
        // `granularity: 'index'` is a view of the same result, not a second query (#131).
        const recalled = recall(opened.kernel, input, false, runtime);
        return optionalString(input.granularity) === 'index' ? asIndexView(recalled) : recalled;
      }
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
        return jsonResult(await previewImport(opened.kernel, mcpImportRequest(input)));
      case 'cogmem_import_apply':
        return jsonResult(await applyImport(opened.kernel, mcpImportRequest(input)));
      case 'cogmem_import_status':
        return handleImportStatus(opened.kernel, input);
      case 'cogmem_shared_publish': {
        // The publisher is this connection's identity (ADR-0006), never an argument.
        const sourceHost = connectionAgentId(runtime, input) ?? '';
        if (!sourceHost) throw new Error('shared_source_host_required');
        const collection = requiredString(input.collection, 'collection');
        const items = Array.isArray(input.items) ? input.items as Array<Record<string, unknown>> : [];
        return jsonResult({ published: await opened.kernel.publishShared(items.map((raw) => ({
          itemHash: requiredString(raw.itemHash, 'itemHash'),
          sourceHost,
          sourceItem: requiredString(raw.sourceItem, 'sourceItem'),
          collection,
          payload: (raw.payload ?? {}) as Record<string, unknown>,
          publishedAt: Date.now(),
        }))) });
      }
      case 'cogmem_shared_retract': {
        const retractedBy = connectionAgentId(runtime, input) ?? '';
        if (!retractedBy) throw new Error('shared_source_host_required');
        await opened.kernel.retractShared({
          itemHash: requiredString(input.itemHash, 'itemHash'), retractedAt: Date.now(), retractedBy,
        });
        return jsonResult({ retracted: true });
      }
      case 'cogmem_shared_subscribe': {
        const collections = Array.isArray(input.collections) ? input.collections.map(String) : [];
        const items = await opened.kernel.subscribeShared(collections, connectionAgentId(runtime, input), {
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        });
        return jsonResult({ items, count: items.length });
      }
      case 'cogmem_shared_explain': {
        // `null` is "no such item", which the JSON result cannot carry, so it is spelled out.
        const found = await opened.kernel.explainShared(requiredString(input.itemHash, 'itemHash'));
        return jsonResult({ item: found?.item ?? null, retractedAt: found?.retractedAt ?? null });
      }
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
        const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean) : [];
        const openKernel = opened.kernel;
        if (ids.length) {
          // Batch fetch by id (#131), which is how a caller turns an index line back into the whole thing.
          // The same lookup the single-id form uses, once per id; an id that is not there is reported in
          // place rather than failing the batch, because the caller asked for several and can use the rest.
          const nodes = ids.map((id) => openKernel.graphNode(id, {
            projectId, includeEvidence: input.includeEvidence === true, evidenceLimit: optionalNumber(input.evidenceLimit), refresh: false, staleOk: true,
          }) ?? { id, found: false });
          return jsonResult({ nodes, requested: ids.length, found: nodes.filter((node) => (node as { found?: boolean }).found !== false).length });
        }
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
      // The import act, said out loud (#153): `externalMessageId` is the replay key every turn may
      // carry, so it cannot be what makes this material project-public. `episode_append` stays a turn
      // with an owner; this tool is the one that puts knowledge into the project.
      const result = await kernel.appendEpisodeMessageAsync({
        projectId, sessionId, sourceAgent, ...message, metadata: { imported: true, importFormat: 'mcp_episode_import' },
      });
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
    episodeType: optionalEpisodeType(input.episodeType, kernel.taxonomy.episodeTypes), topicPath: optionalString(input.topicPath), importance: optionalNumber(input.importance),
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
      semanticIndex: result.semanticIndex,
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

/** The MCP argument names mapped onto the import bridge's own request, which now owns the semantics. */
function mcpImportRequest(input: Record<string, unknown>): ImportBridgeRequest {
  const agent = requiredString(input.agent, 'agent');
  if (agent !== 'openclaw' && agent !== 'hermes') throw new Error('agent must be openclaw or hermes');
  return {
    agent,
    workspaceRoot: requiredString(input.workspaceRoot, 'workspaceRoot'),
    projectId: requiredString(input.projectId, 'projectId'),
    date: optionalString(input.date),
    sessionPaths: Array.isArray(input.sessionPaths) ? input.sessionPaths.map(String) : [],
    memoryPaths: Array.isArray(input.memoryPaths) ? input.memoryPaths.map(String) : [],
    stateDbPath: optionalString(input.stateDbPath),
    profilePath: optionalString(input.profilePath),
    sessionsDir: optionalString(input.sessionsDir),
    since: optionalString(input.since) ?? optionalNumber(input.since),
    until: optionalString(input.until) ?? optionalNumber(input.until),
    reindexRaw: input.reindexRaw === true,
  };
}

function handleImportStatus(
  kernel: MemoryKernel,
  input: Record<string, unknown>,
): CogmemMcpCallResult {
  // The logic lives on the kernel (#63) so host plugins reach the same code through the public entry;
  // this handler only parses arguments. It used to hold its own copy of the query.
  const projectId = requiredString(input.projectId, 'projectId');
  const requested = optionalNumber(input.limit);
  return jsonResult(kernel.importStatus(projectId, requested === undefined ? {} : { limit: requested }));
}

/**
 * Reduce a recall result to one entry per memory: id, title, date and the locator that fetches the whole
 * thing (#131). The fields come from `recallIndexFields`, the same source the injected index line renders,
 * so the index a host's prompt shows and the index this tool returns cannot disagree.
 */
function asIndexView(result: CogmemMcpCallResult): CogmemMcpCallResult {
  const body = result.structuredContent as { items?: Array<Record<string, unknown>> } | undefined;
  const items = Array.isArray(body?.items) ? body.items : [];
  return jsonResult({
    ...(result.structuredContent as Record<string, unknown>),
    granularity: 'index',
    items: items.map((item) => recallIndexFields(item)),
    itemCount: items.length,
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

function optionalEpisodeType(value: unknown, allowed: readonly string[]): EpisodeType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  // The project's `[taxonomy] episode_kinds` is the authority (#184); when it declares none this is the shipped
  // nine, which is what the closed union used to be.
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('episodeType must be a valid episode type');
  return value;
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
