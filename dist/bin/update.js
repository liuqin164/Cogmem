#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
        global: values.global === true,
        localDev: values['local-dev'] === true,
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
function buildCommand(target, spec) {
    if (target.kind === 'npm_global')
        return ['npm', 'install', '-g', `cogmem@${spec}`];
    const manager = target.manager;
    if (manager === 'bun')
        return ['bun', 'add', `cogmem@${spec}`];
    if (manager === 'pnpm')
        return ['pnpm', 'add', `cogmem@${spec}`];
    return ['npm', 'install', `cogmem@${spec}`];
}
function localCogmemBin(cwd) {
    return join(cwd, 'node_modules', '.bin', 'cogmem');
}
function buildMigrationExecForTarget(target, configPath) {
    return [
        target.bin,
        'migrate',
        '--yes',
        '--backup',
        ...(configPath ? ['--config', configPath] : []),
    ];
}
function buildOpenClawRepairExecForTarget(target, configPath, workspaceRoot) {
    return [
        target.bin,
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
function isCogmemSourceCheckout(cwd) {
    const manifest = readPackageManifest(cwd);
    return manifest?.name === 'cogmem'
        && existsSync(join(cwd, 'src', 'bin', 'update.ts'))
        && existsSync(join(cwd, '.git'));
}
function ownPackageRoot() {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}
function isLikelyNpmGlobalInstall(env) {
    if (env.COGMEM_INSTALL_KIND === 'npm_global')
        return true;
    const root = ownPackageRoot();
    const marker = `${sep}node_modules${sep}cogmem`;
    if (!root.includes(marker))
        return false;
    const cwd = resolve(process.cwd());
    return !cwd.startsWith(root + sep);
}
function resolveUpdateTarget(args, env) {
    const cwd = process.cwd();
    if (args.global || isLikelyNpmGlobalInstall(env)) {
        return { cwd, kind: 'npm_global', manager: 'npm', bin: 'cogmem' };
    }
    if (args.installHome) {
        const targetCwd = args.installHome;
        return { cwd: targetCwd, kind: 'install_home', manager: args.manager || detectManager(targetCwd), bin: localCogmemBin(targetCwd) };
    }
    if (isCogmemSourceCheckout(cwd)) {
        return {
            cwd,
            kind: 'source_checkout',
            manager: args.manager || detectManager(cwd),
            bin: localCogmemBin(cwd),
            warning: args.localDev ? undefined : 'source_checkout_requires_local_dev_for_write',
        };
    }
    if (shouldUpdateCwd(cwd)) {
        return { cwd, kind: 'local_project', manager: args.manager || detectManager(cwd), bin: localCogmemBin(cwd) };
    }
    const installHome = defaultInstallHome(env);
    if (existsSync(join(installHome, 'package.json'))) {
        return { cwd: installHome, kind: 'install_home', manager: args.manager || detectManager(installHome), bin: localCogmemBin(installHome) };
    }
    return {
        cwd,
        kind: 'cwd_fallback',
        manager: args.manager || detectManager(cwd),
        bin: localCogmemBin(cwd),
        warning: 'no_install_home_or_project_dependency_detected',
    };
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
    const target = resolveUpdateTarget(args, process.env);
    if (!args.dryRun && target.kind === 'source_checkout' && !args.localDev) {
        throw new Error('Refusing to update the Cogmem source checkout. Pass --local-dev for an intentional development update, --global for npm global, or --install-home <dir> for the one-line installer home.');
    }
    if (!args.dryRun && target.kind === 'cwd_fallback') {
        throw new Error('Unable to find an installed Cogmem package to update. Pass --global for npm global installs or --install-home <dir> for the one-line installer home.');
    }
    const manager = target.manager;
    const command = buildCommand(target, resolvedSpec);
    const config = loadConfigForUpdate(args);
    const migrationExec = !args.skipMigrate && config.configPath
        ? buildMigrationExecForTarget(target, config.configPath)
        : undefined;
    const openclawWorkspace = config.loaded?.integrations.openclaw.enabled
        ? config.loaded.integrations.openclaw.workspaceDir || process.cwd()
        : undefined;
    const openclawRepairExec = !args.skipAgentRefresh && openclawWorkspace && config.configPath
        ? buildOpenClawRepairExecForTarget(target, config.configPath, openclawWorkspace)
        : undefined;
    const restartRequired = [
        ...(openclawWorkspace ? ['restart OpenClaw gateway or agent host'] : []),
        ...(config.loaded?.integrations.hermes.enabled ? ['reload Hermes MCP server or restart the Hermes agent host'] : []),
    ];
    const result = {
        command: 'update',
        dryRun: args.dryRun,
        manager,
        installKind: target.kind,
        from: args.from,
        source: 'npm',
        npmPackage: DEFAULT_NPM_PACKAGE,
        packageSpec: resolvedSpec,
        targetCwd: target.cwd,
        currentSpec: target.kind === 'npm_global' ? 'npm:global' : installedSpec(target.cwd),
        nextCommand: command.join(' '),
        updateWarning: target.warning,
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
        if (result.updateWarning)
            console.log(`warning: ${result.updateWarning}`);
        console.log(`current: ${result.currentSpec || 'not listed in package.json'}`);
        console.log(`command: ${result.nextCommand}`);
        if (result.migrationCommand)
            console.log(`migrate: ${result.migrationCommand}`);
        if (result.openclawRepairCommand)
            console.log(`openclaw: ${result.openclawRepairCommand}`);
        console.log(result.followUp);
    }
    if (!args.dryRun) {
        const updateExitCode = await runCommand(command, target.cwd);
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
