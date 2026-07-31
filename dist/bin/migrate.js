#!/usr/bin/env bun
import Database from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { ALL_MIGRATIONS, SchemaMigrationRunner } from '../migrations/index.js';
import { backupDatabase, snapshotDatabase } from '../migrations/MigrationBackup.js';
import { printCliJson } from './CliJson.js';
function parseArgs(argv) {
    let dbPath;
    let configPath;
    let yes = false;
    let dryRun = false;
    let backup = false;
    let json = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--db')
            dbPath = argv[++index];
        else if (arg === '--config')
            configPath = argv[++index];
        else if (arg === '--yes')
            yes = true;
        else if (arg === '--dry-run')
            dryRun = true;
        else if (arg === '--backup')
            backup = true;
        else if (arg === '--json')
            json = true;
    }
    return { dbPath, configPath, dryRun: dryRun || !yes, backup, json };
}
function resolveDbPath(args) {
    if (args.dbPath)
        return args.dbPath;
    const resolution = args.configPath
        ? resolveCogmemConfigPath({ configPath: args.configPath })
        : resolveCogmemConfigPath();
    if (resolution.kind !== 'toml') {
        throw new Error('Usage: cogmem migrate [--config <config.toml>|--db <memory.db>] [--dry-run|--yes] [--backup] [--json]');
    }
    const loaded = loadCogmemConfig({ configPath: resolution.path });
    if (!loaded.options.dbPath)
        throw new Error('Configured database path is missing.');
    return loaded.options.dbPath;
}
function countRuntimeDiscarded(db) {
    if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_scope_discard_receipts'`).get())
        return 0;
    return db.prepare(`SELECT COUNT(*) AS count FROM runtime_scope_discard_receipts
    WHERE source_table IN ('runtime_states','runtime_transitions')`).get().count;
}
function migrationDiagnostics(db) {
    const count = (table, where = '1=1', ...params) => {
        if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table))
            return 0;
        return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params).count);
    };
    return {
        runtimeStatesDiscarded: count('runtime_scope_discard_receipts', 'source_table=?', 'runtime_states'),
        runtimeTransitionsDiscarded: count('runtime_scope_discard_receipts', 'source_table=?', 'runtime_transitions'),
        runtimeOutboxDiscarded: count('runtime_scope_discard_receipts', 'source_table=?', 'runtime_event_outbox'),
        policyExecutionsQuarantined: count('policy_execution_quarantine'),
        entityAliasesQuarantined: count('entity_scope_migration_quarantine', 'record_type=?', 'entity_alias'),
        entityRelationsQuarantined: count('entity_scope_migration_quarantine', 'record_type=?', 'entity_relation'),
        pendingEntityResolutionsQuarantined: count('pending_entity_resolution_quarantine'),
        malformedEdgeEvidenceDiscarded: count('entity_scope_migration_quarantine', 'record_type=? AND reason=?', 'memory_edge', 'memory_edge_evidence_malformed'),
    };
}
function subtractDiagnostics(after, before) {
    return Object.fromEntries(Object.entries(after).map(([key, value]) => [
        key,
        value - before[key],
    ]));
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dbPath = resolveDbPath(args);
    const sourceExists = dbPath === ':memory:' || existsSync(dbPath);
    const db = new Database(args.dryRun && !sourceExists ? ':memory:' : dbPath);
    db.exec('PRAGMA busy_timeout = 5000;');
    try {
        let backupPath;
        let result;
        let runtimeDiscardedThisRun = 0;
        let runtimeDiscardedTotal = 0;
        let diagnosticsThisRun = migrationDiagnostics(db);
        if (args.dryRun) {
            const temporaryPath = dbPath === ':memory:'
                ? ':memory:'
                : join(tmpdir(), `cogmem-migrate-dry-run-${randomUUID()}.db`);
            try {
                if (temporaryPath !== ':memory:')
                    snapshotDatabase(db, temporaryPath);
                const temporaryDb = new Database(temporaryPath);
                try {
                    temporaryDb.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
                    const discardedBefore = countRuntimeDiscarded(temporaryDb);
                    const diagnosticsBefore = migrationDiagnostics(temporaryDb);
                    const runner = new SchemaMigrationRunner(temporaryDb, ALL_MIGRATIONS, { backupVerified: true });
                    const pending = runner.plan().map((migration) => migration.version);
                    const verified = runner.run();
                    runtimeDiscardedTotal = countRuntimeDiscarded(temporaryDb);
                    runtimeDiscardedThisRun = runtimeDiscardedTotal - discardedBefore;
                    diagnosticsThisRun = subtractDiagnostics(migrationDiagnostics(temporaryDb), diagnosticsBefore);
                    result = { pending, applied: [], currentVersion: verified.currentVersion, dryRun: true };
                }
                finally {
                    temporaryDb.close();
                }
            }
            finally {
                if (temporaryPath !== ':memory:')
                    rmSync(temporaryPath, { force: true });
            }
        }
        else {
            const discardedBefore = countRuntimeDiscarded(db);
            const diagnosticsBefore = migrationDiagnostics(db);
            const planner = new SchemaMigrationRunner(db, ALL_MIGRATIONS);
            planner.preflight();
            const pending = planner.plan();
            const needsBackup = pending.some((migration) => migration.requiresBackup);
            const shouldBackup = dbPath !== ':memory:' && existsSync(dbPath) && (args.backup || needsBackup);
            backupPath = shouldBackup ? backupDatabase(db, dbPath) : undefined;
            result = new SchemaMigrationRunner(db, ALL_MIGRATIONS, {
                backupVerified: !needsBackup || Boolean(backupPath) || dbPath === ':memory:',
            }).run();
            runtimeDiscardedTotal = countRuntimeDiscarded(db);
            runtimeDiscardedThisRun = runtimeDiscardedTotal - discardedBefore;
            diagnosticsThisRun = subtractDiagnostics(migrationDiagnostics(db), diagnosticsBefore);
            db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
            const numericVersion = Number.parseInt(result.currentVersion || '0', 10);
            db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`).run(String(numericVersion));
        }
        const output = {
            command: 'migrate',
            dbPath,
            backupPath,
            runtimeDiscardedThisRun,
            runtimeDiscardedTotal,
            ...Object.fromEntries(Object.entries(diagnosticsThisRun).map(([key, value]) => [`${key}ThisRun`, value])),
            recovery: backupPath ? {
                backupPath,
                instruction: 'Stop Cogmem, preserve the failed database, and restore this backup before retrying migration.',
            } : undefined,
            ...result,
        };
        if (args.json)
            printCliJson('migrate', output);
        else {
            console.log(`cogmem migrate ${args.dryRun ? 'dry-run' : 'complete'}`);
            console.log(`database: ${dbPath}`);
            console.log(`pending: ${result.pending.join(', ') || 'none'}`);
            console.log(`applied: ${result.applied.join(', ') || 'none'}`);
            console.log(`discarded unscoped runtime rows this run: ${runtimeDiscardedThisRun}`);
            console.log(`discarded unscoped runtime rows total: ${runtimeDiscardedTotal}`);
            for (const [key, value] of Object.entries(diagnosticsThisRun))
                console.log(`${key} this run: ${value}`);
            if (backupPath)
                console.log(`backup: ${backupPath}`);
        }
    }
    finally {
        db.close();
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
