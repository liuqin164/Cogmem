import type { MemoryEvent } from '../types/index.js';
import { classifyAssistantRelation, classifyTurnRelation, type TurnClassificationContext, type TurnRelationDecision } from './TurnRelationClassifier.js';
import type { EpisodeClosureReceipt, MemoryEpisode, TurnRelation } from './EpisodeTypes.js';
import { EpisodeStore } from './EpisodeStore.js';

export interface EpisodeAssemblyResult {
  episode?: MemoryEpisode;
  assignedEventIds: string[];
  unassignedEventIds: string[];
  ignoredEventIds: string[];
  closureReceipt?: EpisodeClosureReceipt;
  reopened: boolean;
}

export class EpisodeAssembler {
  constructor(
    private readonly store: EpisodeStore,
    private readonly resolveEvent?: (eventId: string) => MemoryEvent | null | undefined,
    private readonly softReopenWindowMs = 30 * 60_000,
  ) {}

  appendTurn(events: MemoryEvent[], input: {
    projectId: string;
    sessionId: string;
    sourceAgent?: string;
    conversationThreadId?: string;
    now?: number;
    batchSeal?: boolean;
    forceBatchSeal?: boolean;
  }): EpisodeAssemblyResult {
    const ordered = [...events].sort((a, b) => (a.eventOrdinal || 0) - (b.eventOrdinal || 0));
    if (!ordered.length) return { assignedEventIds: [], unassignedEventIds: [], ignoredEventIds: [], reopened: false };
    const mismatched = ordered.find((event) => event.projectId && event.projectId !== input.projectId);
    if (mismatched) throw new Error(`episode_project_mismatch:${mismatched.eventId}`);
    const primary = ordered.find((event) => event.role === 'user') || ordered[0];
    const conversationThreadId = input.conversationThreadId || primary.threadId || input.sessionId;
    let episode = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, conversationThreadId);
    if (episode && !episode.sourceAgent && !episode.conversationThreadId) {
      episode = this.store.claimLegacyEpisodeScope(episode.episodeId, input.sourceAgent, conversationThreadId);
    }
    const decision = this.classifyPrimary(primary, episode);
    let reopened = false;
    let closureReceipt: EpisodeClosureReceipt | undefined;
    let linkedEpisodeId: string | undefined;
    const now = input.now ?? Math.max(...ordered.map((event) => event.occurredAt || Date.now()));

    if (decision.relation === 'noise') {
      for (const event of ordered) {
        this.store.markEventDisposition({
          eventId: event.eventId, projectId: input.projectId, disposition: 'ignored', reason: 'deterministic_noise', now,
        });
      }
      return { assignedEventIds: [], unassignedEventIds: [], ignoredEventIds: ordered.map((event) => event.eventId), reopened: false };
    }

    if (episode?.status === 'open' && decision.relation === 'hard_topic_switch') {
      closureReceipt = this.store.sealEpisode(episode.episodeId, {
        mode: 'hard', reason: 'explicit_topic_switch', reasonCode: 'topic_switch', now,
      });
      episode = undefined;
    }
    if (episode?.status === 'open' && decision.relation === 'ambiguous_shift') {
      linkedEpisodeId = episode.episodeId;
      closureReceipt = this.store.sealEpisode(episode.episodeId, {
        mode: 'soft', reason: 'ambiguous_topic_shift', reasonCode: 'topic_switch', requiresReview: true, now,
      });
      episode = undefined;
    }

    if (episode?.status === 'soft_sealed') {
      const mayReopen = decision.relation !== 'starts_new_topic'
        && decision.relation !== 'switches_topic'
        && now - (episode.sealedAt || episode.updatedAt) <= this.softReopenWindowMs;
      if (mayReopen) {
        episode = this.store.reopenSoftEpisode(episode.episodeId, now);
        reopened = true;
      } else {
        episode = undefined;
      }
    }
    if (!episode) {
      episode = this.store.createEpisode({
        projectId: input.projectId, sessionId: input.sessionId, sourceAgent: input.sourceAgent,
        conversationThreadId,
        episodeType: decision.episodeType, importance: decision.importance,
        eventId: primary.eventId, globalSeq: primary.globalSeq, occurredAt: primary.occurredAt || now,
        episodeTags: [decision.episodeType, ...decision.candidateTypes],
        candidateTypes: decision.candidateTypes,
        importanceSignals: decision.signals,
        importanceReason: decision.rationale,
        linkedEpisodeId,
      });
    }

