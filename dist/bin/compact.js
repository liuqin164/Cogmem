#!/usr/bin/env bun
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { DEFAULT_VECTOR_DIMENSION, parseVectorDimensionValue } from '../config/VectorDimension.js';
import { compactStorage } from '../storage/StorageCompactor.js';
import { printCliJson } from './CliJson.js';
function parseArgs(argv) {
    let dbPath = '';
    let configPath = '';
    let dimension;
    let projectId = '';
    let statuses;
    let dryRun = false;
    let apply = false;
    let json = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--db')
            dbPath = argv[++index] ?? '';
        else if (arg === '--config')
            configPath = argv[++index] ?? '';
        else if (arg === '--dimension')
            dimension = parseDimensionArg(argv[++index], '--dimension');
        else if (arg === '--project')
            projectId = argv[++index] ?? '';
        else if (arg === '--status')
            statuses = parseStatuses(argv[++index] ?? '');
        else if (arg === '--dry-run')
            dryRun = true;
        else if (arg === '--apply')
            apply = true;
        else if (arg === '--json')
            json = true;
    }
    if (!dryRun && !apply)
        dryRun = true;
    if (dryRun && apply)
        throw new Error('Use either --dry-run or --apply, not both.');
    return {
        dbPath: dbPath || undefined,
        configPath: configPath || undefined,
        dimension,
        projectId: projectId || undefined,
        statuses,
        dryRun,
        json,
    };
}
function parseDimensionArg(value, label) {
    if (!value || value.startsWith('--'))
        throw new Error(`${label} must be a positive integer.`);
    const diagnostics = [];
    const dimension = parseVectorDimensionValue(value, label, diagnostics);
    const error = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (error || dimension === undefined)
        throw new Error(error?.message ?? `${label} must be a positive integer.`);
    return dimension;
}
function parseStatuses(value) {
    const allowed = new Set(['cold', 'suspect', 'archived']);
    const statuses = value.split(',').map((item) => item.trim()).filter(Boolean);
    for (const status of statuses) {
        if (!allowed.has(status))
            throw new Error('--status must contain only cold,suspect,archived');
    }
    return statuses;
}
async function main() {
    const args = parseArgs(Bun.argv.slice(2));
    const resolution = args.configPath ? resolveCogmemConfigPath({ configPath: args.configPath }) : resolveCogmemConfigPath();
    const loaded = resolution.kind === 'toml' ? loadCogmemConfig({ configPath: resolution.path }) : undefined;
    const dbPath = args.dbPath || loaded?.options.dbPath;
    if (!dbPath) {
        throw new Error('Usage: cogmem compact [--config <config.toml>|--db <memory.db>] [--status archived,suspect,cold] [--dimension 384] [--dry-run|--apply] [--json]');
    }
    const result = compactStorage({
        dbPath,
        dryRun: args.dryRun,
        statuses: args.statuses,
        projectId: args.projectId,
        dimension: args.dimension ?? loaded?.options.vectorDimension ?? DEFAULT_VECTOR_DIMENSION,
    });
    if (args.json) {
        printCliJson('compact', result);
        return;
    }
    console.log(`cogmem compact ${result.dryRun ? 'dry-run' : 'applied'}`);
    console.log(`raw events deleted: ${result.rawEventsDeleted}`);
    console.log(`eligible vectors: ${result.eligibleVectorCount}`);
    console.log(`vectors deleted: ${result.vectorsDeleted}`);
    console.log(`vector bytes before: ${result.vectorBytesBefore}`);
    console.log(`vector bytes after: ${result.vectorBytesAfter}`);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
