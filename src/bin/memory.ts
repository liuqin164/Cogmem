#!/usr/bin/env bun
import { resolve } from 'node:path';

import { KernelAgentMemoryBackend, type AgentRecallIntent } from '../agent/index.js';
import { createMemoryKernel, createMemoryKernelFromConfig, type MemoryKernel } from '../factory.js';
import { loadCogmemConfig } from '../config/CogmemConfig.js';
import {
  memoryEventCharRange,
  memoryEventLabel,
  memoryEventSourceRange,
  normalizeSourceContextWindow,
} from '../recall/SourceContextMetadata.js';
import type { DeepWriteCandidateRecord, DeepWriteCandidateStatus } from '../store/DeepWriteCandidateStore.js';
import { MemoryInspectionStore } from '../store/MemoryInspectionStore.js';
import type { MemoryEvent } from '../types/index.js';
import { printCliJson } from './CliJson.js';

interface MemoryArgs {
  command?: 'status' | 'list' | 'search' | 'recall' | 'show' | 'dream' | 'govern' | 'candidates' | 'review' | 'map' | 'tick' | 'bind'
    | 'graph' | 'graph-search' | 'graph-explore' | 'graph-node' | 'graph-neighbors' | 'graph-path' | 'graph-timeline';
  query?: string;
  eventId?: string;
  nodeId?: string;
  fromId?: string;
  toId?: string;
  hops?: number;
  maxHops?: number;
  status?: DeepWriteCandidateStatus;
  reviewAction?: 'approve' | 'reject' | 'defer' | 'supersede' | 'relink';
  actor?: string;
  reason?: string;
  confirmationEventId?: string;
  targetBeliefId?: string;
  replacementCandidateId?: string;
  reviewAfter?: number;
  now?: number;
  evidenceLimit?: number;
  agentId?: string;
  intent?: AgentRecallIntent;
  projectId?: string;
  collection?: string;
  workspaceId?: string;
  threadId?: string;
  sessionId?: string;
  excludeSessionId?: string;
  limit?: number;
  before?: number;
  after?: number;
  sinceGlobalSeq?: number;
  intervalMs?: number;
  maxRuns?: number;
  promoteLimit?: number;
  dbPath?: string;
  configPath?: string;
  watch: boolean;
  promote: boolean;
  json: boolean;
  includeEvidence: boolean;
  help: boolean;
}

function readArgs(argv: string[]): MemoryArgs {
  const [commandCandidate, ...rest] = argv;
  const command = isMemoryCommand(commandCandidate) ? commandCandidate : undefined;
  const values: Record<string, string | boolean> = {};
  const flags = command ? rest : argv;
  for (let index = 0; index < flags.length; index += 1) {
    const item = flags[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = flags[index + 1];
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }
    values[key] = next;
    index += 1;
  }

  return {
    command,
    query: stringArg(values, 'query') || stringArg(values, 'q'),
    eventId: stringArg(values, 'event') || stringArg(values, 'event-id'),
    nodeId: stringArg(values, 'id') || stringArg(values, 'node-id'),
    fromId: stringArg(values, 'from'),
    toId: stringArg(values, 'to'),
    hops: numberArg(values, 'hops'),
    maxHops: numberArg(values, 'max-hops'),
    status: candidateStatusArg(values, 'status'),
    reviewAction: reviewActionArg(values, 'action'),
    actor: stringArg(values, 'actor'),
    reason: stringArg(values, 'reason'),
    confirmationEventId: stringArg(values, 'confirmation-event'),
    targetBeliefId: stringArg(values, 'target-belief'),
    replacementCandidateId: stringArg(values, 'replacement'),
    reviewAfter: numberArg(values, 'review-after'),
    now: numberArg(values, 'now'),
    evidenceLimit: numberArg(values, 'evidence-limit'),
    agentId: stringArg(values, 'agent') || stringArg(values, 'agent-id'),
    intent: recallIntentArg(values, 'intent'),
    projectId: stringArg(values, 'project') || stringArg(values, 'project-id'),
    collection: stringArg(values, 'collection'),
    workspaceId: stringArg(values, 'workspace') || stringArg(values, 'workspace-id'),
    threadId: stringArg(values, 'thread') || stringArg(values, 'thread-id'),
    sessionId: stringArg(values, 'session') || stringArg(values, 'session-id'),
    excludeSessionId: stringArg(values, 'exclude-session') || stringArg(values, 'exclude-session-id'),
    limit: numberArg(values, 'limit'),
    before: numberArg(values, 'before'),
    after: numberArg(values, 'after'),
    sinceGlobalSeq: numberArg(values, 'since') ?? numberArg(values, 'since-global-seq'),
    intervalMs: numberArg(values, 'interval-ms'),
    maxRuns: numberArg(values, 'max-runs'),
    promoteLimit: numberArg(values, 'promote-limit'),
    dbPath: stringArg(values, 'db'),
    configPath: stringArg(values, 'config'),
    watch: values.watch === true,
    promote: values.promote === true,
    json: values.json === true,
    includeEvidence: values['include-evidence'] === true,
    help: values.help === true || values.h === true,
  };
}

