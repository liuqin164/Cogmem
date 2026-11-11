/**
 * The import bridge's service layer, kept as internal API after the MCP face left (#143, R2 of #200).
 *
 * It is what `kind`-agnostic hosts pointed at: preview a workspace, then apply it, with `sourceRefs`
 * and an `imported` marker on every anchored record so a reader can tell project-public imported
 * material from an agent's own turns. The callers are now internal — the MCP tools that used to
 * front it are gone — but the mechanism is unchanged: a real incremental batch through
 * `InstalledBatchProcessor`, and a `reindexRaw` path that re-anchors every record.
 *
 * A kernel is passed in, never opened here: the caller owns the single writer (CONCURRENT_ACCESS.md),
 * and the bridge must not close a kernel it does not own.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  ConversationMarkdownAdapter,
  HermesStateDbAdapter,
  HermesWorkspaceProfile,
  MarkdownSourceLoader,
  OpenClawDailyMemoryAdapter,
  OpenClawMemoryIndexAdapter,
  OpenClawPersonaAdapter,
  OpenClawSessionAdapter,
  OpenClawUserProfileAdapter,
  OpenClawWorkspaceProfile,
  SoulMarkdownAdapter,
  buildEpisodeEnvelope,
  type SourceAdapter,
  type SourceAdapterDiagnostic,
  type SourceAdapterKind,
  type SourceDefinition,
} from '../adapters/index.js';
import { InstalledBatchProcessor } from '../batch/InstalledBatchProcessor.js';
import type { MemoryKernel } from '../factory.js';

export type ImportBridgeAgent = 'openclaw' | 'hermes';

export interface ImportBridgeRequest {
  agent: ImportBridgeAgent;
  workspaceRoot: string;
  projectId: string;
  /** A single date label for the window, as the host spelled it. */
  date?: string;
  sessionPaths?: string[];
  memoryPaths?: string[];
  stateDbPath?: string;
  profilePath?: string;
  sessionsDir?: string;
  since?: string | number;
  until?: string | number;
  /** Re-anchor every record from the sources instead of running the incremental batch. */
  reindexRaw?: boolean;
}

export interface ImportBridgeSourceResult {
  sourceId: string;
  sourcePath: string;
  adapterKind: SourceAdapterKind;
  recordsParsed: number;
  recordsWouldIngest: number;
  recordsIngested: number;
  skippedRecords: number;
  diagnostics: SourceAdapterDiagnostic[];
}

export interface ImportBridgeWindow {
  start: number;
  end: number;
  label: string;
}

export interface ImportBridgeResult {
  agent: ImportBridgeAgent;
  workspaceRoot: string;
  projectId: string;
  dryRun: boolean;
  reindexRaw: boolean;
  window: ImportBridgeWindow;
  sourcesScanned: number;
  sourcesChanged: number;
  recordsParsed: number;
  recordsWouldIngest: number;
  recordsIngested: number;
  rawRecordsAnchored: number;
  skippedRecords: number;
  emptyEpisodesSkipped: number;
  processedSourceIds: string[];
  /** #168: the offline consolidation's blocked decisions, the same array `kernel.consolidate()` returns. */
  blockedConsolidations?: Awaited<ReturnType<MemoryKernel['consolidate']>>['blockedConsolidations'];
  diagnostics: SourceAdapterDiagnostic[];
  sourceResults: ImportBridgeSourceResult[];
}

function assertRequest(request: ImportBridgeRequest): void {
  if (request.agent !== 'openclaw' && request.agent !== 'hermes') {
    throw new Error('agent must be openclaw or hermes');
  }
  for (const field of ['workspaceRoot', 'projectId'] as const) {
    if (typeof request[field] !== 'string' || request[field].trim() === '') {
      throw new Error(`${field} must be a non-empty string`);
    }
  }
}

