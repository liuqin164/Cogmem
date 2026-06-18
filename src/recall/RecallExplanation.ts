import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import type { MemoryEventContext, MemorySourceRef, Neuron } from '../types/index.js';
import {
  KernelAgentMemoryBackend,
  type AgentRecallDecisionTrace,
  type AgentRecallItem,
} from '../agent/AgentMemoryBackend.js';
import type { AgentRecallQueryPlan } from '../agent/AgentRecallQueryCompiler.js';
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
  collection?: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
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
  reason: 'agent_scope_mismatch' | 'collection_scope_mismatch' | 'over_context_limit' | 'status_suppressed';
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
  recallMode: MemoryKernelNavigationResult['recallMode'] | 'raw_ledger_fallback';
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
  if (options.agentId) {
    const projectId = options.projectId || options.agentId;
    const retrievalLimit = Math.max(limit * 4, 24);
    const agentRecall = new KernelAgentMemoryBackend(kernel).recall({
      agentId: options.agentId,
      projectId,
      collection: options.collection,
      query: options.query,
      limit,
      startTime: options.startTime,
      endTime: options.endTime,
    });
    const navigated = kernel.navigateMemory(options.query, {
      projectId,
      limit: retrievalLimit,
      startTime: options.startTime,
      endTime: options.endTime,
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

    return {
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
      filteredEvidence,
      queryPlan: agentRecall.queryPlan,
      decisionTrace: agentRecall.decisionTrace,
    };
  }

  const retrievalLimit = Math.max(limit * 4, 24);
  const navigated = kernel.navigateMemory(options.query, {
    projectId: options.projectId,
    limit: retrievalLimit,
    startTime: options.startTime,
    endTime: options.endTime,
  });
  const collectionScoped = navigated.rawEvidence.filter((neuron) => isInCollectionScope(neuron, options.collection));
  const included = collectionScoped.slice(0, limit);
  const filteredEvidence = uniqueFilteredEvidence([
    ...toNavigationFilteredEvidence(navigated, kernel),
    ...navigated.rawEvidence
      .filter((neuron) => !isInCollectionScope(neuron, options.collection))
      .map((neuron) => toFilteredEvidence(neuron, 'collection_scope_mismatch', undefined, kernel)),
    ...collectionScoped
      .slice(limit)
      .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit', undefined, kernel)),
  ]);

  return {
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
  };
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
  const context = kernel.getEventContext(eventId, { before: 1, after: 1 }) || undefined;
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
  const context = kernel.getEventContext(eventId, { before: 1, after: 1 }) || undefined;
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
