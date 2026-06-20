#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
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
        'Usage: cogmem episode <append|import|list|get|seal|status|repair> [args]',
        '  append --project <id> --session <id> --source-agent <id> --role <role> --text <text>',
        '  import --project <id> --session <id> --source-agent <id> --format jsonl --file <path> [--seal-batch]',
        '  list|status [--project <id>] [--session <id>] [--json]',
        '  get --episode <id> [--json]',
        '  seal --episode <id> [--mode soft|hard|manual|batch] [--reason <reason>]',
        '  repair [--project <id>] [--since <globalSeq>] [--limit <n>]',
        'Existing source-specific imports remain: cogmem import-openclaw and cogmem import-hermes.',
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
            });
        }
        else if (args.command === 'import') {
            result = importJsonl(kernel, args);
        }
        else if (args.command === 'list') {
            result = { episodes: kernel.listEpisodes({ projectId, sessionId, limit: numberArg(args, 'limit') }) };
        }
        else if (args.command === 'status') {
            result = { episodes: kernel.listEpisodes({ projectId, sessionId, limit: numberArg(args, 'limit') }), dream: kernel.getEpisodeDreamStatus(projectId) };
        }
        else if (args.command === 'get') {
            const episodeId = requiredArg(args, 'episode');
            result = { episode: kernel.getEpisode(episodeId), events: kernel.listEpisodeEventLinks(episodeId), closureReceipts: kernel.listEpisodeClosureReceipts({ episodeId }) };
        }
        else if (args.command === 'seal') {
            result = kernel.sealEpisode(requiredArg(args, 'episode'), {
                mode: closureModeArg(stringArg(args, 'mode')), reason: stringArg(args, 'reason') || 'cli_manual_seal',
            });
        }
        else if (args.command === 'repair') {
            result = kernel.repairEpisodes({ projectId, sinceGlobalSeq: numberArg(args, 'since'), limit: numberArg(args, 'limit') });
        }
        else {
            throw new Error(usage());
        }
        console.log(JSON.stringify(result, null, args.json === true ? 2 : 2));
    }
    finally {
        kernel.close();
    }
}
function importJsonl(kernel, args) {
    const format = stringArg(args, 'format') || 'jsonl';
    if (format !== 'jsonl' && format !== 'generic-chat') {
        throw new Error('episode import supports jsonl/generic-chat; use import-openclaw or import-hermes for source-specific formats');
    }
    const projectId = requiredArg(args, 'project');
    const sessionId = requiredArg(args, 'session');
    const sourceAgent = requiredArg(args, 'source-agent');
    const lines = readFileSync(requiredArg(args, 'file'), 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length > 100_000)
        throw new Error('episode import is limited to 100000 messages per command');
    const messages = lines.map((line, index) => {
        const message = JSON.parse(line);
        const text = typeof message.text === 'string' ? message.text : typeof message.content === 'string' ? message.content : undefined;
        if (!text)
            throw new Error(`line ${index + 1} is missing text/content`);
        if (text.length > 64_000)
            throw new Error(`line ${index + 1} exceeds the 64000 character message limit`);
        const resolvedSessionId = typeof message.sessionId === 'string' ? message.sessionId : sessionId;
        const role = roleValue(message.role);
        const timestamp = timeValue(message.timestamp);
        return {
            sessionId: resolvedSessionId, role, text, timestamp,
            externalMessageId: typeof message.externalMessageId === 'string'
                ? message.externalMessageId
                : typeof message.id === 'string'
                    ? message.id
                    : stableImportMessageId(resolvedSessionId, role, text, timestamp, index),
        };
    });
    const results = messages.map((message) => kernel.appendEpisodeMessage({
        projectId, sourceAgent, ...message, metadata: { imported: true, importFormat: format },
    }));
    const episodeIds = [...new Set(results.map((item) => item.episodeId).filter((id) => Boolean(id)))];
    const closureReceipts = args['seal-batch'] === true
        ? episodeIds.map((episodeId) => kernel.sealEpisode(episodeId, { mode: 'batch', reason: 'cli_batch_boundary' }))
        : [];
    return {
        imported: results.filter((item) => item.created).length,
        duplicates: results.filter((item) => !item.created).length,
        episodeIds,
        unassignedEventIds: results.filter((item) => !item.assigned && !item.ignored).map((item) => item.eventId),
        ignoredEventIds: results.filter((item) => item.ignored).map((item) => item.eventId),
        closureReceipts, dreamRan: false,
    };
}
function stableImportMessageId(sessionId, role, text, timestamp, index) {
    return `import-${createHash('sha256').update(JSON.stringify([sessionId, role, timestamp ?? null, index, text])).digest('hex')}`;
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
function timeValue(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    return undefined;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
