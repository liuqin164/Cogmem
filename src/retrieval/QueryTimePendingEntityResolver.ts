import type { SemanticCompilation } from '../engine/LocalSemanticCompiler.js';
import type { EntityResolutionResult } from '../engine/EntityResolutionEngine.js';
import {
  extractRelativeReferences,
  inferReferenceType,
  isLatestReference,
  isPreviousReference,
  normalizeLexiconText
} from '../lexicon/coreMemoryLexicon.js';
import type { EntityDisambiguationCandidate, EntityStore, PendingEntityResolutionRecord } from '../store/EntityStore.js';
import type { QueryIR } from '../types/query-ir.js';
import type { Neuron } from '../types/index.js';
import { projectScope } from '../topology/ProjectScope.js';

export type QueryTimePendingResolutionStatus =
  | 'not_applicable'
  | 'not_needed'
  | 'narrowed_but_still_ambiguous'
  | 'resolved_narrowly'
  | 'unresolved_explicit';

export type QueryTimePendingResolutionReason =
  | 'no_relative_pending_reference_in_query'
  | 'no_matching_pending_reference'
  | 'write_time_resolution_already_sufficient'
  | 'pending_capture_missing_or_too_weak'
  | 'pending_relative_reference_narrowed'
  | 'pending_relative_reference_ambiguous_after_narrowing'
  | 'pending_reference_still_unresolved';

export interface QueryTimePendingResolutionCandidate {
  entityId: string;
  score: number;
  reasons: string[];
}

export interface QueryTimePendingEntityResolutionResult {
  reference: string;
  queryTimeResolutionStatus: QueryTimePendingResolutionStatus;
  queryTimeResolutionReason: QueryTimePendingResolutionReason;
  resolutionConfidence: number;
  candidateEntityIds: string[];
  narrowedCandidates: QueryTimePendingResolutionCandidate[];
  matchedPendingIds: string[];
  contextNeuronIds: string[];
  resolvedInstanceId?: string;
}

export interface QueryTimePendingEntityResolverInput {
  query: string;
  ir: QueryIR;
  semanticCompilation: SemanticCompilation;
  baseEntityResolution: EntityResolutionResult;
  projectId?: string;
}

export interface QueryTimePendingEntityResolverOutput {
  overallStatus: QueryTimePendingResolutionStatus;
  overallReason: QueryTimePendingResolutionReason;
  resolvedEntityIds: string[];
  candidateEntityIds: string[];
  candidateNeuronIds: string[];
  results: QueryTimePendingEntityResolutionResult[];
  pendingCaptureMetrics: WriteTimePendingCaptureMetrics;
}

export interface WriteTimePendingCaptureMetrics {
  pending_record_emitted_count: number;
  pending_record_expected_but_missing_count: number;
  pending_candidate_set_nonempty_count: number;
  pending_candidate_set_empty_count: number;
  referential_signal_preserved_count: number;
  referential_signal_lost_count: number;
  query_time_not_needed_due_to_write_time_sufficient_count: number;
  query_time_not_needed_due_to_missing_pending_capture_count: number;
}

export class QueryTimePendingEntityResolver {
  constructor(
    private entityStore: EntityStore,
    private getNeuronById: (neuronId: string) => Neuron | null,
    private resolveBeforeTime: (ir: QueryIR) => number | undefined
  ) {}

