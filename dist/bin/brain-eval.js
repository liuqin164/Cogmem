#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { BrainEvalRunner } from '../benchmark/BrainEval.js';
function usage() {
    return 'Usage: cogmem brain-eval --input <samples.json> [--json]\nInput is BrainEvalSample[] or { "samples": BrainEvalSample[] }.';
}
async function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(usage());
        return;
    }
    const index = argv.indexOf('--input');
    const inputPath = index >= 0 ? argv[index + 1] : undefined;
    if (!inputPath)
        throw new Error(usage());
    const parsed = JSON.parse(readFileSync(inputPath, 'utf8'));
    const samples = Array.isArray(parsed) ? parsed : parsed.samples;
    if (!Array.isArray(samples))
        throw new Error('BrainEval input must contain a samples array.');
    const report = new BrainEvalRunner().evaluate(samples);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed)
        process.exitCode = 1;
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
