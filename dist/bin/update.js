#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { printCliJson } from './CliJson.js';
import { DEFAULT_NPM_PACKAGE, resolveLatestNpmSpec } from './update-release.js';
function readArgs(argv) {
    const values = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--'))
            continue;
        const next = argv[index + 1];
        const key = item.slice(2);
        if (!next || next.startsWith('--')) {
            values[key] = true;
            continue;
        }
        values[key] = next;
        index += 1;
    }
    const manager = values.manager === 'npm' || values.manager === 'pnpm' || values.manager === 'bun'
        ? values.manager
        : undefined;
    return {
        dryRun: values['dry-run'] === true || values.yes !== true,
        yes: values.yes === true,
        json: values.json === true,
        from: typeof values.from === 'string' ? values.from : 'latest',
        installHome: typeof values['install-home'] === 'string' ? values['install-home'] : undefined,
        manager,
        configPath: typeof values.config === 'string' ? values.config : undefined,
        skipMigrate: values['skip-migrate'] === true,
        skipAgentRefresh: values['skip-agent-refresh'] === true,
    };
}
function detectManager(cwd) {
    if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb')))
        return 'bun';
    if (existsSync(join(cwd, 'pnpm-lock.yaml')))
        return 'pnpm';
    return 'npm';
}
function buildCommand(manager, spec) {
    if (manager === 'bun')
        return ['bun', 'add', `cogmem@${spec}`];
    if (manager === 'pnpm')
        return ['pnpm', 'add', `cogmem@${spec}`];
    return ['npm', 'install', `cogmem@${spec}`];
}
function localCogmemBin(cwd) {
    return join(cwd, 'node_modules', '.bin', 'cogmem');
}
function buildMigrationExec(targetCwd, configPath) {
    return [
        localCogmemBin(targetCwd),
        'migrate',
        '--yes',
        '--backup',
        ...(configPath ? ['--config', configPath] : []),
    ];
}
function buildOpenClawRepairExec(targetCwd, configPath, workspaceRoot) {
    return [
        localCogmemBin(targetCwd),
        'doctor',
        '--fix',
        '--agent',
        'openclaw',
        '--plugin-only',
        '--config',
        configPath,
        '--workspace',
        workspaceRoot,
    ];
}
function installedSpec(cwd) {
    const manifest = readPackageManifest(cwd);
    if (!manifest)
        return undefined;
    return manifest.dependencies?.['cogmem']
        || manifest.devDependencies?.['cogmem']
        || manifest.optionalDependencies?.['cogmem']
        || manifest.dependencies?.['@CognitiveOS/core']
        || manifest.devDependencies?.['@CognitiveOS/core']
        || manifest.optionalDependencies?.['@CognitiveOS/core'];
}
function readPackageManifest(cwd) {
    const packagePath = join(cwd, 'package.json');
    if (!existsSync(packagePath))
        return undefined;
    return JSON.parse(readFileSync(packagePath, 'utf8'));
}
function defaultInstallHome(env) {
    return env.COGMEM_INSTALL_HOME || join(env.HOME || homedir(), '.cogmem', 'pkg');
}
function shouldUpdateCwd(cwd) {
    const manifest = readPackageManifest(cwd);
    return manifest?.name === 'cogmem' || installedSpec(cwd) !== undefined;
}
function resolveUpdateCwd(args, env) {
    const cwd = process.cwd();
    if (args.installHome)
        return args.installHome;
    if (shouldUpdateCwd(cwd))
        return cwd;
    const installHome = defaultInstallHome(env);
    if (existsSync(join(installHome, 'package.json')))
        return installHome;
    return cwd;
}
function loadConfigForUpdate(args) {
    const resolution = resolveCogmemConfigPath({ configPath: args.configPath, cwd: process.cwd() });
    if (resolution.kind === 'missing') {
        return { configPath: undefined, skippedReason: `missing_config:${resolution.path}` };
    }
    const loaded = loadCogmemConfig({ configPath: resolution.path });
    const error = loaded.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (error) {
        throw new Error(`config_error:${error.code}: ${error.message}`);
    }
    return { configPath: resolution.path, loaded };
}
async function runCommand(cmd, cwd) {
    const proc = Bun.spawn({
        cmd,
        cwd,
        stdout: 'inherit',
        stderr: 'inherit',
    });
    return proc.exited;
}
async function main() {
    const args = readArgs(process.argv.slice(2));
    const resolvedSpec = args.from === 'latest'
        ? resolveLatestNpmSpec({ env: process.env })
        : args.from;
    const targetCwd = resolveUpdateCwd(args, process.env);
    const manager = args.manager || detectManager(targetCwd);
    const command = buildCommand(manager, resolvedSpec);
    const config = loadConfigForUpdate(args);
    const migrationExec = !args.skipMigrate && config.configPath
        ? buildMigrationExec(targetCwd, config.configPath)
        : undefined;
    const openclawWorkspace = config.loaded?.integrations.openclaw.enabled
        ? config.loaded.integrations.openclaw.workspaceDir || process.cwd()
        : undefined;
    const openclawRepairExec = !args.skipAgentRefresh && openclawWorkspace && config.configPath
        ? buildOpenClawRepairExec(targetCwd, config.configPath, openclawWorkspace)
        : undefined;
    const restartRequired = [
        ...(openclawWorkspace ? ['restart OpenClaw gateway or agent host'] : []),
        ...(config.loaded?.integrations.hermes.enabled ? ['reload Hermes MCP server or restart the Hermes agent host'] : []),
    ];
    const result = {
        command: 'update',
        dryRun: args.dryRun,
        manager,
        from: args.from,
        source: 'npm',
        npmPackage: DEFAULT_NPM_PACKAGE,
        packageSpec: resolvedSpec,
        targetCwd,
        currentSpec: installedSpec(targetCwd),
        nextCommand: command.join(' '),
        configPath: config.configPath,
        migrationCommand: migrationExec?.join(' '),
        migrationSkippedReason: migrationExec ? undefined : (args.skipMigrate ? 'skip_migrate_flag' : config.skippedReason),
        openclawRepairCommand: openclawRepairExec?.join(' '),
        openclawRepairSkippedReason: openclawRepairExec
            ? undefined
            : (args.skipAgentRefresh ? 'skip_agent_refresh_flag' : (config.loaded?.integrations.openclaw.enabled ? undefined : 'openclaw_not_configured')),
        restartRequired,
        followUp: restartRequired.length > 0
            ? `After update finishes, ${restartRequired.join('; ')}.`
            : 'After update finishes, restart any running agent host so it loads the new Cogmem CLI.',
    };
    if (args.json) {
        printCliJson('update', result);
    }
    else {
        console.log(`cogmem update ${args.dryRun ? 'dry-run' : 'running'}`);
        console.log(`target: ${result.targetCwd}`);
        console.log(`current: ${result.currentSpec || 'not listed in package.json'}`);
        console.log(`command: ${result.nextCommand}`);
        if (result.migrationCommand)
            console.log(`migrate: ${result.migrationCommand}`);
        if (result.openclawRepairCommand)
            console.log(`openclaw: ${result.openclawRepairCommand}`);
        console.log(result.followUp);
    }
    if (!args.dryRun) {
        const updateExitCode = await runCommand(command, targetCwd);
        if (updateExitCode !== 0)
            process.exit(updateExitCode);
        if (migrationExec) {
            const migrationExitCode = await runCommand(migrationExec, process.cwd());
            if (migrationExitCode !== 0)
                process.exit(migrationExitCode);
        }
        if (openclawRepairExec) {
            const repairExitCode = await runCommand(openclawRepairExec, process.cwd());
            if (repairExitCode !== 0)
                process.exit(repairExitCode);
        }
        if (!args.json)
            console.log(result.followUp);
        process.exit(0);
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