  resolve(input: QueryTimePendingEntityResolverInput): QueryTimePendingEntityResolverOutput {
    const references = this.collectRelativeReferences(input);
    if (references.length === 0) {
      return {
        overallStatus: 'not_applicable',
        overallReason: 'no_relative_pending_reference_in_query',
        resolvedEntityIds: [],
        candidateEntityIds: [],
        candidateNeuronIds: [],
        results: [],
        pendingCaptureMetrics: emptyPendingCaptureMetrics()
      };
    }

    const pendingRecords = this.entityStore.listPendingResolutions({ status: 'pending', projectId: input.projectId });
    const beforeTime = this.resolveBeforeTime(input.ir);
    const results: QueryTimePendingEntityResolutionResult[] = [];

    for (const reference of references) {
      const matchingPending = this.findMatchingPendingRecords(reference, pendingRecords, input);
      if (matchingPending.length === 0) {
        const queryTimeResolutionReason = this.inferNoPendingReason(reference, pendingRecords, input);
        results.push({
          reference,
          queryTimeResolutionStatus: 'not_needed',
          queryTimeResolutionReason,
          resolutionConfidence: 0,
          candidateEntityIds: [],
          narrowedCandidates: [],
          matchedPendingIds: [],
          contextNeuronIds: []
        });
        continue;
      }

      const normalizedReference = normalizePendingReference(reference);
      const contextNeuronIds = matchingPending
        .map((record) => record.contextNeuronId)
        .filter((id): id is string => Boolean(id));
      const effectiveProjectId = this.inferPendingScopedProjectId(matchingPending) ?? input.projectId;

      const typeHint = matchingPending[0]?.entityType || inferReferenceType(normalizedReference, input.query);
      const candidates = this.entityStore.listReferenceCandidatesWithRelativeSupport(reference, typeHint, {
        projectId: effectiveProjectId,
        beforeTime
      }).slice(0, 4);
      const narrowedCandidates = candidates.map((candidate) => ({
        entityId: candidate.entity.entityId,
        score: candidate.score,
        reasons: candidate.reasons
      }));

      if (candidates.length === 0) {
        results.push({
          reference,
          queryTimeResolutionStatus: 'unresolved_explicit',
          queryTimeResolutionReason: 'pending_reference_still_unresolved',
          resolutionConfidence: 0.12,
          candidateEntityIds: [],
          narrowedCandidates: [],
          matchedPendingIds: matchingPending.map((record) => record.pendingId),
          contextNeuronIds
        });
        continue;
      }

      const topCandidate = candidates[0];
      const secondCandidate = candidates[1];
      const canResolveNarrowly = this.canResolveNarrowly(topCandidate, secondCandidate);

      if (canResolveNarrowly && topCandidate) {
        results.push({
          reference,
          queryTimeResolutionStatus: 'resolved_narrowly',
          queryTimeResolutionReason: 'pending_relative_reference_narrowed',
          resolutionConfidence: topCandidate.score,
          candidateEntityIds: narrowedCandidates.map((candidate) => candidate.entityId),
          narrowedCandidates,
          matchedPendingIds: matchingPending.map((record) => record.pendingId),
          contextNeuronIds,
          resolvedInstanceId: topCandidate.entity.entityId
        });
        continue;
      }

      results.push({
        reference,
        queryTimeResolutionStatus: 'narrowed_but_still_ambiguous',
        queryTimeResolutionReason: 'pending_relative_reference_ambiguous_after_narrowing',
        resolutionConfidence: topCandidate?.score || 0.36,
        candidateEntityIds: narrowedCandidates.map((candidate) => candidate.entityId),
        narrowedCandidates,
        matchedPendingIds: matchingPending.map((record) => record.pendingId),
        contextNeuronIds
      });
    }

    return {
      overallStatus: this.inferOverallStatus(results),
      overallReason: this.inferOverallReason(results),
      resolvedEntityIds: Array.from(new Set(
        results
          .filter((result) => result.queryTimeResolutionStatus === 'resolved_narrowly')
          .map((result) => result.resolvedInstanceId)
          .filter((id): id is string => Boolean(id))
      )),
      candidateEntityIds: Array.from(new Set(results.flatMap((result) => result.candidateEntityIds))),
      candidateNeuronIds: Array.from(new Set(results.flatMap((result) => result.contextNeuronIds))),
      results,
      pendingCaptureMetrics: this.computePendingCaptureMetrics(pendingRecords, results)
    };
  }

