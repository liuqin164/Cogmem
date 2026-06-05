#!/usr/bin/env bun
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { createMemoryKernelFromConfig } from '../factory.js';
import { installOpenClawAutoMemoryPlugin } from '../host/openclaw/AutoMemoryPluginInstaller.js';
function readArg(name) {
    const index = process.argv.indexOf(name);
    if (index === -1)
        return undefined;
    return process.argv[index + 1];
}
function hasFlag(name) {
    return process.argv.includes(name);
}
function ok(message) {
    console.log(`OK ${message}`);
}
function warn(code, message) {
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
const configPath = readArg('--config');
const envPath = readArg('--env-path');
const fix = hasFlag('--fix');
const agent = readArg('--agent');
const workspace = readArg('--workspace');
const openclawConfigPath = readArg('--openclaw-config');
const pluginDir = readArg('--plugin-dir');
const bunPath = readArg('--bun');
if (envPath) {
    fail('--env-path is no longer supported. Use cogmem-init to create .cogmem/config.toml, then run cogmem-doctor --config <config.toml>.');
}
else {
    const resolution = resolveCogmemConfigPath({ configPath });
    if (resolution.kind === 'missing')
        fail(`missing config file: ${resolution.path}`);
    const loaded = loadCogmemConfig({ configPath: resolution.path });
    const error = loaded.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (error)
        fail(`${error.code}: ${error.message}`);
    printWarnings(loaded.diagnostics);
    ok('configuration parsed');
    ok(`cogmem home ${loaded.homeDir}`);
    const kernel = createMemoryKernelFromConfig({ configPath: resolution.path });
    const health = kernel.getHealthStatus();
    if (health.package !== '@CognitiveOS/core')
        fail('unexpected package identity');
    ok(`kernel ready at ${health.dbPath}`);
    kernel.close();
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
}
