import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { DeepWriteCandidateStore, type DeepWriteCandidateRecord } from '../src/store/DeepWriteCandidateStore.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const memoryBin = join(coreRoot, 'src/bin/memory.ts');

// `promotion_target_id` answers "what is this candidate about?" (an event, a topic path, or the
// row it was replaced by). A candidate whose content names none of those used to fall back to its
// own id, so a promoted row claimed a target that is itself. Nothing consumes that id today, but
// the column is evidence: it must not assert a referent that does not exist.

interface SeededCandidate {
  candidateId: string;
  candidateType: string;
}

async function seedOrganizationCandidates(dbPath: string): Promise<{
  eventId: string;
  rows: SeededCandidate[];
}> {
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-promotion-target',
    userText: '把索引决策和语义标签先写成候选，再走治理。',
    assistantText: '好，先留在候选队列里。',
    ingestMode: 'raw_then_dream',
  });

  const db = kernel.factStore.getDatabase();
  const event = db.prepare(
    `SELECT event_id FROM memory_events WHERE project_id='demo' AND role='user' ORDER BY rowid DESC LIMIT 1`
  ).get() as { event_id: string } | null;
  if (!event) throw new Error('seed could not find a user event in project demo');

  const store = new DeepWriteCandidateStore(db);
  const now = Date.now();
  const run = store.insertRun({
    projectId: 'demo',
    sourceNeuronIds: [],
    mode: 'promotion-target-referent',
    promptHash: 'prompt',
    outputHash: 'output',
    status: 'succeeded',
    createdAt: now,
  });
  const evidence = [{ eventId: event.event_id, role: 'user' }];

  const inserted = store.insertCandidates([
    // No `sourceEventId` / `targetEventId` / `topicPath`: nothing to point at.
    {
      runId: run.runId,
      candidateType: 'semantic_tags',
      status: 'candidate',
      confidence: 0.7,
      content: { projectId: 'demo', tags: ['topic:governance'], source: 'explicit_user_statement' },
      evidence,
      promotionTargetType: 'semantic_tags',
      createdAt: now,
    },
    // A topic path is a real locator and must survive.
    {
      runId: run.runId,
      candidateType: 'semantic_tags',
      status: 'candidate',
      confidence: 0.7,
      content: { projectId: 'demo', topicPath: 'memory/kernel', tags: ['topic:governance'], source: 'explicit_user_statement' },
      evidence,
      promotionTargetType: 'semantic_tags',
      createdAt: now,
    },
    // An event id is a real referent and must survive.
    {
      runId: run.runId,
      candidateType: 'indexing_decision',
      status: 'candidate',
      confidence: 0.72,
      content: { projectId: 'demo', sourceEventId: event.event_id, shouldEmbed: true, source: 'explicit_user_statement' },
      evidence,
      promotionTargetType: 'indexing_decision',
      createdAt: now,
    },
    // A target recorded by an earlier pass wins over anything in the content.
    {
      runId: run.runId,
      candidateType: 'edge_adjustment',
      status: 'candidate',
      confidence: 0.64,
      content: { projectId: 'demo', strengthenWhenTagsOverlap: ['topic:governance'], source: 'explicit_user_statement' },
      evidence,
      promotionTargetType: 'edge_adjustment',
      promotionTargetId: 'topic:preset-referent',
      createdAt: now,
    },
  ]);

  kernel.promoteDreamCandidates({ projectId: 'demo', limit: 50 });
  const rows = inserted.map((candidate: DeepWriteCandidateRecord) => ({
    candidateId: candidate.candidateId,
    candidateType: candidate.candidateType,
  }));
  kernel.close();
  return { eventId: event.event_id, rows };
}

test('an organization candidate with no referent promotes without naming itself', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-promotion-target-'));
  const dbPath = join(dir, 'memory.db');
  const { eventId, rows } = await seedOrganizationCandidates(dbPath);

  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  const store = new DeepWriteCandidateStore(kernel.factStore.getDatabase());
  const [noReferent, withTopic, withEvent, withPreset] = rows.map((row) => store.getCandidate(row.candidateId)!);

  // The candidate still promotes: the reason class says what the row is, the missing id says the
  // content never named anything. Nothing is invented to fill the column.
  expect(noReferent.status).toBe('promoted');
  expect(noReferent.promotionTargetType).toBe('semantic_tags');
  expect(noReferent.statusReason).toBe('semantic_organization_candidate_accepted');
  expect(noReferent.promotionTargetId).toBeUndefined();
  expect(noReferent.promotionTargetId).not.toBe(noReferent.candidateId);

  // Same answer through the public read path the CLI and the MCP tool use.
  const listed = kernel.listDreamCandidates({ projectId: 'demo', statuses: ['promoted'], limit: 20 });
  const listedNoReferent = listed.find((row) => row.candidateId === noReferent.candidateId)!;
  expect(listedNoReferent.promotionTargetId).toBeUndefined();

  // A real referent is not collateral damage: each shape still records the thing it is about.
  expect(withTopic.status).toBe('promoted');
  expect(withTopic.promotionTargetId).toBe('memory/kernel');
  expect(withEvent.status).toBe('promoted');
  expect(withEvent.promotionTargetId).toBe(eventId);
  expect(withPreset.status).toBe('promoted');
  expect(withPreset.promotionTargetId).toBe('topic:preset-referent');
  kernel.close();

  // And the operator sees the same row through the CLI: `undefined` keys never serialize, so the
  // absence of the field is the observable fact.
  const proc = Bun.spawn({
    cmd: ['bun', memoryBin, 'candidates', '--project', 'demo', '--status', 'promoted', '--json', '--db', dbPath],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr.trim()).toBe('');
  expect(exitCode).toBe(0);
  const payload = JSON.parse(stdout) as { candidates?: Array<Record<string, unknown>> };
  const cliRow = (payload.candidates || []).find((row) => row.candidateId === noReferent.candidateId);
  expect(cliRow).toBeDefined();
  expect(cliRow!.status).toBe('promoted');
  expect(cliRow!.promotionTargetType).toBe('semantic_tags');
  expect('promotionTargetId' in cliRow!).toBe(false);
});

test('no promotion target in src falls back to the candidate id', () => {
  const files = collectTsFiles(join(coreRoot, 'src'));
  expect(files.length).toBeGreaterThan(100);

  const offenders: string[] = [];
  let checked = 0;
  let sawPolicyTarget = false;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!/^\s*targetId:/.test(line)) continue;
      checked += 1;
      if (file.endsWith(join('engine', 'DeepWritePromotionPolicy.ts'))) sawPolicyTarget = true;
      // The row's own id is the one thing the column must never hold.
      if (/\.candidateId\b/.test(line)) {
        offenders.push(`${file}:${index + 1} ${line.trim()}`);
      }
    }
  }

  // Guard the guard: a parser that finds nothing would otherwise pass silently.
  expect(checked).toBeGreaterThanOrEqual(40);
  expect(sawPolicyTarget).toBe(true);
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
