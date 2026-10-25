import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';
import { makeTempDir } from './helpers/tmp.js';

const DAY = 24 * 60 * 60 * 1000;
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// A candidate closed without a successor has nothing that replaced it, so `promotion_target_id`
// must stay empty. The column answers exactly one question ("what replaced this?"); pointing it at
// the row that just closed makes a retired candidate claim a successor that is itself.

test('review-queue expiry retires a stale candidate without naming a promotion target', () => {
  const dir = makeTempDir('cogmem-auto-supersede-ttl-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const store = new DeepWriteCandidateStore(kernel.factStore.getDatabase());
  const now = Date.now();
  const run = store.insertRun({
    projectId: 'demo',
    sourceNeuronIds: [],
    mode: 'auto-supersede-ttl',
    promptHash: 'prompt',
    outputHash: 'output',
    status: 'succeeded',
    createdAt: now - 40 * DAY,
  });
  const [stale] = store.insertCandidates([
    {
      runId: run.runId,
      candidateType: 'conflict_candidate',
      status: 'needs_confirmation',
      confidence: 0.7,
      content: { projectId: 'demo', statement: 'aged out' },
      evidence: [{ eventId: 'evt-stale', role: 'user' }],
      createdAt: now - 31 * DAY,
    },
  ]);

  const before = store.getCandidate(stale.candidateId)!;
  expect(before.promotionTargetId).toBeUndefined();

  const result = store.expireNeedsConfirmation({ projectId: 'demo', before: now - 30 * DAY, now });
  expect(result.expired).toBe(1);
  expect(result.candidateIds).toEqual([stale.candidateId]);

  const after = store.getCandidate(stale.candidateId)!;
  expect(after.status).toBe('superseded');
  expect(after.statusReason).toBe('needs_confirmation_ttl_expired');
  // The reason class still says why it closed; the id is the part that used to lie.
  expect(after.promotionTargetType).toBe('review_queue_expiry');
  expect(after.promotionTargetId).toBeUndefined();
  expect(after.promotionTargetId).not.toBe(after.candidateId);

  // Same answer through the public read path the CLI and MCP tool use.
  const listed = kernel.listDreamCandidates({ projectId: 'demo', statuses: ['superseded'], limit: 10 });
  expect(listed).toHaveLength(1);
  expect(listed[0]?.promotionTargetType).toBe('review_queue_expiry');
  expect(listed[0]?.promotionTargetId).toBeUndefined();

  kernel.close();
});

test('provider recovery supersedes the stale warning without naming a promotion target', async () => {
  const dir = makeTempDir('cogmem-auto-supersede-diagnostic-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-auto-supersede',
    userText: '第一次 provider 输出坏了。',
    assistantText: '应当只生成一个诊断警告。',
    ingestMode: 'raw_then_dream',
  });
  await kernel.runDreamCurator({ projectId: 'demo', generateText: async () => 'not json' });

  const warnings = kernel.listDreamCandidates({
    projectId: 'demo',
    statuses: ['rejected', 'needs_confirmation'],
    candidateTypes: ['diagnostic_conclusion'],
    limit: 10,
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.promotionTargetId).toBeUndefined();

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-auto-supersede',
    userText: '第三次 provider 恢复。',
    assistantText: '旧警告应被 superseded。',
    ingestMode: 'raw_then_dream',
  });
  await kernel.runDreamCurator({
    projectId: 'demo',
    generateText: async () => JSON.stringify({
      sessionSummaryCandidates: [{ summary: 'provider 已恢复。', confidence: 0.76, evidenceEventIds: ['all'] }],
    }),
  });

  const superseded = kernel.listDreamCandidates({
    projectId: 'demo',
    statuses: ['superseded'],
    candidateTypes: ['diagnostic_conclusion'],
    limit: 10,
  });
  expect(superseded).toHaveLength(1);
  expect(superseded[0]?.statusReason).toBe('provider_recovered');
  expect(superseded[0]?.promotionTargetType).toBe('diagnostic_conclusion');
  expect(superseded[0]?.promotionTargetId).toBeUndefined();
  expect(superseded[0]?.promotionTargetId).not.toBe(superseded[0]?.candidateId);

  kernel.close();
});

test('no status update in src names its own row as the promotion target', () => {
  const files = collectTsFiles(join(coreRoot, 'src'));
  expect(files.length).toBeGreaterThan(100);

  const offenders: string[] = [];
  let checked = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const call of statusUpdateCalls(source)) {
      checked += 1;
      const candidateIdExpr = normalize(call.args[0] || '');
      const target = call.args[2] || '';
      const targetId = topLevelValue(target, 'id');
      if (!targetId) continue;
      if (candidateIdExpr && normalize(targetId) === candidateIdExpr) {
        offenders.push(`${file}:${call.line} ${candidateIdExpr} is named as its own promotion target`);
      }
    }
  }

  // Guard the guard: the parser must still find every call site, not go green on an empty scan.
  expect(checked).toBeGreaterThanOrEqual(9);
  expect(offenders).toEqual([]);
});

function collectTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      out.push(...collectTsFiles(path));
    } else if (entry.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

function statusUpdateCalls(source: string): Array<{ line: number; args: string[] }> {
  const marker = 'updateCandidateStatus(';
  const calls: Array<{ line: number; args: string[] }> = [];
  let index = source.indexOf(marker);
  while (index !== -1) {
    const start = index + marker.length;
    const end = matchParen(source, start - 1);
    if (end === -1) break;
    calls.push({
      line: source.slice(0, index).split('\n').length,
      args: splitTopLevel(source.slice(start, end)),
    });
    index = source.indexOf(marker, end);
  }
  return calls;
}

function matchParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') { i += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      current += char;
      if (char === '\\') { current += text[i + 1] ?? ''; i += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if ('({['.includes(char)) depth += 1;
    if (')}]'.includes(char)) depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

function topLevelValue(objectText: string, key: string): string | null {
  if (!objectText) return null;
  const match = new RegExp(`(?:^|[{,\\s])${key}\\s*:`, 'm').exec(objectText);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 0;
  let quote: string | null = null;
  let value = '';
  for (let i = start; i < objectText.length; i += 1) {
    const char = objectText[i];
    if (quote) {
      value += char;
      if (char === '\\') { value += objectText[i + 1] ?? ''; i += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; value += char; continue; }
    if ('({['.includes(char)) depth += 1;
    if (')}]'.includes(char)) {
      if (depth === 0) break;
      depth -= 1;
    }
    if (char === ',' && depth === 0) break;
    value += char;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalize(expression: string): string {
  return expression.replace(/\s+/g, '');
}
