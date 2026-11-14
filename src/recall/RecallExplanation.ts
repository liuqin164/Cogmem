import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import type { MemoryEvent, MemoryEventContext, MemorySourceRef, Neuron } from '../types/index.js';
import {
  KernelAgentMemoryBackend,
  occasionChainEvents,
  occasionDecisionFor,
  occasionEventText,
  type AgentRecallDecisionTrace,
  type AgentRecallItem,
} from '../agent/AgentMemoryBackend.js';
import { eventHoldsSecretMark } from '../security/SecretMarks.js';
import type { AgentRecallQueryPlan } from '../agent/AgentRecallQueryCompiler.js';
import type { ChannelBinding, OccasionWithholdReason, ResolvedOccasion } from '../occasion/index.js';
import {
  isRecallableMemoryEvidence,
  recallGovernanceReasonsFor,
  recallSuppressionReasonFor,
  type RecallGovernanceSuppressionReason,
} from './RecallGovernance.js';

export interface RecallExplanationOptions {
  query: string;
  projectId?: string;
  agentId?: string;
  workspaceId?: string;
  sessionId?: string;
  threadId?: string;
  excludeSessionId?: string;
  collection?: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
  now?: number;
  localDateNow?: string;
  timeZone?: string;
  /** The connection's occasion binding (#162); absent means the strictest occasion. */
  binding?: ChannelBinding;
}

export interface RecallExplanationEvidence {
  id: string;
  text: string;
  projectId?: string;
  topicPath?: string;
  tags: string[];
  source?: string;
  sourceAnchor?: RecallExplanationSourceAnchor;
  activationPath?: string[];
  whyMatched?: string[];
}

export interface RecallExplanationFilteredEvidence {
  id: string;
  text?: string;
  projectId?: string;
  tags: string[];
  source?: string;
  sourceAnchor?: RecallExplanationSourceAnchor;
  reason: 'agent_scope_mismatch' | 'collection_scope_mismatch' | 'over_context_limit' | 'status_suppressed'
    | OccasionWithholdReason;
  governanceReason?: RecallGovernanceSuppressionReason;
}

export interface RecallExplanationSourceAnchor {
  eventId: string;
  sourceEventType?: string;
  sourceRefs: MemorySourceRef[];
  context?: MemoryEventContext;
}

export interface RecallExplanation {
  query: string;
  projectId?: string;
  agentId?: string;
  collection?: string;
  recallMode: MemoryKernelNavigationResult['recallMode'] | 'raw_ledger_fallback' | 'atlas_facet_recall' | 'atlas_raw_grounded_recall' | 'social_turn_suppressed';
  fallbackUsed: boolean;
  narrative?: NonNullable<MemoryKernelNavigationResult['navigation']>['narrative'];
  pulseTrace?: NonNullable<MemoryKernelNavigationResult['navigation']>['pulse']['trace'];
  temporalTraversal?: NonNullable<MemoryKernelNavigationResult['navigation']>['branchSearch']['temporalTraversal'];
  runtime?: NonNullable<MemoryKernelNavigationResult['navigation']>['runtime'];
  evidence: RecallExplanationEvidence[];
  filteredEvidence?: RecallExplanationFilteredEvidence[];
  queryPlan?: AgentRecallQueryPlan;
  decisionTrace?: AgentRecallDecisionTrace;
}

