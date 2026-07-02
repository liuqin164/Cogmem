export type NeuronType = 'code' | 'chat' | 'doc' | 'command' | 'file' | 'agent_finding' | 'agent_observation' | 'skill' | 'semantic_consolidation' | 'cross_domain_principle';
export type NeuronStatus = 'active' | 'cold' | 'suspect' | 'archived';
export type SourceType = 'user_input' | 'llm_inference' | 'verified_fact' | 'external_tool';
export type MemoryImportanceLevel = 'low' | 'normal' | 'important' | 'permanent';
export type MemoryEventRole = 'user' | 'assistant' | 'agent' | 'tool' | 'system' | 'narrator';
export type MemoryEventCausalityType = 'replies_to' | 'tool_result_for' | 'derived_from' | 'summarizes' | 'corrects' | 'supersedes' | 'triggered_by';
export type OrderingConfidence = 'high' | 'medium' | 'low';
export type MemoryRawEventType = 'message' | 'tool_call' | 'tool_result' | 'memory_write' | 'correction' | 'summary' | 'action_result' | 'task_event';
export interface SkillNeuronMetadata {
    skillId: string;
    skillVersion: string;
    description: string;
    intentTags: string[];
    capabilityIds: string[];
    executionCount: number;
    successCount: number;
    lastExecutedAt?: number;
    lastFailureReason?: string;
    evolutionProposalId?: string;
    consecutiveFailureCount?: number;
    declarativeLinks?: string[];
}
export interface NeuronMetadata {
    projectId?: string;
    topicPath?: string;
    filePath?: string;
    type: NeuronType;
    createdAt: number;
    updatedAt?: number;
    lastActivated?: number;
    activationCount?: number;
    aaak_summary?: string;
    tags?: string[];
    status?: NeuronStatus;
    stability?: number;
    repetitions?: number;
    confidence?: number;
    sourceType?: SourceType;
    fileSize?: number;
    mimeType?: string;
    originalName?: string;
    blobPath?: string;
    fileId?: string;
    sourceEventId?: string;
    importanceLevel?: MemoryImportanceLevel;
    isPinned?: boolean;
    skillMeta?: SkillNeuronMetadata;
    proceduralLink?: {
        skillId: string;
        linkType: 'origin' | 'refinement_evidence';
    };
    communityId?: string;
    lastReinforcedAt?: number;
    sourceRefs?: MemorySourceRef[];
}
export interface TopicNode {
    path: string;
    segments: string[];
    neuronCount: number;
    projectId?: string;
}
export interface NeuronCoordinates {
    T: number;
    S: [number, number, number];
    V: number[];
}
export interface Neuron {
    id: string;
    content: string;
    prev_hash: string;
    self_hash: string;
    coordinates: NeuronCoordinates;
    synapses: Synapse[];
    metadata: NeuronMetadata;
}
export type SynapseType = 'Caused_by' | 'Sequence' | 'Similar' | 'Referenced' | 'Overrides';
export interface Synapse {
    targetId: string;
    type: SynapseType;
    weight: number;
}
export type TemporalOperatorType = 'range' | 'dynamic' | 'llm_guided';
export interface TemporalOperator {
    type: TemporalOperatorType;
    start?: number;
    end?: number;
    threshold?: number;
    confidence?: number;
    center?: number;
}
export type SpatialOperatorType = 'semantic_geo' | 'gravity' | 'point';
export interface SpatialOperator {
    type: SpatialOperatorType;
    center?: [number, number];
    radius?: number;
    weight?: number;
    primary?: [number, number, number];
    semanticConnections?: string[];
}
export interface QueryOptions {
    temporal?: TemporalOperator;
    spatial?: SpatialOperator;
    maxHops?: number;
    topK?: number;
}
export interface QueryResult {
    neurons: Neuron[];
    totalEnergy: number;
    resonanceDepth: number;
    queryTime: number;
    contextPack?: ContextPack;
}
export declare enum ContextFusionPath {
    COMPILED_ONLY = "compiled_only",
    RAW_ONLY = "raw_only",
    COMPILED_PLUS_RAW = "compiled_plus_raw",
    CONFLICT_RESOLVED = "conflict_resolved"
}
export declare enum FusionResolutionReason {
    COMPILED_WINS = "compiled_wins",
    RAW_WINS = "raw_wins",
    TRUST_SCORE_HIGHER = "trust_score_higher",
    RECENCY_WINS = "recency_wins"
}
export interface EmbeddingConfig {
    model: string;
    cacheDir: string;
    quantized: boolean;
    maxSequenceLength: number;
}
export interface BackupConfig {
    enabled: boolean;
    frequency: 'daily' | 'neuron_count';
    neuronThreshold: number;
    targetRepo: string;
    encryptionKey: string;
}
export interface MemoryAnchor {
    id: string;
    neuronCount: number;
    createdAt: number;
    prevAnchorId?: string;
    summaryHash: string;
    metadata: {
        projectId?: string;
        version: string;
    };
}
export declare enum BrainMode {
    FULL = "FULL",
    NO_SYNAPSE = "NO_SYNAPSE",
    TEXT_ONLY = "TEXT_ONLY"
}
export interface BrainMetrics {
    queryLatency: number;
    queryType: 'HARD' | 'STANDARD' | 'FUZZY';
    neuronCount: number;
    synapseCount: number;
    energyPropagation: number;
    memoryUsage: number;
    modelInferenceHealth: number;
    chainIntegrityScore: number;
    fallbackCount: number;
}
export interface DegradationState {
    mode: BrainMode;
    trigger: string;
    timestamp: number;
}
export interface EnergyPropagationResult {
    neuronId: string;
    energy: number;
    hops: number;
}
export interface IngestInput {
    content: string;
    projectId?: string;
    topicPath?: string;
    filePath?: string;
    type?: NeuronType;
    tags?: string[];
    createdAt?: number;
    updatedAt?: number;
    sourceType?: SourceType;
    source?: string;
    sourceEventId?: string;
    sourceRefs?: MemorySourceRef[];
    importanceLevel?: MemoryImportanceLevel;
    isPinned?: boolean;
}
export type StreamType = 'neuron' | 'belief' | 'file' | 'chain' | 'thread' | 'system';
export type MemoryEventType = 'RAW_EVENT_RECORDED' | 'INGESTED' | 'ACTIVATED' | 'BELIEF_UPSERTED' | 'BELIEF_RECALIBRATED' | 'BELIEF_SUPERSEDED' | 'BELIEF_REVOKED' | 'TOPOLOGY_COMPILED' | 'COGNITIVE_GRAPH_COMPILED' | 'ARCHIVED' | 'RESTORED' | 'INDEX_REBUILT' | 'RUNTIME_STATE_UPDATED' | 'RUNTIME_TRANSITION_RECORDED' | 'POLICY_EXECUTION_UPDATED';
export type TimeBucketType = 'day' | 'week' | 'month';
export type ProjectBranchKind = 'project_root' | 'interaction' | 'belief' | 'fact' | 'event' | 'task';
export type EventClusterType = 'approval' | 'rejection' | 'issue' | 'project' | 'fact' | 'generic';
export interface TopologyReference {
    neuronId?: string;
    unitId?: string;
    beliefId?: string;
    factId?: string;
    eventId?: string;
    createdAt: number;
}
export interface TimeBucketRecord {
    bucketId: string;
    bucketType: TimeBucketType;
    bucketStart: number;
    bucketEnd: number;
    label: string;
}
export interface ProjectBranchRecord {
    branchId: string;
    projectId: string;
    branchKey: string;
    branchKind: ProjectBranchKind;
    title: string;
    createdAt: number;
    updatedAt: number;
}
export interface TaskBranchRecord {
    taskId: string;
    projectId?: string;
    taskKey: string;
    title: string;
    status: 'active' | 'derived';
    createdAt: number;
    updatedAt: number;
}
export interface EventClusterRecord {
    clusterId: string;
    projectId?: string;
    clusterKey: string;
    clusterType: EventClusterType;
    title: string;
    createdAt: number;
    updatedAt: number;
}
export type CognitiveNodeType = 'neuron' | 'unit' | 'belief' | 'fact' | 'compiled_event' | 'entity' | 'time_bucket' | 'project_branch' | 'task_branch' | 'event_cluster';
export type CognitiveEdgeType = 'summarizes' | 'supports_belief' | 'mentions_entity' | 'belongs_to_project_branch' | 'belongs_to_task' | 'belongs_to_event_cluster' | 'occurred_in_time_bucket' | 'references_fact' | 'references_event' | 'extends_branch';
export interface CognitiveNodeRecord {
    nodeId: string;
    nodeType: CognitiveNodeType;
    nodeKey: string;
    title: string;
    projectId?: string;
    sourceNeuronId?: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}
