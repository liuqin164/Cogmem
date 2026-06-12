import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';

test('dream ledger reports undreamed raw backlog for raw-then-dream turns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-dream-ledger-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-dream',
    userText: 'Raw then dream should not silently pile up.',
    assistantText: 'Stored raw for later consolidation.',
    ingestMode: 'raw_then_dream',
  });

  const status = kernel.getDreamBacklogStatus('demo');
  expect(status.projectId).toBe('demo');
  expect(status.rawEventCount).toBe(2);
  expect(status.undreamedRawCount).toBe(2);
  expect(status.dreamCoverageRate).toBe(0);
  expect(status.lastDreamedGlobalSeq).toBeUndefined();

  kernel.close();
});

test('dream ledger markDreamed advances coverage without deleting raw events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-dream-ledger-mark-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-dream',
    userText: 'Dream coverage should advance after consolidation.',
    assistantText: 'Stored raw for later consolidation.',
    ingestMode: 'raw_then_dream',
  });
  const latestSeq = Math.max(...kernel.getThreadEvents('session-dream').map((event) => event.globalSeq || 0));

  kernel.markDreamed('demo', latestSeq);
  const status = kernel.getDreamBacklogStatus('demo');

  expect(status.rawEventCount).toBe(2);
  expect(status.undreamedRawCount).toBe(0);
  expect(status.dreamCoverageRate).toBe(1);
  expect(status.lastDreamedGlobalSeq).toBe(latestSeq);
  expect(kernel.getThreadEvents('session-dream')).toHaveLength(2);

  kernel.close();
});

test('dream curator compiles raw backlog into governed candidates without hot vectors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-dream-curator-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-dream',
    userText: '请以后始终记住：记忆内核不是 Obsidian 替代品，也不要把它做成 wiki。',
    assistantText: '明白，我会把它作为 agent-native memory kernel 的边界约束处理。',
    ingestMode: 'raw_then_dream',
  });
  const vectorCountBefore = kernel.vectorStore.getCurrentCount();

  const result = await kernel.runDreamCurator({ projectId: 'demo', limit: 10 });
  const candidates = kernel.listDreamCandidates({ statuses: ['candidate'], limit: 20 });
  const candidateTypes = candidates.map((candidate) => candidate.candidateType);

  expect(result.skipped).toBe(false);
  expect(result.processedEventCount).toBe(2);
  expect(result.candidateCount).toBeGreaterThanOrEqual(2);
  expect(candidateTypes).toContain('summary');
  expect(candidateTypes).toContain('preferences');
  expect(kernel.vectorStore.getCurrentCount()).toBe(vectorCountBefore);
  expect(kernel.getDreamBacklogStatus('demo').undreamedRawCount).toBe(0);
  expect(candidates.every((candidate) => candidate.status === 'candidate')).toBe(true);
  expect(JSON.stringify(candidates)).toContain('"eventId"');
  expect(JSON.stringify(candidates)).toContain('"sourceAnchor"');

  kernel.close();
});

test('dream curator can use explicit memory-model generation to create governance candidates only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-dream-curator-llm-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-dream-llm',
    userText: '我们的对话存档位置属于黑盒吧，我作为用户无法看到，对吗？',
    assistantText: '你指出的是记忆可审计性问题，我会区分注入摘要和 raw ledger source。',
    ingestMode: 'raw_then_dream',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-dream-llm',
    userText: '禁止把导入摘要当成用户原话，必须能回到 raw ledger。',
    assistantText: '我会把它作为边界候选，等待治理层确认。',
    ingestMode: 'raw_then_dream',
  });
  const vectorCountBefore = kernel.vectorStore.getCurrentCount();

  const result = await kernel.runDreamCurator({
    projectId: 'demo',
    limit: 20,
    generateText: async () => JSON.stringify({
      userPreferenceCandidates: [
        {
          statement: '用户希望记忆系统不是黑盒，并能定位到原始对话。',
          confidence: 0.78,
          evidenceEventIds: ['all'],
          tags: ['memory_black_box', 'auditability'],
        },
      ],
      projectMemoryCandidates: [
        {
          statement: 'CogMem 注入摘要必须附带 raw ledger source locator。',
          confidence: 0.82,
          evidenceEventIds: ['all'],
          tags: ['CogMem', 'source_drilldown'],
        },
      ],
      longTermGoalCandidates: [
        {
          statement: '长期目标是让 agent 可以自然浮现旧但重要记忆，同时可审计原文。',
          confidence: 0.74,
          evidenceEventIds: ['all'],
        },
      ],
      boundaryCandidates: [
        {
          statement: '禁止把导入摘要当成用户原话。',
          confidence: 0.86,
          evidenceEventIds: ['all'],
        },
      ],
      failureLessonCandidates: [
        {
          statement: '只注入摘要会让 agent 知道发生了什么但无法理解完整脉络。',
          confidence: 0.77,
          evidenceEventIds: ['all'],
        },
      ],
      diagnosticConclusionCandidates: [
        {
          symptom: 'agent 无法回答用户原话',
          rootCause: '召回项缺少可操作 source context',
          recommendation: '注入 source locator 并用 memory show 下钻',
          confidence: 0.8,
          evidenceEventIds: ['all'],
        },
      ],
      sessionSummaryCandidates: [
        {
          summary: '用户指出记忆黑盒和原话定位问题，assistant 承诺用 raw ledger source 治理。',
          confidence: 0.76,
          evidenceEventIds: ['all'],
        },
      ],
      topicSummaryCandidates: [
        {
          topic: '记忆黑盒',
          summary: '黑盒问题的核心是注入摘要缺少原始事件定位和上下文。',
          confidence: 0.75,
          evidenceEventIds: ['all'],
        },
      ],
      temporalFactUpdateCandidates: [
        {
          statement: '导入摘要不能回答原话',
          validFrom: '2026-06-08T00:00:00.000Z',
          supersedes: ['legacy-summary-as-source'],
          confidence: 0.7,
          evidenceEventIds: ['all'],
        },
      ],
      conflictCandidates: [
        {
          newStatement: '原话问题必须走 raw ledger',
          possiblySupersededStatement: '摘要注入足以回答历史问题',
          conflictSetId: 'memory-black-box-source',
          confidence: 0.72,
          evidenceEventIds: ['all'],
        },
      ],
    }),
  });

  const candidates = kernel.listDreamCandidates({ statuses: ['candidate'], limit: 50 });
  const candidateTypes = candidates.map((candidate) => candidate.candidateType);

  expect(result.skipped).toBe(false);
  expect(result.candidateCount).toBeGreaterThanOrEqual(10);
  expect(candidateTypes).toContain('user_preference');
  expect(candidateTypes).toContain('project_memory');
  expect(candidateTypes).toContain('long_term_goal');
  expect(candidateTypes).toContain('boundary');
  expect(candidateTypes).toContain('failure_lesson');
  expect(candidateTypes).toContain('diagnostic_conclusion');
  expect(candidateTypes).toContain('session_summary');
  expect(candidateTypes).toContain('topic_summary');
  expect(candidateTypes).toContain('temporal_fact_update');
  expect(candidateTypes).toContain('conflict_candidate');
  expect(candidates.every((candidate) => candidate.status === 'candidate')).toBe(true);
  expect(kernel.vectorStore.getCurrentCount()).toBe(vectorCountBefore);
  expect(JSON.stringify(candidates)).toContain('sourceAnchor');
  expect(JSON.stringify(candidates)).toContain('raw ledger');

  kernel.close();
});

