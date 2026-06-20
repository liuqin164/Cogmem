export type EpisodeStatus = 'open' | 'soft_sealed' | 'sealed';
export type EpisodeDreamState = 'pending' | 'processing' | 'processed' | 'failed' | 'skipped';
export type EpisodeClosureMode = 'soft' | 'hard' | 'manual' | 'batch';
export type EpisodeType = 'discussion' | 'decision' | 'correction' | 'preference' | 'goal' | 'debugging' | 'planning' | 'prospective' | 'general';
export type TurnRelation =
  | 'continues_previous'
  | 'clarifies_previous'
  | 'corrects_previous'
  | 'answers_assistant_question'
  | 'accepts_assistant_proposal'
  | 'rejects_assistant_proposal'
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
  topicPath?: string;
  episodeType: EpisodeType;
  status: EpisodeStatus;
  importance: number;
  summary?: string;
  startEventId: string;
  endEventId: string;
  startSeq?: number;
  endSeq?: number;
  eventCount: number;
  startedAt: number;
  updatedAt: number;
  sealedAt?: number;
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
  sourceEventIds: string[];
  startSeq?: number;
  endSeq?: number;
  topicPath?: string;
  episodeType: EpisodeType;
  importance: number;
  dreamRecommended: boolean;
  dreamMode: 'micro' | 'normal' | 'deep';
  createdAt: number;
}

export interface EpisodeDreamStatus {
  projectId?: string;
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  skipped: number;
}

export interface EpisodeListOptions {
  projectId?: string;
  sessionId?: string;
  statuses?: EpisodeStatus[];
  limit?: number;
}
