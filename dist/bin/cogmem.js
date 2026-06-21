#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const COMMANDS = {
    init: 'init',
    doctor: 'doctor',
    connect: 'connect',
    update: 'update',
    compact: 'compact',
    memory: 'memory',
    'explain-recall': 'explain-recall',
    mcp: 'mcp',
    'import-openclaw': 'import-openclaw',
    'import-hermes': 'import-hermes',
    'normalize-transcript': 'normalize-transcript',
    snapshot: 'snapshot',
    're-embed': 're-embed',
    'migrate-vectors': 'migrate-vectors',
    migrate: 'migrate',
    prospective: 'prospective',
    strategy: 'strategy',
    'brain-eval': 'brain-eval',
    episode: 'episode',
    dream: 'dream',
};
function usage() {
    return [
        'Usage: cogmem <command> [args]',
        '',
        'Commands:',
        '  init                 interactive setup',
        '  doctor               validate config; use --fix --agent openclaw to repair OpenClaw auto memory wiring',
        '  connect openclaw     install OpenClaw/Hermes integration files; use --auto for OpenClaw runtime hooks',
        '  update               show or run package update command',
        '  compact              dry-run or apply vector-only storage compaction',
        '  memory               audit/search/show raw and compiled memory; run dream/candidates queue',
        '  import-openclaw      import OpenClaw memory files',
        '  import-hermes        import Hermes memory files',
        '  explain-recall       explain governed recall',
        '  mcp                  start stdio MCP server',
        '  snapshot             export/import snapshots',
        '  re-embed             inspect or run re-embedding',
        '  migrate-vectors      migrate vector backend data',
        '  migrate              plan or apply schema migrations with optional backup',
        '  prospective          manage confirmed-only future-memory candidates; never executes tasks',
        '  strategy             inspect current-turn memory policy and read-only outcome telemetry',
        '  brain-eval           evaluate recall, provenance, leakage, budget, and false activation',
        '  episode              append, import, inspect, seal, or repair conversation episodes',
        '  dream                conditionally process sealed episode backlog',
        '',
        'JSON output: commands with --json emit cogmem.cli.v1. Object fields stay top-level; arrays use items.',
        'Queue commands expose candidate, promoted, needs_confirmation, and beliefs at the top level.',
    ].join('\n');
}
function siblingEntrypoint(command) {
    const base = dirname(fileURLToPath(import.meta.url));
    const jsPath = join(base, `${command}.js`);
    if (existsSync(jsPath))
        return jsPath;
    return join(base, `${command}.ts`);
}
async function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || command === '--help' || command === '-h') {
        console.log(usage());
        return;
    }
    const entrypoint = COMMANDS[command];
    if (!entrypoint) {
        console.error(`Unknown cogmem command: ${command}`);
        console.error(usage());
        process.exit(1);
    }
    const proc = Bun.spawn({
        cmd: [process.execPath || 'bun', siblingEntrypoint(entrypoint), ...rest],
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await Bun.write(Bun.stdout, stdout);
    await Bun.write(Bun.stderr, stderr);
    process.exit(await proc.exited);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
