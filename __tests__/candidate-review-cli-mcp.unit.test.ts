import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool, listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';

const memoryBin = join(import.meta.dir, '..', 'src', 'bin', 'memory.ts');

function seed(dbPath: string, candidateId: string): void {
  const kernel = createMemoryKernel({ dbPath });
  try {
    kernel.eventStore.append({ eventId: `evt-${candidateId}`, streamId: candidateId, streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message', projectId: 'cogmem', role: 'user', payload: { text: '确认候选。' } });
    const store = new DeepWriteCandidateStore(kernel.factStore.getDatabase());
    store.insertRun({ runId: `run-${candidateId}`, projectId: 'cogmem', sourceNeuronIds: [`evt-${candidateId}`], mode: 'episode', promptHash: 'p', outputHash: 'o', status: 'succeeded' });
    store.insertCandidates([{ candidateId, runId: `run-${candidateId}`, candidateType: 'semantic_tags', status: 'needs_confirmation', confidence: 0.8, content: { topicPath: 'cogmem/review' }, evidence: [{ eventId: `evt-${candidateId}`, role: 'user' }] }]);
  } finally { kernel.close(); }
}

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ['bun', memoryBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { exitCode, stdout, stderr };
}

test('memory review approves a needs-confirmation candidate with an audited JSON receipt', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-review-cli-')), 'memory.db');
  seed(dbPath, 'cand-cli');
  const result = await run([
    'review', '--db', dbPath, '--project', 'cogmem', '--id', 'cand-cli', '--action', 'approve',
    '--actor', 'operator', '--reason', 'checked source', '--confirmation-event', 'evt-cand-cli', '--json',
  ]);
  expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: '' });
  const payload = JSON.parse(result.stdout) as Record<string, any>;
  expect(payload.command).toBe('memory.review');
  expect(payload.reviewedCandidate.status).toBe('promoted');
  expect(payload.review.action).toBe('approve');
});

test('govern status is enforced and points needs-confirmation users to review', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-review-govern-')), 'memory.db');
  seed(dbPath, 'cand-govern');
  const result = await run(['govern', '--db', dbPath, '--project', 'cogmem', '--status', 'needs_confirmation', '--json']);
  expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: '' });
  const payload = JSON.parse(result.stdout) as Record<string, any>;
  expect(payload.command).toBe('memory.govern');
  expect(payload.status).toBe('needs_confirmation');
  expect(payload.total).toBe(1);
  expect(payload.candidates[0].candidateId).toBe('cand-govern');
  expect(payload.decisions).toEqual([]);
  expect(payload.warning).toContain('memory review');
  expect(payload.reviewCommand).toContain('--action <approve|reject|defer|supersede|relink>');
});

test('MCP exposes and executes candidate review with explicit confirmation evidence', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-review-mcp-')), 'memory.db');
  seed(dbPath, 'cand-mcp');
  const tool = listCogmemMcpTools().find((item) => item.name === 'cogmem_candidate_review');
  expect(tool?.annotations?.readOnlyHint).toBe(false);
  expect(tool?.annotations?.destructiveHint).toBe(true);
  const result = await callCogmemMcpTool('cogmem_candidate_review', {
    candidateId: 'cand-mcp', projectId: 'cogmem', action: 'approve', actor: 'operator',
    reason: 'checked source', confirmationEventId: 'evt-cand-mcp',
  }, { dbPath });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toEqual(expect.objectContaining({
    candidate: expect.objectContaining({ status: 'promoted' }),
    review: expect.objectContaining({ action: 'approve' }),
  }));
});
