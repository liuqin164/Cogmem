#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
        outputPath: stringValue(values.output),
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
            './node_modules/.bin/cogmem-init --agent openclaw',
            './node_modules/.bin/cogmem-doctor',
            './node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run',
            './node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw',
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
        'Usage: cogmem-connect <openclaw|hermes> [--workspace <dir>] [--output <SKILL.md>] [--dry-run] [--force] [--json]',
        '',
        'Installs the agent-facing CognitiveOS-core memory skill file into:',
        '  OpenClaw: <workspace>/skills/cogmem-memory/SKILL.md',
        '  Hermes:   ~/.hermes/skills/cogmem-memory/SKILL.md',
        '',
        'This command does not migrate data and does not modify OpenClaw or Hermes host config.',
    ].join('\n');
}
function hostConfigSnippet(agent, workspaceRoot) {
    if (agent === 'openclaw') {
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
    if (!args.dryRun && !alreadyCurrent) {
        if (existsSync(skillPath) && !args.force) {
            throw new Error(`Skill already exists at ${skillPath}. Re-run with --force to overwrite.`);
        }
        mkdirSync(dirname(skillPath), { recursive: true });
        writeFileSync(skillPath, template, 'utf8');
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
        hostConfigSnippet: hostConfigSnippet(args.agent, args.workspaceRoot),
    };
}
function printHuman(result) {
    console.log(`cogmem ${result.agent} skill ${result.dryRun ? 'dry-run' : result.installed ? 'installed' : 'already current'}`);
    console.log(`workspace: ${result.workspaceRoot}`);
    console.log(`skill: ${result.skillPath}`);
    console.log('');
    console.log('Host config snippet:');
    console.log(result.hostConfigSnippet);
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
