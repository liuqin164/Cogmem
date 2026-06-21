#!/usr/bin/env bun
import Database from 'bun:sqlite';
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { DEFAULT_VECTOR_DIMENSION, parseVectorDimensionValue } from '../config/VectorDimension.js';
import { NeuronEmbeddingStore } from '../embedding/NeuronEmbeddingStore.js';
import { SqliteVecStore } from '../store/SqliteVecStore.js';
import { printCliJson } from './CliJson.js';
function parseArgs(argv) {
    let dbPath = '';
    let configPath = '';
    let dimension;
    let dryRun = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--db')
            dbPath = argv[++index] ?? '';
        else if (arg === '--config')
            configPath = argv[++index] ?? '';
        else if (arg === '--dimension')
            dimension = parseDimensionArg(argv[++index], '--dimension');
        else if (arg === '--dry-run')
            dryRun = true;
    }
    return { dbPath: dbPath || undefined, configPath: configPath || undefined, dimension, dryRun };
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
async function main() {
    const args = parseArgs(Bun.argv.slice(2));
    const resolution = args.configPath ? resolveCogmemConfigPath({ configPath: args.configPath }) : resolveCogmemConfigPath();
    const loaded = resolution.kind === 'toml' ? loadCogmemConfig({ configPath: resolution.path }) : undefined;
    const dbPath = args.dbPath || loaded?.options.dbPath;
    if (!dbPath) {
        throw new Error('Usage: bun run packages/core/src/bin/migrate-vectors.ts [--config <config.toml>|--db <memory.db>] [--dimension 384] [--dry-run]');
    }
    const db = new Database(dbPath);
    db.exec('PRAGMA busy_timeout = 5000;');
    try {
        const embeddingStore = new NeuronEmbeddingStore(db);
        const embeddings = embeddingStore.listLatestEmbeddings();
        const dimension = args.dimension ?? loaded?.options.vectorDimension ?? embeddings[0]?.dimensions ?? DEFAULT_VECTOR_DIMENSION;
        const sqliteVec = new SqliteVecStore(db, dimension);
        const compatible = embeddings.filter((row) => row.dimensions === dimension);
        if (!args.dryRun) {
            sqliteVec.addVectors(compatible.map((row) => ({
                id: row.neuronId,
                vector: Array.from(row.vector),
            })));
        }
        printCliJson('migrate-vectors', {
            migrated: args.dryRun ? 0 : compatible.length,
            eligible: compatible.length,
            skippedDimensionMismatch: embeddings.length - compatible.length,
            dimension,
            backend: sqliteVec.getStats().backend,
            dryRun: args.dryRun,
        });
    }
    finally {
        db.close();
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
