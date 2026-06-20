import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { createMemoryKernel } from '../src/factory.js';
import { ProspectiveMemoryService } from '../src/prospective/ProspectiveMemoryService.js';

const evidence = new Map([
  ['evt-old-confirm', { eventId: 'evt-old-confirm', projectId: 'brain', role: 'user', globalSeq: 0, content: 'Yes, confirm the reminder.' }],
  ['evt-request', { eventId: 'evt-request', projectId: 'brain', role: 'user', globalSeq: 1, content: 'Remind me to check CI.' }],
  ['evt-confirm', { eventId: 'evt-confirm', projectId: 'brain', role: 'user', globalSeq: 2, content: 'Yes, confirm that reminder.' }],
  ['evt-unrelated', { eventId: 'evt-unrelated', projectId: 'brain', role: 'user', globalSeq: 3, content: 'What is the weather?' }],
  ['evt-new', { eventId: 'evt-new', projectId: 'brain', role: 'user', globalSeq: 4, content: 'Add a new follow-up.' }],
  ['evt-assistant', { eventId: 'evt-assistant', projectId: 'brain', role: 'assistant', globalSeq: 5, content: 'Confirmed.' }],
  ['evt-other', { eventId: 'evt-other', projectId: 'other', role: 'user', globalSeq: 6, content: 'Confirm another reminder.' }],
  ['evt-unscoped', { eventId: 'evt-unscoped', role: 'user', globalSeq: 7, content: 'Yes, confirm.' }],
  ['evt-confirm-late', { eventId: 'evt-confirm-late', projectId: 'brain', role: 'user', globalSeq: 8, content: 'Yes, confirm.' }],
]);

function service() {
  return new ProspectiveMemoryService(new Database(':memory:'), (eventId) => evidence.get(eventId));
}