function parseTime(value: string | number | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return value;
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid ${flag}: ${value}`);
  return parsed;
}

function buildWindow(request: ImportBridgeRequest): ImportBridgeWindow {
  const start = parseTime(request.since, 0, '--since');
  const end = parseTime(request.until, Number.MAX_SAFE_INTEGER, '--until');
  if (end <= start) throw new Error('--until must be later than --since');
  return { start, end, label: request.date || 'full-history' };
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

function buildSources(agent: ImportBridgeAgent, request: ImportBridgeRequest): SourceDefinition[] {
  const { workspaceRoot } = request;
  if (agent === 'openclaw') {
    const profile = new OpenClawWorkspaceProfile(workspaceRoot);
    return profile.buildInstalledBatchSources({
      projectId: request.projectId,
      date: request.date,
      sessionPaths: (request.sessionPaths ?? []).map((item) => resolve(workspaceRoot, item)),
      optionalMemoryPaths: (request.memoryPaths ?? []).map((item) => resolve(workspaceRoot, item)),
    });
  }
  const profile = new HermesWorkspaceProfile(workspaceRoot);
  return profile.buildSourceDefinitions({
    projectId: request.projectId,
    profilePath: request.profilePath,
    sessionDir: request.sessionsDir,
    sessionPaths: (request.sessionPaths ?? []).map((item) => resolve(workspaceRoot, item)),
    stateDbPath: request.stateDbPath ? resolve(workspaceRoot, request.stateDbPath) : undefined,
  });
}

function sourcesOrThrow(agent: ImportBridgeAgent, request: ImportBridgeRequest): SourceDefinition[] {
  const sources = buildSources(agent, request);
  if (sources.length === 0) {
    throw new Error(`No ${agent} memory sources found in ${request.workspaceRoot}.`);
  }
  return sources;
}

export async function previewImport(kernel: MemoryKernel, request: ImportBridgeRequest): Promise<ImportBridgeResult> {
  assertRequest(request);
  const sources = sourcesOrThrow(request.agent, request);
  const window = buildWindow(request);

  const loader = new MarkdownSourceLoader();
  const adapters = buildAdapterMap();
  const diagnostics: SourceAdapterDiagnostic[] = [];
  const sourceResults: ImportBridgeSourceResult[] = [];
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

  return {
    agent: request.agent,
    workspaceRoot: request.workspaceRoot,
    projectId: request.projectId,
    dryRun: true,
    reindexRaw: false,
    window,
    sourcesScanned: sources.length,
    sourcesChanged: sources.length,
    recordsParsed,
    recordsWouldIngest: recordsParsed,
    recordsIngested: 0,
    rawRecordsAnchored: 0,
    skippedRecords: 0,
    emptyEpisodesSkipped: 0,
    processedSourceIds: [],
    diagnostics,
    sourceResults,
  };
}

export async function applyImport(kernel: MemoryKernel, request: ImportBridgeRequest): Promise<ImportBridgeResult> {
  assertRequest(request);
  const sources = sourcesOrThrow(request.agent, request);
  const window = buildWindow(request);

  if (request.reindexRaw) return reindexRawSources({ request, sources, window, kernel });
  return runIncrementalImport({ request, sources, window, kernel });
}

async function runIncrementalImport(input: {
  request: ImportBridgeRequest;
  sources: SourceDefinition[];
  window: ImportBridgeWindow;
  kernel: MemoryKernel;
}): Promise<ImportBridgeResult> {
  const { request, kernel } = input;
  const importedEpisodeIds = new Set<string>();
  let emptyEpisodesSkipped = 0;
  const processor = new InstalledBatchProcessor({
    cursorStore: kernel.cursorStore,
    ingestBatch: async (items) => {
      const neurons = [];
      for (const item of items) neurons.push(await kernel.ingest(item));
      return neurons;
    },
    recordRawEvidence: async (envelope) => {
      const anchored = await recordRawImportedEvidence(kernel, request.projectId, envelope);
      if (anchored.episodeId) importedEpisodeIds.add(anchored.episodeId);
      return anchored.event;
    },
    runOfflineWindow: (window) => kernel.consolidate({
      projectId: request.projectId,
      startTime: window.start,
      endTime: window.end,
    }),
    onProgress: undefined,
  });

  const summary = await processor.runOnce({ window: input.window, sources: input.sources });
  for (const episodeId of importedEpisodeIds) {
    const episode = kernel.getEpisode(episodeId);
    if (episode?.status !== 'sealed') {
      emptyEpisodesSkipped += sealImportedEpisodeIfReady(kernel, episodeId, `${request.agent}_import_batch_boundary`) ? 0 : 1;
    }
  }
  return {
    agent: request.agent,
    workspaceRoot: request.workspaceRoot,
    projectId: request.projectId,
    dryRun: false,
    reindexRaw: false,
    window: input.window,
    sourcesScanned: summary.sourcesScanned,
    sourcesChanged: summary.sourcesChanged,
    recordsParsed: summary.recordsParsed,
    recordsWouldIngest: summary.recordsIngested,
    recordsIngested: summary.recordsIngested,
    rawRecordsAnchored: summary.recordsIngested,
    skippedRecords: summary.skippedRecords,
    emptyEpisodesSkipped,
    // #168: without it a caller reading this result cannot tell a blocked consolidation from a
    // batch that had nothing to consolidate.
    blockedConsolidations: summary.offline.blockedConsolidations,
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
  };
}

async function reindexRawSources(input: {
  request: ImportBridgeRequest;
  sources: SourceDefinition[];
  window: ImportBridgeWindow;
  kernel: MemoryKernel;
}): Promise<ImportBridgeResult> {
  const { request, kernel } = input;
  const loader = new MarkdownSourceLoader();
  const adapters = buildAdapterMap();
  const diagnostics: SourceAdapterDiagnostic[] = [];
  const sourceResults: ImportBridgeSourceResult[] = [];
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
      const anchored = await recordRawImportedEvidence(kernel, request.projectId, envelope);
      if (anchored.episodeId) importedEpisodeIds.add(anchored.episodeId);
      if (anchored.created) sourceAnchored += 1;
      else sourceSkipped += 1;
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
    const episode = kernel.getEpisode(episodeId);
    if (episode?.status !== 'sealed') {
      emptyEpisodesSkipped += sealImportedEpisodeIfReady(kernel, episodeId, `${request.agent}_reindex_batch_boundary`) ? 0 : 1;
    }
  }

  return {
    agent: request.agent,
    workspaceRoot: request.workspaceRoot,
    projectId: request.projectId,
    dryRun: false,
    reindexRaw: true,
    window: input.window,
    sourcesScanned: input.sources.length,
    sourcesChanged: processedSourceIds.length,
    recordsParsed,
    recordsWouldIngest: recordsParsed,
    recordsIngested: rawRecordsAnchored,
    rawRecordsAnchored,
    skippedRecords,
    emptyEpisodesSkipped,
    processedSourceIds,
    diagnostics,
    sourceResults,
  };
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
  input: { projectId: string; threadId: string; sourceId: string; importAnchor: string },
): any {
  const indexed = kernel.eventStore.findImportedEventAnchor(input.projectId, input.sourceId, input.importAnchor);
  if (indexed) return indexed;
  return kernel.getThreadEvents(input.threadId, { projectId: input.projectId, limit: 10_000 }).find((event) => {
    const payload = event.payload as { metadata?: Record<string, unknown> };
    return event.sourceId === input.sourceId
      && payload.metadata?.importAnchor === input.importAnchor;
  });
}
