import { ConversationMarkdownAdapter, MarkdownSourceLoader, OpenClawDailyMemoryAdapter, OpenClawMemoryIndexAdapter, OpenClawPersonaAdapter, OpenClawSessionAdapter, OpenClawUserProfileAdapter, SoulMarkdownAdapter } from '../adapters/index.js';
import { LocalSemanticCompiler } from '../engine/LocalSemanticCompiler.js';
import { normalizeLexiconText } from '../lexicon/coreMemoryLexicon.js';
import { logger } from '../utils/Logger.js';
import { config as globalConfig } from '../utils/Config.js';
import { isRecallableMemoryEvidence } from './RecallGovernance.js';
export class BrainRecall {
    deps;
    semanticCompiler = new LocalSemanticCompiler();
    loader = new MarkdownSourceLoader();
    adapters = new Map([
        ['conversation_markdown', new ConversationMarkdownAdapter()],
        ['soul_markdown', new SoulMarkdownAdapter()],
        ['openclaw_daily_memory', new OpenClawDailyMemoryAdapter()],
        ['openclaw_session', new OpenClawSessionAdapter()],
        ['openclaw_memory_index', new OpenClawMemoryIndexAdapter()],
        ['openclaw_user_profile', new OpenClawUserProfileAdapter()],
        ['openclaw_persona', new OpenClawPersonaAdapter()]
    ]);
    constructor(deps) {
        this.deps = deps;
    }
    recall(query, options = {}) {
        const prepared = this.prepareRecallCandidates(query, options);
        const vectorSearchUsed = this.appendVectorResults(prepared.candidateNeuronIds, query, options.projectId, prepared.limit, prepared.vectorTopicPath);
        return this.finishRecall(query, options, prepared, vectorSearchUsed);
    }
    async recallAsync(query, options = {}) {
        const prepared = this.prepareRecallCandidates(query, options);
        const vectorSearchUsed = await this.appendVectorResultsAsync(prepared.candidateNeuronIds, query, options.projectId, prepared.limit, prepared.vectorTopicPath);
        return this.finishRecall(query, options, prepared, vectorSearchUsed);
    }
    prepareRecallCandidates(query, options) {
        const limit = options.limit ?? 6;
        const compiledQuery = this.semanticCompiler.compileQuery({ text: query, projectId: options.projectId });
        const resolvedEntityIds = compiledQuery.entities
            .flatMap((entity) => {
            const direct = this.deps.entityStore.findByCanonicalName(entity.text, entity.type);
            const alias = direct || this.deps.entityStore.findByAlias(entity.text, entity.type);
            return alias ? [alias.entityId] : [];
        });
        const candidateEntityIds = this.expandEntityIdsViaPersistentGainEdges(Array.from(new Set(resolvedEntityIds)), options.enablePersistentGainEdges !== false, options.enableDeepWriteEdges === true);
        const candidateNeuronIds = Array.from(new Set([
            ...this.deps.memoryGraph.fullTextSearch(query, options.projectId, limit * 4),
            ...this.deps.factStore.listNeuronIdsByEntityIds(candidateEntityIds, limit * 6)
        ]));
        const topicRouteResult = this.routeByTopic(query, options.projectId, options.topicPath, candidateNeuronIds);
        this.retainRecallableNeuronIds(candidateNeuronIds);
        const vectorTopicPath = topicRouteResult && !topicRouteResult.fallbackToGlobal
            ? topicRouteResult.matchedTopicPath ?? options.topicPath
            : undefined;
        return {
            limit,
            candidateEntityIds,
            candidateNeuronIds,
            topicRouteResult,
            vectorTopicPath
        };
    }
    finishRecall(query, options, prepared, vectorSearchUsed) {
        const { limit, candidateEntityIds, candidateNeuronIds, topicRouteResult } = prepared;
        const beliefs = this.deps.beliefStore.getActiveBeliefsForQuery({
            query,
            projectId: options.projectId,
            limit
        });
        const facts = this.rankFacts(query, [
            ...this.deps.factStore.listFactsByNeuronIds(candidateNeuronIds, limit * 8),
            ...this.deps.factStore.listFactsByEntityIds(candidateEntityIds, { limit: limit * 8 })
        ]).slice(0, limit);
        const events = this.rankEvents(query, this.deps.factStore.listEventsByNeuronIds(candidateNeuronIds, limit * 6)).slice(0, limit);
        const entityTimeline = this.deps.entityStore.getEntityTimeline({
            projectId: options.projectId,
            entityIds: candidateEntityIds.length > 0 ? candidateEntityIds : undefined,
            limit: limit * 3
        });
        const compiledHitCount = beliefs.length + facts.length + events.length + entityTimeline.length;
        const rawEvidence = options.includeRawEvidence === false
            ? []
            : this.toRecallableNeurons(candidateNeuronIds, limit);
        this._expandByCommunity(rawEvidence, limit);
        if (topicRouteResult && !topicRouteResult.fallbackToGlobal && options.includeRawEvidence !== false) {
            const summaryTopicPath = topicRouteResult.matchedTopicPath ?? options.topicPath ?? rawEvidence[0]?.metadata.topicPath ?? '';
            const summary = this.deps.topicSummaryBoard?.getSummaryNeuron(summaryTopicPath, options.projectId);
            const index = summary ? rawEvidence.findIndex((item) => item.id === summary.id) : -1;
            if (summary && this.isRecallableNeuron(summary) && index >= 0)
                rawEvidence.unshift(...rawEvidence.splice(index, 1));
            else if (summary && this.isRecallableNeuron(summary))
                rawEvidence.unshift(summary);
        }
        this._prependSemanticConsolidations(rawEvidence, options.projectId, topicRouteResult?.matchedTopicPath ?? options.topicPath);
        this._prependCrossDomainPrinciples(rawEvidence, options.projectId);
        const profileSignals = this.collectProfileSignals(query, options.projectId, limit);
        const profileSurface = this.collectProfileSurface(query, options.projectId, limit);
        const totalStructuredHits = compiledHitCount + profileSignals.length + profileSurface.userProfile.length + profileSurface.agentPersona.length;
        const fallbackSnippets = totalStructuredHits > 0 || options.includeUnprocessedFallback === false
            ? []
            : this.collectFallbackSnippets(query, options.projectId, limit);
        const result = {
            query,
            strategy: {
                primaryLevel: totalStructuredHits > 0
                    ? 'compiled_memory'
                    : rawEvidence.length > 0
                        ? 'raw_evidence'
                        : 'recent_unprocessed_sources',
                fallbackUsed: fallbackSnippets.length > 0,
                vectorSearchUsed
            },
            compiledMemory: {
                beliefs,
                facts,
                events,
                entityTimeline
            },
            rawEvidence,
            fallbackSnippets,
            profileSignals,
            profileSurface
        };
        if (topicRouteResult) {
            result.topicRouteInfo = {
                matchedTopicPath: topicRouteResult.matchedTopicPath,
                confidence: topicRouteResult.confidence,
                fallbackToGlobal: topicRouteResult.fallbackToGlobal
            };
        }
        const withOptionalSkillCandidates = this.withSkillCandidates(result, query, options.projectId, limit);
        return this.withFileEvidence(this.withSummaries(withOptionalSkillCandidates, options.projectId, limit));
    }
    _prependSemanticConsolidations(rawEvidence, projectId, topicPath) {
        const semantic = this.findDurableNeuronsByType('semantic_consolidation', {
            projectId,
            topicPath,
            limit: 3
        }).filter((neuron) => this.isRecallableNeuron(neuron));
        for (const neuron of semantic) {
            const index = rawEvidence.findIndex((item) => item.id === neuron.id);
            if (index >= 0)
                rawEvidence.splice(index, 1);
        }
        rawEvidence.unshift(...semantic);
    }
    _prependCrossDomainPrinciples(rawEvidence, projectId) {
        const principles = this.findDurableNeuronsByType('cross_domain_principle', {
            projectId,
            limit: 2
        }).filter((neuron) => this.isRecallableNeuron(neuron));
        for (const neuron of principles) {
            const index = rawEvidence.findIndex((item) => item.id === neuron.id);
            if (index >= 0)
                rawEvidence.splice(index, 1);
        }
        rawEvidence.unshift(...principles);
    }
    findDurableNeuronsByType(type, options) {
        const indexedLookup = this.deps.memoryGraph.findNeuronsByType;
        if (typeof indexedLookup !== 'function')
            return [];
        return indexedLookup.call(this.deps.memoryGraph, type, options);
    }
    _expandByCommunity(rawEvidence, limit) {
        const ids = new Set(rawEvidence.map((n) => n.id));
        const communityIds = Array.from(new Set(rawEvidence.map((n) => n.metadata.communityId).filter(Boolean)));
        for (const communityId of communityIds)
            for (const id of this.deps.graphCommunityEngine?.getCommunityMembers(communityId) || []) {
                if (ids.has(id) || rawEvidence.length >= limit + 3)
                    continue;
                const neuron = this.deps.memoryGraph.getNeuron(id);
                if (this.isRecallableNeuron(neuron)) {
                    rawEvidence.push(neuron);
                    ids.add(id);
                }
            }
    }
    routeByTopic(query, projectId, topicPath, candidateNeuronIds) {
        if (!this.deps.hierarchicalRouter && !topicPath)
            return undefined;
        const routed = this.deps.hierarchicalRouter?.route(query, projectId, topicPath);
        if (!routed || routed.fallbackToGlobal)
            return routed;
        const allowed = new Set(routed.candidateNeuronIds);
        for (let index = candidateNeuronIds.length - 1; index >= 0; index--) {
            if (!allowed.has(candidateNeuronIds[index]))
                candidateNeuronIds.splice(index, 1);
        }
        const existing = new Set(candidateNeuronIds);
        for (const id of routed.candidateNeuronIds) {
            if (!existing.has(id)) {
                candidateNeuronIds.push(id);
                existing.add(id);
            }
        }
        return routed;
    }
    withSkillCandidates(result, query, projectId, limit) {
        if (!this.deps.skillDiscoveryEngine)
            return result;
        return {
            ...result,
            skillCandidates: this.deps.skillDiscoveryEngine.findCandidates(query, projectId, Math.min(5, limit))
        };
    }
    withFileEvidence(result) {
        if (!this.deps.fileChunkStore || result.rawEvidence.length === 0)
            return result;
        const evidence = this.deps.fileChunkStore.listEvidenceByNeuronIds(result.rawEvidence.map((neuron) => neuron.id));
        if (evidence.length === 0)
            return result;
        return {
            ...result,
            fileEvidence: this.deps.fileChunkStore.groupEvidenceByAsset(evidence)
        };
    }
    expandEntityIdsViaPersistentGainEdges(resolvedEntityIds, enabled, enableDeepWriteEdges = false) {
        if (!enabled || resolvedEntityIds.length === 0 || !this.deps.graphEdgeStore?.listActiveNeighborEdges) {
            return resolvedEntityIds;
        }
        try {
            const edgeTypes = [
                'persistent_gain',
                ...(enableDeepWriteEdges ? ['deep_write_relation', 'deep_write_causal'] : [])
            ];
            const activePersistentGainEdges = this.deps.graphEdgeStore.listActiveNeighborEdges(resolvedEntityIds, edgeTypes, Math.max(32, resolvedEntityIds.length * 8));
            const relevantEdges = activePersistentGainEdges.filter((edge) => (edge.fromNodeId !== undefined && resolvedEntityIds.includes(edge.fromNodeId))
                || (edge.toNodeId !== undefined && resolvedEntityIds.includes(edge.toNodeId)));
            if (relevantEdges.length === 0) {
                logger.debug('RPI-2 persistent_gain expansion fell back to baseline: reason=no_edges_for_resolved_entities');
                return resolvedEntityIds;
            }
            const ambiguityReason = this.detectPersistentGainAmbiguity(relevantEdges, resolvedEntityIds);
            if (ambiguityReason) {
                logger.warn(`RPI-2 persistent_gain expansion fell back to baseline: reason=${ambiguityReason}`);
                return resolvedEntityIds;
            }
            const expandedEntityIds = new Set(resolvedEntityIds);
            for (const edge of relevantEdges) {
                if (edge.fromNodeId !== undefined && edge.toNodeId !== undefined && resolvedEntityIds.includes(edge.fromNodeId)) {
                    expandedEntityIds.add(edge.toNodeId);
                }
                if (edge.fromNodeId !== undefined && edge.toNodeId !== undefined && resolvedEntityIds.includes(edge.toNodeId)) {
                    expandedEntityIds.add(edge.fromNodeId);
                }
            }
            const expanded = Array.from(expandedEntityIds);
            logger.info('RPI-2 persistent_gain expansion applied', {
                resolvedEntityIds,
                expandedEntityIds: expanded,
                traversedEdges: relevantEdges.map((edge) => ({
                    fromNodeId: edge.fromNodeId,
                    toNodeId: edge.toNodeId,
                    weight: edge.weight
                }))
            });
            return expanded;
        }
        catch (error) {
            logger.warn('RPI-2 persistent_gain expansion fell back to baseline: reason=edge_read_failed', error);
            return resolvedEntityIds;
        }
    }
    withSummaries(result, projectId, limit) {
        if (!this.deps.summaryStore)
            return result;
        const summaries = this.deps.summaryStore.findRelevant(result.query, projectId, Math.min(3, limit))
            .map((summary) => ({
            summaryId: summary.summaryId,
            text: summary.text,
            scope: summary.scope,
            windowStart: summary.windowStart,
            windowEnd: summary.windowEnd,
            confidence: summary.confidence
        }));
        return summaries.length > 0 ? { ...result, summaries } : result;
    }
    detectPersistentGainAmbiguity(edges, resolvedEntityIds) {
        const neighborSets = new Map();
        for (const edge of edges) {
            if (!edge.fromNodeId || !edge.toNodeId || edge.fromNodeId === edge.toNodeId) {
                return 'ambiguous_edge_payload';
            }
            if (!this.deps.entityStore.findByEntityId(edge.fromNodeId) || !this.deps.entityStore.findByEntityId(edge.toNodeId)) {
                return 'ambiguous_unknown_target_entity';
            }
            if (resolvedEntityIds.includes(edge.fromNodeId)) {
                const neighbors = neighborSets.get(edge.fromNodeId) || new Set();
                neighbors.add(edge.toNodeId);
                neighborSets.set(edge.fromNodeId, neighbors);
            }
            if (resolvedEntityIds.includes(edge.toNodeId)) {
                const neighbors = neighborSets.get(edge.toNodeId) || new Set();
                neighbors.add(edge.fromNodeId);
                neighborSets.set(edge.toNodeId, neighbors);
            }
        }
        for (const neighbors of neighborSets.values()) {
            if (neighbors.size > 1)
                return 'ambiguous_multiple_hop_targets';
        }
        return undefined;
    }
    collectProfileSignals(query, projectId, limit) {
        return this.deps.memoryGraph.fullTextSearch(query, projectId, limit * 6)
            .map((neuronId) => this.deps.memoryGraph.getNeuron(neuronId))
            .filter((item) => Boolean(item))
            .filter((neuron) => this.isRecallableNeuron(neuron))
            .filter((neuron) => {
            const tags = neuron.metadata.tags || [];
            return tags.includes('namespace:user_profile') || tags.includes('namespace:agent_persona');
        })
            .slice(0, limit)
            .map((neuron) => ({
            neuronId: neuron.id,
            sourcePath: neuron.metadata.filePath,
            text: neuron.content,
            tags: neuron.metadata.tags || [],
            namespace: (neuron.metadata.tags || []).includes('namespace:user_profile')
                ? 'user_profile'
                : 'agent_persona'
        }));
    }
    collectFallbackSnippets(query, projectId, limit) {
        const tokens = this.extractTokens(query);
        const sources = this.deps.cursorStore
            .listRecentUnprocessedSources(Date.now() - 72 * 60 * 60 * 1000)
            .filter((source) => !projectId || source.projectId === projectId);
        const snippets = [];
        for (const sourceCursor of sources) {
            if (snippets.length >= limit)
                break;
            const source = {
                sourceId: sourceCursor.sourceId,
                adapterKind: sourceCursor.sourceType,
                sourcePath: sourceCursor.sourcePath,
                projectId: sourceCursor.projectId
            };
            const adapter = this.adapters.get(source.adapterKind);
            if (!adapter)
                continue;
            const snapshot = this.loader.read(source);
            const adapted = adapter.adapt(source, snapshot);
            const matched = adapted.records
                .filter((record) => this.scoreRecord(tokens, record) > 0)
                .sort((a, b) => this.scoreRecord(tokens, b) - this.scoreRecord(tokens, a))
                .slice(0, limit - snippets.length);
            for (const record of matched) {
                snippets.push({
                    sourceId: source.sourceId,
                    sourcePath: source.sourcePath,
                    text: record.text,
                    timestamp: record.timestamp,
                    sourceType: source.adapterKind
                });
            }
        }
        return snippets;
    }
    collectProfileSurface(query, projectId, limit) {
        const profileSignals = this.collectProfileSignals(query, projectId, limit * 2);
        const userProfile = [];
        const agentPersona = [];
        for (const signal of profileSignals) {
            const facets = this.extractProfileFacets(signal.text);
            for (const facet of facets) {
                const entry = {
                    neuronId: signal.neuronId,
                    sourcePath: signal.sourcePath,
                    label: facet.label,
                    value: facet.value,
                    section: facet.section
                };
                if (signal.namespace === 'user_profile')
                    userProfile.push(entry);
                else
                    agentPersona.push(entry);
            }
        }
        return {
            userProfile: userProfile.slice(0, limit),
            agentPersona: agentPersona.slice(0, limit)
        };
    }
    rankFacts(query, facts) {
        const tokens = this.extractTokens(query);
        return Array.from(new Map(facts.map((fact) => [fact.factId, fact])).values())
            .map((fact) => ({
            fact,
            score: this.scoreText(tokens, [
                fact.subject,
                fact.predicateFamily,
                fact.predicateValue,
                fact.object,
                fact.sourceText
            ].filter(Boolean).join(' ')) + fact.confidence
        }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((item) => item.fact);
    }
    rankEvents(query, events) {
        const tokens = this.extractTokens(query);
        return Array.from(new Map(events.map((event) => [event.eventId, event])).values())
            .map((event) => ({
            event,
            score: this.scoreText(tokens, [
                event.eventType,
                event.actor,
                event.target,
                JSON.stringify(event.payload || {})
            ].filter(Boolean).join(' ')) + event.confidence
        }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((item) => item.event);
    }
    scoreRecord(tokens, record) {
        return this.scoreText(tokens, `${record.text} ${(record.tags || []).join(' ')}`) + record.confidenceHint;
    }
    scoreText(tokens, text) {
        const haystack = normalizeLexiconText(text).toLowerCase();
        return tokens.filter((token) => haystack.includes(token)).length;
    }
    extractProfileFacets(text) {
        const facets = [];
        const seen = new Set();
        let currentSection;
        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            const heading = line.match(/^#{1,6}\s+(.+)$/);
            if (heading) {
                currentSection = heading[1].trim();
                continue;
            }
            const normalized = line
                .replace(/^[-*]\s+/, '')
                .replace(/^\d+\.\s+/, '')
                .trim();
            if (!normalized)
                continue;
            const keyValue = normalized.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
            if (keyValue) {
                const label = this.normalizeProfileLabel(keyValue[1].trim(), currentSection);
                const value = keyValue[2].trim();
                const dedupeKey = `${label}::${value}`.toLowerCase();
                if (!seen.has(dedupeKey)) {
                    seen.add(dedupeKey);
                    facets.push({
                        label,
                        value,
                        section: currentSection
                    });
                }
                continue;
            }
            const label = this.normalizeProfileLabel(currentSection || 'profile_statement', currentSection);
            const value = normalized;
            const dedupeKey = `${label}::${value}`.toLowerCase();
            if (!seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                facets.push({
                    label,
                    value,
                    section: currentSection
                });
            }
        }
        return facets;
    }
    normalizeProfileLabel(label, section) {
        const token = normalizeLexiconText(`${section || ''} ${label}`).toLowerCase();
        if (/(prefer|preference|偏好|喜欢)/.test(token))
            return 'preference';
        if (/(priority|priorities|重点|关注)/.test(token))
            return 'priority';
        if (/(constraint|constraints|boundary|边界|限制)/.test(token))
            return 'constraint';
        if (/(style|voice|tone|语气|风格)/.test(token))
            return 'style';
        if (/(persona|identity|人格|身份)/.test(token))
            return 'persona';
        if (/(profile|user|画像|用户)/.test(token))
            return 'profile';
        return label || 'profile_statement';
    }
    extractTokens(text) {
        return Array.from(new Set(normalizeLexiconText(text)
            .toLowerCase()
            .split(/[\s,，。！？、:：/]+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2)));
    }
    /**
     * v1.1: Appends vector semantic search results to candidateNeuronIds when the
     * existing FTS5 results are sparse (below vectorFallbackThreshold).
     *
     * @returns true if vector search was triggered and produced results.
     */
    appendVectorResults(candidateNeuronIds, query, projectId, limit, topicPath) {
        const recallCfg = globalConfig.recall;
        if (!recallCfg.vectorEnabled)
            return false;
        if (!this.deps.vectorSearchFn && !(this.deps.neuronEmbeddingStore && this.deps.embeddingProvider))
            return false;
        if (candidateNeuronIds.length >= recallCfg.vectorFallbackThreshold)
            return false;
        const syncEmbed = this.deps.embeddingProvider?.embedSync;
        const rawVectorIds = this.deps.neuronEmbeddingStore && this.deps.embeddingProvider && syncEmbed
            ? this.deps.neuronEmbeddingStore.findNearest(syncEmbed(query), projectId, limit * 4, this.deps.embeddingProvider.modelId).map((item) => item.neuronId)
            : this.deps.vectorSearchFn?.(query, projectId, limit * 4) ?? [];
        return this.appendVectorResultIds(candidateNeuronIds, rawVectorIds, projectId, topicPath, query);
    }
    async appendVectorResultsAsync(candidateNeuronIds, query, projectId, limit, topicPath) {
        const recallCfg = globalConfig.recall;
        if (!recallCfg.vectorEnabled)
            return false;
        if (!this.deps.vectorSearchFn && !(this.deps.neuronEmbeddingStore && this.deps.embeddingProvider))
            return false;
        if (candidateNeuronIds.length >= recallCfg.vectorFallbackThreshold)
            return false;
        try {
            const rawVectorIds = this.deps.neuronEmbeddingStore && this.deps.embeddingProvider
                ? this.deps.neuronEmbeddingStore
                    .findNearest(await this.deps.embeddingProvider.embed(query), projectId, limit * 4, this.deps.embeddingProvider.modelId)
                    .map((item) => item.neuronId)
                : this.deps.vectorSearchFn?.(query, projectId, limit * 4) ?? [];
            return this.appendVectorResultIds(candidateNeuronIds, rawVectorIds, projectId, topicPath, query);
        }
        catch (error) {
            logger.warn('BrainRecall async vector fallback skipped', { error });
            return false;
        }
    }
    appendVectorResultIds(candidateNeuronIds, rawVectorIds, projectId, topicPath, query) {
        const vectorIds = this.deps.vectorCandidateFilter
            ? this.deps.vectorCandidateFilter.filter(rawVectorIds, { projectId, topicPath, queryTime: Date.now() })
            : rawVectorIds;
        const recallableVectorIds = this.filterRecallableNeuronIds(vectorIds);
        if (recallableVectorIds.length === 0)
            return false;
        const existingSet = new Set(candidateNeuronIds);
        for (const id of recallableVectorIds) {
            if (!existingSet.has(id)) {
                candidateNeuronIds.push(id);
                existingSet.add(id);
            }
        }
        return true;
    }
    toRecallableNeurons(neuronIds, limit) {
        return neuronIds
            .map((neuronId) => this.deps.memoryGraph.getNeuron(neuronId))
            .filter((item) => this.isRecallableNeuron(item))
            .slice(0, limit);
    }
    retainRecallableNeuronIds(neuronIds) {
        for (let index = neuronIds.length - 1; index >= 0; index--) {
            if (!this.isRecallableNeuronId(neuronIds[index]))
                neuronIds.splice(index, 1);
        }
    }
    filterRecallableNeuronIds(neuronIds) {
        return neuronIds.filter((id) => this.isRecallableNeuronId(id));
    }
    isRecallableNeuronId(neuronId) {
        const neuron = this.deps.memoryGraph.getNeuron(neuronId);
        return !neuron || this.isRecallableNeuron(neuron);
    }
    isRecallableNeuron(neuron) {
        return isRecallableMemoryEvidence(neuron);
    }
}
