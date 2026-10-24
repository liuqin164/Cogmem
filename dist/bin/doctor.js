#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { createMemoryKernelFromConfig } from '../factory.js';
import { defaultOpenClawAutoMemoryPluginDir, inspectOpenClawAutoMemoryPlugin, installOpenClawAutoMemoryPlugin, } from '../host/openclaw/AutoMemoryPluginInstaller.js';
import { compactStorage } from '../storage/StorageCompactor.js';
import { buildGate, installPathSteps, isOnPath, pathWarningSteps, postInstallSteps, resolveCliBinDir, } from '../install/InstallSteps.js';
function readArg(name) {
    const index = process.argv.indexOf(name);
    if (index === -1)
        return undefined;
    return process.argv[index + 1];
}
function hasFlag(name) {
    return process.argv.includes(name);
}
// In --json mode stdout carries one JSON document and nothing else. The gate
// already reports every warning as a diagnostic, so the human progress lines are
// suppressed rather than moved to stderr: two renderings, one set of facts.
function ok(message) {
    if (json)
        return;
    console.log(`OK ${message}`);
}
function warn(code, message) {
    if (json)
        return;
    console.log(`WARN ${code}: ${message}`);
}
function printWarnings(diagnostics) {
    for (const diagnostic of diagnostics) {
        if (diagnostic.severity === 'warning')
            warn(diagnostic.code, diagnostic.message);
    }
}
function fail(message) {
    console.error(`FAIL ${message}`);
    process.exit(1);
}
/**
 * The command a reader should copy. A CLI installed into a `bin`/`.bin`
 * directory is named by absolute path, because the whole point of the PATH
 * WARN is that the bare name may not resolve.
 */
