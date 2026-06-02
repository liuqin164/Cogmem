import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/index.js';
import { createMemoryKernel } from '../src/factory.js';
import { explainRecallWithKernel } from '../src/recall/RecallExplanation.js';

function leakageRate(suppressedIds: string[], rawIds: Set<string>): number {
  if (suppressedIds.length === 0) return 0;
  return suppressedIds.filter((id) => rawIds.has(id)).length / suppressedIds.length;
}

test('recall governance hardening metrics stay within fixed leakage thresholds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recall-governance-hardening-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const query = 'governance hardening sentinel';

  const active = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel active memory remains recallable.',
    tags: ['agent:openclaw', 'hardening'],
  });
  const cold = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel cold memory remains recallable when relevant.',
    tags: ['agent:openclaw', 'hardening'],
  });
  const pinned = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel important pinned memory remains recallable.',
    tags: ['agent:openclaw', 'hardening'],
    importanceLevel: 'important',
    isPinned: true,
  });
  const rawUser = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel raw user utterance is preserved as provenance evidence.',
    sourceType: 'user_input',
    tags: ['reliability:raw_utterance', 'role:user', 'record:raw_utterance'],
  });
  const staleArchived = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel stale archived memory must not enter context.',
    tags: ['hardening'],
  });
  const supersededArchived = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel superseded fact must not enter context.',
    tags: ['hardening', 'fact:superseded'],
  });
  const suspectLlm = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel suspect LLM inference must not enter context.',
    sourceType: 'llm_inference',
    tags: ['hardening'],
  });
  const suspectTool = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel suspect tool observation must not enter context.',
    sourceType: 'external_tool',
    tags: ['hardening'],
  });
  const suspectClaim = await kernel.ingest({
    projectId: 'project-a',
    content: 'Governance hardening sentinel suspect unverified claim must not enter context.',
    tags: ['hardening'],
  });
  const otherProject = await kernel.ingest({
    projectId: 'project-b',
    content: 'Governance hardening sentinel project B secret filtered evidence must not leak.',
    tags: ['hardening'],
  });

  kernel.memoryGraph.updateNeuronStatus(cold.id, 'cold');
  kernel.memoryGraph.updateNeuronStatus(staleArchived.id, 'archived');
  kernel.memoryGraph.updateNeuronStatus(supersededArchived.id, 'archived');
  kernel.memoryGraph.updateNeuronMetadata(rawUser.id, { status: 'suspect' });
  kernel.memoryGraph.updateNeuronMetadata(suspectLlm.id, { status: 'suspect' });
  kernel.memoryGraph.updateNeuronMetadata(suspectTool.id, { status: 'suspect' });
  kernel.memoryGraph.updateNeuronMetadata(suspectClaim.id, { status: 'suspect' });
  kernel.memoryGraph.updateNeuronStatus(otherProject.id, 'archived');

  const navigated = kernel.navigateMemory(query, { projectId: 'project-a', limit: 20 });
  const brainRecall = kernel.recall(query, { projectId: 'project-a', limit: 20, includeRawEvidence: true });
  const agentRecall = new KernelAgentMemoryBackend(kernel).recall({
    agentId: 'openclaw',
    projectId: 'project-a',
    query,
    limit: 20,
  });
  const explanation = explainRecallWithKernel(kernel, { query, projectId: 'project-a', limit: 1 });

  const rawIds = new Set([
    ...navigated.rawEvidence.map((item) => item.id),
    ...brainRecall.rawEvidence.map((item) => item.id),
    ...agentRecall.items.map((item) => item.id),
  ]);
  const filtered = explanation.filteredEvidence || [];
  const statusFiltered = filtered.filter((item) => item.reason === 'status_suppressed');

  const metrics = {
    stale_memory_leakage_rate: leakageRate([staleArchived.id], rawIds),
    superseded_fact_leakage_rate: leakageRate([supersededArchived.id], rawIds),
    suspect_llm_inference_leakage_rate: leakageRate([suspectLlm.id], rawIds),
    suspect_tool_observation_leakage_rate: leakageRate([suspectTool.id], rawIds),
    suspect_unverified_claim_leakage_rate: leakageRate([suspectClaim.id], rawIds),
    raw_user_evidence_preservation_rate: rawIds.has(rawUser.id) ? 1 : 0,
    filtered_evidence_explainability_rate: statusFiltered.every((item) => item.governanceReason) ? 1 : 0,
    cross_project_filtered_evidence_leakage_rate: filtered.some((item) => item.projectId === 'project-b') ? 1 : 0,
  };

  expect(rawIds).toContain(active.id);
  expect(rawIds).toContain(cold.id);
  expect(rawIds).toContain(pinned.id);
  expect(metrics.stale_memory_leakage_rate).toBe(0);
  expect(metrics.superseded_fact_leakage_rate).toBe(0);
  expect(metrics.suspect_llm_inference_leakage_rate).toBe(0);
  expect(metrics.suspect_tool_observation_leakage_rate).toBe(0);
  expect(metrics.suspect_unverified_claim_leakage_rate).toBe(0);
  expect(metrics.raw_user_evidence_preservation_rate).toBe(1);
  expect(metrics.filtered_evidence_explainability_rate).toBe(1);
  expect(metrics.cross_project_filtered_evidence_leakage_rate).toBe(0);
  expect(filtered.some((item) => item.reason === 'over_context_limit' && item.projectId === 'project-a')).toBe(true);
  expect(statusFiltered.map((item) => item.governanceReason)).toContain('archived');
  expect(statusFiltered.map((item) => item.governanceReason)).toContain('suspect_llm_inference');
  expect(statusFiltered.map((item) => item.governanceReason)).toContain('suspect_external_tool_observation');
  expect(statusFiltered.map((item) => item.governanceReason)).toContain('suspect_unverified_claim');

  kernel.close();
});
