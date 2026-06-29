#!/usr/bin/env bun
import Database from 'bun:sqlite';
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
function readArg(name) {
    const index = process.argv.indexOf(name);
    if (index === -1)
        return undefined;
    return process.argv[index + 1];
}
function hasFlag(name) {
    return process.argv.includes(name);
}
function usage() {
    return [
        'Usage: cogmem repair project-scope --from <projectId> --to <projectId> [--db <memory.db>|--config <config.toml>] [--dry-run|--apply] [--json]',
        '',
        'Conservatively moves empty-project upgrade residue into a real project scope.',
    ].join('\n');
}
function dbPathFromArgs() {
    const explicit = readArg('--db');
    if (explicit)
        return explicit;
    const resolution = resolveCogmemConfigPath({ configPath: readArg('--config') });
    if (resolution.kind === 'missing')
        throw new Error(`missing config file: ${resolution.path}`);
    const dbPath = loadCogmemConfig({ configPath: resolution.path }).options.dbPath;
    if (!dbPath)
        throw new Error(`config does not define a database path: ${resolution.path}`);
    return dbPath;
}
function quoteIdent(name) {
    return `"${name.replace(/"/g, '""')}"`;
}
function tablesWithProjectId(db) {
    const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
    return tables
        .map((table) => table.name)
        .filter((table) => {
        const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
        return columns.some((column) => column.name === 'project_id');
    });
}
function countRows(db, table, projectId) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE COALESCE(project_id,'')=?`).get(projectId);
    return Number(row?.count || 0);
}
function nonEmptyProjectIds(db, table) {
    const rows = db.prepare(`SELECT DISTINCT project_id FROM ${quoteIdent(table)} WHERE COALESCE(project_id,'')<>'' LIMIT 20`).all();
    return rows.map((row) => row.project_id).filter(Boolean);
}
function main() {
    const [command] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
    if (command !== 'project-scope' || hasFlag('--help') || hasFlag('-h')) {
        console.log(usage());
        process.exit(command === 'project-scope' ? 0 : 1);
    }
    const from = readArg('--from');
    const to = readArg('--to');
    if (from === undefined || !to)
        throw new Error(`Missing --from or --to.\n${usage()}`);
    const apply = hasFlag('--apply');
    const dbPath = dbPathFromArgs();
    const db = new Database(dbPath);
    db.exec('PRAGMA busy_timeout = 5000;');
    try {
        const tables = tablesWithProjectId(db);
        const counts = tables.map((table) => ({
            table,
            fromCount: countRows(db, table, from),
            existingProjectIds: nonEmptyProjectIds(db, table),
        })).filter((row) => row.fromCount > 0);
        const nonEmpty = new Set(counts.flatMap((row) => row.existingProjectIds));
        if (from === '' && to === 'openclaw') {
            for (const projectId of nonEmpty) {
                if (projectId !== to) {
                    throw new Error(`Refusing project-scope repair: database already contains non-openclaw project_id "${projectId}".`);
                }
            }
        }
        let changed = 0;
        if (apply) {
            db.transaction(() => {
                for (const row of counts) {
                    const result = db.prepare(`UPDATE ${quoteIdent(row.table)} SET project_id=? WHERE COALESCE(project_id,'')=?`).run(to, from);
                    changed += Number(result.changes || 0);
                }
            })();
        }
        const payload = {
            schemaVersion: 'cogmem.cli.v1',
            command: 'repair project-scope',
            dbPath,
            dryRun: !apply,
            apply,
            from,
            to,
            changed,
            tables: counts,
        };
        if (hasFlag('--json')) {
            console.log(JSON.stringify(payload));
        }
        else {
            console.log(`${apply ? 'applied' : 'dry-run'} project-scope repair ${JSON.stringify({ from, to, changed })}`);
            for (const row of counts)
                console.log(`${row.table}: ${row.fromCount}`);
        }
    }
    finally {
        db.close();
    }
}
main();