export interface CognitiveEdgeRecord {
    edgeId: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: CognitiveEdgeType;
    weight: number;
    projectId?: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
}
export interface MemoryEvent<TPayload = Record<string, unknown>> {
    eventId: string;
    globalSeq?: number;
    streamId: string;
    streamType: StreamType;
    eventType: MemoryEventType;
    rawEventType?: MemoryRawEventType;
    eventVersion: number;
    projectId?: string;
    workspaceId?: string;
    actorId?: string;
    causationId?: string;
    correlationId?: string;
    sourceNeuronId?: string;
    sourceId?: string;
    contentHash?: string;
    threadId?: string;
    sessionId?: string;
    localDate?: string;
    threadSeq?: number;
    turnId?: string;
    turnSeq?: number;
    eventOrdinal?: number;
    role?: MemoryEventRole;
    parentEventId?: string;
    prevEventId?: string;
    nextEventId?: string;
    causalityType?: MemoryEventCausalityType;
    sourceOffset?: number;
    lineStart?: number;
    lineEnd?: number;
    charStart?: number;
    charEnd?: number;
    orderingConfidence?: OrderingConfidence;
    occurredAt: number;
    payload: TPayload;
    payloadHash: string;
    createdAt: number;
    ingestedAt?: number;
}
export interface MemorySourceRef {
    eventId?: string;
    eventType?: string;
    sourceId?: string;
    sourcePath?: string;
    sourceType?: string;
    recordId?: string;
    contentHash?: string;
    threadId?: string;
    sessionId?: string;
    turnId?: string;
    parentEventId?: string;
    prevEventId?: string;
    nextEventId?: string;
    causalityType?: MemoryEventCausalityType;
    role?: MemoryEventRole;
    threadSeq?: number;
    turnSeq?: number;
    eventOrdinal?: number;
    sourceOffset?: number;
    lineStart?: number;
    lineEnd?: number;
    charStart?: number;
    charEnd?: number;
    orderingConfidence?: OrderingConfidence;
    metadata?: Record<string, unknown>;
}
export interface MemoryEventContext {
    event: MemoryEvent;
    before: MemoryEvent[];
    after: MemoryEvent[];
    parent?: MemoryEvent;
    children: MemoryEvent[];
}
export type ScopeType = 'global' | 'project' | 'session' | 'agent' | 'file';
export type BeliefStatus = 'active' | 'superseded' | 'revoked' | 'suspect' | 'expired';
export type BeliefValidityKind = 'open' | 'time_range' | 'conditional' | 'revoked';
export interface BeliefValue {
    raw: string;
    normalized?: string;
    json?: unknown;
    type: 'string' | 'number' | 'boolean' | 'json' | 'enum';
}
export interface BeliefRecord {
    id: string;
    projectId?: string;
    scope: ScopeType;
    subject: string;
    predicate: string;
    objectValue: BeliefValue;
    canonicalKey: string;
    confidence: number;
    trustScore: number;
    sourceNeuronId?: string;
    sourceEventId?: string;
    sourceType: SourceType;
    validityKind: BeliefValidityKind;
    validFrom: number;
    validTo?: number;
    supersedesBeliefId?: string;
    supersededByBeliefId?: string;
    contradictionGroup?: string;
    status: BeliefStatus;
    explanation?: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}
