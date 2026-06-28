#!/usr/bin/env bun
import Database from 'bun:sqlite';
import { NeuronEmbeddingStore } from '../embedding/NeuronEmbeddingStore.js';
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { printCliJson } from './CliJson.js';
function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--'))
            continue;
        const key = item.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
        }
        else {
            args[key] = next;
            index += 1;
        }
    }
    return args;
}
const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (command !== 'status') {
    console.error('Usage: re-embed.ts status --db <cogmem.db>');
    process.exit(1);
}
const configPath = typeof args.config === 'string' ? args.config : undefined;
const resolution = configPath ? resolveCogmemConfigPath({ configPath }) : resolveCogmemConfigPath();
const loaded = resolution.kind === 'toml' ? loadCogmemConfig({ configPath: resolution.path }) : undefined;
const dbPath = typeof args.db === 'string' ? args.db : loaded?.options.dbPath ?? './cogmem.db';
const db = new Database(dbPath);
const store = new NeuronEmbeddingStore(db);
const progress = store.getProgress();
const completedOrFailed = progress.completed + progress.failed;
const status = {
    isRunning: false,
    dbPath,
    ...progress,
    percentComplete: progress.total === 0 ? 100 : Math.min(100, (completedOrFailed / progress.total) * 100),
    estimatedRemainingMs: null,
};
printCliJson('re-embed.status', status);
db.close();