export function explainRecallWithKernel(
  kernel: MemoryKernel,
  options: RecallExplanationOptions,
): RecallExplanation {
  const limit = Math.max(1, options.limit ?? 8);
  const resolved = kernel.occasionScope.resolve(options.binding);
  if (options.agentId) {
    const projectId = options.projectId || options.agentId;
    const retrievalLimit = Math.max(limit * 4, 24);
    const agentRecall = new KernelAgentMemoryBackend(kernel, { binding: options.binding }).recall({
      agentId: options.agentId,
      projectId,
      collection: options.collection,
      query: options.query,
      limit,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      threadId: options.threadId,
      excludeSessionId: options.excludeSessionId,
      startTime: options.startTime,
      endTime: options.endTime,
      now: options.now,
      localDateNow: options.localDateNow,
      timeZone: options.timeZone,
    });
    const navigated = kernel.navigateMemory(options.query, {
      projectId,
      limit: retrievalLimit,
      startTime: options.startTime,
      endTime: options.endTime,
      now: options.now,
      localDateNow: options.localDateNow,
      timeZone: options.timeZone,
    });
    const agentScoped = navigated.rawEvidence.filter((neuron) => isInAgentScope(neuron, options.agentId!));
    const scoped = agentScoped.filter((neuron) => isInCollectionScope(neuron, options.collection));
    const scopedRecallable = scoped.filter((neuron) => isRecallableMemoryEvidence(neuron));
    const filteredEvidence = uniqueFilteredEvidence([
      ...toNavigationFilteredEvidence(navigated, kernel),
      ...scoped
        .filter((neuron) => !isRecallableMemoryEvidence(neuron))
        .map((neuron) => toFilteredEvidence(neuron, 'status_suppressed', undefined, kernel)),
      ...navigated.rawEvidence
        .filter((neuron) => !isInAgentScope(neuron, options.agentId!))
        .map((neuron) => toFilteredEvidence(neuron, 'agent_scope_mismatch', undefined, kernel)),
      ...agentScoped
        .filter((neuron) => !isInCollectionScope(neuron, options.collection))
        .map((neuron) => toFilteredEvidence(neuron, 'collection_scope_mismatch', undefined, kernel)),
      ...scopedRecallable
        .slice(limit)
        .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit', undefined, kernel)),
    ]);

    return finalizeExplanation({
      query: options.query,
      projectId: options.projectId,
      agentId: options.agentId,
      collection: normalizedCollection(options.collection),
      recallMode: agentRecall.recallMode,
      fallbackUsed: agentRecall.fallbackUsed,
      narrative: agentRecall.narrative,
      pulseTrace: agentRecall.pulseTrace,
      temporalTraversal: agentRecall.temporalTraversal,
      runtime: agentRecall.runtime,
      evidence: agentRecall.items.map((item) => toAgentEvidence(item, agentRecall.decisionTrace, options.agentId!, kernel)),
      filteredEvidence: applyOccasionToFilteredEvidence(filteredEvidence, kernel, resolved, options.projectId),
      queryPlan: agentRecall.queryPlan,
      decisionTrace: agentRecall.decisionTrace,
    }, kernel, resolved, options.projectId);
  }

  const retrievalLimit = Math.max(limit * 4, 24);
  const navigated = kernel.navigateMemory(options.query, {
    projectId: options.projectId,
    limit: retrievalLimit,
    startTime: options.startTime,
    endTime: options.endTime,
    now: options.now,
    localDateNow: options.localDateNow,
    timeZone: options.timeZone,
  });
  const collectionScoped = navigated.rawEvidence.filter((neuron) => isInCollectionScope(neuron, options.collection));
  const occasionWithheld = collectionScoped.flatMap((neuron) => {
    const reason = occasionWithholdReason(kernel, resolved, options.projectId, neuron);
    return reason ? [{ neuron, reason }] : [];
  });
  const withheldIds = new Set(occasionWithheld.map((entry) => entry.neuron.id));
  const visible = collectionScoped.filter((neuron) => !withheldIds.has(neuron.id));
  const included = visible.slice(0, limit);
  const filteredEvidence = uniqueFilteredEvidence([
    // Navigation may already list a neuron for another reason; the occasion reason and the missing
    // text replace that entry rather than sitting beside it.
    ...toNavigationFilteredEvidence(navigated, kernel).filter((entry) => !withheldIds.has(entry.id)),
    ...navigated.rawEvidence
      .filter((neuron) => !isInCollectionScope(neuron, options.collection))
      .map((neuron) => toFilteredEvidence(neuron, 'collection_scope_mismatch', undefined, kernel)),
    ...visible
      .slice(limit)
      .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit', undefined, kernel)),
    ...occasionWithheld
      .map(({ neuron, reason }) => toOccasionFilteredEvidence(neuron, reason, kernel)),
  ]);

  return finalizeExplanation({
    query: options.query,
    projectId: options.projectId,
    collection: normalizedCollection(options.collection),
    recallMode: navigated.recallMode,
    fallbackUsed: navigated.fallbackUsed,
    narrative: navigated.navigation?.narrative,
    pulseTrace: navigated.navigation?.pulse.trace,
    temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
    runtime: navigated.navigation?.runtime,
    evidence: included.map((neuron) => toEvidence(neuron, navigated, undefined, kernel)),
    filteredEvidence,
  }, kernel, resolved, options.projectId);
}

