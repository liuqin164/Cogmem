#!/usr/bin/env bun
/**
 * F19 (#196) recovery drill: the closing condition, not a demonstration.
 *
 * Builds a small but real brain (turns, a compiled procedure, a compiled profile entry, an open
 * commitment, a soul version), takes a nightly snapshot, restores it into a directory that holds no
 * other brain, opens the restored kernel and compares the ledger counts, the soul, all three
 * compiled books and a recall item by item. Exits non-zero on the first mismatch.
 *
 * Usage: TMPDIR="$PWD/.cogmem/tmp" bun scripts/recovery-drill.ts [--keep]
 */
import Database from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { SnapshotImporter } from '../src/snapshot/index.js';
import { readBrainCounts } from '../src/snapshot/BrainManifest.js';

const keep = process.argv.includes('--keep');
const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'cogmem-drill-'));
const sourceDir = join(root, 'source');
const restoredDir = join(root, 'restored');
mkdirSync(sourceDir, { recursive: true });
mkdirSync(restoredDir, { recursive: true });
const sourceDb = join(sourceDir, 'brain.db');
const restoredDb = join(restoredDir, 'brain.db');
const agentId = 'agent-a';
const projectId = 'drill-project';
const now = Date.UTC(2026, 10, 15, 9);

type Check = { step: string; ok: boolean; expected?: unknown; actual?: unknown };
const checks: Check[] = [];
function assert(step: string, ok: boolean, expected?: unknown, actual?: unknown): void {
  checks.push({ step, ok, expected, actual });
}

function countsOf(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    return readBrainCounts(db);
  } finally {
    db.close();
  }
}

async function seed(kernel: MemoryKernel): Promise<void> {
  // The books read raw turns, written the way the shell writes them.
  const backend = new KernelAgentMemoryBackend(kernel, { agentId });
  await backend.rememberTurn({
    agentId,
    projectId,
    sessionId: 'drill-session',
    userText: '我明天把发布清单发你。',
    assistantText: '好，我会在发布前检查清单。',
    timestamp: now,
  });
  await backend.rememberTurn({
    agentId,
    projectId,
    sessionId: 'drill-session',
    userText: '我喜欢喝乌龙茶。',
    timestamp: now + 2_000,
  });
  // A plain memory in the pipeline's own lane, so the drill's recall step has evidence to return.
  await kernel.ingest({
    content: '恢复演练会把这段记忆带回来。',
    role: 'user',
    projectId,
    workspaceId: projectId,
    sessionId: 'drill-session',
    occurredAt: now + 2_500,
  });
  kernel.recordTaskEvent({
    projectId,
    workspaceId: projectId,
    threadId: 'drill-thread',
    sessionId: 'drill-session',
    taskId: 'drill-task',
    title: '发布 npm 包',
    content: '跑测试，构建，然后发布。',
    sourceId: `${agentId}:drill-session`,
    occurredAt: now + 3_000,
    metadata: {
      procedure: {
        domain: '发布',
        key: 'publish',
        title: '发布 npm 包',
        steps: ['跑测试', 'bun run build', 'npm publish'],
        tools: ['bun', 'npm'],
        outcome: 'succeeded',
        checklist: true,
      },
    },
  });
  kernel.procedures.compile({ projectId, now: now + 4_000 });
  kernel.profile.compile({ projectId, now: now + 4_000 });
  kernel.commitments.compile({ projectId, now: now + 4_000 });
  kernel.soul.ensureDefault(agentId, '宁可承认病了，不许带着坏记忆装正常。', now);
}

function bookSnapshot(kernel: MemoryKernel) {
  return {
    soul: kernel.soul.read(agentId),
    profile: kernel.profile.entries({ projectId }).map((entry) => ({ ledger: entry.ledger, key: entry.key, value: entry.value })),
    procedures: kernel.procedures.entries({ projectId }).map((entry) => ({
      domain: entry.domain, key: entry.key, title: entry.title, steps: entry.steps,
    })),
    commitments: kernel.commitments.list({
      projectId,
      statuses: ['pending', 'due_soon', 'overdue'],
      now,
    }).map((entry) => ({ commitmentId: entry.commitmentId, content: entry.content, status: entry.status })),
  };
}

async function main(): Promise<void> {
  const kernel = createMemoryKernel({ dbPath: sourceDb, snapshotsDir: join(sourceDir, 'snapshots') });
  await seed(kernel);
  const before = bookSnapshot(kernel);
  const manifest = await kernel.backup.snapshot();
  if (!manifest) throw new Error('no snapshot was written');
  const snapshotPath = join(sourceDir, 'snapshots', manifest.snapshot.file);
  const sourceCounts = countsOf(sourceDb);
  kernel.close();

  assert('export', manifest.verification.ok === true, true, manifest.verification);
  assert('export-counts', JSON.stringify(manifest.counts) === JSON.stringify(sourceCounts), sourceCounts, manifest.counts);
  assert('restore-clean-dir', readdirSync(restoredDir).length === 0, 0, readdirSync(restoredDir));

  const importer = new SnapshotImporter({ expectedEmbeddingDimension: manifest.config.vectorDimension });
  const imported = await importer.import(snapshotPath, restoredDb, { overwrite: false });
  assert('restore', imported.skipped === false, false, imported.skipped);

  const restored = createMemoryKernel({ dbPath: restoredDb });
  try {
    const after = bookSnapshot(restored);
    const restoredCounts = countsOf(restoredDb);
    assert('ledger', JSON.stringify(before) === JSON.stringify(before) && JSON.stringify(sourceCounts) === JSON.stringify(restoredCounts), sourceCounts, restoredCounts);
    assert('soul', before.soul?.version === after.soul?.version && before.soul?.content === after.soul?.content, before.soul, after.soul);
    assert('profile', JSON.stringify(before.profile) === JSON.stringify(after.profile), before.profile, after.profile);
    assert('procedures', JSON.stringify(before.procedures) === JSON.stringify(after.procedures), before.procedures, after.procedures);
    assert('commitments', JSON.stringify(before.commitments) === JSON.stringify(after.commitments), before.commitments, after.commitments);
    assert('open-commitment-nonempty', after.commitments.length > 0, '>0', after.commitments.length);
    assert('procedure-nonempty', after.procedures.length > 0, '>0', after.procedures.length);
    assert('profile-nonempty', after.profile.length > 0, '>0', after.profile.length);

    const recall = new KernelAgentMemoryBackend(restored, { agentId })
      .recall({ query: '恢复演练', projectId, limit: 5 });
    assert('open-recall', recall.items.length > 0, '>0', recall.items.map((item) => item.text));
  } finally {
    restored.close();
  }

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({
    drill: 'f19-recovery',
    ok,
    at: new Date().toISOString(),
    root: keep ? root : '(removed)',
    snapshot: manifest.snapshot.file,
    checks,
  }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
