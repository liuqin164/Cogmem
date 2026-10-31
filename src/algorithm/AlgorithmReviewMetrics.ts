import type { FactRecord } from '../store/FactStore.js';

export interface AlgorithmReviewMetricsSnapshot {
  backendMode: 'noop' | 'phase1_rule' | 'model_backed_phase2';
  reviewVersion?: string;
  facts: FactRecord[];
  baselineFacts?: FactRecord[];
}

export interface AlgorithmReviewMetricsSummary {
  backendMode: AlgorithmReviewMetricsSnapshot['backendMode'];
  reviewVersion?: string;
  provisionalToVerifiedPromotionCount: number;
  provisionalToVerifiedPromotionRate: number;
  keepProvisionalCount: number;
  keepProvisionalRate: number;
  supersedeCount: number;
  rejectArchiveCount: number;
  selfCorrectionRepairHitCount: number;
  multiFactRepairCompletenessDelta: number;
  aliasMergeSuggestionPrecisionProxy: number | null;
  backendOutcomeDifferenceCount: number;
}