function resolveBinCommand() {
    const binDir = resolveCliBinDir(process.argv[1], process.env);
    if (binDir && existsSync(join(binDir, 'cogmem')))
        return join(binDir, 'cogmem');
    return 'cogmem';
}
function printSteps(steps) {
    if (steps.length === 0)
        return;
    console.log('');
    console.log('Next steps:');
    for (const step of steps) {
        console.log(`  [${step.actor}] ${step.command}`);
        console.log(`      ${step.when} — ${step.purpose}`);
    }
}
function emitGate(gate, payload = {}) {
    if (json) {
        console.log(JSON.stringify({
            schemaVersion: 'cogmem.cli.v1',
            command: 'doctor',
            ...payload,
            installGate: {
                level: gate.level,
                exitCode: gate.exitCode,
                summary: gate.summary,
                diagnostics: gate.diagnostics,
            },
            nextSteps: gate.nextSteps,
        }, null, 2));
    }
    else {
        console.log('');
        console.log(`Install gate: ${gate.level.toUpperCase()} — ${gate.summary}`);
        printSteps(gate.nextSteps);
    }
    process.exit(gate.exitCode);
}
const configPath = readArg('--config');
const envPath = readArg('--env-path');
const fix = hasFlag('--fix');
const agent = readArg('--agent');
const workspace = readArg('--workspace');
const openclawConfigPath = readArg('--openclaw-config');
const pluginDir = readArg('--plugin-dir');
const bunPath = readArg('--bun');
const storage = hasFlag('--storage');
const pluginOnly = hasFlag('--plugin-only');
const json = hasFlag('--json');
if (envPath) {
    fail('--env-path is no longer supported. Use cogmem-init to create .cogmem/config.toml, then run cogmem-doctor --config <config.toml>.');
}
else {
    const resolution = resolveCogmemConfigPath({ configPath });
    // A named config that is not on disk yet is the same state as no config:
    // the install exists, the setup does not.
    if (resolution.kind === 'missing' || !existsSync(resolution.path)) {
        // No config is the state every fresh install is in. It is not a failure:
        // it is the gate saying "now configure it", with the command that does it.
        const bin = resolveBinCommand();
        if (!json) {
            console.log(`cogmem is installed but not configured yet (looked for ${resolution.path}).`);
        }
        emitGate(buildGate('not_installed', [{ code: 'missing_config', message: `no cogmem config at ${resolution.path}` }], installPathSteps(bin)), { configPath: null, resolvedConfigPath: resolution.path });
    }
    const loaded = loadCogmemConfig({ configPath: resolution.path });
    const error = loaded.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (error)
        fail(`${error.code}: ${error.message}`);
    if (pluginOnly) {
        if (agent && agent !== 'openclaw')
            fail('doctor --plugin-only currently supports --agent openclaw.');
        const workspaceRoot = workspace || loaded.integrations.openclaw.workspaceDir || process.cwd();
        let fixed = undefined;
        if (fix) {
            fixed = installOpenClawAutoMemoryPlugin({
                workspaceRoot,
                configPath: resolution.path,
                openclawConfigPath,
                pluginDir,
                bunPath,
                force: true,
            });
        }
        const inspection = inspectOpenClawAutoMemoryPlugin({
            workspaceRoot,
            pluginDir: pluginDir || defaultOpenClawAutoMemoryPluginDir(workspaceRoot),
        });
        const audit = readLatestOpenClawAudit(workspaceRoot);
        if (json) {
            console.log(JSON.stringify({
                schemaVersion: 'cogmem.cli.v1',
                command: 'doctor',
                pluginOnly: true,
                configPath: resolution.path,
                openclaw: { plugin: inspection, fixed, audit },
            }));
        }
        else {
            printWarnings(loaded.diagnostics);
            ok('configuration parsed');
            ok(`openclaw plugin ${inspection.current ? 'current' : 'stale'} at ${inspection.pluginDir}`);
            if (!inspection.current)
                warn('openclaw_plugin_stale', 'Run cogmem doctor --fix --agent openclaw --plugin-only --workspace <workspace>.');
            if (fixed)
                ok(`openclaw auto memory integration fixed at ${fixed.pluginDir}`);
            if (audit.lastBeforePromptBuild)
                ok(`last before_prompt_build action=${audit.lastBeforePromptBuild.action || 'unknown'} reason=${audit.lastBeforePromptBuild.reason || ''}`);
        }
        process.exit(0);
    }
    const gateDiagnostics = [];
    for (const diagnostic of loaded.diagnostics) {
        if (diagnostic.severity === 'warning') {
            gateDiagnostics.push({ code: diagnostic.code, message: diagnostic.message });
        }
    }
    printWarnings(loaded.diagnostics);
    ok('configuration parsed');
    ok(`cogmem home ${loaded.homeDir}`);
    let kernelDbPath;
    try {
        const kernel = createMemoryKernelFromConfig({ configPath: resolution.path });
        const health = kernel.getHealthStatus();
        if (health.package !== 'cogmem')
            fail('unexpected package identity');
        kernelDbPath = health.dbPath;
        kernel.close();
        ok(`kernel ready at ${health.dbPath}`);
    }
    catch (kernelError) {
        fail(kernelError instanceof Error ? kernelError.message : String(kernelError));
    }
    if (storage) {
        const storageStats = compactStorage({
            dbPath: kernelDbPath,
            dryRun: true,
            dimension: loaded.options.vectorDimension,
        });
        ok([
            `storage raw_events=${storageStats.rawEventsBefore}`,
            `vectors=${storageStats.vectorCountBefore}`,
            `vector_bytes=${storageStats.vectorBytesBefore}`,
            `eligible_vector_bytes=${storageStats.eligibleVectorBytes}`,
            `vector_bytes_per_raw_event=${storageStats.vectorBytesPerRawEventBefore.toFixed(2)}`,
        ].join(' '));
        if (storageStats.rawEventsBefore > 0 && storageStats.vectorBytesPerRawEventBefore >= 8192) {
            warn('vector_storage_growth', 'Vector bytes per raw event are high; consider selective_compile/raw_then_dream and cogmem compact --dry-run.');
        }
    }
    if (fix) {
        if (agent !== 'openclaw') {
            fail('doctor --fix currently requires --agent openclaw.');
        }
        const result = installOpenClawAutoMemoryPlugin({
            workspaceRoot: workspace || loaded.integrations.openclaw.workspaceDir || process.cwd(),
            configPath: resolution.path,
            openclawConfigPath,
            pluginDir,
            bunPath,
            force: true,
        });
        ok(`openclaw auto memory integration fixed at ${result.pluginDir}`);
        ok(`openclaw config patched at ${result.openclawConfigPath}`);
    }
    if (agent === 'openclaw' || workspace) {
        const workspaceRoot = workspace || loaded.integrations.openclaw.workspaceDir || process.cwd();
        const inspection = inspectOpenClawAutoMemoryPlugin({
            workspaceRoot,
            pluginDir: pluginDir || defaultOpenClawAutoMemoryPluginDir(workspaceRoot),
        });
        if (inspection.installed) {
            ok(`openclaw plugin ${inspection.current ? 'current' : 'stale'} at ${inspection.pluginDir}`);
            if (!inspection.current) {
                warn('openclaw_plugin_stale', 'Run cogmem connect openclaw --workspace <workspace> --auto --force or cogmem doctor --fix --agent openclaw --plugin-only.');
                gateDiagnostics.push({
                    code: 'openclaw_plugin_stale',
                    message: 'the OpenClaw plugin files are older than the installed package',
                });
            }
        }
        const audit = readLatestOpenClawAudit(workspaceRoot);
        if (audit.lastBeforePromptBuild) {
            ok(`last before_prompt_build action=${audit.lastBeforePromptBuild.action || 'unknown'} reason=${audit.lastBeforePromptBuild.reason || ''}`);
        }
    }
    // A rule_only config works; it just does not do semantic recall. That is a
    // degraded install, not a broken one, so it is a WARN and still exits 0.
    const memoryRole = loaded.modelRegistry.getRoleConfig('memory');
    if (memoryRole.provider === 'rule_only') {
        gateDiagnostics.push({
            code: 'rule_only',
            message: 'memory and reasoning run rule_only; semantic recall and Dream curation stay off until a model provider is configured',
        });
    }
    // A CLI nobody can invoke is not a success, even though the install worked.
    const binDir = resolveCliBinDir(process.argv[1], process.env);
    let pathSteps = [];
    if (binDir && existsSync(join(binDir, 'cogmem')) && !isOnPath(binDir, process.env)) {
        warn('cli_not_on_path', `${binDir} is not on PATH. Run: export PATH="${binDir}:$PATH"`);
        gateDiagnostics.push({
            code: 'cli_not_on_path',
            message: `the cogmem CLI at ${binDir} is not reachable as cogmem`,
        });
        pathSteps = pathWarningSteps(binDir);
    }
    const level = gateDiagnostics.length > 0 ? 'warn' : 'ok';
    emitGate(buildGate(level, gateDiagnostics, [...pathSteps, ...postInstallSteps(resolveBinCommand())]), { configPath: resolution.path, dbPath: kernelDbPath, integrations: loaded.integrations });
}
function readLatestOpenClawAudit(workspaceRoot) {
    const logPath = join(workspaceRoot, '.cogmem', 'logs', 'openclaw-auto-memory.jsonl');
    if (!existsSync(logPath))
        return {};
    const lines = readFileSync(logPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).slice(-200);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            const record = JSON.parse(lines[index]);
            if (record.hook === 'before_prompt_build')
                return { lastBeforePromptBuild: record };
        }
        catch {
            // Ignore malformed audit rows.
        }
    }
    return {};
}