export interface BeliefEvidenceRecord {
    beliefId: string;
    neuronId?: string;
    eventId?: string;
    evidenceType: 'source' | 'support' | 'conflict' | 'verification';
    weight: number;
    createdAt: number;
}
export interface BeliefCandidate {
    projectId?: string;
    scope: ScopeType;
    subject: string;
    predicate: string;
    objectValue: BeliefValue;
    confidence: number;
    trustScore?: number;
    sourceNeuronId?: string;
    sourceEventId?: string;
    sourceType: SourceType;
    validityKind?: BeliefValidityKind;
    validFrom?: number;
    validTo?: number;
    explanation?: string;
    metadata?: Record<string, unknown>;
    extractionReason: 'explicit_user_statement' | 'decision_statement' | 'tool_verified_fact' | 'preference_signal' | 'workflow_rule';
}
export interface BeliefConflictCandidate {
    existing: BeliefRecord;
    incoming: BeliefCandidate;
    reason: 'same_canonical_key' | 'contradictory_value' | 'overlapping_time_range' | 'same_value' | 'scope_conflict';
}
export interface BeliefRevisionDecision {
    action: 'insert' | 'supersede_existing' | 'reject_incoming' | 'coexist_conditional' | 'revoke_existing';
    supersedeBeliefIds?: string[];
    rejectReason?: string;
    contradictionGroup?: string;
    normalizedMetadata?: Record<string, unknown>;
}
export interface RankedBelief {
    belief: BeliefRecord;
    score: number;
    reasons: string[];
    supportingNeuronIds: string[];
}
export interface RankedEpisode {
    neuron: Neuron;
    score: number;
    reasons: string[];
}
export interface ContextPack {
    fusionPath: ContextFusionPath;
    compiledEvidence: Array<{
        evidenceType: 'fact' | 'event';
        evidenceId: string;
        neuronId: string;
        summary: string;
        confidence: number;
    }>;
    rawEvidence: Array<{
        neuronId: string;
        content: string;
        createdAt: number;
        score: number;
    }>;
    conflictTrace: Array<{
        conflictingRawContent: string;
        conflictingCompiledFact: {
            factId: string;
            subject: string;
            predicateFamily: string;
            predicateValue?: string;
            object?: string;
            confidence: number;
        };
        resolutionReason: FusionResolutionReason;
    }>;
    coreFacts: RankedBelief[];
    activeConstraints: RankedBelief[];
    compiledFacts: Array<{
        factId: string;
        neuronId: string;
        subject: string;
        predicateFamily: string;
        predicateValue?: string;
        object?: string;
        entityId?: string;
        validFrom: number;
        validTo?: number;
        confidence: number;
        status: 'provisional' | 'verified' | 'superseded' | 'archived' | 'rejected' | 'provisional_enriched' | 'enriched_candidate';
        sourceText: string;
        metadata?: Record<string, unknown>;
    }>;
    compiledEvents: Array<{
        eventId: string;
        neuronId: string;
        unitId?: string;
        eventType: string;
        actor?: string;
        target?: string;
        validFrom: number;
        validTo?: number;
        confidence: number;
        status: 'provisional' | 'verified' | 'archived';
        payload?: Record<string, unknown>;
    }>;
    supportingEpisodes: RankedEpisode[];
    recentEpisodes: RankedEpisode[];
    runtimeDiagnostics: Array<{
        beliefId: string;
        predicate: string;
        runtimeId: string;
        allowed: boolean;
        executionReady: boolean;
        blockedSteps: Array<{
            step: string;
            reasons: string[];
        }>;
        mergeReadiness: Array<{
            into: string;
            ready: boolean;
            missing: string[];
        }>;
        validationReadiness: Array<{
            target: string;
            ready: boolean;
            missingChecks: string[];
        }>;
        policyActions: Array<{
            policy: string;
            action: 'allow' | 'deny' | 'prefer';
        }>;
        executionFeedback?: {
            matchedExecutions: number;
            executed: number;
            failed: number;
            latestStatus?: string;
        };
    }>;
    contradictions: Array<{
        canonicalKey: string;
        active?: BeliefRecord;
        alternatives: BeliefRecord[];
        reason: string;
    }>;
    debug: {
        usedSources: Array<'beliefs' | 'vector' | 'fts' | 'graph' | 'topology' | 'entity'>;
        plannerReasons: string[];
        narrowingTrace?: Array<{
            stage: string;
            action: 'seed' | 'shrink' | 'expand' | 'filter' | 'rank';
            beforeCount?: number;
            afterCount?: number;
            reason: string;
        }>;
        excludedCandidates?: Array<{
            source: 'vector' | 'fts' | 'graph' | 'topology' | 'entity';
            candidateId: string;
            reason: string;
        }>;
        entityContext?: {
            resolvedEntityIds: string[];
            relatedEntityIds: string[];
            candidateNeuronIds: string[];
            entityIsolationApplied?: boolean;
            ambiguous?: boolean;
            scopedNeuronIds?: string[];
            disambiguation?: Array<{
                reference: string;
                candidates: Array<{
                    entityId: string;
                    score: number;
                    reasons: string[];
                }>;
            }>;
        };
        cognitiveGraph?: {
            seedNodeIds: string[];
            traversedNodeIds: string[];
            edgeCount: number;
        };
        temporalWindow?: {
            start?: number;
            end?: number;
            bucketType?: 'day' | 'week' | 'month';
            bucketLabels?: string[];
        };
        queryCompiler?: {
            confidence: number;
            entityHints: string[];
            temporalHints: string[];
            issueHints?: string[];
            relativeReferences?: string[];
            parseMode?: 'grammar';
            residualQuery?: string;
            nativeDirectives?: {
                entity?: string;
                entityType?: string;
                project?: string;
                branch?: string;
                task?: string;
                cluster?: string;
                time?: string;
                from?: string;
                to?: string;
                around?: string;
                mode?: 'continuous' | 'focused';
            };
            clauses?: Array<{
                key: 'entity' | 'entityType' | 'project' | 'branch' | 'task' | 'cluster' | 'time' | 'from' | 'to' | 'around' | 'mode';
                value: string;
            }>;
        };
        queryTimePendingEntityResolution?: {
            hookRan: boolean;
            overallStatus: 'not_applicable' | 'not_needed' | 'narrowed_but_still_ambiguous' | 'resolved_narrowly' | 'unresolved_explicit';
            resolvedCount: number;
            unresolvedCount: number;
            candidateEntityIds: string[];
            results: Array<{
                reference: string;
                resolvedInstanceId?: string;
                queryTimeResolutionStatus: 'not_applicable' | 'not_needed' | 'narrowed_but_still_ambiguous' | 'resolved_narrowly' | 'unresolved_explicit';
                queryTimeResolutionReason: 'no_relative_pending_reference_in_query' | 'no_matching_pending_reference' | 'write_time_resolution_already_sufficient' | 'pending_relative_reference_narrowed' | 'pending_relative_reference_ambiguous_after_narrowing' | 'pending_reference_still_unresolved';
                resolutionConfidence: number;
                candidateEntityIds: string[];
                narrowedCandidates: Array<{
                    entityId: string;
                    score: number;
                    reasons: string[];
                }>;
                matchedPendingIds?: string[];
            }>;
        };
        fusionStrategy?: {
            chosenEvidence: Array<{
                source: 'compiled' | 'raw';
                evidenceId: string;
            }>;
            rejectedEvidence: Array<{
                source: 'compiled' | 'raw';
                evidenceId: string;
                reason: string;
            }>;
            resolutionReason?: FusionResolutionReason;
        };
        boundaryClosure?: {
            selfCorrection?: {
                artifactFactIds: string[];
                stage: 'write_time' | 'enrichment' | 'offline_consolidation';
            };
            previousReference?: {
                boundaryState: 'resolved_entity_focus' | 'mixed_candidates_visible' | 'not_applicable';
                preferredEntityIds: string[];
                suppressedFactIds: string[];
            };
        };
        pulseTrace?: Array<{
            pulse: 0 | 1 | 2 | 3;
            stage: string;
            candidateCount: number;
            reason: string;
        }>;
        universeTraversal?: {
            narrativeHeadline: string;
            path: string[];
            whyMatched: string[];
            runtimePath?: string[];
            runtimeSegments?: Array<{
                stage: string;
                label: string;
                count?: number;
            }>;
        };
        temporalTraversal?: {
            bucketType?: 'day' | 'week' | 'month';
            bucketIds: string[];
            labels: string[];
            candidateNeuronIds: string[];
            traversalMode?: 'surface' | 'adjacent_fallback' | 'nearest_fallback';
            segments?: Array<{
                bucketId: string;
                label: string;
                source: 'seed' | 'window' | 'adjacent' | 'nearest' | 'band';
                branchIds?: string[];
                taskIds?: string[];
                clusterIds?: string[];
            }>;
        };
        denseSearch?: {
            candidateNeuronIds: string[];
            reason: string;
        };
        retrievalChannels?: {
            rawEpisodeNeuronIds: string[];
            compiledFactIds: string[];
            compiledEventIds: string[];
            suppressedSupersededFactIds?: string[];
            primaryChannel: 'raw' | 'compiled' | 'hybrid';
        };
    };
}
export interface RuntimeDiagnosticsHistoryPage {
    runtimeId: string;
    page: number;
    pageSize: number;
    totalTransitions: number;
    transitions: Array<{
        transitionId: string;
        runtimeId: string;
        entityType: string;
        entityKey: string;
        transitionType: string;
        fromStatus?: string;
        toStatus: string;
        payload?: Record<string, unknown>;
        occurredAt: number;
    }>;
    currentStates: Array<{
        runtimeId: string;
        entityType: string;
        entityKey: string;
        status: string;
        metadata?: Record<string, unknown>;
        updatedAt: number;
    }>;
    appliedFilters?: {
        entityTypes?: string[];
        transitionTypes?: string[];
        status?: string[];
        startTime?: number;
        endTime?: number;
    };
}
export interface PolicyExecutionAuditPage {
    page: number;
    pageSize: number;
    total: number;
    records: Array<{
        executionId: string;
        idempotencyKey: string;
        runtimeId?: string;
        policy: string;
        action: string;
        target?: string;
        status: string;
        attemptCount: number;
        nextRetryAt?: number;
        deadLetteredAt?: number;
        replayPolicy?: string;
        actorId?: string;
        causationId?: string;
        correlationId?: string;
        policyGroup?: string;
        streamType?: string;
        eventType?: string;
        detail?: string;
        metadata?: Record<string, unknown>;
        createdAt: number;
        updatedAt: number;
    }>;
    appliedFilters?: {
        runtimeId?: string;
        actorId?: string[];
        causationId?: string[];
        correlationId?: string[];
        policyGroup?: string[];
        streamType?: string[];
        eventType?: string[];
        policy?: string[];
        target?: string[];
        status?: string[];
        replayPolicy?: string[];
        startTime?: number;
        endTime?: number;
    };
}
export interface RuntimeAuditTrail {
    runtimeHistory: RuntimeDiagnosticsHistoryPage;
    policyExecutions: PolicyExecutionAuditPage;
}
export interface UnifiedAuditBundle {
    runtimeHistory?: RuntimeDiagnosticsHistoryPage;
    policyExecutions?: PolicyExecutionAuditPage;
    events: EventAuditPage;
}
export interface ProjectionObservabilityStats {
    vector: {
        projectionName: string;
        checkpointStatus: 'idle' | 'building' | 'ready' | 'degraded' | 'failed';
        lastEventId?: string;
        lastEventTime?: number;
        lastRebuildAt?: number;
        lastFullCount: number;
        pendingEvents: number;
        projectedCount: number;
    };
    runtime: {
        projectionName: string;
        checkpointStatus: 'idle' | 'building' | 'ready' | 'degraded' | 'failed';
        lastEventId?: string;
        lastEventTime?: number;
        lastRebuildAt?: number;
        lastFullCount: number;
        pendingEvents: number;
        projectedStateCount: number;
    };
    policy: {
        projectionName: string;
        checkpointStatus: 'idle' | 'building' | 'ready' | 'degraded' | 'failed';
        lastEventId?: string;
        lastEventTime?: number;
        lastRebuildAt?: number;
        lastFullCount: number;
        pendingEvents: number;
        projectedExecutionCount: number;
        deadLetterCount: number;
        pendingRetryCount: number;
    };
}
export interface RetrievalCacheStats {
    size: number;
    hits: number;
    misses: number;
}
export interface ProjectionObservabilityStorageStats {
    rawSampleCount: number;
    rollupCount: number;
    rollupBuckets: number[];
}
export interface ProjectionObservabilityHistoryPage {
    page: number;
    pageSize: number;
    total: number;
    samples: Array<{
        projectionType: 'vector' | 'runtime' | 'policy';
        projectionName: string;
        checkpointStatus: 'idle' | 'building' | 'ready' | 'degraded' | 'failed';
        pendingEvents: number;
        materializedCount: number;
        sampledAt: number;
        metadata?: Record<string, unknown>;
    }>;
    appliedFilters?: {
        projectionType?: Array<'vector' | 'runtime' | 'policy'>;
        checkpointStatus?: Array<'idle' | 'building' | 'ready' | 'degraded' | 'failed'>;
        bucketMs?: number;
        aggregateMode?: 'latest' | 'avg';
        startTime?: number;
        endTime?: number;
        includeRollups?: boolean;
    };
}
export interface BackgroundJobStatus {
    jobName: string;
    intervalMs: number;
    nextRunAt: number;
    lastRunAt?: number;
    lastStatus: 'idle' | 'running' | 'succeeded' | 'failed';
    lastError?: string;
    isEnabled: boolean;
    leaseOwner?: string;
    leaseExpiresAt?: number;
    metadata?: Record<string, unknown>;
    updatedAt: number;
}
export interface EventAuditPage {
    page: number;
    pageSize: number;
    total: number;
    records: MemoryEvent[];
    appliedFilters?: {
        streamId?: string[];
        streamType?: StreamType[];
        eventType?: MemoryEventType[];
        actorId?: string[];
        causationId?: string[];
        correlationId?: string[];
        projectId?: string[];
        workspaceId?: string[];
        threadId?: string[];
        sessionId?: string[];
        startTime?: number;
        endTime?: number;
        sinceGlobalSeq?: number;
        untilGlobalSeq?: number;
        order?: 'asc' | 'desc';
    };
}
//# sourceMappingURL=index.d.ts.map