import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';

function seedCandidate(kernel: ReturnType<typeof createMemoryKernel>, input: {
  candidateId: string;
  projectId?: string;
  candidateType?: string;
  content?: Record<string, unknown>;
  evidenceEventId: string;
}): void {
  const store = new DeepWriteCandidateStore(kernel.factStore.getDatabase());
  const run = store.insertRun({
    runId: `run-${input.candidateId}`,
    projectId: input.projectId,
    sourceNeuronIds: [input.evidenceEventId],
    mode: 'episode',
    promptHash: 'prompt',
    outputHash: 'output',
    status: 'succeeded',
  });
  store.insertCandidates([{
    candidateId: input.candidateId,
    runId: run.runId,
    candidateType: input.candidateType || 'semantic_tags',
    status: 'needs_confirmation',
    confidence: 0.8,
    content: input.content || { topicPath: 'cogmem/reliability' },
    evidence: [{ eventId: input.evidenceEventId, role: 'user' }],
    statusReason: 'manual_review_required',
  }]);
}

test('candidate review closes approve reject defer and supersede with immutable audit', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-candidate-review-')), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  try {
    const confirmation = kernel.eventStore.append({
      eventId: 'evt-confirm', streamId: 'review', streamType: 'thread', eventType: 'MESSAGE',
      rawEventType: 'message', projectId: 'cogmem', role: 'user', payload: { text: '批准这个候选。' },
    });
    for (const id of ['approve', 'reject', 'defer', 'supersede']) {
      seedCandidate(kernel, { candidateId: `cand-${id}`, projectId: 'cogmem', evidenceEventId: confirmation.eventId });
    }

    const approved = kernel.reviewDreamCandidate({
      candidateId: 'cand-approve', projectId: 'cogmem', action: 'approve', actor: 'operator',
      reason: 'verified against source', confirmationEventId: confirmation.eventId,
    });
    expect(approved.candidate.status).toBe('promoted');
    expect(approved.review.action).toBe('approve');

    expect(kernel.reviewDreamCandidate({
      candidateId: 'cand-reject', projectId: 'cogmem', action: 'reject', actor: 'operator', reason: 'not durable',
    }).candidate.status).toBe('rejected');
    const reviewAfter = Date.now() + 60_000;
    const deferred = kernel.reviewDreamCandidate({
      candidateId: 'cand-defer', projectId: 'cogmem', action: 'defer', actor: 'operator', reason: 'wait for evidence', reviewAfter,
    });
    expect(deferred.candidate.status).toBe('needs_confirmation');
    expect(deferred.candidate.reviewAfter).toBe(reviewAfter);
    expect(deferred.review.reviewAfter).toBe(reviewAfter);
    expect(kernel.reviewDreamCandidate({
      candidateId: 'cand-supersede', projectId: 'cogmem', action: 'supersede', actor: 'operator', reason: 'duplicate', replacementCandidateId: 'cand-approve',
    }).candidate.status).toBe('superseded');

    const reviews = kernel.listDreamCandidateReviews({ projectId: 'cogmem', limit: 20 });
    expect(reviews.map((review) => review.action).sort()).toEqual(['approve', 'defer', 'reject', 'supersede']);
    expect(() => kernel.reviewDreamCandidate({
      candidateId: 'cand-reject', projectId: 'cogmem', action: 'approve', actor: 'operator',
      reason: 'invalid second transition', confirmationEventId: confirmation.eventId,
    })).toThrow('candidate_not_awaiting_confirmation');
  } finally {
    kernel.close();
  }
});

test('candidate review is atomic when the audit insert fails', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-candidate-review-atomic-')), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  try {
    const confirmation = kernel.eventStore.append({
      eventId: 'evt-atomic-confirm', streamId: 'review', streamType: 'thread', eventType: 'MESSAGE',
      rawEventType: 'message', projectId: 'cogmem', role: 'user', payload: { text: '确认这个候选。' },
    });
    seedCandidate(kernel, { candidateId: 'cand-atomic', projectId: 'cogmem', evidenceEventId: confirmation.eventId });
    kernel.factStore.getDatabase().exec(`
      CREATE TRIGGER fail_candidate_review_audit
      BEFORE INSERT ON deep_write_candidate_reviews
      BEGIN
        SELECT RAISE(ABORT, 'audit_failed');
      END;
    `);

    expect(() => kernel.reviewDreamCandidate({
      candidateId: 'cand-atomic', projectId: 'cogmem', action: 'approve', actor: 'operator',
      reason: 'verified against source', confirmationEventId: confirmation.eventId,
    })).toThrow('audit_failed');

    const store = new DeepWriteCandidateStore(kernel.factStore.getDatabase());
    expect(store.getCandidate('cand-atomic')).toEqual(expect.objectContaining({
      status: 'needs_confirmation',
      statusReason: 'manual_review_required',
    }));
    expect(kernel.listDreamCandidateReviews({ projectId: 'cogmem', limit: 20 })).toEqual([]);
  } finally {
    kernel.close();
  }
});

test('candidate review rejects cross-project confirmation and relinks orphan correction to an active belief', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-candidate-relink-')), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  try {
    const original = kernel.eventStore.append({
      eventId: 'evt-old', streamId: 'old', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
      projectId: 'cogmem', role: 'user', payload: { text: '旧事实。' },
    });
    const confirmation = kernel.eventStore.append({
      eventId: 'evt-new', streamId: 'new', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
      projectId: 'cogmem', role: 'user', payload: { text: '这个事实需要修正。' },
    });
    const foreign = kernel.eventStore.append({
      eventId: 'evt-foreign', streamId: 'foreign', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
      projectId: 'other', role: 'user', payload: { text: '另一个项目。' },
    });
    const belief = kernel.beliefStore.upsert({
      projectId: 'cogmem', scope: 'project', subject: 'Hermes', predicate: '状态',
      objectValue: { raw: '旧', normalized: '旧', type: 'string' }, confidence: 0.9, trustScore: 0.9,
      sourceEventId: original.eventId, sourceType: 'user_input', validityKind: 'open', validFrom: original.occurredAt,
    }).belief!;
    seedCandidate(kernel, {
      candidateId: 'cand-correction', projectId: 'cogmem', candidateType: 'correction',
      content: { newStatement: 'Hermes 状态已更新' }, evidenceEventId: confirmation.eventId,
    });

    expect(() => kernel.reviewDreamCandidate({
      candidateId: 'cand-correction', projectId: 'cogmem', action: 'approve', actor: 'operator',
      reason: 'wrong project evidence', confirmationEventId: foreign.eventId,
    })).toThrow('confirmation_event_project_mismatch');

    const result = kernel.reviewDreamCandidate({
      candidateId: 'cand-correction', projectId: 'cogmem', action: 'relink', actor: 'operator',
      reason: 'bind correction target', targetBeliefId: belief.id, confirmationEventId: confirmation.eventId,
    });
    expect(result.candidate.status).toBe('promoted');
    expect(result.candidate.promotionTargetId).toBe(belief.id);
    expect(result.review.targetBeliefId).toBe(belief.id);
  } finally {
    kernel.close();
  }
});