test('dream curator proposes semantic tags, index decisions, and event relations for raw dialogue windows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-dream-curator-relations-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-dream-relations',
    userText: '我担心记忆黑盒：如果只注入摘要，agent 不知道原话和上下文在哪里。',
    assistantText: '需要让 recall item 带 sourceContext，并把黑盒问题归到 memory/auditability 主题。',
    ingestMode: 'raw_then_dream',
  });

  const result = await kernel.runDreamCurator({ projectId: 'demo', limit: 20 });
  const candidates = kernel.listDreamCandidates({ statuses: ['candidate'], limit: 50 });
  const candidateTypes = candidates.map((candidate) => candidate.candidateType);
  const serialized = JSON.stringify(candidates);

  expect(result.skipped).toBe(false);
  expect(candidateTypes).toContain('semantic_tags');
  expect(candidateTypes).toContain('indexing_decision');
  expect(candidateTypes).toContain('semantic_relation');
  expect(serialized).toContain('memory/auditability');
  expect(serialized).toContain('记忆黑盒');
  expect(serialized).toContain('shouldEmbed');
  expect(serialized).toContain('sourceAnchor');
  expect(kernel.vectorStore.getCurrentCount()).toBe(0);

  kernel.close();
});

test('dream curator records a diagnostic candidate when explicit generation returns invalid output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-dream-curator-llm-invalid-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-dream-invalid',
    userText: '请整理这段记忆，但不要让失败静默发生。',
    assistantText: '整理失败应该进入诊断候选。',
    ingestMode: 'raw_then_dream',
  });

  const result = await kernel.runDreamCurator({
    projectId: 'demo',
    generateText: async () => 'not json',
  });
  const candidates = kernel.listDreamCandidates({ statuses: ['needs_confirmation'], limit: 10 });

  expect(result.skipped).toBe(false);
  expect(candidates.some((candidate) => candidate.candidateType === 'diagnostic_conclusion')).toBe(true);
  expect(JSON.stringify(candidates)).toContain('dream_curator_provider_invalid_output');
  expect(JSON.stringify(candidates)).toContain('sourceAnchor');

  kernel.close();
});

test('dream curator suppresses operational noise before candidate generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-dream-curator-noise-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });

  kernel.recordRawEvent({
    projectId: 'demo',
    threadId: 'thread-noise',
    sessionId: 'session-noise',
    role: 'user',
    content: '[OpenClaw heartbeat poll]',
  });
  kernel.recordRawEvent({
    projectId: 'demo',
    threadId: 'thread-noise',
    sessionId: 'session-noise',
    role: 'assistant',
    content: 'HEARTBEAT_OK',
  });
  kernel.recordRawEvent({
    projectId: 'demo',
    threadId: 'thread-noise',
    sessionId: 'session-noise',
    role: 'user',
    content: '我的长期目标是让 CogMem 能自然浮现旧但重要的项目记忆。',
  });

  const result = await kernel.runDreamCurator({ projectId: 'demo', limit: 10 });
  const candidates = kernel.listDreamCandidates({ statuses: ['candidate'], limit: 20 });
  const serialized = JSON.stringify(candidates);

  expect(result.processedEventCount).toBe(3);
  expect(result.dreamableEventCount).toBe(1);
  expect(result.candidateCount).toBeGreaterThan(0);
  expect(serialized).toContain('自然浮现');
  expect(serialized).not.toContain('HEARTBEAT_OK');
  expect(serialized).not.toContain('heartbeat poll');

  kernel.close();
});