function toAgentEvidence(
  item: AgentRecallItem,
  decisionTrace: AgentRecallDecisionTrace | undefined,
  agentId: string,
  kernel: MemoryKernel,
): RecallExplanationEvidence {
  const whyMatched = new Set<string>([`agent_scope:${agentId}`]);
  if (item.whyMatched) whyMatched.add(item.whyMatched);
  if (item.sourceAnchor?.eventId) whyMatched.add('provenance:source_event');
  return {
    id: item.id,
    text: item.text,
    projectId: item.projectId,
    topicPath: item.topicPath,
    tags: item.tags,
    source: item.source,
    sourceAnchor: sourceAnchorForAgentItem(item, kernel),
    activationPath: decisionTrace
      ? [`agent_recall:${decisionTrace.selectedLane}`, `reason:${decisionTrace.reason}`]
      : ['agent_recall:unavailable'],
    whyMatched: Array.from(whyMatched),
  };
}

function sourceAnchorForAgentItem(
  item: AgentRecallItem,
  kernel: MemoryKernel,
): RecallExplanationSourceAnchor | undefined {
  if (item.sourceType === 'compiled_memory' || item.sourceType === 'imported_summary') {
    const neuron = kernel.memoryGraph.getNeuron(item.id);
    if (neuron) {
      const semanticAnchor = sourceAnchorFor(neuron, kernel);
      if (semanticAnchor) return semanticAnchor;
    }
  }
  const eventId = item.sourceAnchor?.eventId;
  if (!eventId) return undefined;
  const context = withoutSecretMarked(kernel.getEventContext(eventId, { before: 1, after: 1 }));
  const payload = context?.event.payload as { sourceRefs?: unknown } | undefined;
  const sourceRefs = Array.isArray(payload?.sourceRefs)
    ? payload.sourceRefs.filter((entry): entry is MemorySourceRef => Boolean(entry && typeof entry === 'object'))
    : [];
  return {
    eventId,
    sourceEventType: context?.event.eventType,
    sourceRefs,
    context,
  };
}

function isInAgentScope(neuron: Neuron, agentId: string): boolean {
  const tags = neuron.metadata.tags || [];
  const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
  if (explicitAgentTags.length === 0) return true;
  return explicitAgentTags.includes(`agent:${agentId}`) || tags.includes(agentId);
}

function isInCollectionScope(neuron: Neuron, collection: string | undefined): boolean {
  const tags = neuron.metadata.tags || [];
  const collectionTags = tags.filter((tag) => tag.startsWith('collection:'));
  const requested = normalizedCollection(collection);
  if (requested) {
    if (requested === 'anchor' && collectionTags.length === 0) return true;
    return collectionTags.includes(`collection:${requested}`);
  }
  return collectionTags.length === 0 || collectionTags.includes('collection:anchor');
}

