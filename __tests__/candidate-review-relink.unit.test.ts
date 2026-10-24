import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';
import type { BeliefRecord } from '../src/types/index.js';

/**
 * `relink` is the operator saying "this correction corrects that belief instead". The curator writes
 * `correctedClaimKey` and `correctedBeliefCandidateIds` as a pair, so a relink that rewrote only
 * `correctedClaimKey` left the same content naming two different beliefs, and kept a resolver verdict
 * (`resolved` / `claim_key_match`) that described a match which never happened. These tests hold the
 * whole target triple together and keep the override visible.
 */

const PROJECT = 'relink-targets';
const root = join(import.meta.dir, '..');
const memoryBin = join(root, 'src', 'bin', 'memory.ts');

type Seeded = {
  kernel: ReturnType<typeof createMemoryKernel>;
  beliefA: BeliefRecord;
  beliefB: BeliefRecord;
  dbPath: string;
  dir: string;
};

/** Content for a correction the curator already resolved against `beliefA`. */
const boundToA = (beliefA: BeliefRecord): Record<string, unknown> => ({
  projectId: PROJECT,
  statement: '不对，svc 不是跑在 bun 上',
  sourceEventId: 'evt-confirm',
  correctionKind: 'user_clarification_or_revision',
  correctedClaimKey: beliefA.canonicalKey,
  correctedBeliefCandidateIds: [beliefA.id],
  correctionResolution: 'resolved',
  correctionResolutionReason: 'claim_key_match',
  governance: 'organizational_trace_only',
});

/** Content for a correction the resolver could not bind to anything. */
const orphan: Record<string, unknown> = {
  projectId: PROJECT,
  statement: '不对，之前的说法有误',
  sourceEventId: 'evt-confirm',
  correctionKind: 'user_clarification_or_revision',
  correctedClaimKey: null,
  correctedBeliefCandidateIds: [],
  correctionResolution: 'needs_review',
  correctionResolutionReason: 'no_claim_key_match',
  governance: 'organizational_trace_only',
};

function seed(contentFor: (beliefA: BeliefRecord) => Record<string, unknown>): Seeded {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-relink-targets-'));
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  kernel.eventStore.append({
    eventId: 'evt-confirm', streamId: 's1', streamType: 'thread', eventType: 'MESSAGE',
    rawEventType: 'message', projectId: PROJECT, role: 'user', payload: { text: '我确认这条结论有效。' },
  });
  const upsert = (predicate: string, value: string): BeliefRecord => kernel.beliefStore.upsert({
    projectId: PROJECT, scope: 'project', subject: 'svc', predicate,
    objectValue: { raw: value, normalized: value, type: 'string' },
    confidence: 0.9, trustScore: 0.9, sourceEventId: 'evt-confirm', sourceType: 'user_input',
    validityKind: 'open', validFrom: 1_700_000_000_000, extractionReason: 'explicit_user_statement',
  }).belief!;
  const beliefA = upsert('runs_on', 'bun');
  const beliefB = upsert('port', '8080');
  const store = new DeepWriteCandidateStore(kernel.factStore.getDatabase());
  store.insertRun({ runId: 'run-correction', projectId: PROJECT, sourceNeuronIds: ['evt-confirm'], mode: 'episode', promptHash: 'p', outputHash: 'o', status: 'succeeded' });
  store.insertCandidates([{
    candidateId: 'cand-correction', runId: 'run-correction', candidateType: 'correction',
    status: 'needs_confirmation', confidence: 0.78, content: contentFor(beliefA),
    evidence: [{ eventId: 'evt-confirm', role: 'user' }],
  }]);
  return { kernel, beliefA, beliefB, dbPath, dir };
}

function close(seeded: Seeded): void {
  seeded.kernel.close();
  rmSync(seeded.dir, { recursive: true, force: true });
}

function contentOf(kernel: ReturnType<typeof createMemoryKernel>): Record<string, unknown> {
  const store = new DeepWriteCandidateStore(kernel.factStore.getDatabase());
  return store.getCandidate('cand-correction')!.content as Record<string, unknown>;
}

