import type { MemoryEvent } from '../types/index.js';
import type {
  MemoryBindingAction,
  MemoryBindingInput,
  MemoryBindingRecord,
  MemoryEntityType,
  MemoryGraphRecallAnchor,
} from './MemoryBindingTypes.js';
import { MemoryBindingStore } from '../store/MemoryBindingStore.js';
import { EntityStore } from '../store/EntityStore.js';
import { BindingClassifier, normalizeForBinding, type BindingTopicDecision } from './BindingClassifier.js';
import { BindingDecisionEngine } from './BindingDecisionEngine.js';

export interface MemoryBindingEventInput {
  eventId: string;
  projectId?: string;
  role?: string;
  rawEventType?: string;
  text: string;
  occurredAt?: number;
}

export class MemoryBindingService {
  private readonly classifier = new BindingClassifier();
  private readonly decisionEngine = new BindingDecisionEngine();

  constructor(
    private readonly store: MemoryBindingStore,
    private readonly entityStore?: EntityStore,
  ) {}

  bindRawEvent(event: MemoryEvent): MemoryBindingRecord[] {
    const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
    const text = typeof payload.text === 'string'
      ? payload.text
      : typeof payload.output === 'string'
        ? payload.output
        : typeof payload.title === 'string'
          ? payload.title
          : JSON.stringify(event.payload);
    return this.bindEvent({
      eventId: event.eventId,
      projectId: event.projectId,
      role: event.role,
      rawEventType: event.rawEventType,
      text,
      occurredAt: event.occurredAt,
    });
  }

  bindEvent(input: MemoryBindingEventInput): MemoryBindingRecord[] {
    if (input.role !== 'user') return [];
    if (input.rawEventType && input.rawEventType !== 'message') return [];

    const text = normalizeForBinding(input.text);
    const decisions = this.classifier.classify(text);
    if (decisions.length === 0) return [];

    const createdAt = input.occurredAt ?? Date.now();
    const bindings: MemoryBindingRecord[] = [];
    for (const decision of decisions) {
      const canonicalEntity = decision.entityName && this.entityStore
        ? this.entityStore.upsertEntity({
          canonicalName: decision.entityName,
          type: decision.entityType || 'concept',
          aliases: decision.aliases,
          createdFrom: input.eventId,
          metadata: { projectId: input.projectId, evidenceEventId: input.eventId },
          createdAt,
        })
        : undefined;
      const entity = decision.entityName
        ? this.store.upsertEntity({
          entityId: canonicalEntity?.entityId,
          projectId: input.projectId,
          canonicalName: decision.entityName,
          entityType: decision.entityType || 'concept',
          aliases: decision.aliases,
          stablePath: entityStablePath(decision.entityType || 'concept', decision.entityName),
          now: createdAt,
        })
        : undefined;
      this.store.upsertTopic({
        projectId: input.projectId,
        topicPath: decision.topicPath,
        topicType: decision.topicType,
        summary: decision.summary,
        now: createdAt,
      });
      const related = this.store.listBindings({
        projectId: input.projectId,
        topicPath: decision.topicPath,
        role: 'user',
        limit: 8,
      }).filter((binding) => binding.eventId !== input.eventId);
      const clusterStatus = decision.bindingType === 'correction' ? 'possible_conflict' : 'active';
      const cluster = this.store.upsertCluster({
        projectId: input.projectId,
        topicPath: decision.topicPath,
        clusterType: decision.bindingType,
        title: clusterTitle(decision.topicPath, decision.bindingType),
        summary: decision.summary,
        claimKey: decision.claimKey,
        status: 'active',
        reviewFlags: clusterStatus === 'possible_conflict' ? ['possible_conflict'] : [],
        confidence: decision.confidence,
        eventId: input.eventId,
        now: createdAt,
      });
      const bindingAction = this.decisionEngine.decide({
        bindingType: decision.bindingType,
        relatedCount: related.length,
        supportCount: cluster.supportCount,
        relatedBindingTypes: related.map((binding) => binding.bindingType),
      });
      const binding: MemoryBindingInput = {
        eventId: input.eventId,
        projectId: input.projectId,
        role: input.role,
        rawEventType: input.rawEventType,
        entityId: entity?.entityId,
        entityName: entity?.canonicalName,
        entityType: entity?.entityType,
        topicPath: decision.topicPath,
        bindingType: decision.bindingType,
        confidence: decision.confidence,
        source: 'deterministic',
        signal: decision.signal,
        claimKey: decision.claimKey,
        bindingAction,
        clusterId: cluster.clusterId,
        relatedEventIds: related.map((item) => item.eventId),
        createdAt,
      };
      const inserted = this.store.insertBinding(binding);
      this.store.upsertEdge({
        projectId: input.projectId,
        sourceType: 'event',
        sourceId: input.eventId,
        relationType: 'ABOUT',
        targetType: 'topic',
        targetId: decision.topicPath,
        confidence: decision.confidence,
        evidenceEventIds: [input.eventId],
        createdAt,
      });
      this.store.upsertEdge({
        projectId: input.projectId,
        sourceType: 'event',
        sourceId: input.eventId,
        relationType: 'SUPPORTS',
        targetType: 'cluster',
        targetId: cluster.clusterId,
        confidence: decision.confidence,
        evidenceEventIds: [input.eventId],
        createdAt,
      });
      this.store.upsertEdge({
        projectId: input.projectId,
        sourceType: 'cluster',
        sourceId: cluster.clusterId,
        relationType: 'BELONGS_TO',
        targetType: 'topic',
        targetId: decision.topicPath,
        confidence: decision.confidence,
        evidenceEventIds: cluster.evidenceEventIds,
        createdAt,
      });
      if (entity) {
        this.store.upsertEdge({
          projectId: input.projectId,
          sourceType: 'event',
          sourceId: input.eventId,
          relationType: 'MENTIONS',
          targetType: 'entity',
          targetId: entity.entityId,
          confidence: decision.confidence,
          evidenceEventIds: [input.eventId],
          createdAt,
        });
      }
      for (const relatedBinding of related.slice(0, 5)) {
        this.store.upsertEdge({
          projectId: input.projectId,
          sourceType: 'event',
          sourceId: input.eventId,
          relationType: 'SAME_TOPIC_AS',
          targetType: 'event',
          targetId: relatedBinding.eventId,
          confidence: Math.min(decision.confidence, relatedBinding.confidence),
          evidenceEventIds: [input.eventId, relatedBinding.eventId],
          createdAt,
        });
      }
      if (decision.bindingType === 'correction') {
        for (const relatedBinding of related.slice(0, 3)) {
          this.store.upsertEdge({
            projectId: input.projectId,
            sourceType: 'event',
            sourceId: input.eventId,
            relationType: 'CORRECTS',
            targetType: 'event',
            targetId: relatedBinding.eventId,
            confidence: Math.min(decision.confidence, relatedBinding.confidence),
            evidenceEventIds: [input.eventId, relatedBinding.eventId],
            createdAt,
          });
          if (/不对|错了|wrong|contradict|不是/.test(text.toLowerCase())) {
            this.store.upsertEdge({
              projectId: input.projectId,
              sourceType: 'event',
              sourceId: input.eventId,
              relationType: 'CONTRADICTS',
              targetType: 'event',
              targetId: relatedBinding.eventId,
              confidence: Math.min(decision.confidence, relatedBinding.confidence),
              evidenceEventIds: [input.eventId, relatedBinding.eventId],
              createdAt,
            });
          }
        }
      }
      bindings.push(inserted);
    }
    return bindings;
  }

