#!/usr/bin/env bun
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
import { printCliJson } from './CliJson.js';
function parse(argv) {
    const [command, ...rest] = argv;
    const values = new Map();
    for (let index = 0; index < rest.length; index += 1) {
        const item = rest[index];
        if (!item.startsWith('--'))
            continue;
        const next = rest[index + 1];
        values.set(item.slice(2), !next || next.startsWith('--') ? 'true' : next);
        if (next && !next.startsWith('--'))
            index += 1;
    }
    return { command, values };
}
function usage() {
    return [
        'Usage: cogmem strategy <plan|outcomes> [options]',
        '  plan --query <text> [--project <id>]',
        '  outcomes --project <id> [--limit <n>]',
        '  Common: --config <config.toml> | --db <memory.db> --json',
        'Strategy commands are read-only and never execute recall, tools, or memory governance.',
    ].join('\n');
}
async function main() {
    const args = parse(process.argv.slice(2));
    if (!args.command || args.command === 'help' || args.values.has('help')) {
        console.log(usage());
        return;
    }
    const dbPath = args.values.get('db');
    const kernel = dbPath ? createMemoryKernel({ dbPath }) : createMemoryKernelFromConfig({ configPath: args.values.get('config') });
    try {
        if (args.command === 'plan') {
            const query = args.values.get('query');
            if (!query)
                throw new Error('plan requires --query <text>');
            const intent = kernel.contextCortex.classifyIntent(query);
            printCliJson('strategy.plan', kernel.strategyCortex.plan({
                query, intent, projectId: args.values.get('project'),
            }));
            return;
        }
        if (args.command === 'outcomes') {
            const projectId = args.values.get('project');
            if (!projectId)
                throw new Error('outcomes requires --project <id>');
            const rawLimit = args.values.get('limit');
            const limit = rawLimit === undefined ? 100 : Number(rawLimit);
            if (!Number.isInteger(limit) || limit <= 0)
                throw new Error('--limit must be a positive integer');
            printCliJson('strategy.outcomes', kernel.contextOutcomeStore.list(projectId, limit));
            return;
        }
        throw new Error(`unknown strategy command: ${args.command}`);
    }
    finally {
        kernel.close();
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
