export class CandidateReviewService {
    db;
    candidates;
    reviews;
    promotion;
    eventLookup;
    constructor(db, candidates, reviews, promotion, eventLookup) {
        this.db = db;
        this.candidates = candidates;
        this.reviews = reviews;
        this.promotion = promotion;
        this.eventLookup = eventLookup;
    }
    review(input) {
        return this.db.transaction(() => {
            const actor = required(input.actor, 'actor');
            const reason = required(input.reason, 'reason');
            const candidate = this.candidates.getCandidate(required(input.candidateId, 'candidateId'));
            if (!candidate)
                throw new Error('candidate_not_found');
            const run = this.candidates.getRun(candidate.runId);
            if (!run || run.projectId !== input.projectId)
                throw new Error('candidate_project_mismatch');
            if (candidate.status !== 'needs_confirmation')
                throw new Error('candidate_not_awaiting_confirmation');
            const fromStatus = candidate.status;
            let decision;
            if (input.action === 'reject') {
                this.candidates.updateCandidateStatus(candidate.candidateId, 'rejected', { reason: `manual_review_rejected:${reason}` });
            }
            else if (input.action === 'defer') {
                if (!Number.isFinite(input.reviewAfter) || Number(input.reviewAfter) <= Date.now()) {
                    throw new Error('review_after_must_be_in_the_future');
                }
                this.candidates.updateCandidateStatus(candidate.candidateId, 'needs_confirmation', {
                    reason: `manual_review_deferred:${reason}`,
                    reviewAfter: input.reviewAfter,
                });
            }
            else if (input.action === 'supersede') {
                if (input.replacementCandidateId)
                    this.requireReplacement(input.replacementCandidateId, input.projectId);
                this.candidates.updateCandidateStatus(candidate.candidateId, 'superseded', {
                    type: input.replacementCandidateId ? 'replacement_candidate' : 'manual_review',
                    id: input.replacementCandidateId || candidate.candidateId,
                    reason: `manual_review_superseded:${reason}`,
                });
            }
            else {
                const confirmation = this.requireUserConfirmation(input.confirmationEventId, input.projectId);
                let content = asObject(candidate.content);
                let targetType = candidate.promotionTargetType;
                let targetId = candidate.promotionTargetId;
                if (input.action === 'relink') {
                    if (candidate.candidateType !== 'correction')
                        throw new Error('relink_requires_correction_candidate');
                    const belief = this.db.prepare(`SELECT id, canonical_key, project_id, status FROM beliefs WHERE id=?`).get(input.targetBeliefId || '');
                    if (!belief || belief.project_id !== input.projectId || belief.status !== 'active') {
                        throw new Error('target_belief_not_active_in_project');
                    }
                    content = { ...content, targetBeliefId: belief.id, correctedClaimKey: belief.canonical_key };
                    targetType = 'belief';
                    targetId = belief.id;
                }
                const evidence = appendConfirmationEvidence(candidate.evidence, confirmation.eventId);
                this.candidates.updateCandidateReviewData(candidate.candidateId, {
                    content,
                    evidence,
                    promotionTargetType: targetType,
                    promotionTargetId: targetId,
                    status: 'candidate',
                    statusReason: `manual_review_${input.action}:${reason}`,
                });
                decision = this.promotion.evaluateAndApply(this.candidates.getCandidate(candidate.candidateId), { reviewConfirmed: true });
            }
            const reviewed = this.candidates.getCandidate(candidate.candidateId);
            const review = this.reviews.insert({
                candidateId: candidate.candidateId,
                projectId: input.projectId,
                action: input.action,
                actor,
                reason,
                fromStatus,
                toStatus: reviewed.status,
                confirmationEventId: input.confirmationEventId,
                targetBeliefId: input.targetBeliefId,
                replacementCandidateId: input.replacementCandidateId,
                reviewAfter: input.reviewAfter,
                decision: decision ? { ...decision } : {},
            });
            return { review, candidate: reviewed, decision };
        })();
    }
    requireUserConfirmation(eventId, projectId) {
        if (!eventId)
            throw new Error('confirmation_event_required');
        const event = this.eventLookup(eventId);
        if (!event)
            throw new Error('confirmation_event_not_found');
        if (event.projectId !== projectId)
            throw new Error('confirmation_event_project_mismatch');
        if (event.role !== 'user')
            throw new Error('confirmation_event_must_be_user');
        return event;
    }
    requireReplacement(candidateId, projectId) {
        const replacement = this.candidates.getCandidate(candidateId);
        const run = replacement ? this.candidates.getRun(replacement.runId) : null;
        if (!replacement || run?.projectId !== projectId)
            throw new Error('replacement_candidate_project_mismatch');
    }
}
function appendConfirmationEvidence(value, eventId) {
    const evidence = Array.isArray(value) ? [...value] : [];
    if (!evidence.some((item) => asObject(item).eventId === eventId))
        evidence.push({ eventId, role: 'user', source: 'manual_review_confirmation' });
    return evidence;
}
function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function required(value, field) {
    if (!value?.trim())
        throw new Error(`${field}_required`);
    return value.trim();
}
