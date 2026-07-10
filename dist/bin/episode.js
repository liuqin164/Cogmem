#!/usr/bin/env bun
import { createReadStream, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createStableImportIdentityFactory } from '../episode/EpisodeImportIdentity.js';
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
import { printCliJson } from './CliJson.js';
function parseArgs(argv) {
    const [command, ...rest] = argv;
    const args = { command };
    for (let index = 0; index < rest.length; index += 1) {
        const item = rest[index];
        if (!item.startsWith('--'))
            continue;
        const key = item.slice(2);
        const next = rest[index + 1];
        if (!next || next.startsWith('--'))
            args[key] = true;
        else {
            args[key] = next;
            index += 1;
        }
    }
    return args;
}
function usage() {
    return [
        'Usage: cogmem episode <append|import|list|get|seal|status|audit-boundaries|boundary-decisions|split-plan|repair|split|merge|move-event|reclassify|requeue-dream> [args]',
        '  append --project <id> --session <id> --source-agent <id> --role <role> --text <text>',
        '  import --project <id> --session <id> --source-agent <id> --format jsonl --file <path> [--seal-batch] [--force-seal] [--chunk-size <n>] [--checkpoint-file <path>] [--resume] [--start-line <n>] [--end-line <n>] [--max-lines <n>] [--skip-errors] [--max-errors <n>]',
        '  list|status [--project <id>] [--session <id>] [--json]',
        '  get --project <id> --episode <id> [--json]',
        '  seal --project <id> --episode <id> [--mode soft|hard|manual|batch] [--reason <reason>]',
        '  audit-boundaries --project <id> [--episode <id>] [--status open|soft_sealed|sealed] [--limit <n>] [--cursor <cursor>]',
        '  boundary-decisions --project <id> [--event <eventId>] [--limit <n>]',
        '  split-plan --project <id> --episode <id> [--include-event-ids]',
        '  repair [--project <id>] [--since <globalSeq>] [--limit <n>]',
        '  split --project <id> --episode <id> --events <eventId,eventId>',
        '  merge --project <id> --source-episode <id> --target-episode <id>',
        '  move-event --project <id> --event <id> --target-episode <id>',
        '  reclassify --project <id> --episode <id> [--episode-type <type>] [--topic-path <path>] [--importance <0..1>]',
        '  requeue-dream --project <id> --episode <id> [--mode micro|normal|deep]',
        'Existing source-specific imports remain: cogmem import-openclaw and cogmem import-hermes.',
        '--json emits cogmem.cli.v1; array results are returned under items.',
    ].join('\n');
}
function openKernel(args) {
    const dbPath = stringArg(args, 'db');
    return dbPath
        ? createMemoryKernel({ dbPath })
        : createMemoryKernelFromConfig({ configPath: stringArg(args, 'config'), cwd: process.cwd() });
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.command || args.help === true || args.h === true) {
        console.log(usage());
        return;
    }
    const kernel = openKernel(args);
    try {
        const projectId = stringArg(args, 'project');
        const sessionId = stringArg(args, 'session');
        let result;
        if (args.command === 'append') {
            result = kernel.appendEpisodeMessage({
                projectId: requiredArg(args, 'project'), sessionId: requiredArg(args, 'session'),
                sourceAgent: requiredArg(args, 'source-agent'), role: roleArg(args.role), text: requiredArg(args, 'text'),
                externalMessageId: stringArg(args, 'external-id'), timestamp: numberArg(args, 'timestamp'),
                threadId: stringArg(args, 'thread-id'), turnId: stringArg(args, 'turn-id'), turnSeq: numberArg(args, 'turn-seq'),
                localDate: stringArg(args, 'local-date'), eventOrdinal: numberArg(args, 'event-ordinal'),
            });
        }
        else if (args.command === 'import') {
            result = await importJsonl(kernel, args);
        }
        else if (args.command === 'list') {
            result = { episodes: kernel.listEpisodes({ projectId, sessionId, limit: numberArg(args, 'limit') }) };
        }
        else if (args.command === 'status') {
            result = { episodes: kernel.listEpisodes({ projectId, sessionId, limit: numberArg(args, 'limit') }), dream: kernel.getEpisodeDreamStatus(projectId) };
        }
        else if (args.command === 'get') {
            const requestedProject = requiredArg(args, 'project');
            const episodeId = requiredArg(args, 'episode');
            const episode = kernel.getEpisode(episodeId);
            if (!episode || episode.projectId !== requestedProject)
                throw new Error(`episode_project_mismatch:${episodeId}`);
            result = { episode, events: kernel.listEpisodeEventLinks(episodeId), closureReceipts: kernel.listEpisodeClosureReceipts({ episodeId, projectId: requestedProject }) };
        }
        else if (args.command === 'seal') {
            const episodeId = requiredArg(args, 'episode');
            const requestedProject = requiredArg(args, 'project');
            const episode = kernel.getEpisode(episodeId);
            if (!episode || episode.projectId !== requestedProject)
                throw new Error(`episode_project_mismatch:${episodeId}`);
            result = kernel.sealEpisode(episodeId, {
                mode: closureModeArg(stringArg(args, 'mode')), reason: stringArg(args, 'reason') || 'cli_manual_seal',
            });
        }
        else if (args.command === 'audit-boundaries') {
            result = kernel.auditEpisodeBoundaries({
                projectId: requiredArg(args, 'project'), episodeId: stringArg(args, 'episode'),
                status: statusArg(stringArg(args, 'status')), limit: numberArg(args, 'limit'), cursor: stringArg(args, 'cursor'),
                maxEvents: numberArg(args, 'max-events'), maxDurationMs: numberArg(args, 'max-duration-ms'),
                maxIdleGapMs: numberArg(args, 'max-idle-gap-ms'), timezone: stringArg(args, 'timezone'),
            });
        }
        else if (args.command === 'boundary-decisions') {
            result = { decisions: kernel.listEpisodeBoundaryDecisions({
                    projectId: requiredArg(args, 'project'), primaryEventId: stringArg(args, 'event'), limit: numberArg(args, 'limit'),
                }) };
        }
        else if (args.command === 'split-plan') {
            result = kernel.planEpisodeSplit({
                projectId: requiredArg(args, 'project'), episodeId: requiredArg(args, 'episode'),
                maxEvents: numberArg(args, 'max-events'), maxDurationMs: numberArg(args, 'max-duration-ms'),
                maxIdleGapMs: numberArg(args, 'max-idle-gap-ms'), timezone: stringArg(args, 'timezone'),
                includeEventIds: args['include-event-ids'] === true,
            });
        }
        else if (args.command === 'repair') {
            result = kernel.repairEpisodes({ projectId, sinceGlobalSeq: numberArg(args, 'since'), limit: numberArg(args, 'limit') });
        }
        else if (args.command === 'split') {
            result = kernel.repairEpisode({ operation: 'split', projectId: requiredArg(args, 'project'),
                episodeId: requiredArg(args, 'episode'), eventIds: requiredArg(args, 'events').split(',').map((item) => item.trim()).filter(Boolean) });
        }
        else if (args.command === 'merge') {
            result = kernel.repairEpisode({ operation: 'merge', projectId: requiredArg(args, 'project'),
                sourceEpisodeId: requiredArg(args, 'source-episode'), targetEpisodeId: requiredArg(args, 'target-episode') });
        }
        else if (args.command === 'move-event') {
            result = kernel.repairEpisode({ operation: 'move-event', projectId: requiredArg(args, 'project'),
                eventId: requiredArg(args, 'event'), targetEpisodeId: requiredArg(args, 'target-episode') });
        }
        else if (args.command === 'reclassify') {
            result = kernel.repairEpisode({ operation: 'reclassify', projectId: requiredArg(args, 'project'),
                episodeId: requiredArg(args, 'episode'), episodeType: episodeTypeArg(stringArg(args, 'episode-type')),
                topicPath: stringArg(args, 'topic-path'), importance: numberArg(args, 'importance') });
        }
        else if (args.command === 'requeue-dream') {
            result = kernel.repairEpisode({ operation: 'requeue-dream', projectId: requiredArg(args, 'project'),
                episodeId: requiredArg(args, 'episode'), mode: dreamModeArg(stringArg(args, 'mode')) });
        }
        else {
            throw new Error(usage());
        }
        printCliJson(`episode.${args.command}`, result);
    }
    finally {
        kernel.close();
    }
}
async function importJsonl(kernel, args) {
    const format = stringArg(args, 'format') || 'jsonl';
    if (format !== 'jsonl' && format !== 'generic-chat') {
        throw new Error('episode import supports jsonl/generic-chat; use import-openclaw or import-hermes for source-specific formats');
    }
    const projectId = requiredArg(args, 'project');
    const sessionId = requiredArg(args, 'session');
    const sourceAgent = requiredArg(args, 'source-agent');
    const file = requiredArg(args, 'file');
    const checkpointFile = stringArg(args, 'checkpoint-file') || `${file}.cogmem-checkpoint.json`;
    const chunkSize = Math.max(1, Math.min(Math.trunc(numberArg(args, 'chunk-size') ?? 500), 5000));
    const checkpoint = args.resume === true && existsSync(checkpointFile)
        ? JSON.parse(readFileSync(checkpointFile, 'utf8'))
        : {};
    const resumeAfter = Math.max(0, checkpoint.processedLine || 0);
    const startLine = Math.max(1, Math.trunc(numberArg(args, 'start-line') ?? 1));
    const endLine = Math.max(startLine, Math.trunc(numberArg(args, 'end-line') ?? Number.MAX_SAFE_INTEGER));
    const maxLines = Math.max(1, Math.trunc(numberArg(args, 'max-lines') ?? Number.MAX_SAFE_INTEGER));
    const skipErrors = args['skip-errors'] === true;
    const maxErrors = Math.max(0, Math.trunc(numberArg(args, 'max-errors') ?? (skipErrors ? 100 : 0)));
    const identities = new Map();
    const getIdentity = (resolvedSessionId) => {
        let identity = identities.get(resolvedSessionId);
        if (!identity) {
            identity = createStableImportIdentityFactory(sourceAgent, resolvedSessionId);
            identities.set(resolvedSessionId, identity);
        }
        return identity;
    };
    const episodeIds = new Set();
    const unassignedEventIds = [];
    const ignoredEventIds = [];
    let imported = 0;
    let duplicates = 0;
    let processed = 0;
    let lineNumber = 0;
    let lastProcessedLine = resumeAfter;
    let selectedLines = 0;
    const errors = [];
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const rawLine of reader) {
        lineNumber += 1;
        if (!rawLine.trim())
            continue;
        if (lineNumber > endLine || selectedLines >= maxLines)
            break;
        if (lineNumber <= resumeAfter || lineNumber < startLine) {
            // Rebuild only the deterministic fallback identity state. A malformed
            // skipped line must remain skipped during resume.
            try {
                const prior = JSON.parse(rawLine);
                const priorText = typeof prior.text === 'string' ? prior.text : typeof prior.content === 'string' ? prior.content : undefined;
                if (priorText) {
                    const priorSession = typeof prior.sessionId === 'string' ? prior.sessionId : sessionId;
                    const priorRole = roleValue(prior.role);
                    const priorTimestamp = prior.timestamp === undefined ? undefined : timeValue(prior.timestamp);
                    getIdentity(priorSession)({ role: priorRole, text: priorText, timestamp: priorTimestamp });
                }
            }
            catch {
                // The checkpoint already records this line as skipped/failed.
            }
            continue;
        }
        try {
            const message = JSON.parse(rawLine);
            const text = typeof message.text === 'string' ? message.text : typeof message.content === 'string' ? message.content : undefined;
            if (!text)
                throw new Error(`line ${lineNumber} is missing text/content`);
            if (text.length > 64_000)
                throw new Error(`line ${lineNumber} exceeds the 64000 character CLI message limit`);
            const resolvedSessionId = typeof message.sessionId === 'string' ? message.sessionId : sessionId;
            const role = roleValue(message.role);
            const timestamp = timeValue(message.timestamp);
            const threadId = typeof message.threadId === 'string' ? message.threadId : undefined;
            const turnId = typeof message.turnId === 'string' ? message.turnId : undefined;
            const turnSeq = typeof message.turnSeq === 'number' && Number.isFinite(message.turnSeq) ? message.turnSeq : undefined;
            const localDate = typeof message.localDate === 'string' ? message.localDate : undefined;
            const eventOrdinal = typeof message.eventOrdinal === 'number' && Number.isFinite(message.eventOrdinal) ? message.eventOrdinal : undefined;
            const externalMessageId = typeof message.externalMessageId === 'string'
                ? message.externalMessageId
                : typeof message.id === 'string'
                    ? message.id
                    : getIdentity(resolvedSessionId)({ role, text, timestamp });
            selectedLines += 1;
            const result = await kernel.appendEpisodeMessageAsync({
                projectId, sourceAgent, sessionId: resolvedSessionId, role, text, timestamp, threadId, turnId, turnSeq, localDate, eventOrdinal,
                externalMessageId,
                metadata: { imported: true, importFormat: format },
            });
            processed += 1;
            lastProcessedLine = lineNumber;
            result.created ? imported += 1 : duplicates += 1;
            if (result.episodeId)
                episodeIds.add(result.episodeId);
            if (!result.assigned && !result.ignored)
                unassignedEventIds.push(result.eventId);
            if (result.ignored)
                ignoredEventIds.push(result.eventId);
            if (processed % chunkSize === 0)
                writeCheckpoint(checkpointFile, { processedLine: lineNumber, lastProcessedLine: lineNumber, processed, projectId, sourceAgent, sessionId });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({ line: lineNumber, error: message });
            writeCheckpoint(checkpointFile, {
                failedAtLine: lineNumber, error: message, resumeFrom: lineNumber,
                lastProcessedLine, processedLine: lastProcessedLine,
                processed, projectId, sourceAgent, sessionId,
            });
            if (!skipErrors || errors.length > maxErrors)
                throw error;
            lastProcessedLine = lineNumber;
        }
    }
    writeCheckpoint(checkpointFile, { processedLine: lastProcessedLine, processed, projectId, sourceAgent, sessionId, completed: true });
    const closureReceipts = args['seal-batch'] === true
        ? [...episodeIds].map((episodeId) => kernel.sealImportedEpisode(episodeId, { reason: 'cli_batch_boundary', force: args['force-seal'] === true }))
        : [];
    return {
        importId: `episode-import:${sourceAgent}:${sessionId}`,
        imported, duplicates, processed, errors, resumeFrom: lastProcessedLine + 1, checkpointFile,
        episodeIds: [...episodeIds], unassignedEventIds, ignoredEventIds, closureReceipts, dreamRan: false,
    };
}
function writeCheckpoint(path, value) {
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
}
function stringArg(args, key) { return typeof args[key] === 'string' && args[key] ? args[key] : undefined; }
function requiredArg(args, key) { const value = stringArg(args, key); if (!value)
    throw new Error(`--${key} is required`); return value; }
