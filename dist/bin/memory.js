#!/usr/bin/env bun
import { resolve } from 'node:path';
import { KernelAgentMemoryBackend } from '../agent/index.js';
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
import { memoryEventCharRange, memoryEventLabel, memoryEventSourceRange, normalizeSourceContextWindow, } from '../recall/SourceContextMetadata.js';
function readArgs(argv) {
    const [commandCandidate, ...rest] = argv;
    const command = isMemoryCommand(commandCandidate) ? commandCandidate : undefined;
    const values = {};
    const flags = command ? rest : argv;
    for (let index = 0; index < flags.length; index += 1) {
        const item = flags[index];
        if (!item.startsWith('--'))
            continue;
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
        status: candidateStatusArg(values, 'status'),
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
        help: values.help === true || values.h === true,
    };
}
function usage() {
    return [
        'Usage: cogmem memory <status|list|search|recall|show|dream|govern|candidates|map|tick|bind> [args]',
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
        '  map                  print the self-describing memory map for agent/host inspection',
        '  tick                 run one explicit host-owned maintenance tick',
        '  bind                 backfill memory bindings for high-value raw user events',
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
        '  --promote            after dream, run CPU governance over pending candidates',
        '  --promote-limit <n>  governance candidate limit, default follows --limit or 100',
        '  --watch              keep issuing conditional Dream ticks as a host-owned worker',
        '  --interval-ms <n>    watch sleep interval, default 300000',
        '  --max-runs <n>       stop watch after n iterations; omit for long-running worker',
        '  --agent <id>         agent id for governed recall, default openclaw',
        '  --intent <intent>    memory_recall, previous_session_summary, or forensic_quote',
        '  --db <memory.db>     open an explicit database path',
        '  --config <toml>      open a cogmem TOML config',
        '  --json               print machine-readable JSON',
        '',
        'Dream processes sealed episodes only. A timer may call the conditional tick, but recall and message ingestion never run Dream.',
        'Candidate interpretation uses deterministic rules unless [memory_model] configures an OpenAI-compatible local or cloud chat model.',
        'This is a local audit console, not a notes app or UI dashboard. It exposes provenance so memory is not a black box.',
    ].join('\n');
}
function isMemoryCommand(value) {
    return value === 'status'
        || value === 'list'
        || value === 'search'
        || value === 'recall'
        || value === 'show'
        || value === 'dream'
        || value === 'govern'
        || value === 'candidates'
        || value === 'map'
        || value === 'tick'
        || value === 'bind';
}
function recallIntentArg(values, key) {
    const raw = stringArg(values, key);
    if (!raw)
        return undefined;
    if (raw === 'memory_recall' || raw === 'previous_session_summary' || raw === 'forensic_quote')
        return raw;
    throw new Error(`--${key} must be one of memory_recall, previous_session_summary, forensic_quote`);
}
function stringArg(values, key) {
    const value = values[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function numberArg(values, key) {
    const raw = stringArg(values, key);
    if (!raw)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0)
        throw new Error(`--${key} must be a non-negative number`);
    return parsed;
}
function candidateStatusArg(values, key) {
    const raw = stringArg(values, key);
    if (!raw)
        return undefined;
    if (raw === 'shadow'
        || raw === 'candidate'
        || raw === 'promoted'
        || raw === 'rejected'
        || raw === 'needs_confirmation'
        || raw === 'superseded') {
        return raw;
    }
    throw new Error(`--${key} must be one of shadow, candidate, promoted, rejected, needs_confirmation, superseded`);
}
function openKernel(args) {
    if (args.dbPath)
        return createMemoryKernel({ dbPath: resolve(args.dbPath) });
    return createMemoryKernelFromConfig({
        configPath: args.configPath ? resolve(args.configPath) : undefined,
        cwd: process.cwd(),
    });
}
function eventText(event) {
    const payload = event.payload;
    if (typeof payload.text === 'string')
        return payload.text;
    if (typeof payload.output === 'string')
        return payload.output;
    if (typeof payload.title === 'string')
        return payload.title;
    return JSON.stringify(event.payload);
}
function eventToJson(event) {
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
function candidateToJson(candidate) {
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
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
    };
}
function runStatus(kernel, args) {
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
function runList(kernel, args) {
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
function runSearch(kernel, args) {
    if (!args.query)
        throw new Error(`Missing --query.\n${usage()}`);
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
function runRecall(kernel, args) {
    if (!args.query)
        throw new Error(`Missing --query.\n${usage()}`);
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
function runMap(kernel, args) {
    return kernel.buildMemoryMap({ projectId: args.projectId });
}
function runTick(kernel, args) {
    return kernel.runMaintenanceTick({ projectId: args.projectId });
}
function runBind(kernel, args) {
    return kernel.bindRawEvents({
        projectId: args.projectId,
        workspaceId: args.workspaceId,
        threadId: args.threadId,
        sessionId: args.sessionId,
        sinceGlobalSeq: args.sinceGlobalSeq,
        limit: args.limit || 500,
    });
}
function runShow(kernel, args) {
    if (!args.eventId)
        throw new Error(`Missing --event.\n${usage()}`);
    const beforeCount = args.before ?? 2;
    const afterCount = args.after ?? 2;
    const context = kernel.getEventContext(args.eventId, {
        before: beforeCount,
        after: afterCount,
    });
    if (!context)
        throw new Error(`No raw ledger event found for ${args.eventId}`);
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
function runGovern(kernel, args) {
    const result = kernel.promoteDreamCandidates({
        projectId: args.projectId,
        limit: args.promoteLimit || args.limit || 100,
    });
    return {
        ...result,
        decisions: result.decisions,
    };
}
async function runDreamOnce(kernel, args) {
    const result = await kernel.runDreamTick({
        projectId: args.projectId,
        maxEpisodes: args.limit || 10,
    });
    const payload = {
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
function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
async function runDream(kernel, args) {
    if (!args.watch)
        return runDreamOnce(kernel, args);
    const intervalMs = args.intervalMs ?? 300000;
    const maxRuns = args.maxRuns;
    const runs = [];
    let completed = 0;
    while (maxRuns === undefined || completed < maxRuns) {
        const run = await runDreamOnce(kernel, args);
        completed += 1;
        if (maxRuns === undefined) {
            if (args.json) {
                console.log(JSON.stringify({ watch: true, intervalMs, run }, null, 2));
            }
            else {
                printHuman('dream', run);
            }
        }
        else {
            runs.push(run);
        }
        if (maxRuns !== undefined && completed >= maxRuns)
            break;
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
function runCandidates(kernel, args) {
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
function printHuman(command, payload) {
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
        if (payload.governance)
            console.log(`governance: ${JSON.stringify(payload.governance)}`);
        return;
    }
    if (command === 'govern') {
        const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
        console.log(`decisions: ${decisions.length}`);
        console.log(`queue: ${JSON.stringify(payload.queue)}`);
        return;
    }
    if (command === 'candidates') {
        const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
        for (const candidate of candidates) {
            console.log(`- ${candidate.candidateId} ${candidate.candidateType} ${candidate.status} confidence=${candidate.confidence}`);
        }
        return;
    }
    if (command === 'map') {
        const counters = payload.counters;
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
    if (command === 'recall') {
        const items = Array.isArray(payload.items) ? payload.items : [];
        console.log(`recallMode: ${payload.recallMode}`);
        console.log(`fallbackUsed: ${payload.fallbackUsed}`);
        console.log(`decisionTrace: ${JSON.stringify(payload.decisionTrace)}`);
        for (const item of items) {
            console.log(`- ${item.id} ${item.sourceType || 'memory'} ${item.text}`);
            const sourceContext = item.sourceContext;
            if (sourceContext?.locator?.command)
                console.log(`  sourceLocator=${sourceContext.locator.command}`);
        }
        return;
    }
    const events = Array.isArray(payload.events) ? payload.events : [payload.event].filter(Boolean);
    for (const event of events) {
        const anchor = event.sourceAnchor;
        console.log(`- ${event.label || event.eventId} ${event.eventId} ${event.role || 'unknown'} session=${anchor.sessionId || 'unknown'} ${event.text}`);
    }
    if (command === 'show') {
        if (payload.window)
            console.log(`window: ${JSON.stringify(payload.window)}`);
        for (const label of ['before', 'after', 'children']) {
            const rows = Array.isArray(payload[label]) ? payload[label] : [];
            if (!rows.length)
                continue;
            console.log(`${label}:`);
            for (const event of rows)
                console.log(`- ${event.label || event.eventId} ${event.eventId} ${event.role || 'unknown'} ${event.text}`);
        }
    }
}
async function main() {
    const args = readArgs(process.argv.slice(2));
    if (args.help || !args.command) {
        console.log(usage());
        return;
    }
    const kernel = openKernel(args);
    try {
        const payload = args.command === 'status'
            ? runStatus(kernel, args)
            : args.command === 'list'
                ? runList(kernel, args)
                : args.command === 'search'
                    ? runSearch(kernel, args)
                    : args.command === 'recall'
                        ? runRecall(kernel, args)
                        : args.command === 'show'
                            ? runShow(kernel, args)
                            : args.command === 'dream'
                                ? await runDream(kernel, args)
                                : args.command === 'govern'
                                    ? runGovern(kernel, args)
                                    : args.command === 'candidates'
                                        ? runCandidates(kernel, args)
                                        : args.command === 'map'
                                            ? runMap(kernel, args)
                                            : args.command === 'tick'
                                                ? runTick(kernel, args)
                                                : runBind(kernel, args);
        if (args.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
        }
        printHuman(args.command, payload);
    }
    finally {
        kernel.close();
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
