#!/usr/bin/env bun
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
        'Usage: cogmem dream <tick|status|retry> [args]',
        '  tick [--project <id>] [--mode auto|micro|normal|deep] [--max-episodes <n>] [--json]',
        '  status [--project <id>] [--json]',
        '  retry [--project <id>] [--json]',
        'A tick is explicit and conditional. It processes sealed episodes only and never executes tools.',
    ].join('\n');
}
function openKernel(args) {
    const dbPath = stringArg(args, 'db');
    return dbPath ? createMemoryKernel({ dbPath }) : createMemoryKernelFromConfig({ configPath: stringArg(args, 'config'), cwd: process.cwd() });
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
        const result = args.command === 'tick'
            ? await kernel.runDreamTick({ projectId, mode: modeArg(stringArg(args, 'mode')), maxEpisodes: numberArg(args, 'max-episodes') })
            : args.command === 'status'
                ? kernel.getEpisodeDreamStatus(projectId)
                : args.command === 'retry'
                    ? { retried: kernel.retryFailedEpisodeDreams(projectId), status: kernel.getEpisodeDreamStatus(projectId) }
                    : (() => { throw new Error(usage()); })();
        console.log(JSON.stringify(result, null, 2));
    }
    finally {
        kernel.close();
    }
}
function stringArg(args, key) { return typeof args[key] === 'string' && args[key] ? args[key] : undefined; }
function numberArg(args, key) { const value = stringArg(args, key); if (!value)
    return undefined; const parsed = Number(value); if (!Number.isFinite(parsed))
    throw new Error(`--${key} must be numeric`); return parsed; }
function modeArg(value) { if (!value)
    return undefined; if (value === 'auto' || value === 'micro' || value === 'normal' || value === 'deep')
    return value; throw new Error('mode must be auto, micro, normal, or deep'); }
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