function usage(): string {
  return [
    'Usage: cogmem memory <status|list|search|recall|show|dream|govern|candidates|review|map|tick|bind|graph...> [args]',
    '',
    'Commands:',
    '  status               summarize raw ledger, vector, and dream backlog state',
    '  list                 list raw ledger events with source anchors',
    '  search --query <q>   search raw ledger text without requiring hot vectors',
    '  recall --query <q>   run agent-facing governed recall with source context',
    '  show --event <id>    show one raw event with surrounding context',
    '  dream                compatibility alias for a conditional sealed-episode Dream tick',
    '  govern               apply CPU governance to pending dream/deep-write candidates',
    '  candidates           list dream/deep-write governance candidates',
    '  review               approve, reject, defer, supersede, or relink one needs-confirmation candidate',
    '  map                  print the self-describing memory map for agent/host inspection',
    '  tick                 run one explicit host-owned maintenance tick',
    '  bind                 backfill memory bindings for high-value raw user events',
    '  graph                show a bounded overview of remembered topics, entities, clusters, actions, and time',
    '  graph-search         locate Atlas nodes by --query without expanding the graph',
    '  graph-explore        return a bounded local graph for a broad --query',
    '  graph-node           inspect --id with neighbors and evidence drilldown commands',
    '  graph-neighbors      expand --id by --hops 1..2',
    '  graph-path           find a bounded path from --from to --to',
    '  graph-timeline       reconstruct entity/time/action history for --query',
    '',
    'Common options:',
    '  --project <id>       scope to one project',
    '  --collection <name>  recall from a named collection; default excludes collection:theseus',
    '  --workspace <id>     scope to one workspace',
    '  --thread <id>        scope to one thread',
    '  --session <id>       scope to one session',
    '  --limit <n>          result limit, default 20',
    '  --since <globalSeq>  for bind, scan raw events at or after a global sequence',
    '  --status <status>    candidate queue status, default candidate',
    '  --id <candidate>     candidate id for review',
    '  --action <action>    review action: approve, reject, defer, supersede, or relink',
    '  --actor <name>       audited operator identity for review',
    '  --reason <text>      required audited review reason',
    '  --confirmation-event <id>  distinct same-project raw user evidence for approve/relink',
    '  --target-belief <id>       active same-project belief for correction relink',
    '  --replacement <id>         replacement candidate for supersede',
    '  --review-after <ms>         future epoch milliseconds for defer',
    '  --promote            after dream, run CPU governance over pending candidates',
    '  --promote-limit <n>  governance candidate limit, default follows --limit or 100',
    '  --watch              keep issuing conditional Dream ticks as a host-owned worker',
    '  --interval-ms <n>    watch sleep interval, default 300000',
    '  --max-runs <n>       stop watch after n iterations; omit for long-running worker',
    '  --agent <id>         agent id for governed recall, default openclaw',
    '  --intent <intent>    memory_recall, previous_session_summary, or forensic_quote',
    '  --db <memory.db>     open an explicit database path',
    '  --config <toml>      open a cogmem TOML config',
    '  --include-evidence   include bounded raw excerpts; event ids are always returned',
    '  --evidence-limit <n> bound evidence locators per Atlas node, default 2, maximum 10',
    '  --now <epoch-ms>     deterministic reference time for relative Atlas time facets',
    '  --json               print cogmem.cli.v1 JSON; queue counters are stable top-level fields',
    '',
    'Dream processes sealed episodes only. A timer may call the conditional tick, but recall and message ingestion never run Dream.',
    'Candidate interpretation uses deterministic rules unless [memory_model] configures an OpenAI-compatible local or cloud chat model.',
    'This is a local audit console, not a notes app or UI dashboard. It exposes provenance so memory is not a black box.',
  ].join('\n');
}