  private collectRelativeReferences(input: QueryTimePendingEntityResolverInput): string[] {
    return Array.from(new Set([
      ...input.semanticCompilation.relativeReferences,
      ...input.ir.entities,
      ...input.ir.semantics.entityHints
    ]))
      .map((reference) => reference.trim())
      .filter(Boolean)
      .filter((reference) => extractRelativeReferences(normalizeLexiconText(reference)).length > 0);
  }

  private findMatchingPendingRecords(
    reference: string,
    pendingRecords: PendingEntityResolutionRecord[],
    input: QueryTimePendingEntityResolverInput
  ): PendingEntityResolutionRecord[] {
    const normalizedReference = normalizePendingReference(reference);
    const referenceSignals = new Set(extractRelativeReferences(normalizedReference).map(normalizePendingReference));
    if (referenceSignals.size === 0) referenceSignals.add(normalizedReference);

    const matchingPending = pendingRecords.filter((record) => {
      const normalizedPending = normalizePendingReference(record.referenceText);
      const pendingSignals = new Set(extractRelativeReferences(normalizedPending).map(normalizePendingReference));
      if (pendingSignals.size === 0) pendingSignals.add(normalizedPending);
      const sharesRelativePolarity = Array.from(referenceSignals).some((signal) =>
        Array.from(pendingSignals).some((pendingSignal) =>
          (isPreviousReference(signal) && isPreviousReference(pendingSignal))
          || (isLatestReference(signal) && isLatestReference(pendingSignal))
        )
      );
      return normalizedPending === normalizedReference
        || normalizedPending.includes(normalizedReference)
        || normalizedReference.includes(normalizedPending)
        || Array.from(referenceSignals).some((signal) => pendingSignals.has(signal))
        || sharesRelativePolarity;
    });

    if (matchingPending.length > 0) return matchingPending;
    return this.findSameTypePendingFallback(reference, pendingRecords, input);
  }

  private canResolveNarrowly(
    topCandidate?: EntityDisambiguationCandidate,
    secondCandidate?: EntityDisambiguationCandidate
  ): boolean {
    if (!topCandidate) return false;
    if (topCandidate.score < 0.7) return false;
    if (!secondCandidate) return true;
    return (topCandidate.score - secondCandidate.score) >= 0.2;
  }

  private inferOverallStatus(results: QueryTimePendingEntityResolutionResult[]): QueryTimePendingResolutionStatus {
    if (results.some((result) => result.queryTimeResolutionStatus === 'resolved_narrowly')) return 'resolved_narrowly';
    if (results.some((result) => result.queryTimeResolutionStatus === 'narrowed_but_still_ambiguous')) return 'narrowed_but_still_ambiguous';
    if (results.some((result) => result.queryTimeResolutionStatus === 'unresolved_explicit')) return 'unresolved_explicit';
    if (results.some((result) => result.queryTimeResolutionStatus === 'not_needed')) return 'not_needed';
    return 'not_applicable';
  }

  private inferOverallReason(results: QueryTimePendingEntityResolutionResult[]): QueryTimePendingResolutionReason {
    const priority: QueryTimePendingResolutionReason[] = [
      'pending_relative_reference_narrowed',
      'pending_relative_reference_ambiguous_after_narrowing',
      'pending_reference_still_unresolved',
      'pending_capture_missing_or_too_weak',
      'no_matching_pending_reference',
      'write_time_resolution_already_sufficient'
    ];
    for (const reason of priority) {
      if (results.some((result) => result.queryTimeResolutionReason === reason)) return reason;
    }
    return 'no_relative_pending_reference_in_query';
  }

  private inferNoPendingReason(
    reference: string,
    pendingRecords: PendingEntityResolutionRecord[],
    input: QueryTimePendingEntityResolverInput
  ): QueryTimePendingResolutionReason {
    if (this.hasWriteTimeSufficientEntityResolution(reference, input)) {
      return 'write_time_resolution_already_sufficient';
    }
    if (pendingRecords.length === 0) return 'pending_capture_missing_or_too_weak';
    return 'no_matching_pending_reference';
  }

