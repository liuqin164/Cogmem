export type EpisodeStatus = 'open' | 'soft_sealed' | 'sealed';
export type EpisodeDreamState =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'retry_scheduled'
  | 'skipped';
export type EpisodeDreamStatusValue = 'none' | 'queued' | 'processing' | 'processed' | 'failed';
export type EpisodeClosureMode = 'soft' | 'hard' | 'manual' | 'batch';
export type EpisodeClosureReasonCode =
  | 'explicit_user_closure'
  | 'topic_switch'
  | 'batch_boundary'
  | 'idle_timeout'
  | 'manual'
  | 'soft_seal_stabilized'
  | 'repair';
export type EpisodeType = 'discussion' | 'decision' | 'correction' | 'preference' | 'goal' | 'debugging' | 'planning' | 'prospective' | 'general';
export type EpisodeCandidateType = 'belief' | 'entity' | 'temporal' | 'prospective' | 'correction' | 'preference' | 'goal' | 'decision';
export type TurnRelation =
  | 'continues_previous'
  | 'clarifies_previous'
  | 'corrects_previous'
  | 'answers_assistant_question'
  | 'accepts_assistant_proposal'
  | 'rejects_assistant_proposal'
  | 'assistant_response'
  | 'assistant_proposal'
  | 'assistant_summary'
  | 'assistant_question'
  | 'assistant_clarification'
  | 'tool_result_context'
  | 'hard_topic_switch'
  | 'subtopic_shift'
  | 'ambiguous_shift'
  | 'switches_topic'
  | 'starts_new_topic'
  | 'returns_to_old_topic'
  | 'confirms_future_intent'
  | 'closes_episode'
  | 'noise';

export interface MemoryEpisode {
  episodeId: string;
  projectId: string;
  sessionId: string;
  sourceAgent?: string;
  conversationThreadId?: string;
  topicPath?: string;
  episodeType: EpisodeType;
  status: EpisodeStatus;
  importance: number;
  summary?: string;
  semanticSummary?: EpisodeSemanticSummary;
  episodeTags: string[];
  candidateTypes: EpisodeCandidateType[];
  importanceSignals: string[];
  importanceReason?: string;
  linkedEpisodeId?: string;
  dreamStatus: EpisodeDreamStatusValue;
  lastDreamRunId?: string;
  lastDreamedAt?: number;
  dreamCandidateCount: number;
  dreamError?: string;
  startEventId: string;
  endEventId: string;
  startSeq?: number;
  endSeq?: number;
  eventCount: number;
  startedAt: number;
  updatedAt: number;
  sealedAt?: number;
}

export interface EpisodeSemanticSummary {
  userPosition: string;
  assistantContribution: string;
  decision?: string;
  correction?: string;
  openQuestions: string[];
  candidateTypes: EpisodeCandidateType[];
  evidenceEventIds: string[];
  evidenceAuthority: 'raw_event_ids_only';
}

export interface EpisodeEventLink {
  episodeId: string;
  eventId: string;
  position: number;
  relation: TurnRelation;
  confidence: number;
  createdAt: number;
}

export interface EpisodeClosureReceipt {
  receiptId: string;
  episodeId: string;
  projectId: string;
  closureMode: EpisodeClosureMode;
  closureReason: string;
  closureReasonCode: EpisodeClosureReasonCode;
  closureReasonDetail?: string;
  sourceEventIds: string[];
  startSeq?: number;
  endSeq?: number;
  topicPath?: string;
  episodeType: EpisodeType;
  importance: number;
  dreamRecommended: boolean;
  dreamMode: 'micro' | 'normal' | 'deep';
  requiresReview: boolean;
  ignoredNearbyEventIds: string[];
  unassignedNearbyEventIds: string[];
  createdAt: number;
}

export interface EpisodeDreamStatus {
  projectId?: string;
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  failedRetryable: number;
  failedTerminal: number;
  retryScheduled: number;
  skipped: number;
}

export interface EpisodeListOptions {
  projectId?: string;
  sessionId?: string;
  statuses?: EpisodeStatus[];
  limit?: number;
}
