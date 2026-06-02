import { describe, expect, test } from 'bun:test';
import { BENCHMARK_GROUPS } from '../src/benchmark/BenchmarkRegistry.js';
import { ExternalBenchmarkRunner } from '../src/benchmark/ExternalBenchmarkRunner.js';
import { LongMemEvalAdapter, type LongMemEvalBrain } from '../src/benchmark/LongMemEvalAdapter.js';
import { parseLongMemEvalArgs } from '../../../scripts/run-longmemeval.ts';

function mockBrain(answer = 'blue headphones had static noise'): LongMemEvalBrain & { ingested: Array<{ projectId?: string; content: string }> } {
  const ingested: Array<{ projectId?: string; content: string }> = [];
  return {
    ingested,
    async ingest(input: { projectId?: string; content: string }) {
      ingested.push(input);
      return {};
    },
    recall(_query: string, _options?: { projectId?: string }) {
      return {
        query: _query,
        strategy: { primaryLevel: 'raw_evidence' as const, fallbackUsed: false },
        compiledMemory: { beliefs: [], facts: [], events: [], entityTimeline: [] },
        rawEvidence: answer ? [{ id: 'n1', content: answer, prev_hash: '', self_hash: '', coordinates: { T: 0, S: [0, 0, 0], V: [] }, synapses: [], metadata: { type: 'chat', createdAt: 0 } }] : [],
        fallbackSnippets: [],
        profileSignals: [],
        profileSurface: { userProfile: [], agentPersona: [] }
      };
    }
  };
}

async function writeDataset(body: unknown): Promise<string> {
  const path = `/tmp/longmemeval-${crypto.randomUUID()}.json`;
  await Bun.write(path, JSON.stringify(body));
  return path;
}

describe('LongMemEvalAdapter', () => {
  test('runDataset computes accuracy', async () => {
    const path = await writeDataset({ sessions: [{ id: 's1', messages: [], questions: [{ id: 'q1', query: 'issue', expectedAnswer: 'static noise', type: 'single_hop' }] }] });
    const metrics = await new LongMemEvalAdapter(mockBrain()).runDataset(path);
    expect(metrics.totalQuestions).toBe(1);
    expect(metrics.correct).toBe(1);
    expect(metrics.accuracy).toBe(1);
  });

  test('evaluateAnswer uses token F1 overlap', () => {
    const adapter = new LongMemEvalAdapter(mockBrain()) as unknown as { evaluateAnswer: (a: string, b: string) => boolean };
    expect(adapter.evaluateAnswer('blue headphones static noise', 'static noise')).toBe(true);
    expect(adapter.evaluateAnswer('calendar meeting', 'static noise')).toBe(false);
  });

  test('negative expected empty answer is correct only for empty prediction', () => {
    const adapter = new LongMemEvalAdapter(mockBrain()) as unknown as { evaluateAnswer: (a: string, b: string) => boolean };
    expect(adapter.evaluateAnswer('', '')).toBe(true);
    expect(adapter.evaluateAnswer('some answer', '')).toBe(false);
  });

  test('accuracyByType is grouped by question type', async () => {
    const path = await writeDataset({ sessions: [{ id: 's1', messages: [], questions: [
      { id: 'q1', query: 'issue', expectedAnswer: 'static noise', type: 'single_hop' },
      { id: 'q2', query: 'issue', expectedAnswer: 'static noise', type: 'temporal' }
    ] }] });
    const metrics = await new LongMemEvalAdapter(mockBrain()).runDataset(path);
    expect(metrics.accuracyByType.single_hop).toBe(1);
    expect(metrics.accuracyByType.temporal).toBe(1);
  });

  test('session projectId is used for ingestion isolation', async () => {
    const brain = mockBrain();
    const path = await writeDataset({ sessions: [{ id: 's1', projectId: 'bench-a', messages: [{ role: 'user', content: 'hello' }], questions: [] }] });
    await new LongMemEvalAdapter(brain).runDataset(path);
    expect(brain.ingested[0]?.projectId).toBe('bench-a');
  });

  test('missing projectId gets session scoped generated project', async () => {
    const brain = mockBrain();
    const path = await writeDataset({ sessions: [{ id: 's1', messages: [{ role: 'user', content: 'hello' }], questions: [] }] });
    await new LongMemEvalAdapter(brain).runDataset(path);
    expect(brain.ingested[0]?.projectId).toBe('longmemeval-s1');
  });

  test('empty dataset returns zero metrics', async () => {
    const path = await writeDataset({ sessions: [] });
    const metrics = await new LongMemEvalAdapter(mockBrain()).runDataset(path);
    expect(metrics.totalQuestions).toBe(0);
    expect(metrics.correct).toBe(0);
    expect(metrics.accuracy).toBe(0);
  });

  test('avgRecallMs is numeric', async () => {
    const path = await writeDataset({ sessions: [{ id: 's1', messages: [], questions: [{ id: 'q1', query: 'issue', expectedAnswer: 'static noise', type: 'single_hop' }] }] });
    const metrics = await new LongMemEvalAdapter(mockBrain()).runDataset(path);
    expect(metrics.avgRecallMs).toBeGreaterThanOrEqual(0);
  });

  test('multi_hop questions are counted', async () => {
    const path = await writeDataset({ sessions: [{ id: 's1', messages: [], questions: [{ id: 'q1', query: 'issue', expectedAnswer: 'static noise', type: 'multi_hop' }] }] });
    const metrics = await new LongMemEvalAdapter(mockBrain()).runDataset(path);
    expect(metrics.accuracyByType.multi_hop).toBe(1);
  });

  test('temporal questions are counted', async () => {
    const path = await writeDataset({ sessions: [{ id: 's1', messages: [], questions: [{ id: 'q1', query: 'issue', expectedAnswer: 'static noise', type: 'temporal' }] }] });
    const metrics = await new LongMemEvalAdapter(mockBrain()).runDataset(path);
    expect(metrics.accuracyByType.temporal).toBe(1);
  });

  test('BenchmarkRegistry includes longmemeval_accuracy group', () => {
    expect(BENCHMARK_GROUPS.some((group) => group.name === 'longmemeval_accuracy')).toBe(true);
  });

  test('CLI parser reads --dataset', () => {
    expect(parseLongMemEvalArgs(['--dataset', './data/sample.json']).datasetPath).toBe('./data/sample.json');
  });

  test('ExternalBenchmarkRunner returns metrics', async () => {
    const path = await writeDataset({ sessions: [{ id: 's1', messages: [], questions: [{ id: 'q1', query: 'issue', expectedAnswer: 'static noise', type: 'single_hop' }] }] });
    const metrics = await new ExternalBenchmarkRunner(mockBrain(), path).runLongMemEval();
    expect(metrics.correct).toBe(1);
  });
});
