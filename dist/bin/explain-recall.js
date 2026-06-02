#!/usr/bin/env bun
import { resolve } from 'node:path';
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
import { explainRecallWithKernel } from '../recall/RecallExplanation.js';
function readArgs(argv) {
    const values = {};
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
        values[key] = next;
        index += 1;
    }
    return {
        query: stringArg(values, 'query'),
        projectId: stringArg(values, 'project') || stringArg(values, 'project-id'),
        agentId: stringArg(values, 'agent') || stringArg(values, 'agent-id'),
        limit: numberArg(values, 'limit'),
        startTime: timeArg(values, 'since'),
        endTime: timeArg(values, 'until'),
        dbPath: stringArg(values, 'db'),
        configPath: stringArg(values, 'config'),
        json: values.json === true,
        help: values.help === true || values.h === true,
    };
}
function stringArg(values, key) {
    const value = values[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function numberArg(values, key) {
    const raw = stringArg(values, key);
    if (!raw)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
        throw new Error(`--${key} must be a positive number`);
    return parsed;
}
function timeArg(values, key) {
    const raw = stringArg(values, key);
    if (!raw)
        return undefined;
    if (/^\d+$/.test(raw))
        return Number(raw);
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed))
        throw new Error(`--${key} must be a timestamp or parseable date`);
    return parsed;
}
function usage() {
    return [
        'Usage: cogmem-explain-recall --query <text> [--project <id>] [--agent <id>] [--limit <n>] [--db <memory.db>|--config <config.toml>] [--json]',
        '',
        'Explains the memory kernel recall path: narrative, pulse trace, temporal traversal, runtime path, evidence, and filteredEvidence.',
        'filteredEvidence keeps suppressed same-project candidates with reason and optional governanceReason such as archived, suspect_llm_inference, suspect_external_tool_observation, or suspect_unverified_claim.',
    ].join('\n');
}
function openKernel(args) {
    if (args.dbPath)
        return createMemoryKernel({ dbPath: resolve(args.dbPath) });
    return createMemoryKernelFromConfig({
        configPath: args.configPath ? resolve(args.configPath) : undefined,
        cwd: process.cwd(),
    });
}
function printHuman(explanation) {
    console.log(`query: ${explanation.query}`);
    if (explanation.projectId)
        console.log(`project: ${explanation.projectId}`);
    if (explanation.agentId)
        console.log(`agent: ${explanation.agentId}`);
    console.log(`mode: ${explanation.recallMode}`);
    console.log(`fallback: ${explanation.fallbackUsed}`);
    if (explanation.narrative?.headline)
        console.log(`headline: ${explanation.narrative.headline}`);
    if (explanation.temporalTraversal?.labels.length) {
        console.log(`temporal: ${explanation.temporalTraversal.labels.join(', ')}`);
    }
    console.log('evidence:');
    for (const item of explanation.evidence) {
        console.log(`- ${item.id}: ${item.text}`);
    }
    if (explanation.filteredEvidence?.length) {
        console.log('filteredEvidence:');
        for (const item of explanation.filteredEvidence) {
            const governance = item.governanceReason ? ` governanceReason=${item.governanceReason}` : '';
            console.log(`- ${item.id}: reason=${item.reason}${governance}`);
        }
    }
}
async function main() {
    const args = readArgs(process.argv.slice(2));
    if (args.help) {
        console.log(usage());
        return;
    }
    if (!args.query)
        throw new Error(`Missing --query.\n${usage()}`);
    const kernel = openKernel(args);
    try {
        const explanation = explainRecallWithKernel(kernel, {
            query: args.query,
            projectId: args.projectId,
            agentId: args.agentId,
            limit: args.limit,
            startTime: args.startTime,
            endTime: args.endTime,
        });
        if (args.json) {
            console.log(JSON.stringify(explanation, null, 2));
            return;
        }
        printHuman(explanation);
    }
    finally {
        kernel.close();
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
