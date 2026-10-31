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