    const assignedEventIds: string[] = [];
    for (const event of ordered) {
      const existing = this.store.getEventLink(event.eventId);
      if (existing) { assignedEventIds.push(event.eventId); continue; }
      const relation: TurnRelation = event.role === 'assistant' || event.role === 'agent'
        ? classifyAssistantRelation(eventText(event), 'assistant')
        : event.role === 'tool'
          ? 'tool_result_context'
          : decision.relation;
      this.store.appendEvent({
        episodeId: episode.episodeId, eventId: event.eventId, relation,
        confidence: event.eventId === primary.eventId ? decision.confidence : 0.9,
        globalSeq: event.globalSeq, occurredAt: event.occurredAt || now,
        episodeType: decision.episodeType, importance: decision.importance,
        summaryText: summaryLine(event),
        candidateTypes: decision.candidateTypes,
        importanceSignals: decision.signals,
        importanceReason: decision.rationale,
      });
      assignedEventIds.push(event.eventId);
    }

    if (input.batchSeal) {
      const confidence = averageConfidence(this.store.listEventLinks(episode.episodeId));
      const requiresReview = !input.forceBatchSeal && confidence < 0.6;
      closureReceipt = this.store.sealEpisode(episode.episodeId, {
        mode: requiresReview ? 'soft' : 'batch', reason: requiresReview ? 'batch_low_confidence_review' : 'batch_boundary',
        reasonCode: 'batch_boundary', requiresReview, now,
      });
    } else if (decision.relation === 'closes_episode') {
      closureReceipt = this.store.sealEpisode(episode.episodeId, { mode: 'hard', reason: 'explicit_user_closure', now });
    }
    return { episode: this.store.getEpisode(episode.episodeId), assignedEventIds, unassignedEventIds: [], ignoredEventIds: [], closureReceipt, reopened };
  }

  appendEvent(event: MemoryEvent, input: { projectId: string; sessionId: string; sourceAgent?: string; now?: number }): EpisodeAssemblyResult {
    const active = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, event.threadId || input.sessionId);
    if (!active && event.role !== 'user') {
      return { assignedEventIds: [], unassignedEventIds: [event.eventId], ignoredEventIds: [], reopened: false };
    }
    return this.appendTurn([event], input);
  }

  private classificationContext(primary: MemoryEvent, episode?: MemoryEpisode): TurnClassificationContext {
    const context: TurnClassificationContext = {
      currentUserText: eventText(primary),
      activeEpisodeSummary: episode?.semanticSummary?.userPosition || episode?.summary,
      activeEpisodeTopicPath: episode?.topicPath,
    };
    if (!episode || !this.resolveEvent) return context;
    const prior = this.store.listEventLinks(episode.episodeId)
      .map((link) => this.resolveEvent!(link.eventId))
      .filter((event): event is MemoryEvent => Boolean(event));
    const previousUser = [...prior].reverse().find((event) => event.role === 'user');
    const previousAssistant = [...prior].reverse().find((event) => event.role === 'assistant' || event.role === 'agent');
    context.previousUserText = previousUser ? eventText(previousUser) : undefined;
    context.previousAssistantText = previousAssistant ? eventText(previousAssistant) : undefined;
    context.recentRelations = this.store.listEventLinks(episode.episodeId).slice(-5).map((link) => link.relation);
    return context;
  }

  private classifyPrimary(primary: MemoryEvent, episode?: MemoryEpisode): TurnRelationDecision {
    if (primary.role === 'user') return classifyTurnRelation(this.classificationContext(primary, episode));
    return {
      relation: classifyAssistantRelation(eventText(primary), primary.role || 'assistant'),
      confidence: 0.9,
      signals: ['non_user_context_only'],
      needsLlmReview: false,
      candidateTypes: [],
      closureCandidate: false,
      episodeType: 'discussion',
      importance: 0.3,
      rationale: 'non_user_event_requires_later_user_evidence',
    };
  }
}

function eventText(event: MemoryEvent): string {
  const payload = event.payload as { text?: unknown } | undefined;
  return typeof payload?.text === 'string'
    ? payload.text
      .replace(/<(COGMEM_RECALL_CONTEXT|COGMEM_TURN_BRIDGE|COGMEM_SESSION_STATE|COGMEM_STRATEGY_CONTEXT)\b[\s\S]*?<\/\1>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    : '';
}

function summaryLine(event: MemoryEvent): string {
  const text = eventText(event).replace(/\s+/g, ' ').trim().slice(0, 240);
  return `${event.role || event.rawEventType || 'event'}: ${text}`;
}

function averageConfidence(links: Array<{ confidence: number }>): number {
  return links.length ? links.reduce((total, link) => total + link.confidence, 0) / links.length : 0;
}
