#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installOpenClawAutoMemoryPlugin, } from '../host/openclaw/AutoMemoryPluginInstaller.js';
function readArgs(argv) {
    const values = {};
    const positionals = [];
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--')) {
            positionals.push(item);
            continue;
        }
        const next = argv[index + 1];
        const key = item.slice(2);
        if (!next || next.startsWith('--')) {
            values[key] = true;
            continue;
        }
        values[key] = next;
        index += 1;
    }
    const rawAgent = positionals[0];
    const agent = rawAgent === 'openclaw' || rawAgent === 'hermes' ? rawAgent : undefined;
    return {
        agent,
        workspaceRoot: resolve(stringValue(values.workspace) || '.'),
        configPath: stringValue(values.config),
        openclawConfigPath: stringValue(values['openclaw-config']),
        pluginDir: stringValue(values['plugin-dir']),
        bunPath: stringValue(values.bun),
        projectId: stringValue(values.project),
        agentId: stringValue(values['agent-id']),
        outputPath: stringValue(values.output),
        auto: values.auto === true,
        dryRun: values['dry-run'] === true,
        force: values.force === true,
        json: values.json === true,
        help: values.help === true || values.h === true,
    };
}
function stringValue(value) {
    return typeof value === 'string' ? value : undefined;
}
function packageRoot() {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}
function templatePathFor(agent) {
    return join(packageRoot(), 'examples', `${agent}-backend`, 'SKILL.md');
}
function defaultSkillPath(agent, workspaceRoot) {
    if (agent === 'openclaw') {
        return join(workspaceRoot, 'skills', 'cogmem-memory', 'SKILL.md');
    }
    return join(process.env.HOME || homedir(), '.hermes', 'skills', 'cogmem-memory', 'SKILL.md');
}
function nextCommands(agent) {
    if (agent === 'openclaw') {
        return [
            './node_modules/.bin/cogmem-init --agent openclaw --scope project',
            './node_modules/.bin/cogmem-doctor',
            './node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run',
            './node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw',
            './node_modules/.bin/cogmem-connect openclaw --workspace . --auto --force',
        ];
    }
    return [
        './node_modules/.bin/cogmem-init --agent hermes',
        './node_modules/.bin/cogmem-doctor',
        './node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --dry-run',
        './node_modules/.bin/cogmem-import-hermes --workspace . --project hermes',
    ];
}
function usage() {
    return [
        'Usage: cogmem-connect <openclaw|hermes> [--workspace <dir>] [--output <SKILL.md>] [--auto] [--config <config.toml>] [--openclaw-config <openclaw.json>] [--dry-run] [--force] [--json]',
        '',
        'Installs the agent-facing CognitiveOS-core memory skill file into:',
        '  OpenClaw: <workspace>/skills/cogmem-memory/SKILL.md',
        '  Hermes:   ~/.hermes/skills/cogmem-memory/SKILL.md',
        '',
        'By default this command installs only the agent-facing skill file.',
        'For OpenClaw, pass --auto to install the local automatic recall/remember plugin wrapper and patch OpenClaw plugin config.',
    ].join('\n');
}
function hostConfigSnippet(agent, workspaceRoot, auto) {
    if (agent === 'openclaw') {
        if (auto) {
            return [
                '// cogmem-connect openclaw --auto installs a local OpenClaw plugin wrapper.',
                '// The wrapper registers before_prompt_build for governed recall and agent_end for turn recording.',
                '// It calls KernelAgentMemoryBackend through @CognitiveOS/core public API via a Bun bridge.',
                '// Restart the OpenClaw Gateway after changing plugin code, hook policy, or plugins.load.paths.',
            ].join('\n');
        }
        return [
            '// cogmem-connect does not modify OpenClaw host config.',
            '// It installs a workspace skill at <workspace>/skills/cogmem-memory/SKILL.md.',
            '// Current OpenClaw memory config is owned by OpenClaw, for example memory.backend = "builtin" | "qmd".',
            '// Do not write unknown OpenClaw config fields for CognitiveOS-core.',
            '// Add host config only after installing a real OpenClaw plugin wrapper with a valid manifest/schema.',
        ].join('\n');
    }
    const mcpBin = join(workspaceRoot, 'node_modules', '.bin', 'cogmem-mcp');
    return [
        'mcp_servers:',
        '  cogmem:',
        `    command: "${mcpBin}"`,
        '    args: []',
        '    enabled: true',
        '    tools:',
        '      include:',
        '        - cogmem_remember_turn',
        '        - cogmem_recall',
        '        - cogmem_explain_recall',
    ].join('\n');
}
function installSkill(args) {
    if (!args.agent)
        throw new Error(usage());
    const templatePath = templatePathFor(args.agent);
    if (!existsSync(templatePath)) {
        throw new Error(`Missing packaged skill template: ${templatePath}`);
    }
    const template = readFileSync(templatePath, 'utf8');
    const skillPath = resolve(args.outputPath || defaultSkillPath(args.agent, args.workspaceRoot));
    const alreadyCurrent = existsSync(skillPath) && readFileSync(skillPath, 'utf8') === template;
    let autoMemory;
    if (!args.dryRun && !alreadyCurrent) {
        if (existsSync(skillPath) && !args.force) {
            throw new Error(`Skill already exists at ${skillPath}. Re-run with --force to overwrite.`);
        }
        mkdirSync(dirname(skillPath), { recursive: true });
        writeFileSync(skillPath, template, 'utf8');
    }
    if (args.agent === 'openclaw' && args.auto) {
        autoMemory = installOpenClawAutoMemoryPlugin({
            workspaceRoot: args.workspaceRoot,
            configPath: args.configPath,
            openclawConfigPath: args.openclawConfigPath,
            pluginDir: args.pluginDir,
            bunPath: args.bunPath,
            projectId: args.projectId,
            agentId: args.agentId,
            dryRun: args.dryRun,
            force: args.force,
        });
    }
    else if (args.auto && args.agent !== 'openclaw') {
        throw new Error('--auto is currently supported only for OpenClaw.');
    }
    return {
        agent: args.agent,
        workspaceRoot: args.workspaceRoot,
        skillPath,
        templatePath,
        dryRun: args.dryRun,
        installed: !args.dryRun && !alreadyCurrent,
        alreadyCurrent,
        nextCommands: nextCommands(args.agent),
        hostConfigSnippet: hostConfigSnippet(args.agent, args.workspaceRoot, args.auto),
        autoMemory,
    };
}
function printHuman(result) {
    console.log(`cogmem ${result.agent} skill ${result.dryRun ? 'dry-run' : result.installed ? 'installed' : 'already current'}`);
    console.log(`workspace: ${result.workspaceRoot}`);
    console.log(`skill: ${result.skillPath}`);
    console.log('');
    console.log('Host config snippet:');
    console.log(result.hostConfigSnippet);
    if (result.autoMemory) {
        console.log('');
        console.log('OpenClaw automatic memory plugin:');
        console.log(`  plugin: ${result.autoMemory.pluginDir}`);
        console.log(`  config: ${result.autoMemory.openclawConfigPath}`);
        console.log(`  hooks: ${result.autoMemory.hookNames.join(', ')}`);
        if (result.autoMemory.backupPath)
            console.log(`  backup: ${result.autoMemory.backupPath}`);
    }
    console.log('');
    console.log('Next commands:');
    for (const command of result.nextCommands) {
        console.log(`  ${command}`);
    }
    console.log('');
    console.log('Then let the agent read the installed SKILL.md before changing runtime wiring.');
}
async function main() {
    const args = readArgs(process.argv.slice(2));
    if (args.help) {
        console.log(usage());
        return;
    }
    const result = installSkill(args);
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    printHuman(result);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