  isBindableRawEvent(event: MemoryEvent): boolean {
    if (event.role !== 'user') return false;
    if (event.rawEventType && event.rawEventType !== 'message') return false;
    return this.classifier.isBindableText(this.rawEventText(event));
  }

  recallGraphAnchors(query: string, options: { projectId?: string; limit?: number } = {}): MemoryGraphRecallAnchor[] {
    const text = normalizeForBinding(query);
    if (!text) return [];
    const decisions = this.classifier.classify(text);
    if (decisions.length === 0) return [];

    const limit = Math.max(1, Math.min(options.limit ?? 8, 50));
    const anchors: MemoryGraphRecallAnchor[] = [];
    const seen = new Set<string>();

    for (const decision of decisions) {
      const bindings = this.store.listBindings({
        projectId: options.projectId,
        topicPath: decision.topicPath,
        role: 'user',
        limit: Math.max(limit * 4, 20),
      }).sort((a, b) => bindingRank(b, decision) - bindingRank(a, decision));
      for (const binding of bindings) {
        if (seen.has(binding.eventId)) continue;
        seen.add(binding.eventId);
        anchors.push({
          eventId: binding.eventId,
          projectId: binding.projectId,
          topicPath: binding.topicPath,
          clusterId: binding.clusterId,
          confidence: bindingRank(binding, decision),
          whyMatched: 'memory_binding_graph',
        });
        if (anchors.length >= limit) return anchors;
      }
    }

    return anchors;
  }

  private rawEventText(event: MemoryEvent): string {
    const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.output === 'string') return payload.output;
    if (typeof payload.title === 'string') return payload.title;
    return JSON.stringify(event.payload);
  }
}

function bindingRank(binding: MemoryBindingRecord, decision: BindingTopicDecision): number {
  let score = binding.confidence;
  if (binding.claimKey === decision.claimKey) score += 1;
  if (binding.signal === decision.signal) score += 0.75;
  if (binding.bindingType === decision.bindingType) score += 0.5;
  if (binding.role === 'user') score += 0.25;
  score += Math.min(0.25, Math.max(0, binding.createdAt) / 1_000_000_000_000_000);
  return score;
}

function clusterTitle(topicPath: string, bindingType: BindingTopicDecision['bindingType']): string {
  const tail = topicPath.split('/').slice(-1)[0] || topicPath;
  return `${tail}:${bindingType}`;
}

function entityStablePath(entityType: MemoryEntityType, canonicalName: string): string {
  if (entityType === 'project') return `PROJECT/${canonicalName}`;
  if (entityType === 'person') return `PERSON/${canonicalName}`;
  return `${entityType.toUpperCase()}/${canonicalName}`;
}