describe('relink keeps every target-bearing field on the same belief', () => {
  test('relinking a correction bound to A onto B moves the claim key, the id list, and the target together', () => {
    const seeded = seed(boundToA);
    const result = seeded.kernel.reviewDreamCandidate({
      candidateId: 'cand-correction', projectId: PROJECT, action: 'relink', actor: 'operator',
      reason: 'bind correction target', targetBeliefId: seeded.beliefB.id, confirmationEventId: 'evt-confirm',
    });

    const content = contentOf(seeded.kernel);
    expect(content.targetBeliefId).toBe(seeded.beliefB.id);
    expect(content.correctedClaimKey).toBe(seeded.beliefB.canonicalKey);
    expect(content.correctedBeliefCandidateIds).toEqual([seeded.beliefB.id]);
    expect(content.correctionResolution).toBe('manual_relink');
    expect(content.correctionResolutionReason).toBe('operator_target_belief');
    expect(content.relinkedFromBeliefId).toBe(seeded.beliefA.id);
    // The record must not still name the belief it was moved away from, and must not still claim the
    // resolver matched the new claim key.
    expect(JSON.stringify(content)).not.toContain(seeded.beliefA.canonicalKey);
    expect(JSON.stringify(content)).not.toContain('claim_key_match');
    expect(result.candidate.status).toBe('promoted');
    expect(result.candidate.promotionTargetId).toBe(seeded.beliefB.id);
    expect(result.review.targetBeliefId).toBe(seeded.beliefB.id);
    close(seeded);
  });

  test('relinking an orphan correction binds it without inventing a previous target', () => {
    const seeded = seed(() => orphan);
    const result = seeded.kernel.reviewDreamCandidate({
      candidateId: 'cand-correction', projectId: PROJECT, action: 'relink', actor: 'operator',
      reason: 'bind correction target', targetBeliefId: seeded.beliefB.id, confirmationEventId: 'evt-confirm',
    });
    const content = contentOf(seeded.kernel);
    expect(content.correctedBeliefCandidateIds).toEqual([seeded.beliefB.id]);
    expect(content.correctedClaimKey).toBe(seeded.beliefB.canonicalKey);
    expect(content.targetBeliefId).toBe(seeded.beliefB.id);
    // An orphan names nothing, so there is no override to record.
    expect('relinkedFromBeliefId' in content).toBe(false);
    // `needs_review` / `no_claim_key_match` on a promoted, operator-bound record is a stale verdict.
    expect(content.correctionResolution).toBe('manual_relink');
    expect(content.correctionResolutionReason).toBe('operator_target_belief');
    expect(result.candidate.status).toBe('promoted');
    close(seeded);
  });

  test('relinking to the belief the correction already names is a rebind, not an override', () => {
    const seeded = seed(boundToA);
    seeded.kernel.reviewDreamCandidate({
      candidateId: 'cand-correction', projectId: PROJECT, action: 'relink', actor: 'operator',
      reason: 'confirm existing target', targetBeliefId: seeded.beliefA.id, confirmationEventId: 'evt-confirm',
    });
    const content = contentOf(seeded.kernel);
    expect(content.correctedBeliefCandidateIds).toEqual([seeded.beliefA.id]);
    expect('relinkedFromBeliefId' in content).toBe(false);
    expect(content.correctionResolution).toBe('manual_relink');
    close(seeded);
  });

  test('the CLI writes the same shape as the kernel API', async () => {
    const seeded = seed(boundToA);
    const proc = Bun.spawn({
      cmd: ['bun', memoryBin, 'review', '--id', 'cand-correction', '--action', 'relink',
        '--project', PROJECT, '--actor', 'operator', '--reason', 'bind correction target',
        '--confirmation-event', 'evt-confirm', '--target-belief', seeded.beliefB.id,
        '--db', seeded.dbPath, '--json'],
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect({ exitCode, stderr: stderr.trim() }).toEqual({ exitCode: 0, stderr: '' });

    const reread = createMemoryKernel({ dbPath: seeded.dbPath });
    try {
      const content = contentOf(reread);
      expect(content.correctedBeliefCandidateIds).toEqual([seeded.beliefB.id]);
      expect(content.correctedClaimKey).toBe(seeded.beliefB.canonicalKey);
      expect(content.targetBeliefId).toBe(seeded.beliefB.id);
      expect(content.relinkedFromBeliefId).toBe(seeded.beliefA.id);
      expect(content.correctionResolution).toBe('manual_relink');
    } finally {
      reread.close();
    }
    close(seeded);
  });
});
