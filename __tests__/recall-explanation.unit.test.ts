import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { explainRecallWithKernel } from '../src/recall/RecallExplanation.js';

test('agent recall explanation includes activation reasons and filtered evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recall-explanation-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });

  await kernel.ingest({
    content: 'Bluetooth protocol project for OpenClaw used a GATT configuration service.',
    projectId: 'shared-project',
    tags: ['agent:openclaw'],
  });
  await kernel.ingest({
    content: 'Bluetooth protocol project for Hermes used a pairing note.',
    projectId: 'shared-project',
    tags: ['agent:hermes'],
  });

  const explanation = explainRecallWithKernel(kernel, {
    query: 'Bluetooth protocol project',
    projectId: 'shared-project',
    agentId: 'openclaw',
    limit: 1,
  });

  expect(explanation.evidence).toHaveLength(1);
  expect(explanation.evidence[0]?.text).toContain('GATT configuration service');
  expect(explanation.evidence[0]?.source).toMatch(/^evt-/);
  expect(explanation.evidence[0]?.activationPath?.length).toBeGreaterThan(0);
  expect(explanation.evidence[0]?.whyMatched).toContain('agent_scope:openclaw');

  expect(explanation.filteredEvidence?.some((item) => (
    item.reason === 'agent_scope_mismatch'
    && item.text?.includes('Hermes used a pairing note')
  ))).toBe(true);

  kernel.close();
});

test('kernel recall explanation reports over-budget evidence without leaking other projects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recall-explanation-budget-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });

  await kernel.ingest({
    content: 'Atlas release memory backend should use sqlite-vec for durable vectors.',
    projectId: 'project-a',
    tags: ['release'],
  });
  await kernel.ingest({
    content: 'Atlas release migration should run dry-run before importing memory.',
    projectId: 'project-a',
    tags: ['release'],
  });
  await kernel.ingest({
    content: 'Atlas release secret from project B must not appear in project A explanation.',
    projectId: 'project-b',
    tags: ['release'],
  });

  const explanation = explainRecallWithKernel(kernel, {
    query: 'Atlas release memory',
    projectId: 'project-a',
    limit: 1,
  });

  expect(explanation.evidence).toHaveLength(1);
  expect(explanation.filteredEvidence?.some((item) => (
    item.reason === 'over_context_limit'
    && item.projectId === 'project-a'
    && item.source?.startsWith('evt-')
  ))).toBe(true);
  expect(JSON.stringify(explanation.filteredEvidence)).not.toContain('project B');

  kernel.close();
});

test('kernel recall explanation reports status-suppressed evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recall-explanation-status-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });

  await kernel.ingest({
    content: 'Release governance active evidence may enter context.',
    projectId: 'project-a',
    tags: ['release'],
  });
  const archived = await kernel.ingest({
    content: 'Release governance archived stale evidence must be filtered from context.',
    projectId: 'project-a',
    tags: ['release'],
  });
  const suspect = await kernel.ingest({
    content: 'Release governance suspect disputed evidence must be filtered from context.',
    projectId: 'project-a',
    tags: ['release'],
  });

  kernel.memoryGraph.updateNeuronStatus(archived.id, 'archived');
  kernel.memoryGraph.updateNeuronMetadata(suspect.id, { status: 'suspect' });

  const explanation = explainRecallWithKernel(kernel, {
    query: 'release governance evidence',
    projectId: 'project-a',
    limit: 3,
  });

  expect(explanation.evidence.some((item) => item.id === archived.id)).toBe(false);
  expect(explanation.evidence.some((item) => item.id === suspect.id)).toBe(false);
  expect(explanation.filteredEvidence?.some((item) => (
    item.reason === 'status_suppressed'
    && item.governanceReason === 'archived'
    && item.id === archived.id
    && item.text?.includes('archived stale evidence')
  ))).toBe(true);
  expect(explanation.filteredEvidence?.some((item) => (
    item.reason === 'status_suppressed'
    && item.governanceReason === 'suspect_unverified_claim'
    && item.id === suspect.id
    && item.text?.includes('suspect disputed evidence')
  ))).toBe(true);

  kernel.close();
});

test('kernel recall explanation identifies suspect raw user utterances allowed as provenance evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recall-explanation-raw-user-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });

  const userRaw = await kernel.ingest({
    content: 'Bluetooth protocol project used BLE device provisioning.',
    projectId: 'project-a',
    sourceType: 'user_input',
    tags: [
      'reliability:raw_utterance',
      'role:user',
      'record:raw_utterance',
    ],
  });
  const agentRaw = await kernel.ingest({
    content: 'Agent inferred Bluetooth provisioning was already complete.',
    projectId: 'project-a',
    sourceType: 'llm_inference',
    tags: [
      'reliability:raw_utterance',
      'role:agent',
      'record:raw_utterance',
    ],
  });

  kernel.memoryGraph.updateNeuronMetadata(userRaw.id, { status: 'suspect' });
  kernel.memoryGraph.updateNeuronMetadata(agentRaw.id, { status: 'suspect' });

  const explanation = explainRecallWithKernel(kernel, {
    query: 'Bluetooth provisioning project',
    projectId: 'project-a',
    limit: 5,
  });

  const rawEvidence = explanation.evidence.find((item) => item.id === userRaw.id);
  expect(rawEvidence).toBeDefined();
  expect(rawEvidence?.whyMatched).toContain('provenance:raw_user_utterance');
  expect(rawEvidence?.whyMatched).toContain('governance:allowed_suspect_raw_evidence');

  expect(explanation.evidence.some((item) => item.id === agentRaw.id)).toBe(false);
  expect(explanation.filteredEvidence?.some((item) => (
    item.id === agentRaw.id
    && item.reason === 'status_suppressed'
    && item.governanceReason === 'suspect_llm_inference'
  ))).toBe(true);

  kernel.close();
});

test('agent explanation uses the same raw-ledger route and evidence ids as agent recall', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recall-explanation-agent-parity-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  kernel.recordRawEvent({
    projectId: 'project-a',
    threadId: 'thread-black-box',
    sessionId: 'historical-session',
    role: 'user',
    content: '你能看到记忆内核中的记忆吗，还是说它是黑盒？',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'project-a',
    query: '记忆黑盒问题',
    limit: 3,
  });
  const explanation = explainRecallWithKernel(kernel, {
    query: '记忆黑盒问题',
    projectId: 'project-a',
    agentId: 'openclaw',
    limit: 3,
  });

  expect(explanation.recallMode).toBe(recalled.recallMode);
  expect(explanation.decisionTrace).toEqual(recalled.decisionTrace);
  expect(explanation.evidence.map((item) => item.id)).toEqual(recalled.items.map((item) => item.id));
  expect(explanation.evidence[0]?.sourceAnchor?.eventId).toBe(recalled.items[0]?.sourceAnchor?.eventId);

  kernel.close();
});