function isMemoryCommand(value: string | undefined): value is NonNullable<MemoryArgs['command']> {
  return value === 'status'
    || value === 'list'
    || value === 'search'
    || value === 'recall'
    || value === 'show'
    || value === 'dream'
    || value === 'govern'
    || value === 'candidates'
    || value === 'review'
    || value === 'map'
    || value === 'tick'
    || value === 'bind'
    || value === 'graph'
    || value === 'graph-search'
    || value === 'graph-explore'
    || value === 'graph-node'
    || value === 'graph-neighbors'
    || value === 'graph-path'
    || value === 'graph-timeline';
}

function reviewActionArg(values: Record<string, string | boolean>, key: string): MemoryArgs['reviewAction'] {
  const raw = stringArg(values, key);
  if (!raw) return undefined;
  if (raw === 'approve' || raw === 'reject' || raw === 'defer' || raw === 'supersede' || raw === 'relink') return raw;
  throw new Error(`--${key} must be one of approve, reject, defer, supersede, relink`);
}

function recallIntentArg(
  values: Record<string, string | boolean>,
  key: string,
): AgentRecallIntent | undefined {
  const raw = stringArg(values, key);
  if (!raw) return undefined;
  if (raw === 'memory_recall' || raw === 'previous_session_summary' || raw === 'forensic_quote') return raw;
  throw new Error(`--${key} must be one of memory_recall, previous_session_summary, forensic_quote`);
}