function normalizedCollection(collection: string | undefined): string | undefined {
  const normalized = String(collection || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
  return normalized || undefined;
}

function toEvidence(
  neuron: Neuron,
  result: MemoryKernelNavigationResult,
  agentId?: string,
  kernel?: MemoryKernel,
): RecallExplanationEvidence {
  return {
    id: neuron.id,
    text: neuron.content,
    projectId: neuron.metadata.projectId,
    topicPath: neuron.metadata.topicPath,
    tags: neuron.metadata.tags || [],
    source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
    sourceAnchor: sourceAnchorFor(neuron, kernel),
    activationPath: activationPathFor(result),
    whyMatched: whyMatchedFor(neuron, result, agentId),
  };
}

function toFilteredEvidence(
  neuron: Neuron,
  reason: RecallExplanationFilteredEvidence['reason'],
  governanceReason?: RecallGovernanceSuppressionReason,
  kernel?: MemoryKernel,
): RecallExplanationFilteredEvidence {
  return {
    id: neuron.id,
    text: neuron.content,
    projectId: neuron.metadata.projectId,
    tags: neuron.metadata.tags || [],
    source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
    sourceAnchor: sourceAnchorFor(neuron, kernel),
    reason,
    governanceReason: governanceReason ?? (
      reason === 'status_suppressed' ? recallSuppressionReasonFor(neuron) : undefined
    ),
  };
}

function toNavigationFilteredEvidence(
  result: MemoryKernelNavigationResult,
  kernel?: MemoryKernel,
): RecallExplanationFilteredEvidence[] {
  return (result.filteredEvidence || []).map((item) => (
    toFilteredEvidence(item.neuron, item.reason, item.governanceReason, kernel)
  ));
}

function sourceAnchorFor(neuron: Neuron, kernel?: MemoryKernel): RecallExplanationSourceAnchor | undefined {
  const eventId = neuron.metadata.sourceEventId;
  if (!eventId || !kernel) return undefined;
  const context = withoutSecretMarked(kernel.getEventContext(eventId, { before: 1, after: 1 }));
  if (!context) {
    return { eventId, sourceRefs: [] };
  }
  const payload = context.event.payload as { sourceRefs?: unknown };
  const sourceRefs = Array.isArray(payload.sourceRefs)
    ? payload.sourceRefs.filter((item): item is MemorySourceRef => Boolean(item && typeof item === 'object'))
    : [];
  return {
    eventId,
    sourceEventType: context.event.eventType,
    sourceRefs,
    context,
  };
}

/**
 * An event window with the secret-marked events taken out (#142, #169).
 *
 * The explanation reads its own windows, and a marked turn used to come back inside the anchor's `before` array
 * with its text intact even though recall itself had withheld it — the same leak #142 fixed for the recall lanes,
 * on the one surface an operator uses to audit them. A marked anchor means there is nothing to explain.
 */
function withoutSecretMarked(context: MemoryEventContext | null | undefined): MemoryEventContext | undefined {
  if (!context) return undefined;
  if (eventHoldsSecretMark(context.event)) return undefined;
  const keep = (event: MemoryEvent) => !eventHoldsSecretMark(event);
  return {
    ...context,
    before: context.before.filter(keep),
    after: context.after.filter(keep),
    parent: context.parent && keep(context.parent) ? context.parent : undefined,
    children: (context.children ?? []).filter(keep),
  };
}

function uniqueFilteredEvidence(items: RecallExplanationFilteredEvidence[]): RecallExplanationFilteredEvidence[] {
  const seen = new Set<string>();
  const uniqueItems: RecallExplanationFilteredEvidence[] = [];
  for (const item of items) {
    const key = `${item.id}:${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(item);
  }
  return uniqueItems;
}

function activationPathFor(result: MemoryKernelNavigationResult): string[] {
  const runtimePath = result.navigation?.runtime.path || [];
  const narrativePath = result.navigation?.narrative.path || [];
  return runtimePath.length > 0
    ? runtimePath
    : narrativePath.length > 0
      ? narrativePath
      : [`recall:${result.recallMode}`];
}

function whyMatchedFor(neuron: Neuron, result: MemoryKernelNavigationResult, agentId?: string): string[] {
  const reasons = new Set<string>();
  if (agentId && isInAgentScope(neuron, agentId)) reasons.add(`agent_scope:${agentId}`);
  if (neuron.metadata.sourceEventId) reasons.add('provenance:source_event');
  for (const reason of recallGovernanceReasonsFor(neuron)) reasons.add(reason);
  if (result.navigation?.pulse.fusedIds.includes(neuron.id)) reasons.add('pulse:fused');
  if (result.navigation?.branchSearch.neuronIds.includes(neuron.id)) reasons.add('temporal_branch:candidate');
  if (result.navigation?.branchSearch.temporalTraversal.neuronIds.includes(neuron.id)) {
    reasons.add('temporal_traversal:candidate');
  }
  for (const reason of result.navigation?.narrative.whyMatched || []) reasons.add(reason);
  if (reasons.size === 0) reasons.add(`recall_mode:${result.recallMode}`);
  return Array.from(reasons);
}

/** The reason this neuron would be withheld on this connection, or `undefined` when it may show. */
function occasionWithholdReason(
  kernel: MemoryKernel,
  resolved: ResolvedOccasion,
  projectId: string | undefined,
  neuron: Neuron,
): OccasionWithholdReason | undefined {
  if (resolved.occasion === 'private') return undefined;
  const decision = occasionDecisionFor(kernel, resolved.occasion, {
    projectId,
    text: neuron.content,
    events: occasionChainEvents(kernel, neuron.metadata.sourceEventId),
  });
  return decision.allowed ? undefined : decision.reason ?? 'occasion_private_tier';
}

/** The withheld face of an explanation: the reason and the id, never the text. */
function toOccasionFilteredEvidence(
  neuron: Neuron,
  reason: OccasionWithholdReason,
  kernel?: MemoryKernel,
): RecallExplanationFilteredEvidence {
  return {
    id: neuron.id,
    projectId: neuron.metadata.projectId,
    tags: neuron.metadata.tags || [],
    source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
    sourceAnchor: sourceAnchorFor(neuron, kernel),
    reason,
  };
}

/**
 * The agent path's filtered list is built from navigation, before the occasion gate. An entry that
 * the gate withheld is renamed and, because this is a withheld face, loses its text.
 */
function applyOccasionToFilteredEvidence(
  entries: RecallExplanationFilteredEvidence[],
  kernel: MemoryKernel,
  resolved: ResolvedOccasion,
  projectId: string | undefined,
): RecallExplanationFilteredEvidence[] {
  if (resolved.occasion === 'private') return entries;
  return entries.map((entry) => {
    const neuron = kernel.memoryGraph.getNeuron(entry.id);
    const reason = neuron ? occasionWithholdReason(kernel, resolved, projectId, neuron) : undefined;
    return reason ? { ...entry, text: undefined, reason } : entry;
  });
}

/**
 * The context windows are part of the answer, so their neighbours obey the same occasion as the
 * evidence they surround. The anchor itself was already admitted by the caller's gate.
 */
function finalizeExplanation(
  explanation: RecallExplanation,
  kernel: MemoryKernel,
  resolved: ResolvedOccasion,
  projectId: string | undefined,
): RecallExplanation {
  if (resolved.occasion === 'private') return explanation;
  const mapEntry = <T extends { sourceAnchor?: RecallExplanationSourceAnchor }>(entry: T): T => (
    entry.sourceAnchor
      ? { ...entry, sourceAnchor: occasionScopedAnchor(entry.sourceAnchor, kernel, resolved, projectId) }
      : entry
  );
  return {
    ...explanation,
    evidence: explanation.evidence.map(mapEntry),
    ...(explanation.filteredEvidence
      ? { filteredEvidence: explanation.filteredEvidence.map(mapEntry) }
      : {}),
  };
}

function occasionScopedAnchor(
  anchor: RecallExplanationSourceAnchor,
  kernel: MemoryKernel,
  resolved: ResolvedOccasion,
  projectId: string | undefined,
): RecallExplanationSourceAnchor {
  const context = anchor.context;
  if (!context) return anchor;
  const keep = (event: MemoryEvent) => occasionDecisionFor(kernel, resolved.occasion, {
    projectId,
    text: occasionEventText(event),
    events: occasionChainEvents(kernel, event.eventId),
  }).allowed;
  return {
    ...anchor,
    context: {
      ...context,
      before: context.before.filter(keep),
      after: context.after.filter(keep),
      parent: context.parent && keep(context.parent) ? context.parent : undefined,
      children: (context.children ?? []).filter(keep),
    },
  };
}