function numberArg(args, key) { const value = stringArg(args, key); if (!value)
    return undefined; const parsed = Number(value); if (!Number.isFinite(parsed))
    throw new Error(`--${key} must be numeric`); return parsed; }
function roleArg(value) { return roleValue(value); }
function roleValue(value) {
    if (value === 'user' || value === 'assistant' || value === 'agent' || value === 'tool' || value === 'system' || value === 'narrator')
        return value;
    throw new Error('role must be user, assistant, agent, tool, system, or narrator');
}
function closureModeArg(value) {
    if (!value)
        return 'manual';
    if (value === 'soft' || value === 'hard' || value === 'manual' || value === 'batch')
        return value;
    throw new Error('mode must be soft, hard, manual, or batch');
}
function dreamModeArg(value) {
    if (!value)
        return 'normal';
    if (value === 'micro' || value === 'normal' || value === 'deep')
        return value;
    throw new Error('mode must be micro, normal, or deep');
}
function statusArg(value) {
    if (!value)
        return undefined;
    if (value === 'open' || value === 'soft_sealed' || value === 'sealed')
        return value;
    throw new Error('status must be open, soft_sealed, or sealed');
}
function episodeTypeArg(value) {
    if (!value)
        return undefined;
    if (['discussion', 'decision', 'correction', 'preference', 'goal', 'debugging', 'planning', 'prospective', 'general'].includes(value))
        return value;
    throw new Error('invalid episode type');
}
function timeValue(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    throw new Error('timestamp must be a finite number or parseable date');
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