function stringArg(values: Record<string, string | boolean>, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberArg(values: Record<string, string | boolean>, key: string): number | undefined {
  const raw = stringArg(values, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${key} must be a non-negative number`);
  return parsed;
}

function candidateStatusArg(
  values: Record<string, string | boolean>,
  key: string,
): DeepWriteCandidateStatus | undefined {
  const raw = stringArg(values, key);
  if (!raw) return undefined;
  if (
    raw === 'shadow'
    || raw === 'candidate'
    || raw === 'promoted'
    || raw === 'rejected'
    || raw === 'needs_confirmation'
    || raw === 'superseded'
  ) {
    return raw;
  }
  throw new Error(`--${key} must be one of shadow, candidate, promoted, rejected, needs_confirmation, superseded`);
}

function openKernel(args: MemoryArgs): MemoryKernel {
  if (args.dbPath) return createMemoryKernel({ dbPath: resolve(args.dbPath) });
  return createMemoryKernelFromConfig({
    configPath: args.configPath ? resolve(args.configPath) : undefined,
    cwd: process.cwd(),
  });
}

function inspectionDbPath(args: MemoryArgs): string {
  if (args.dbPath) return resolve(args.dbPath);
  const loaded = loadCogmemConfig({
    configPath: args.configPath ? resolve(args.configPath) : undefined,
    cwd: process.cwd(),
  });
  if (!loaded.options.dbPath) throw new Error('Cogmem config does not define core.db_path');
  return loaded.options.dbPath;
}

function runReadOnlyInspection(args: MemoryArgs): void {
  const inspection = new MemoryInspectionStore(inspectionDbPath(args));
  try {
    if (args.command === 'status') {
      const payload = inspection.status({
        projectId: args.projectId, workspaceId: args.workspaceId,
        threadId: args.threadId, sessionId: args.sessionId,
      });
      if (args.json) {
        printCliJson('memory.status', payload, {
          queue: payload.dreamCandidateQueue,
          beliefs: payload.activeBeliefs,
        });
      } else printHuman('status', payload as unknown as Record<string, unknown>);
      return;
    }
    const status = args.status || 'candidate';
    const candidates = inspection.listCandidates({
      projectId: args.projectId,
      status,
      limit: args.limit || 50,
    });
    const payload = { total: candidates.length, status, candidates: candidates.map(candidateToJson) };
    if (args.json) printCliJson('memory.candidates', payload);
    else printHuman('candidates', payload);
  } finally {
    inspection.close();
  }
}

function eventText(event: MemoryEvent): string {
  const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.output === 'string') return payload.output;
  if (typeof payload.title === 'string') return payload.title;
  return JSON.stringify(event.payload);
}

function eventToJson(event: MemoryEvent): Record<string, unknown> {
  const text = eventText(event);
  return {
    eventId: event.eventId,
    label: memoryEventLabel(event),
    globalSeq: event.globalSeq,
    projectId: event.projectId,
    workspaceId: event.workspaceId,
    threadId: event.threadId,
    sessionId: event.sessionId,
    role: event.role,
    rawEventType: event.rawEventType,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    localDate: event.localDate,
    charRange: memoryEventCharRange(event),
    sourceRange: memoryEventSourceRange(event),
    textLength: text.length,
    text,
    sourceAnchor: {
      eventId: event.eventId,
      threadId: event.threadId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      role: event.role,
      threadSeq: event.threadSeq,
      turnSeq: event.turnSeq,
      eventOrdinal: event.eventOrdinal,
      parentEventId: event.parentEventId,
      prevEventId: event.prevEventId,
      nextEventId: event.nextEventId,
      causalityType: event.causalityType,
      orderingConfidence: event.orderingConfidence,
    },
  };
}

function candidateToJson(candidate: DeepWriteCandidateRecord): Record<string, unknown> {
  return {
    candidateId: candidate.candidateId,
    runId: candidate.runId,
    candidateType: candidate.candidateType,
    status: candidate.status,
    confidence: candidate.confidence,
    content: candidate.content,
    evidence: candidate.evidence,
    promotionTargetType: candidate.promotionTargetType,
    promotionTargetId: candidate.promotionTargetId,
    statusReason: candidate.statusReason,
    reviewAfter: candidate.reviewAfter,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function runStatus(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  const page = kernel.eventStore.queryEvents(1, 1, {
    projectId: args.projectId ? [args.projectId] : undefined,
    workspaceId: args.workspaceId ? [args.workspaceId] : undefined,
    threadId: args.threadId ? [args.threadId] : undefined,
    sessionId: args.sessionId ? [args.sessionId] : undefined,
  });
  const dreamBacklog = kernel.getDreamBacklogStatus(args.projectId);
  const episodeDream = kernel.getEpisodeDreamStatus(args.projectId);
  const dreamCandidateQueue = kernel.getDreamCandidateQueue(args.projectId);
  return {
    rawEventCount: page.total,
    rawEvents: page.total,
    vectorCount: kernel.vectorStore.getCurrentCount(),
    vectors: kernel.vectorStore.getCurrentCount(),
    dreamedRawCount: dreamBacklog.dreamedRawCount,
    undreamedRawCount: dreamBacklog.undreamedRawCount,
    dreamCoverageRate: dreamBacklog.dreamCoverageRate,
    lastDreamedGlobalSeq: dreamBacklog.lastDreamedGlobalSeq,
    lastDreamedAt: dreamBacklog.lastDreamedAt,
    dreamBacklog,
    episodeDream,
    dreamCandidateQueue,
  };
}

function runList(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  const page = kernel.eventStore.queryEvents(1, args.limit || 20, {
    projectId: args.projectId ? [args.projectId] : undefined,
    workspaceId: args.workspaceId ? [args.workspaceId] : undefined,
    threadId: args.threadId ? [args.threadId] : undefined,
    sessionId: args.sessionId ? [args.sessionId] : undefined,
  });
  return {
    total: page.total,
    events: page.records.map(eventToJson),
  };
}

function runSearch(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  if (!args.query) throw new Error(`Missing --query.\n${usage()}`);
  const events = kernel.searchRawEvents(args.query, {
    projectId: args.projectId,
    workspaceId: args.workspaceId,
    threadId: args.threadId,
    sessionId: args.sessionId,
    limit: args.limit || 20,
  });
  return {
    query: args.query,
    total: events.length,
    events: events.map(eventToJson),
  };
}

function runRecall(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  if (!args.query) throw new Error(`Missing --query.\n${usage()}`);
  const backend = new KernelAgentMemoryBackend(kernel);
  const projectId = args.projectId || 'openclaw';
  const strategyCapsule = kernel.strategyCortex.plan({
    query: args.query,
    intent: kernel.contextCortex.classifyIntent(args.query),
    projectId,
  });
  const result = backend.recall({
    agentId: args.agentId || 'openclaw',
    projectId,
    collection: args.collection,
    workspaceId: args.workspaceId,
    sessionId: args.sessionId,
    threadId: args.threadId,
    excludeSessionId: args.excludeSessionId,
    intent: args.intent,
    query: args.query,
    limit: args.limit || 5,
    retrievalPolicy: strategyCapsule.retrievalPolicy,
  });
  return {
    query: args.query,
    agentId: args.agentId || 'openclaw',
    projectId,
    collection: args.collection,
    recallMode: result.recallMode,
    fallbackUsed: result.fallbackUsed,
    queryPlan: result.queryPlan,
    decisionTrace: result.decisionTrace,
    strategyCapsule,
    narrative: result.narrative,
    items: result.items,
  };
}

function runMap(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  return kernel.buildMemoryMap({ projectId: args.projectId }) as unknown as Record<string, unknown>;
}

function runTick(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  return kernel.runMaintenanceTick({ projectId: args.projectId }) as unknown as Record<string, unknown>;
}

function runBind(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  return kernel.bindRawEvents({
    projectId: args.projectId,
    workspaceId: args.workspaceId,
    threadId: args.threadId,
    sessionId: args.sessionId,
    sinceGlobalSeq: args.sinceGlobalSeq,
    limit: args.limit || 500,
  }) as unknown as Record<string, unknown>;
}

function runGraphCommand(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  const projectId = args.projectId;
  if (!projectId) throw new Error(`Memory Atlas commands require --project.\n${usage()}`);
  kernel.ensureMemoryAtlas({ projectId });
  const options = { projectId, limit: args.limit, includeEvidence: args.includeEvidence,
    evidenceLimit: args.evidenceLimit, now: args.now };
  if (args.command === 'graph') return kernel.graphOverview(options) as unknown as Record<string, unknown>;
  if (args.command === 'graph-search') {
    if (!args.query) throw new Error(`graph-search requires --query.\n${usage()}`);
    return kernel.graphSearch(args.query, options) as unknown as Record<string, unknown>;
  }
  if (args.command === 'graph-explore') {
    if (!args.query) throw new Error(`graph-explore requires --query.\n${usage()}`);
    return kernel.graphExplore(args.query, options) as unknown as Record<string, unknown>;
  }
  if (args.command === 'graph-node') {
    if (!args.nodeId) throw new Error(`graph-node requires --id.\n${usage()}`);
    const result = kernel.graphNode(args.nodeId, options);
    if (!result) throw new Error(`No Memory Atlas node found for ${args.nodeId}`);
    return result as unknown as Record<string, unknown>;
  }
  if (args.command === 'graph-neighbors') {
    if (!args.nodeId) throw new Error(`graph-neighbors requires --id.\n${usage()}`);
    return kernel.graphNeighbors(args.nodeId, { ...options, hops: args.hops }) as unknown as Record<string, unknown>;
  }
  if (args.command === 'graph-path') {
    if (!args.fromId || !args.toId) throw new Error(`graph-path requires --from and --to.\n${usage()}`);
    return kernel.graphPath(args.fromId, args.toId, { ...options, maxHops: args.maxHops }) as unknown as Record<string, unknown>;
  }
  if (!args.query) throw new Error(`graph-timeline requires --query.\n${usage()}`);
  return kernel.graphTimeline(args.query, options) as unknown as Record<string, unknown>;
}

function runShow(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  if (!args.eventId) throw new Error(`Missing --event.\n${usage()}`);
  const beforeCount = args.before ?? 2;
  const afterCount = args.after ?? 2;
  const context = kernel.getEventContext(args.eventId, {
    before: beforeCount,
    after: afterCount,
  });
  if (!context) throw new Error(`No raw ledger event found for ${args.eventId}`);
  const normalized = normalizeSourceContextWindow(context.event, context.before, context.after, {
    before: beforeCount,
    after: afterCount,
  });
  return {
    event: eventToJson(context.event),
    before: normalized.before.map(eventToJson),
    after: normalized.after.map(eventToJson),
    parent: context.parent ? eventToJson(context.parent) : undefined,
    children: context.children.map(eventToJson),
    window: normalized.window,
  };
}

function runGovern(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  if (args.status && args.status !== 'candidate') {
    if (args.status === 'needs_confirmation') {
      const candidates = kernel.listDreamCandidates({
        projectId: args.projectId,
        statuses: ['needs_confirmation'],
        limit: args.limit || 50,
      });
      return {
        status: 'needs_confirmation',
        total: candidates.length,
        candidates: candidates.map(candidateToJson),
        decisions: [],
        queue: kernel.getDreamCandidateQueue(args.projectId),
        warning: 'memory govern does not process needs_confirmation candidates. Use memory review for approve, reject, defer, supersede, or relink.',
        reviewCommand: 'cogmem memory review --project <projectId> --id <candidateId> --action <approve|reject|defer|supersede|relink> --actor <operator> --reason <reason>',
      };
    }
    throw new Error(`memory govern processes only candidate status; ${args.status} requires "cogmem memory review --id <candidateId> --action <action>"`);
  }
  const result = kernel.promoteDreamCandidates({
    projectId: args.projectId,
    limit: args.promoteLimit || args.limit || 100,
  });
  return {
    ...result,
    decisions: result.decisions,
  };
}

function runReview(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  if (!args.nodeId) throw new Error(`memory review requires --id.\n${usage()}`);
  if (!args.reviewAction) throw new Error(`memory review requires --action.\n${usage()}`);
  if (!args.projectId) throw new Error(`memory review requires --project.\n${usage()}`);
  if (!args.actor) throw new Error(`memory review requires --actor.\n${usage()}`);
  if (!args.reason) throw new Error(`memory review requires --reason.\n${usage()}`);
  const result = kernel.reviewDreamCandidate({
    candidateId: args.nodeId,
    projectId: args.projectId,
    action: args.reviewAction,
    actor: args.actor,
    reason: args.reason,
    confirmationEventId: args.confirmationEventId,
    targetBeliefId: args.targetBeliefId,
    replacementCandidateId: args.replacementCandidateId,
    reviewAfter: args.reviewAfter,
  });
  return { review: result.review, reviewedCandidate: result.candidate, decision: result.decision, queue: kernel.getDreamCandidateQueue(args.projectId) };
}

async function runDreamOnce(kernel: MemoryKernel, args: MemoryArgs): Promise<Record<string, unknown>> {
  const result = await kernel.runDreamTick({
    projectId: args.projectId,
    maxEpisodes: args.limit || 10,
  });
  const payload: Record<string, unknown> = {
    ...result,
    processedEventCount: 0,
    dreamableEventCount: result.processedEpisodeCount,
    status: kernel.getEpisodeDreamStatus(args.projectId),
    candidates: result.candidateIds,
  };
  if (args.promote) {
    payload.governance = kernel.promoteDreamCandidates({
      projectId: args.projectId,
      limit: args.promoteLimit || args.limit || 100,
    });
  }
  return payload;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function runDream(kernel: MemoryKernel, args: MemoryArgs): Promise<Record<string, unknown>> {
  if (!args.watch) return runDreamOnce(kernel, args);

  const intervalMs = args.intervalMs ?? 300000;
  const maxRuns = args.maxRuns;
  const runs: Record<string, unknown>[] = [];
  let completed = 0;
  while (maxRuns === undefined || completed < maxRuns) {
    const run = await runDreamOnce(kernel, args);
    completed += 1;
    if (maxRuns === undefined) {
      if (args.json) {
        printCliJson('memory.dream.watch', { watch: true, intervalMs, run });
      } else {
        printHuman('dream', run);
      }
    } else {
      runs.push(run);
    }
    if (maxRuns !== undefined && completed >= maxRuns) break;
    await sleep(intervalMs);
  }
  return {
    watch: true,
    intervalMs,
    maxRuns,
    runs,
    queue: kernel.getDreamCandidateQueue(args.projectId),
  };
}

function runCandidates(kernel: MemoryKernel, args: MemoryArgs): Record<string, unknown> {
  const candidates = kernel.listDreamCandidates({
    projectId: args.projectId,
    statuses: [args.status || 'candidate'],
    limit: args.limit || 50,
  });
  return {
    total: candidates.length,
    status: args.status || 'candidate',
    candidates: candidates.map(candidateToJson),
  };
}

function printHuman(command: NonNullable<MemoryArgs['command']>, payload: Record<string, unknown>): void {
  if (command === 'status') {
    console.log(`rawEvents: ${payload.rawEventCount}`);
    console.log(`vectors: ${payload.vectorCount}`);
    console.log(`dreamBacklog: ${JSON.stringify(payload.dreamBacklog)}`);
    console.log(`episodeDream: ${JSON.stringify(payload.episodeDream)}`);
    console.log(`dreamCandidateQueue: ${JSON.stringify(payload.dreamCandidateQueue)}`);
    return;
  }
  if (command === 'dream') {
    if (payload.watch === true) {
      const runs = Array.isArray(payload.runs) ? payload.runs : [];
      console.log(`watch: true intervalMs=${payload.intervalMs}`);
      console.log(`runs: ${runs.length}`);
      console.log(`queue: ${JSON.stringify(payload.queue)}`);
      return;
    }
    console.log(`processedEpisodes: ${payload.processedEpisodeCount}`);
    console.log(`selectedMode: ${payload.selectedMode}`);
    console.log(`candidates: ${payload.candidateCount}`);
    console.log(`dreamBacklog: ${JSON.stringify(payload.status)}`);
    if (payload.governance) console.log(`governance: ${JSON.stringify(payload.governance)}`);
    return;
  }
  if (command === 'govern') {
    const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
    if (payload.warning) console.log(`warning: ${payload.warning}`);
    if (payload.reviewCommand) console.log(`reviewCommand: ${payload.reviewCommand}`);
    console.log(`decisions: ${decisions.length}`);
    console.log(`queue: ${JSON.stringify(payload.queue)}`);
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    for (const candidate of candidates as Array<Record<string, unknown>>) {
      console.log(`- ${candidate.candidateId} ${candidate.candidateType} ${candidate.status} confidence=${candidate.confidence}`);
    }
    return;
  }
  if (command === 'candidates') {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    for (const candidate of candidates as Array<Record<string, unknown>>) {
      console.log(`- ${candidate.candidateId} ${candidate.candidateType} ${candidate.status} confidence=${candidate.confidence}`);
    }
    return;
  }
  if (command === 'review') {
    const candidate = payload.reviewedCandidate as Record<string, unknown> | undefined;
    const review = payload.review as Record<string, unknown> | undefined;
    console.log(`candidate: ${candidate?.candidateId} status=${candidate?.status}`);
    console.log(`review: ${review?.reviewId} action=${review?.action}`);
    return;
  }
  if (command === 'map') {
    const counters = payload.counters as Record<string, unknown> | undefined;
    console.log(`memoryMap: ${payload.version}`);
    console.log(`rawEvents: ${counters?.rawEvents}`);
    console.log(`neurons: ${counters?.neurons}`);
    console.log(`bounds: ${JSON.stringify(payload.bounds)}`);
    return;
  }
  if (command === 'tick') {
    console.log(`maintenanceTick: ${payload.version}`);
    console.log(`hostOwned: ${payload.hostOwned}`);
    console.log(`chargeVector: ${JSON.stringify(payload.chargeVector)}`);
    console.log(`suggestedActions: ${JSON.stringify(payload.suggestedActions)}`);
    return;
  }
  if (command === 'bind') {
    console.log(`scannedEvents: ${payload.scannedEvents}`);
    console.log(`bindableEvents: ${payload.bindableEvents}`);
    console.log(`boundEvents: ${payload.boundEvents}`);
    console.log(`createdBindings: ${payload.createdBindings}`);
    console.log(`skippedAlreadyBound: ${payload.skippedAlreadyBound}`);
    console.log(`failedEvents: ${payload.failedEvents}`);
    return;
  }
  if (command === 'graph' || command.startsWith('graph-')) {
    console.log(`memoryAtlas: ${payload.version || 'memory_atlas.v1'} project=${payload.projectId || 'unknown'}`);
    const rows = Array.isArray(payload.nodes) ? payload.nodes
      : Array.isArray(payload.path) ? payload.path
        : Array.isArray(payload.actions) ? payload.actions
          : payload.id ? [payload] : [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const label = row.label || [row.targetLabel, row.action].filter(Boolean).join(' ') || row.id;
      console.log(`- ${row.id} [${row.nodeType || row.frameType || 'node'}] ${label}`);
      const evidence = Array.isArray(row.evidence) ? row.evidence as Array<Record<string, unknown>> : [];
      for (const item of evidence) if (item.drilldown) console.log(`  ${item.drilldown}`);
    }
    const nextActions = Array.isArray(payload.nextActions) ? payload.nextActions as Array<Record<string, unknown>> : [];
    for (const action of nextActions) console.log(`next: ${action.tool} ${JSON.stringify(action.args || {})}`);
    if (payload.truncated === true) console.log('truncated: true');
    return;
  }
  if (command === 'recall') {
    const items = Array.isArray(payload.items) ? payload.items : [];
    console.log(`recallMode: ${payload.recallMode}`);
    console.log(`fallbackUsed: ${payload.fallbackUsed}`);
    console.log(`decisionTrace: ${JSON.stringify(payload.decisionTrace)}`);
    for (const item of items as Array<Record<string, unknown>>) {
      console.log(`- ${item.id} ${item.sourceType || 'memory'} ${item.text}`);
      const sourceContext = item.sourceContext as { locator?: { command?: string } } | undefined;
      if (sourceContext?.locator?.command) console.log(`  sourceLocator=${sourceContext.locator.command}`);
    }
    return;
  }
  const events = Array.isArray(payload.events) ? payload.events : [payload.event].filter(Boolean);
  for (const event of events as Array<Record<string, unknown>>) {
    const anchor = event.sourceAnchor as Record<string, unknown>;
    console.log(`- ${event.label || event.eventId} ${event.eventId} ${event.role || 'unknown'} session=${anchor.sessionId || 'unknown'} ${event.text}`);
  }
  if (command === 'show') {
    if (payload.window) console.log(`window: ${JSON.stringify(payload.window)}`);
    for (const label of ['before', 'after', 'children'] as const) {
      const rows = Array.isArray(payload[label]) ? payload[label] as Array<Record<string, unknown>> : [];
      if (!rows.length) continue;
      console.log(`${label}:`);
      for (const event of rows) console.log(`- ${event.label || event.eventId} ${event.eventId} ${event.role || 'unknown'} ${event.text}`);
    }
  }
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    console.log(usage());
    return;
  }
  if (args.command === 'status' || args.command === 'candidates') {
    runReadOnlyInspection(args);
    return;
  }
  const kernelArgs: MemoryArgs = { ...args };
  const kernel = openKernel(kernelArgs);
  try {
    const payload = kernelArgs.command === 'status'
      ? runStatus(kernel, kernelArgs)
      : kernelArgs.command === 'list'
        ? runList(kernel, kernelArgs)
        : kernelArgs.command === 'search'
          ? runSearch(kernel, kernelArgs)
          : kernelArgs.command === 'recall'
            ? runRecall(kernel, kernelArgs)
            : kernelArgs.command === 'show'
              ? runShow(kernel, kernelArgs)
              : kernelArgs.command === 'dream'
                ? await runDream(kernel, kernelArgs)
                : kernelArgs.command === 'govern'
                  ? runGovern(kernel, kernelArgs)
                  : kernelArgs.command === 'candidates'
                    ? runCandidates(kernel, kernelArgs)
                    : kernelArgs.command === 'review'
                      ? runReview(kernel, kernelArgs)
                    : kernelArgs.command === 'map'
                      ? runMap(kernel, kernelArgs)
                      : kernelArgs.command === 'tick'
                        ? runTick(kernel, kernelArgs)
                      : kernelArgs.command === 'bind'
                        ? runBind(kernel, kernelArgs)
                        : runGraphCommand(kernel, kernelArgs);
    if (kernelArgs.json) {
      const queue = kernelArgs.command === 'status'
        ? payload.dreamCandidateQueue as ReturnType<MemoryKernel['getDreamCandidateQueue']>
        : kernelArgs.command === 'dream' && payload.governance
          ? (payload.governance as { queue?: ReturnType<MemoryKernel['getDreamCandidateQueue']> }).queue
          : kernelArgs.command === 'dream' && payload.queue
            ? payload.queue as ReturnType<MemoryKernel['getDreamCandidateQueue']>
            : kernelArgs.command === 'govern'
              ? payload.queue as ReturnType<MemoryKernel['getDreamCandidateQueue']>
              : kernelArgs.command === 'review'
                ? payload.queue as ReturnType<MemoryKernel['getDreamCandidateQueue']>
              : undefined;
      printCliJson(`memory.${kernelArgs.command}`, payload, {
        queue,
        beliefs: queue ? kernel.beliefStore.countActive(kernelArgs.projectId) : undefined,
      });
      return;
    }
    printHuman(kernelArgs.command!, payload);
  } finally {
    kernel.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
