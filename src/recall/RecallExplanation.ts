import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import type { Neuron } from '../types/index.js';
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
  activationPath?: string[];
  whyMatched?: string[];
}

export interface RecallExplanationFilteredEvidence {
  id: string;
  text?: string;
  projectId?: string;
  tags: string[];
  source?: string;
  reason: 'agent_scope_mismatch' | 'over_context_limit' | 'status_suppressed';
  governanceReason?: RecallGovernanceSuppressionReason;
}

export interface RecallExplanation {
  query: string;
  projectId?: string;
  agentId?: string;
  recallMode: MemoryKernelNavigationResult['recallMode'];
  fallbackUsed: boolean;
  narrative?: NonNullable<MemoryKernelNavigationResult['navigation']>['narrative'];
  pulseTrace?: NonNullable<MemoryKernelNavigationResult['navigation']>['pulse']['trace'];
  temporalTraversal?: NonNullable<MemoryKernelNavigationResult['navigation']>['branchSearch']['temporalTraversal'];
  runtime?: NonNullable<MemoryKernelNavigationResult['navigation']>['runtime'];
  evidence: RecallExplanationEvidence[];
  filteredEvidence?: RecallExplanationFilteredEvidence[];
}

export function explainRecallWithKernel(
  kernel: MemoryKernel,
  options: RecallExplanationOptions,
): RecallExplanation {
  const limit = Math.max(1, options.limit ?? 8);
  if (options.agentId) {
    const projectId = options.projectId || options.agentId;
    const retrievalLimit = Math.max(limit * 4, 24);
    const navigated = kernel.navigateMemory(options.query, {
      projectId,
      limit: retrievalLimit,
      startTime: options.startTime,
      endTime: options.endTime,
    });
    const scoped = navigated.rawEvidence.filter((neuron) => isInAgentScope(neuron, options.agentId!));
    const included = scoped.slice(0, limit);
    const filteredEvidence = uniqueFilteredEvidence([
      ...toNavigationFilteredEvidence(navigated),
      ...navigated.rawEvidence
        .filter((neuron) => !isInAgentScope(neuron, options.agentId!))
        .map((neuron) => toFilteredEvidence(neuron, 'agent_scope_mismatch')),
      ...scoped
        .slice(limit)
        .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit')),
    ]);

    if (included.length > 0) {
      return {
        query: options.query,
        projectId: options.projectId,
        agentId: options.agentId,
        recallMode: navigated.recallMode,
        fallbackUsed: navigated.fallbackUsed,
        narrative: navigated.navigation?.narrative,
        pulseTrace: navigated.navigation?.pulse.trace,
        temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
        runtime: navigated.navigation?.runtime,
        evidence: included.map((neuron) => toEvidence(neuron, navigated, options.agentId)),
        filteredEvidence,
      };
    }

    const fallback = kernel.recall(options.query, {
      projectId,
      limit: retrievalLimit,
      includeRawEvidence: true,
    });
    const fallbackRawEvidence = fallback.rawEvidence
      .filter((neuron) => !projectId || neuron.metadata.projectId === projectId);
    const fallbackRecallable = fallbackRawEvidence.filter((neuron) => isRecallableMemoryEvidence(neuron));
    const fallbackScoped = fallbackRecallable.filter((neuron) => isInAgentScope(neuron, options.agentId!));

    return {
      query: options.query,
      projectId: options.projectId,
      agentId: options.agentId,
      recallMode: 'brain_recall_fallback',
      fallbackUsed: true,
      narrative: navigated.navigation?.narrative,
      pulseTrace: navigated.navigation?.pulse.trace,
      temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
      runtime: navigated.navigation?.runtime,
      evidence: fallbackScoped
        .slice(0, limit)
        .map((neuron) => toEvidence(neuron, navigated, options.agentId)),
      filteredEvidence: uniqueFilteredEvidence([
        ...filteredEvidence,
        ...fallbackRawEvidence
          .filter((neuron) => !isRecallableMemoryEvidence(neuron))
          .map((neuron) => toFilteredEvidence(neuron, 'status_suppressed')),
        ...fallbackRecallable
          .filter((neuron) => !isInAgentScope(neuron, options.agentId!))
          .map((neuron) => toFilteredEvidence(neuron, 'agent_scope_mismatch')),
        ...fallbackScoped
          .slice(limit)
          .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit')),
      ]),
    };
  }

  const retrievalLimit = Math.max(limit * 4, 24);
  const navigated = kernel.navigateMemory(options.query, {
    projectId: options.projectId,
    limit: retrievalLimit,
    startTime: options.startTime,
    endTime: options.endTime,
  });
  const included = navigated.rawEvidence.slice(0, limit);
  const filteredEvidence = uniqueFilteredEvidence([
    ...toNavigationFilteredEvidence(navigated),
    ...navigated.rawEvidence
      .slice(limit)
      .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit')),
  ]);

  return {
    query: options.query,
    projectId: options.projectId,
    recallMode: navigated.recallMode,
    fallbackUsed: navigated.fallbackUsed,
    narrative: navigated.navigation?.narrative,
    pulseTrace: navigated.navigation?.pulse.trace,
    temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
    runtime: navigated.navigation?.runtime,
    evidence: included.map((neuron) => toEvidence(neuron, navigated)),
    filteredEvidence,
  };
}

function isInAgentScope(neuron: Neuron, agentId: string): boolean {
  const tags = neuron.metadata.tags || [];
  const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
  if (explicitAgentTags.length === 0) return true;
  return explicitAgentTags.includes(`agent:${agentId}`) || tags.includes(agentId);
}

function toEvidence(
  neuron: Neuron,
  result: MemoryKernelNavigationResult,
  agentId?: string,
): RecallExplanationEvidence {
  return {
    id: neuron.id,
    text: neuron.content,
    projectId: neuron.metadata.projectId,
    topicPath: neuron.metadata.topicPath,
    tags: neuron.metadata.tags || [],
    source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
    activationPath: activationPathFor(result),
    whyMatched: whyMatchedFor(neuron, result, agentId),
  };
}

function toFilteredEvidence(
  neuron: Neuron,
  reason: RecallExplanationFilteredEvidence['reason'],
  governanceReason?: RecallGovernanceSuppressionReason,
): RecallExplanationFilteredEvidence {
  return {
    id: neuron.id,
    text: neuron.content,
    projectId: neuron.metadata.projectId,
    tags: neuron.metadata.tags || [],
    source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
    reason,
    governanceReason: governanceReason ?? (
      reason === 'status_suppressed' ? recallSuppressionReasonFor(neuron) : undefined
    ),
  };
}

function toNavigationFilteredEvidence(result: MemoryKernelNavigationResult): RecallExplanationFilteredEvidence[] {
  return (result.filteredEvidence || []).map((item) => (
    toFilteredEvidence(item.neuron, item.reason, item.governanceReason)
  ));
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