  private hasWriteTimeSufficientEntityResolution(
    reference: string,
    input: QueryTimePendingEntityResolverInput
  ): boolean {
    const normalizedReference = normalizePendingReference(reference);
    return input.semanticCompilation.relativeReferences.some((item) => normalizePendingReference(item) === normalizedReference)
      && input.baseEntityResolution.disambiguation.some((item) =>
        normalizePendingReference(item.reference) === normalizedReference
        && item.candidates.length > 0
      );
  }

  private computePendingCaptureMetrics(
    pendingRecords: PendingEntityResolutionRecord[],
    results: QueryTimePendingEntityResolutionResult[]
  ): WriteTimePendingCaptureMetrics {
    const expectedButMissing = results.filter((result) => result.queryTimeResolutionReason === 'pending_capture_missing_or_too_weak').length;
    const notNeededSufficient = results.filter((result) => result.queryTimeResolutionReason === 'write_time_resolution_already_sufficient').length;
    const matchedResults = results.filter((result) => result.matchedPendingIds.length > 0);
    return {
      pending_record_emitted_count: pendingRecords.length,
      pending_record_expected_but_missing_count: expectedButMissing,
      pending_candidate_set_nonempty_count: results.filter((result) => result.candidateEntityIds.length > 0).length,
      pending_candidate_set_empty_count: matchedResults.filter((result) => result.candidateEntityIds.length === 0).length,
      referential_signal_preserved_count: matchedResults.length + notNeededSufficient,
      referential_signal_lost_count: expectedButMissing,
      query_time_not_needed_due_to_write_time_sufficient_count: notNeededSufficient,
      query_time_not_needed_due_to_missing_pending_capture_count: expectedButMissing
    };
  }

  private inferPendingScopedProjectId(records: PendingEntityResolutionRecord[]): string | undefined {
    const projectIds = new Set(
      records
        .map((record) => record.contextNeuronId ? projectScope(this.getNeuronById(record.contextNeuronId)?.metadata.projectId) : undefined)
        .filter((projectId): projectId is string => projectId !== undefined)
    );
    return projectIds.size === 1 ? Array.from(projectIds)[0] : undefined;
  }

  private findSameTypePendingFallback(
    reference: string,
    pendingRecords: PendingEntityResolutionRecord[],
    input: QueryTimePendingEntityResolverInput
  ): PendingEntityResolutionRecord[] {
    const normalizedReference = normalizePendingReference(reference);
    const inferredType = inferReferenceType(normalizedReference, input.query);
    if (!inferredType || hasDirectionalRelativeSignal(normalizedReference)) return [];

    const sameTypePending = pendingRecords.filter((record) => !record.entityType || record.entityType === inferredType);

    return sameTypePending;
  }
}

function emptyPendingCaptureMetrics(): WriteTimePendingCaptureMetrics {
  return {
    pending_record_emitted_count: 0,
    pending_record_expected_but_missing_count: 0,
    pending_candidate_set_nonempty_count: 0,
    pending_candidate_set_empty_count: 0,
    referential_signal_preserved_count: 0,
    referential_signal_lost_count: 0,
    query_time_not_needed_due_to_write_time_sufficient_count: 0,
    query_time_not_needed_due_to_missing_pending_capture_count: 0
  };
}

function normalizePendingReference(reference: string): string {
  return normalizeLexiconText(reference).toLowerCase();
}

function hasDirectionalRelativeSignal(reference: string): boolean {
  const relativeSignals = extractRelativeReferences(reference).map((signal) => normalizePendingReference(signal));
  return relativeSignals.some((signal) => isPreviousReference(signal) || isLatestReference(signal));
}
