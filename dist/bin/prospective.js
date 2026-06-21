#!/usr/bin/env bun
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
import { printCliJson } from './CliJson.js';
function parseArgs(argv) {
    const [command, ...rest] = argv;
    const values = new Map();
    for (let index = 0; index < rest.length; index += 1) {
        const item = rest[index];
        if (!item.startsWith('--'))
            continue;
        const next = rest[index + 1];
        const value = !next || next.startsWith('--') ? 'true' : next;
        values.set(item.slice(2), [...(values.get(item.slice(2)) ?? []), value]);
        if (value !== 'true')
            index += 1;
    }
    return { command, values };
}
function usage() {
    return [
        'Usage: cogmem prospective <list|due|create|confirm|reject|defer|complete|expire> [options]',
        '  list --project <id> [--status pending --status confirmed]',
        '  due --project <id> [--at <epoch-ms>]',
        '  create --project <id> --type <type> --key <key> --title <text> --evidence <eventId> [--due <epoch-ms>]',
        '  confirm --project <id> --id <candidateId> --evidence <userEventId>',
        '  reject|complete|expire --project <id> --id <candidateId>',
        '  defer --project <id> --id <candidateId> --until <epoch-ms>',
        '  Common: --config <config.toml> | --db <memory.db> --json',
        'This command manages candidates only. It never executes tasks or tools.',
    ].join('\n');
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.command || args.command === 'help' || args.values.has('help')) {
        console.log(usage());
        return;
    }
    const dbPath = args.values.get('db')?.[0];
    const configPath = args.values.get('config')?.[0];
    const kernel = dbPath ? createMemoryKernel({ dbPath }) : createMemoryKernelFromConfig({ configPath });
    try {
        const service = kernel.prospectiveMemoryService;
        const projectId = args.values.get('project')?.[0];
        let result;
        if (args.command === 'list') {
            if (!projectId)
                throw new Error('--project is required');
            result = service.list({ projectId, statuses: args.values.get('status') });
        }
        else if (args.command === 'due') {
            if (!projectId)
                throw new Error('--project is required');
            result = service.listDue({ projectId, atTime: numberValue(args.values, 'at') });
        }
        else if (args.command === 'create') {
            const candidateType = args.values.get('type')?.[0];
            const canonicalKey = args.values.get('key')?.[0];
            const title = args.values.get('title')?.[0];
            const evidenceEventIds = args.values.get('evidence') ?? [];
            if (!projectId || !candidateType || !canonicalKey || !title || evidenceEventIds.length === 0) {
                throw new Error('create requires --project --type --key --title and at least one --evidence');
            }
            result = service.propose({
                projectId, candidateType, canonicalKey, title, evidenceEventIds,
                details: args.values.get('details')?.[0],
                proposedBy: args.values.get('proposed-by')?.[0] ?? 'operator',
                dueAt: numberValue(args.values, 'due'),
            });
        }
        else {
            const candidateId = args.values.get('id')?.[0];
            if (!candidateId)
                throw new Error('--id is required');
            if (!projectId)
                throw new Error('--project is required');
            if (args.command === 'confirm') {
                const evidence = args.values.get('evidence')?.[0];
                if (!evidence)
                    throw new Error('confirm requires --evidence <userEventId>');
                result = service.resolve(candidateId, { action: 'confirm', confirmationEvidenceEventId: evidence }, projectId);
            }
            else if (args.command === 'reject')
                result = service.resolve(candidateId, { action: 'reject' }, projectId);
            else if (args.command === 'complete')
                result = service.resolve(candidateId, { action: 'complete' }, projectId);
            else if (args.command === 'expire')
                result = service.resolve(candidateId, { action: 'expire' }, projectId);
            else if (args.command === 'defer') {
                const deferredUntil = numberValue(args.values, 'until');
                if (deferredUntil === undefined)
                    throw new Error('defer requires --until <epoch-ms>');
                result = service.resolve(candidateId, { action: 'defer', deferredUntil }, projectId);
            }
            else
                throw new Error(`unknown prospective command: ${args.command}`);
        }
        printCliJson(`prospective.${String(args.command)}`, result);
    }
    finally {
        kernel.close();
    }
}
function numberValue(values, key) {
    const value = values.get(key)?.[0];
    if (value === undefined)
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        throw new Error(`--${key} must be a finite number`);
    return parsed;
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
