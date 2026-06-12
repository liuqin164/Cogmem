import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EvalRunner, type EvalSuiteResult } from '../src/eval/runners/EvalRunner.ts';
import { ReportFormatter } from '../src/eval/runners/ReportFormatter.ts';

let results: EvalSuiteResult[] = [];
const formatter = new ReportFormatter();
const reportRoot = `/tmp/agent-brain-eval-report-${Date.now()}-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  results = await new EvalRunner().runAll();
});

afterAll(() => {
  if (existsSync(reportRoot)) rmSync(reportRoot, { recursive: true, force: true });
});

describe('EvalRunner', () => {
  it('runAll returns all registered suite results', () => {
    expect(results).toHaveLength(8);
  });

  it('runAll returns the expected suite names', () => {
    expect(results.map((item) => item.suiteName)).toEqual([
      'memory_recall',
      'context_pack',
      'long_horizon',
      'surface_latency',
      'notification_delivery',
      'session_continuity',
      'tool_use_quality',
      'longmemeval'
    ]);
  });

  it('runSuite(memory_recall) returns the correct suiteName', async () => {
    const result = await new EvalRunner().runSuite('memory_recall');
    expect(result.suiteName).toBe('memory_recall');
  });

  it('runSuite(context_pack) returns the correct suiteName', async () => {
    const result = await new EvalRunner().runSuite('context_pack');
    expect(result.suiteName).toBe('context_pack');
  });

  it('runSuite(long_horizon) returns the correct suiteName', async () => {
    const result = await new EvalRunner().runSuite('long_horizon');
    expect(result.suiteName).toBe('long_horizon');
  });

  it('memory_recall passed reflects stale leakage acceptance criteria', () => {
    const result = results.find((item) => item.suiteName === 'memory_recall')!;
    expect(result.passed).toBe(result.metrics.brain_vs_dump_stale_leakage_ratio < 0.5);
  });

  it('context_pack passed reflects token ratio and coverage acceptance criteria', () => {
    const result = results.find((item) => item.suiteName === 'context_pack')!;
    expect(result.passed).toBe(result.metrics.brain_vs_dump_token_ratio < 0.3 && result.metrics.necessary_memory_coverage > 0.9);
  });

  it('long_horizon passed reflects resume-rate acceptance criteria', () => {
    const result = results.find((item) => item.suiteName === 'long_horizon')!;
    expect(result.passed).toBe(result.metrics.resume_success_rate_200_turns > 0.8);
  });
});

describe('ReportFormatter', () => {
  it('formatJson emits parseable json with all registered results', () => {
    const json = formatter.formatJson(results);
    const parsed = JSON.parse(json) as { results: EvalSuiteResult[] };
    expect(parsed.results).toHaveLength(8);
  });

  it('formatJson preserves suite names', () => {
    const json = formatter.formatJson(results);
    expect(json.includes('"suiteName": "memory_recall"')).toBe(true);
    expect(json.includes('"suiteName": "context_pack"')).toBe(true);
    expect(json.includes('"suiteName": "long_horizon"')).toBe(true);
    expect(json.includes('"suiteName": "surface_latency"')).toBe(true);
    expect(json.includes('"suiteName": "notification_delivery"')).toBe(true);
    expect(json.includes('"suiteName": "session_continuity"')).toBe(true);
    expect(json.includes('"suiteName": "tool_use_quality"')).toBe(true);
    expect(json.includes('"suiteName": "longmemeval"')).toBe(true);
  });

  it('formatMarkdown emits a PR-friendly table', () => {
    const markdown = formatter.formatMarkdown(results);
    expect(markdown.includes('| Suite | Passed | Key metrics |')).toBe(true);
  });

  it('formatMarkdown includes acceptance summary lines', () => {
    const markdown = formatter.formatMarkdown(results);
    expect(markdown.includes('BrainRecall stale leakage')).toBe(true);
    expect(markdown.includes('ContextPack token ratio')).toBe(true);
    expect(markdown.includes('Long-horizon 200-turn resume success')).toBe(true);
  });

  it('writeReports writes report.json and report.md', () => {
    const written = formatter.writeReports(results, reportRoot);
    expect(existsSync(written.jsonPath)).toBe(true);
    expect(existsSync(written.markdownPath)).toBe(true);
  });

  it('writeReports creates latest as a symlink', () => {
    const written = formatter.writeReports(results, reportRoot);
    expect(lstatSync(written.latestPath).isSymbolicLink()).toBe(true);
  });

  it('writeReports stores markdown content on disk', () => {
    const written = formatter.writeReports(results, reportRoot);
    expect(readFileSync(written.markdownPath, 'utf8').includes('# Eval Report')).toBe(true);
  });

  it('writeReports stores json content on disk', () => {
    const written = formatter.writeReports(results, reportRoot);
    const jsonPath = join(written.directory, 'report.json');
    expect(readFileSync(jsonPath, 'utf8').includes('"results"')).toBe(true);
  });
});
