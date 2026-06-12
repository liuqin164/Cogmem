import { MemoryKernel } from '../factory.js';
import { ExternalBenchmarkRunner } from './ExternalBenchmarkRunner.js';

export interface LongMemEvalCliArgs {
  datasetPath: string;
}

export function parseLongMemEvalArgs(argv: string[]): LongMemEvalCliArgs {
  const datasetIndex = argv.indexOf('--dataset');
  const datasetPath = datasetIndex >= 0 ? argv[datasetIndex + 1] : undefined;
  if (!datasetPath) {
    throw new Error('Usage: run-longmemeval --dataset <path>');
  }
  return { datasetPath };
}

export async function runLongMemEvalCli(argv: string[] = Bun.argv.slice(2)): Promise<string> {
  const { datasetPath } = parseLongMemEvalArgs(argv);
  const brain = new MemoryKernel();
  await brain.initialize();
  const metrics = await new ExternalBenchmarkRunner(brain, datasetPath).runLongMemEval();
  const temporal = metrics.accuracyByType.temporal ?? 0;

  return [
    'LongMemEval Results',
    '---------------------------------------',
    `Total questions : ${metrics.totalQuestions}`,
    `Correct         : ${metrics.correct}`,
    `Overall accuracy: ${(metrics.accuracy * 100).toFixed(1)}% ${metrics.accuracy >= 0.4 ? 'pass' : 'fail'}  (baseline >= 40%)`,
    `Temporal        : ${(temporal * 100).toFixed(1)}% ${temporal >= 0.3 ? 'pass' : 'fail'}  (baseline >= 30%)`,
    `Avg recall ms   : ${Math.round(metrics.avgRecallMs)}ms`,
  ].join('\n');
}
