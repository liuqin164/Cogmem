import { ConversationMarkdownAdapter, MarkdownSourceLoader, OpenClawDailyMemoryAdapter, OpenClawMemoryIndexAdapter, OpenClawPersonaAdapter, OpenClawSessionAdapter, OpenClawUserProfileAdapter, SoulMarkdownAdapter, buildEpisodeEnvelope } from '../adapters/index.js';
export class InstalledBatchProcessor {
    deps;
    loader = new MarkdownSourceLoader();
    adapters = new Map([
        ['conversation_markdown', new ConversationMarkdownAdapter()],
        ['soul_markdown', new SoulMarkdownAdapter()],
        ['openclaw_daily_memory', new OpenClawDailyMemoryAdapter()],
        ['openclaw_session', new OpenClawSessionAdapter()],
        ['openclaw_memory_index', new OpenClawMemoryIndexAdapter()],
        ['openclaw_user_profile', new OpenClawUserProfileAdapter()],
        ['openclaw_persona', new OpenClawPersonaAdapter()]
    ]);
    constructor(deps) {
        this.deps = deps;
    }
    async runOnce(options) {
        const registered = options.sources || [];
        for (const source of registered) {
            this.deps.cursorStore.registerSource(source);
        }
        const sources = registered.length > 0
            ? registered
            : this.deps.cursorStore.listRegisteredSources().map((cursor) => ({
                sourceId: cursor.sourceId,
                adapterKind: cursor.sourceType,
                sourcePath: cursor.sourcePath,
                projectId: cursor.projectId
            }));
        let sourcesChanged = 0;
        let recordsParsed = 0;
        let skippedRecords = 0;
        let recordsIngested = 0;
        const processedSourceIds = [];
        const adapterDiagnostics = [];
        const sourceResults = [];
        for (const [sourceOffset, source] of sources.entries()) {
            const adapter = this.adapters.get(source.adapterKind);
            if (!adapter)
                continue;
            const sourceIndex = sourceOffset + 1;
            this.deps.onProgress?.({
                stage: 'source:start',
                sourceIndex,
                totalSources: sources.length,
                sourcePath: source.sourcePath,
                adapterKind: source.adapterKind
            });
            const snapshot = this.loader.read(source);
            const cursor = this.deps.cursorStore.getCursor(source.sourceId);
            const adapted = adapter.adapt(source, snapshot, source.tags?.includes('ingest:profile_only')
                ? undefined
                : {
                    start: options.window.start,
                    end: options.window.end
                });
            adapterDiagnostics.push(...(adapted.diagnostics || []));
            const seenHashes = this.deps.cursorStore.listProcessedRecordHashes(source.sourceId, options.window.start, options.window.end);
            const pending = adapted.records.filter((record) => !seenHashes.has(record.provenance.recordHash));
            recordsParsed += adapted.records.length;
            skippedRecords += adapted.records.length - pending.length;
            this.deps.onProgress?.({
                stage: 'source:parsed',
                sourceIndex,
                totalSources: sources.length,
                sourcePath: source.sourcePath,
                adapterKind: source.adapterKind,
                recordsParsed: adapted.records.length,
                pendingRecords: pending.length,
                skippedRecords: adapted.records.length - pending.length
            });
            if (!cursor || cursor.lastSeenHash !== snapshot.fileHash || pending.length > 0) {
                sourcesChanged += 1;
            }
            if (pending.length > 0) {
                this.deps.onProgress?.({
                    stage: 'source:ingest:start',
                    sourceIndex,
                    totalSources: sources.length,
                    sourcePath: source.sourcePath,
                    adapterKind: source.adapterKind,
                    pendingRecords: pending.length
                });
                const envelopes = pending.map((record) => buildEpisodeEnvelope(source, record));
                const neurons = await this.deps.ingestBatch(envelopes.map((item) => item.ingestInput));
                recordsIngested += envelopes.length;
                envelopes.forEach((item, index) => {
                    const neuron = neurons[index];
                    this.deps.cursorStore.markRecordProcessed({
                        recordHash: item.record.provenance.recordHash,
                        sourceId: source.sourceId,
                        sourcePath: source.sourcePath,
                        sourceType: source.adapterKind,
                        contentHash: item.record.provenance.fileHash,
                        contentWindowStart: options.window.start,
                        contentWindowEnd: options.window.end,
                        processedAt: Date.now(),
                        neuronId: neuron?.id
                    });
                });
                this.deps.onProgress?.({
                    stage: 'source:ingest:complete',
                    sourceIndex,
                    totalSources: sources.length,
                    sourcePath: source.sourcePath,
                    adapterKind: source.adapterKind,
                    ingestedRecords: envelopes.length,
                    totalRecordsIngested: recordsIngested
                });
            }
            this.deps.cursorStore.updateCursor({
                sourceId: source.sourceId,
                sourcePath: source.sourcePath,
                sourceType: source.adapterKind,
                projectId: source.projectId,
                lastProcessedAt: Date.now(),
                lastSeenHash: snapshot.fileHash,
                lastSeenMtime: snapshot.fileMtimeMs,
                contentWindowStart: options.window.start,
                contentWindowEnd: options.window.end
            });
            processedSourceIds.push(source.sourceId);
            sourceResults.push({
                sourceId: source.sourceId,
                sourcePath: source.sourcePath,
                adapterKind: source.adapterKind,
                recordsParsed: adapted.records.length,
                recordsIngested: pending.length,
                skippedRecords: adapted.records.length - pending.length,
                diagnostics: adapted.diagnostics || []
            });
        }
        this.deps.onProgress?.({ stage: 'offline:start', recordsIngested });
        const offline = await this.deps.runOfflineWindow(options.window);
        this.deps.onProgress?.({ stage: 'offline:complete', recordsIngested });
        return {
            window: options.window,
            sourcesScanned: sources.length,
            sourcesChanged,
            recordsParsed,
            recordsIngested,
            skippedRecords,
            processedSourceIds,
            adapterDiagnostics,
            sourceResults,
            offline
        };
    }
}
