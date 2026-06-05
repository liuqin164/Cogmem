#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
        from: typeof values.from === 'string' ? values.from : 'github:liuqin164/CognitiveOS-core#main',
        manager,
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
        return ['bun', 'add', `@CognitiveOS/core@${spec}`];
    if (manager === 'pnpm')
        return ['pnpm', 'add', `@CognitiveOS/core@${spec}`];
    return ['npm', 'install', `@CognitiveOS/core@${spec}`];
}
function installedSpec(cwd) {
    const packagePath = join(cwd, 'package.json');
    if (!existsSync(packagePath))
        return undefined;
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    return manifest.dependencies?.['@CognitiveOS/core']
        || manifest.devDependencies?.['@CognitiveOS/core']
        || manifest.optionalDependencies?.['@CognitiveOS/core'];
}
async function main() {
    const args = readArgs(process.argv.slice(2));
    const manager = args.manager || detectManager(process.cwd());
    const command = buildCommand(manager, args.from);
    const result = {
        command: 'update',
        dryRun: args.dryRun,
        manager,
        from: args.from,
        currentSpec: installedSpec(process.cwd()),
        nextCommand: command.join(' '),
        followUp: 'Run cogmem doctor --fix --agent openclaw --workspace <openclaw-workspace> after updating if OpenClaw auto memory is configured.',
    };
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        console.log(`cogmem update ${args.dryRun ? 'dry-run' : 'running'}`);
        console.log(`current: ${result.currentSpec || 'not listed in package.json'}`);
        console.log(`command: ${result.nextCommand}`);
        console.log(result.followUp);
    }
    if (!args.dryRun) {
        const proc = Bun.spawn({
            cmd: command,
            cwd: process.cwd(),
            stdout: 'inherit',
            stderr: 'inherit',
        });
        process.exit(await proc.exited);
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
