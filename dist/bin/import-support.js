import { basename, resolve } from 'node:path';
import { ConversationMarkdownAdapter, HermesWorkspaceProfile, MarkdownSourceLoader, OpenClawDailyMemoryAdapter, OpenClawMemoryIndexAdapter, OpenClawPersonaAdapter, OpenClawSessionAdapter, OpenClawUserProfileAdapter, OpenClawWorkspaceProfile, SoulMarkdownAdapter, } from '../adapters/index.js';
import { InstalledBatchProcessor } from '../batch/InstalledBatchProcessor.js';
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { createMemoryKernel, createMemoryKernelFromConfig, } from '../factory.js';
export function parseArgs(argv) {
    const values = {};
    const lists = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--'))
            continue;
        const key = item.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            values[key] = true;
            continue;
        }
        if (values[key] !== undefined) {
            lists[key] = [...(lists[key] || []), next];
        }
        else {
            values[key] = next;
        }
        index += 1;
    }
    return { values, lists };
}
export async function runOpenClawImport(argv) {
    const args = parseArgs(argv);
    const workspaceRoot = resolve(stringArg(args, 'workspace') || '.');
    const profile = new OpenClawWorkspaceProfile(workspaceRoot);
    const projectId = stringArg(args, 'project') || basename(workspaceRoot) || 'openclaw';
    const sources = profile.buildInstalledBatchSources({
        projectId,
        date: stringArg(args, 'date'),
        sessionPaths: listArgs(args, 'session').map((item) => resolve(workspaceRoot, item)),
        optionalMemoryPaths: listArgs(args, 'memory').map((item) => resolve(workspaceRoot, item)),
    });
    await runAgentImport({
        agent: 'openclaw',
        args,
        workspaceRoot,
        projectId,
        sources,
        usage: 'Usage: cogmem-import-openclaw [--workspace <dir>] [--project <id>] [--db <memory.db>|--config <config.toml>] [--date YYYY-MM-DD] [--session <file>...] [--memory <file>...] [--dry-run] [--json]',
    });
}
export async function runHermesImport(argv) {
    const args = parseArgs(argv);
    const workspaceRoot = resolve(stringArg(args, 'workspace') || '.');
    const profile = new HermesWorkspaceProfile(workspaceRoot);
    const projectId = stringArg(args, 'project') || basename(workspaceRoot) || 'hermes';
    const sources = profile.buildSourceDefinitions({
        projectId,
        profilePath: stringArg(args, 'profile'),
        sessionDir: stringArg(args, 'sessions'),
        sessionPaths: listArgs(args, 'session').map((item) => resolve(workspaceRoot, item)),
    });
    await runAgentImport({
        agent: 'hermes',
        args,
        workspaceRoot,
        projectId,
        sources,
        usage: 'Usage: cogmem-import-hermes [--workspace <dir>] [--project <id>] [--db <memory.db>|--config <config.toml>] [--profile <file>] [--sessions <dir>] [--session <file>...] [--dry-run] [--json]',
    });
}
async function runAgentImport(input) {
    if (input.args.values.help === true || input.args.values.h === true) {
        console.log(input.usage);
        return;
    }
    if (input.args.values['env-path'] !== undefined) {
        throw new Error('--env-path is no longer supported. Use .cogmem/config.toml or pass --config <config.toml>.');
    }
    if (input.sources.length === 0) {
        throw new Error(`No ${input.agent} memory sources found in ${input.workspaceRoot}. ${input.usage}`);
    }
    const window = buildWindow(input.args);
    const dryRun = input.args.values['dry-run'] === true;
    const result = dryRun
        ? previewSources({
            agent: input.agent,
            workspaceRoot: input.workspaceRoot,
            projectId: input.projectId,
            sources: input.sources,
            window,
        })
        : await importSources({
            agent: input.agent,
            args: input.args,
            workspaceRoot: input.workspaceRoot,
            projectId: input.projectId,
            sources: input.sources,
            window,
        });
    if (input.args.values.json === true) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    printHumanSummary(result);
}
function previewSources(input) {
    const loader = new MarkdownSourceLoader();
    const adapters = buildAdapterMap();
    const diagnostics = [];
    const sourceResults = [];
    let recordsParsed = 0;
    for (const source of input.sources) {
        const adapter = adapters.get(source.adapterKind);
        if (!adapter)
            continue;
        const snapshot = loader.read(source);
        const adapted = adapter.adapt(source, snapshot, { start: input.window.start, end: input.window.end });
        diagnostics.push(...(adapted.diagnostics || []));
        recordsParsed += adapted.records.length;
        sourceResults.push({
            sourceId: source.sourceId,
            sourcePath: source.sourcePath,
            adapterKind: source.adapterKind,
            recordsParsed: adapted.records.length,
            recordsWouldIngest: adapted.records.length,
            recordsIngested: 0,
            skippedRecords: 0,
            diagnostics: adapted.diagnostics || [],
        });
    }
    return {
        agent: input.agent,
        workspaceRoot: input.workspaceRoot,
        projectId: input.projectId,
        dryRun: true,
        window: input.window,
        sourcesScanned: input.sources.length,
        sourcesChanged: input.sources.length,
        recordsParsed,
        recordsWouldIngest: recordsParsed,
        recordsIngested: 0,
        skippedRecords: 0,
        processedSourceIds: [],
        diagnostics,
        sourceResults,
    };
}
async function importSources(input) {
    const opened = openKernel(input.args, input.workspaceRoot);
    const processor = new InstalledBatchProcessor({
        cursorStore: opened.kernel.cursorStore,
        ingestBatch: async (items) => {
            const neurons = [];
            for (const item of items)
                neurons.push(await opened.kernel.ingest(item));
            return neurons;
        },
        runOfflineWindow: (window) => opened.kernel.consolidate({
            projectId: input.projectId,
            startTime: window.start,
            endTime: window.end,
        }),
    });
    try {
        const summary = await processor.runOnce({
            window: input.window,
            sources: input.sources,
        });
        return {
            agent: input.agent,
            workspaceRoot: input.workspaceRoot,
            projectId: input.projectId,
            dbPath: opened.dbPath,
            dryRun: false,
            window: input.window,
            sourcesScanned: summary.sourcesScanned,
            sourcesChanged: summary.sourcesChanged,
            recordsParsed: summary.recordsParsed,
            recordsWouldIngest: summary.recordsIngested,
            recordsIngested: summary.recordsIngested,
            skippedRecords: summary.skippedRecords,
            processedSourceIds: summary.processedSourceIds,
            diagnostics: summary.adapterDiagnostics,
            sourceResults: summary.sourceResults.map((item) => ({
                sourceId: item.sourceId,
                sourcePath: item.sourcePath,
                adapterKind: item.adapterKind,
                recordsParsed: item.recordsParsed,
                recordsWouldIngest: item.recordsIngested,
                recordsIngested: item.recordsIngested,
                skippedRecords: item.skippedRecords,
                diagnostics: item.diagnostics,
            })),
        };
    }
    finally {
        opened.kernel.cursorStore.close();
        opened.kernel.close();
    }
}
function openKernel(args, workspaceRoot) {
    const explicitDb = stringArg(args, 'db');
    if (explicitDb) {
        return {
            kernel: createMemoryKernel({ dbPath: explicitDb }),
            dbPath: explicitDb,
        };
    }
    const explicitConfig = stringArg(args, 'config');
    const configResolution = explicitConfig
        ? resolveCogmemConfigPath({ configPath: resolve(explicitConfig) })
        : resolveCogmemConfigPath({ cwd: workspaceRoot });
    if (configResolution.kind === 'toml') {
        const loaded = loadCogmemConfig({ configPath: configResolution.path, cwd: workspaceRoot });
        const error = loaded.diagnostics.find((item) => item.severity === 'error');
        if (error)
            throw new Error(`${error.code}: ${error.message}`);
        if (!loaded.options.dbPath) {
            throw new Error(`Missing core.db_path in ${configResolution.path}. Run cogmem-init again or pass --db <memory.db>.`);
        }
        return {
            kernel: createMemoryKernelFromConfig({ configPath: configResolution.path, cwd: workspaceRoot }),
            dbPath: loaded.options.dbPath,
        };
    }
    throw new Error(`Missing cogmem config at ${configResolution.path}. Run cogmem-init first or pass --db <memory.db> / --config <config.toml>.`);
}
function buildAdapterMap() {
    return new Map([
        ['conversation_markdown', new ConversationMarkdownAdapter()],
        ['soul_markdown', new SoulMarkdownAdapter()],
        ['openclaw_daily_memory', new OpenClawDailyMemoryAdapter()],
        ['openclaw_session', new OpenClawSessionAdapter()],
        ['openclaw_memory_index', new OpenClawMemoryIndexAdapter()],
        ['openclaw_user_profile', new OpenClawUserProfileAdapter()],
        ['openclaw_persona', new OpenClawPersonaAdapter()],
    ]);
}
function buildWindow(args) {
    const start = parseTime(stringArg(args, 'since'), 0, '--since');
    const end = parseTime(stringArg(args, 'until'), Number.MAX_SAFE_INTEGER, '--until');
    if (end <= start)
        throw new Error('--until must be later than --since');
    return {
        start,
        end,
        label: stringArg(args, 'date') || 'full-history',
    };
}
function parseTime(value, fallback, flag) {
    if (!value)
        return fallback;
    if (/^\d+$/.test(value))
        return Number(value);
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
        throw new Error(`Invalid ${flag}: ${value}`);
    return parsed;
}
function stringArg(args, key) {
    const value = args.values[key];
    return typeof value === 'string' ? value : undefined;
}
function listArgs(args, key) {
    const value = args.values[key];
    const first = typeof value === 'string' ? [value] : [];
    return [...first, ...(args.lists[key] || [])];
}
function printHumanSummary(result) {
    const action = result.dryRun ? 'would import' : 'imported';
    console.log(`cogmem ${result.agent} migration ${result.dryRun ? 'dry-run' : 'complete'}`);
    console.log(`workspace: ${result.workspaceRoot}`);
    console.log(`project: ${result.projectId}`);
    if (result.dbPath)
        console.log(`db: ${result.dbPath}`);
    console.log(`sources: ${result.sourcesScanned}`);
    console.log(`records parsed: ${result.recordsParsed}`);
    console.log(`records ${action}: ${result.dryRun ? result.recordsWouldIngest : result.recordsIngested}`);
    console.log(`records skipped: ${result.skippedRecords}`);
    if (result.diagnostics.length > 0) {
        console.log('diagnostics:');
        for (const diagnostic of result.diagnostics) {
            console.log(`- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
        }
    }
}