describe('prospective memory v1', () => {
  test('creates a pending candidate and requires explicit user confirmation before due activation', () => {
    const prospective = service();
    const candidate = prospective.propose({
      projectId: 'brain', candidateType: 'reminder', canonicalKey: 'release:check-ci',
      title: 'Check CI after release', evidenceEventIds: ['evt-request'], dueAt: 100,
      proposedBy: 'deterministic',
    });

    expect(candidate.status).toBe('pending');
    expect(prospective.listDue({ projectId: 'brain', atTime: 200 })).toEqual([]);
    expect(() => prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-assistant' }, 'brain'))
      .toThrow('confirmation_requires_user_evidence');
    expect(() => prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-request' }, 'brain'))
      .toThrow('confirmation_requires_distinct_user_evidence');
    expect(() => prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-old-confirm' }, 'brain'))
      .toThrow('confirmation_must_follow_proposal_evidence');
    expect(() => prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-unrelated' }, 'brain'))
      .toThrow('confirmation_requires_explicit_affirmation');
    expect(() => prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-confirm' }, 'other'))
      .toThrow('project_boundary_violation');

    const confirmed = prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-confirm' }, 'brain');
    expect(confirmed.status).toBe('confirmed');
    expect(prospective.listDue({ projectId: 'brain', atTime: 200 })[0]?.candidateId).toBe(candidate.candidateId);
  });

  test('rejected candidates do not resurface without new evidence', () => {
    const prospective = service();
    const first = prospective.propose({
      projectId: 'brain', candidateType: 'open_loop', canonicalKey: 'project:follow-up',
      title: 'Follow up', evidenceEventIds: ['evt-request'], proposedBy: 'model_candidate',
    });
    prospective.resolve(first.candidateId, { action: 'reject' }, 'brain');
    expect(() => prospective.resolve(first.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-confirm' }, 'brain'))
      .toThrow('terminal_prospective_memory_cannot_transition');

    const duplicate = prospective.propose({
      projectId: 'brain', candidateType: 'open_loop', canonicalKey: 'project:follow-up',
      title: 'Follow up again', evidenceEventIds: ['evt-request'], proposedBy: 'model_candidate',
    });
    expect(duplicate.candidateId).toBe(first.candidateId);
    expect(duplicate.status).toBe('rejected');
    expect(prospective.list({ projectId: 'brain', statuses: ['pending', 'confirmed'] })).toEqual([]);

    const revised = prospective.propose({
      projectId: 'brain', candidateType: 'open_loop', canonicalKey: 'project:follow-up',
      title: 'Follow up with new evidence', evidenceEventIds: ['evt-new'], proposedBy: 'model_candidate',
    });
    expect(revised.version).toBe(2);
    expect(revised.status).toBe('pending');
  });

  test('supports defer, complete, and expire state transitions without execution capability', () => {
    const prospective = service();
    const candidate = prospective.propose({
      projectId: 'brain', candidateType: 'commitment', canonicalKey: 'release:publish',
      title: 'Publish release', evidenceEventIds: ['evt-request'], proposedBy: 'operator', dueAt: 100,
    });
    prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-confirm' }, 'brain');
    const deferredUntil = Date.now() + 500;
    expect(prospective.resolve(candidate.candidateId, { action: 'defer', deferredUntil }, 'brain').status).toBe('deferred');
    expect(prospective.listDue({ projectId: 'brain', atTime: deferredUntil - 1 })).toEqual([]);
    expect(prospective.listDue({ projectId: 'brain', atTime: deferredUntil })[0]?.candidateId).toBe(candidate.candidateId);
    expect(prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-confirm' }, 'brain').status).toBe('confirmed');
    expect(prospective.resolve(candidate.candidateId, { action: 'complete' }, 'brain').status).toBe('completed');
    expect(() => prospective.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-confirm' }, 'brain'))
      .toThrow('terminal_prospective_memory_cannot_transition');
    expect('execute' in prospective).toBe(false);

    const expiring = prospective.propose({
      projectId: 'brain', candidateType: 'plan', canonicalKey: 'release:old-plan',
      title: 'Old plan', evidenceEventIds: ['evt-new'], proposedBy: 'deterministic',
    });
    expect(prospective.resolve(expiring.candidateId, { action: 'expire' }, 'brain').status).toBe('expired');
  });

  test('rejects unknown and cross-project evidence', () => {
    const prospective = service();
    expect(() => prospective.list({ projectId: '', statuses: ['pending'] })).toThrow('project_id_required');
    expect(() => prospective.list({
      projectId: 'brain', statuses: ['invalid' as never],
    })).toThrow('invalid_prospective_memory_status');
    expect(() => prospective.listDue({ projectId: 'brain', limit: 1.5 })).toThrow('invalid_limit');
    expect(() => prospective.propose({
      projectId: 'brain', candidateType: 'plan', canonicalKey: 'bad', title: 'Bad',
      evidenceEventIds: ['evt-other'], proposedBy: 'deterministic',
    })).toThrow('project_boundary_violation');
    expect(() => prospective.propose({
      projectId: 'brain', candidateType: 'plan', canonicalKey: 'unscoped', title: 'Unscoped',
      evidenceEventIds: ['evt-unscoped'], proposedBy: 'deterministic',
    })).toThrow('project_boundary_violation');
    expect(() => prospective.propose({
      projectId: 'brain', candidateType: 'unknown' as never, canonicalKey: 'bad-type', title: 'Bad',
      evidenceEventIds: ['evt-request'], proposedBy: 'deterministic',
    })).toThrow('invalid_prospective_memory_type');
    expect(() => prospective.propose({
      projectId: 'brain', candidateType: 'plan', canonicalKey: 'bad-proposer', title: 'Bad',
      evidenceEventIds: ['evt-request'], proposedBy: 'assistant' as never,
    })).toThrow('invalid_prospective_memory_proposer');
  });

  test('does not let one user confirmation activate multiple candidates', () => {
    const prospective = service();
    const first = prospective.propose({
      projectId: 'brain', candidateType: 'reminder', canonicalKey: 'first', title: 'First',
      evidenceEventIds: ['evt-request'], proposedBy: 'deterministic',
    });
    const second = prospective.propose({
      projectId: 'brain', candidateType: 'reminder', canonicalKey: 'second', title: 'Second',
      evidenceEventIds: ['evt-new'], proposedBy: 'deterministic',
    });
    prospective.resolve(first.candidateId, { action: 'confirm', confirmationEvidenceEventId: 'evt-confirm-late' }, 'brain');
    expect(() => prospective.resolve(second.candidateId, {
      action: 'confirm', confirmationEvidenceEventId: 'evt-confirm-late',
    }, 'brain')).toThrow('confirmation_evidence_already_used');
    expect(prospective.get(second.candidateId, 'other')).toBeNull();
    expect(prospective.get(second.candidateId, 'brain')?.status).toBe('pending');
  });

  test('creates and confirms candidates through audited governance operations', () => {
    const kernel = createMemoryKernel({ dbPath: ':memory:' });
    const request = kernel.recordRawEvent({
      threadId: 'thread', projectId: 'brain', role: 'user', content: 'Remind me to review the release.',
    });
    const confirmation = kernel.recordRawEvent({
      threadId: 'thread', projectId: 'brain', role: 'user', content: 'Yes, confirm that reminder.',
    });

    kernel.executeMemoryGovernancePlan({
      planId: 'prospective-create', projectId: 'brain', proposedBy: 'deterministic', createdAt: 1,
      operations: [{
        operationId: 'prospective-create-op', type: 'CREATE_PROSPECTIVE_MEMORY', projectId: 'brain',
        evidenceEventIds: [request.eventId], sourceRole: 'user', ownership: 'user',
        idempotencyKey: 'prospective:create:release-review',
        payload: { candidateType: 'reminder', canonicalKey: 'release:review', title: 'Review release', dueAt: 100 },
      }],
    });
    const candidate = kernel.prospectiveMemoryService.list({ projectId: 'brain', statuses: ['pending'] })[0]!;
    kernel.executeMemoryGovernancePlan({
      planId: 'prospective-confirm', projectId: 'brain', proposedBy: 'operator', createdAt: 2,
      operations: [{
        operationId: 'prospective-confirm-op', type: 'RESOLVE_PROSPECTIVE_MEMORY', projectId: 'brain',
        evidenceEventIds: [confirmation.eventId], sourceRole: 'user', ownership: 'user',
        idempotencyKey: 'prospective:confirm:release-review',
        payload: { candidateId: candidate.candidateId, action: 'confirm', confirmationEvidenceEventId: confirmation.eventId },
      }],
    });

    expect(kernel.prospectiveMemoryService.get(candidate.candidateId, 'brain')?.status).toBe('confirmed');
    expect(kernel.prospectiveMemoryService.listDue({ projectId: 'brain', atTime: 200 })).toHaveLength(1);
    kernel.close();
  });
});
