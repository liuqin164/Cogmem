#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { BrainEvalRunner, type BrainEvalSample } from '../benchmark/BrainEval.js';
import { StrategyRolloutEvaluator, type StrategyRolloutOutcome } from '../eval/strategy/index.js';

function usage(): string {
  return [
    'Usage: cogmem brain-eval --input <samples.json> [--json]',
    '       cogmem brain-eval --input <outcomes.json> --strategy-rollout [--json]',
    'Normal input is BrainEvalSample[] or { "samples": BrainEvalSample[] }.',
    'Strategy input is precomputed StrategyRolloutOutcome[] or { "outcomes": StrategyRolloutOutcome[] }; no online rollouts are generated.',
  ].join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  const index = argv.indexOf('--input');
  const inputPath = index >= 0 ? argv[index + 1] : undefined;
  if (!inputPath) throw new Error(usage());
  const parsed = JSON.parse(readFileSync(inputPath, 'utf8')) as
    | BrainEvalSample[]
    | { samples: BrainEvalSample[] }
    | StrategyRolloutOutcome[]
    | { outcomes: StrategyRolloutOutcome[] };
  if (argv.includes('--strategy-rollout')) {
    const outcomes = Array.isArray(parsed) ? parsed as StrategyRolloutOutcome[] : 'outcomes' in parsed ? parsed.outcomes : undefined;
    if (!Array.isArray(outcomes)) throw new Error('Strategy rollout input must contain an outcomes array.');
    const report = new StrategyRolloutEvaluator().evaluate(outcomes);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
    return;
  }
  const samples = Array.isArray(parsed) ? parsed as BrainEvalSample[] : 'samples' in parsed ? parsed.samples : undefined;
  if (!Array.isArray(samples)) throw new Error('BrainEval input must contain a samples array.');
  const report = new BrainEvalRunner().evaluate(samples);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
