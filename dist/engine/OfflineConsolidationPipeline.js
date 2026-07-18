import { LocalSemanticCompiler } from './LocalSemanticCompiler.js';
import { normalizeLexiconText } from '../lexicon/coreMemoryLexicon.js';
import { NoopAlgorithmReviewBackend } from '../algorithm/AlgorithmReviewBackend.js';
export class NoopCoreProposalEmitter {
    emit() {
        return [];
    }
}
/**
 * Offline deep consolidation stays asynchronous and independent from sync ingest.
 * v1 performs a minimal nightly pass:
 * - group interaction units / episodes inside a window
 * - revisit low-confidence provisional facts/events
 * - resolve pending entity references and same-name duplicates
 * - promote stable provisional outputs to verified records
 * - materialize belief updates from verified facts
 */
export class OfflineConsolidationPipeline {
    deps;
    semanticCompiler;
    algorithmReviewBackend;
    plasticityProposalEmitter;
    enableAutoEdgeSeeding;
    constructor(deps = {}) {
        this.deps = deps;
        this.semanticCompiler = deps.semanticCompiler || new LocalSemanticCompiler();
        this.algorithmReviewBackend = deps.algorithmReviewBackend || new NoopAlgorithmReviewBackend();
        this.plasticityProposalEmitter = deps.plasticityProposalEmitter || new NoopCoreProposalEmitter();
        this.enableAutoEdgeSeeding = deps.enableAutoEdgeSeeding === true;
        this.initCheckpointSchema();
    }
    schedule(request) {
        const hasDeferredSignals = request.pendingReferenceIds.length > 0
            || request.reasons.length > 0
            || request.provisionalFacts.some((fact) => fact.status === 'provisional' && fact.confidence < 0.84)
            || request.provisionalEvents.some((event) => event.status === 'provisional');
        return hasDeferredSignals
            ? {
                scheduled: true,
                queueReason: 'scheduled_for_async_window'
            }
            : {
                scheduled: false,
                queueReason: 'insufficient_signal'
            };
    }
    async run(input, reviewBackend) {
        this.assertInputProjectScope(input);
        const algorithmReviewBackend = reviewBackend || this.algorithmReviewBackend;
        const correctedEntityBindings = [];
        const archivedFactIds = [];
        const rejectedFactIds = [];
        const archivedEntityIds = [];
        const unresolvedReferenceIds = [];
        const consolidatedBeliefs = [];
        const verifiedFacts = [];
        const verifiedEvents = [];
        this.deps.deepWritePromotionPolicy?.promotePending(100, { projectId: input.window.projectId });
        const episodeById = new Map(input.rawEpisodes.map((episode) => [episode.id, episode]));
        const lowConfidenceIndex = new Set(input.lowConfidenceItems.map((item) => `${item.targetType}:${item.targetId}`));
        const workingEntities = [...input.provisionalEntities];
        const workingFacts = [...input.provisionalFacts];
        const knownFactKeys = new Set(workingFacts.map((fact) => `${fact.neuronId}|${this.toFactKey(fact)}`));
        const persistSuggestedEntities = (entities) => {
            if (!this.deps.entityStore)
                return [];
            const inserted = [];
            for (const entity of entities) {
                const existing = workingEntities.find((item) => item.type === entity.type
                    && normalizeLexiconText(item.canonicalName).toLowerCase() === normalizeLexiconText(entity.canonicalName).toLowerCase());
                if (existing) {
                    inserted.push(existing);
                    continue;
                }
                const record = this.deps.entityStore.upsertEntity({
                    canonicalName: entity.canonicalName,
                    type: entity.type,
                    aliases: entity.aliases,
                    metadata: { ...(entity.metadata || {}), ...(input.window.projectId !== undefined ? { projectId: input.window.projectId } : {}) },
                    instanceMode: entity.instanceMode,
                    createdAt: input.window.endTime ?? Date.now()
                });
                workingEntities.push(record);
                inserted.push(record);
            }
            return inserted;
        };
        const persistSuggestedFacts = (facts, insertedEntities) => {
            if (!this.deps.factStore || facts.length === 0)
                return [];
            const factInputs = facts
                .map((fact) => {
                const matchedEntity = insertedEntities.find((entity) => !fact.entityId && fact.object
                    && normalizeLexiconText(entity.canonicalName).toLowerCase() === normalizeLexiconText(fact.object).toLowerCase());
                return {
                    ...fact,
                    entityId: fact.entityId || matchedEntity?.entityId
                };
            })
                .filter((fact) => {
                const key = `${fact.neuronId}|${this.toFactKey({
                    factId: 'pending',
                    ...fact
                })}`;
                if (knownFactKeys.has(key))
                    return false;
                knownFactKeys.add(key);
                return true;
            });
            const inserted = this.deps.factStore.insertFacts(factInputs);
            workingFacts.push(...inserted);
            return inserted;
        };
        const multiFactReview = await algorithmReviewBackend.reviewMultiFactExtractionCandidates({
            rawEpisodes: input.rawEpisodes,
            facts: workingFacts,
            entities: workingEntities,
            mode: 'offline'
        });
        const multiFactEntities = persistSuggestedEntities(multiFactReview.suggestedEntities);
        persistSuggestedFacts(multiFactReview.suggestedFacts, multiFactEntities);
        const selfCorrectionReview = await algorithmReviewBackend.reviewSelfCorrectionCandidates({
            rawEpisodes: input.rawEpisodes,
            facts: workingFacts,
            entities: workingEntities
        });
        persistSuggestedFacts(selfCorrectionReview.suggestedFacts, multiFactEntities);
        const reviewResult = await algorithmReviewBackend.reviewProvisionalFactCandidates({
            rawEpisodes: input.rawEpisodes,
            facts: workingFacts,
            entities: workingEntities
        });
        const adjudicationByFactId = new Map(reviewResult.adjudications.map((item) => [item.factId, item]));
        const groupedFacts = new Map();
        for (const fact of workingFacts) {
            const factKey = this.toFactKey(fact);
            const bucket = groupedFacts.get(factKey) || [];
            bucket.push(fact);
            groupedFacts.set(factKey, bucket);
        }
        for (const facts of groupedFacts.values()) {
            facts.sort((a, b) => {
                const reviewRank = (adjudicationByFactId.get(b.factId)?.action === 'verify' ? 2 : 0)
                    - (adjudicationByFactId.get(a.factId)?.action === 'verify' ? 2 : 0);
                if (reviewRank !== 0)
                    return reviewRank;
                const evidenceDelta = this.scoreFactEvidence(episodeById.get(b.neuronId)) - this.scoreFactEvidence(episodeById.get(a.neuronId));
                if (evidenceDelta !== 0)
                    return evidenceDelta;
                return (b.confidence - a.confidence) || (b.validFrom - a.validFrom);
            });
            const winner = facts[0];
            const winnerEpisode = episodeById.get(winner.neuronId);
            const reviewedWinner = adjudicationByFactId.get(winner.factId);
            if (reviewedWinner?.action === 'supersede' || reviewedWinner?.action === 'reject' || reviewedWinner?.action === 'archive') {
                const reviewedStatus = reviewedWinner.action === 'supersede'
                    ? 'superseded'
                    : reviewedWinner.action === 'archive'
                        ? 'archived'
                        : 'rejected';
                this.deps.factStore?.updateFactStatus(winner.factId, reviewedStatus, winner.confidence, {
                    offlineConsolidatedAt: Date.now(),
                    supersededByFactId: reviewedWinner.supersededByFactId,
                    ...(reviewedWinner.metadata || {})
                });
                if (reviewedStatus === 'archived')
                    archivedFactIds.push(winner.factId);
                else
                    rejectedFactIds.push(winner.factId);
                continue;
            }
            if (reviewedWinner?.action === 'keep_provisional') {
                continue;
            }
            if (!winner.entityId && winner.object && this.deps.entityStore) {
                const resolved = this.deps.entityStore.resolveReference(winner.object, this.inferEntityTypeFromFact(winner), {
                    projectId: input.window.projectId ?? winnerEpisode?.metadata.projectId,
                    beforeTime: input.window.endTime
                });
                if (resolved) {
                    this.deps.factStore?.bindFactEntity(winner.factId, resolved.entityId, Math.max(winner.confidence, 0.82), {
                        offlineConsolidatedAt: Date.now(),
                        correctedBy: 'offline_entity_resolution_v1'
                    });
                    winner.entityId = resolved.entityId;
                    winner.confidence = Math.max(winner.confidence, 0.82);
                    correctedEntityBindings.push({
                        targetId: winner.factId,
                        targetType: 'fact',
                        toEntityId: resolved.entityId,
                        reason: 'resolved_fact_entity_during_offline_consolidation'
                    });
                }
            }
            const winnerIsImportedSummarySupport = this.isImportedSummarySupport(winner, winnerEpisode);
            if (!winnerIsImportedSummarySupport
                && (reviewedWinner?.action === 'verify'
                    || this.shouldVerifyFact(winner, winnerEpisode, facts.length, lowConfidenceIndex))) {
                winner.status = 'verified';
                winner.confidence = Math.min(0.99, Math.max(reviewedWinner?.confidence || winner.confidence, facts.length > 1 ? 0.91 : 0.86));
                this.deps.factStore?.updateFactStatus(winner.factId, 'verified', winner.confidence, {
                    offlineConsolidatedAt: Date.now(),
                    provenance: reviewedWinner?.metadata?.algorithm_review_kind ? 'offline_deep_consolidation_v2' : 'offline_deep_consolidation_v1',
                    corroborationCount: facts.length,
                    ...(reviewedWinner?.metadata || {})
                });
                verifiedFacts.push(winner);
            }
            for (const duplicate of facts.slice(1)) {
                const reviewedDuplicate = adjudicationByFactId.get(duplicate.factId);
                const sameValue = this.toFactKey(duplicate) === this.toFactKey(winner);
                const loserStatus = reviewedDuplicate?.action === 'supersede'
                    ? 'superseded'
                    : reviewedDuplicate?.action === 'reject'
                        ? 'rejected'
                        : sameValue
                            ? 'archived'
                            : 'rejected';
                this.deps.factStore?.updateFactStatus(duplicate.factId, loserStatus, duplicate.confidence, {
                    offlineConsolidatedAt: Date.now(),
                    supersededByFactId: reviewedDuplicate?.supersededByFactId || winner.factId,
                    ...(reviewedDuplicate?.metadata || {})
                });
                if (loserStatus === 'archived')
                    archivedFactIds.push(duplicate.factId);
                else
                    rejectedFactIds.push(duplicate.factId);
            }
        }
        const eventGroups = new Map();
        for (const event of input.provisionalEvents) {
            const key = [event.eventType, event.actor || '', event.target || '', event.unitId || ''].join('|');
            const bucket = eventGroups.get(key) || [];
            bucket.push(event);
            eventGroups.set(key, bucket);
        }
        for (const events of eventGroups.values()) {
            events.sort((a, b) => (b.confidence - a.confidence) || (b.validFrom - a.validFrom));
            const winner = events[0];
            if (winner.status === 'provisional' && !lowConfidenceIndex.has(`event:${winner.eventId}`) && winner.confidence >= 0.72) {
                winner.status = 'verified';
                winner.confidence = Math.min(0.98, Math.max(winner.confidence, 0.84));
                this.deps.factStore?.updateEventStatus(winner.eventId, 'verified', winner.confidence);
                verifiedEvents.push(winner);
            }
            for (const duplicate of events.slice(1)) {
                this.deps.factStore?.updateEventStatus(duplicate.eventId, 'archived', duplicate.confidence);
            }
        }
        for (const pending of input.unresolvedReferences) {
            const resolved = this.deps.entityStore?.resolveReference(pending.referenceText, pending.entityType, {
                projectId: input.window.projectId,
                beforeTime: input.window.endTime
            });
            if (resolved) {
                this.deps.entityStore?.resolvePendingReference(pending.pendingId, resolved.entityId, Date.now());
                correctedEntityBindings.push({
                    targetId: pending.pendingId,
                    targetType: 'reference',
                    toEntityId: resolved.entityId,
                    reason: 'resolved_pending_reference_during_offline_consolidation'
                });
            }
            else {
                unresolvedReferenceIds.push(pending.pendingId);
            }
        }
        if (this.deps.entityStore) {
            const groupedEntities = new Map();
            for (const entity of workingEntities) {
                const key = `${entity.type}|${normalizeLexiconText(entity.canonicalName).toLowerCase()}`;
                const bucket = groupedEntities.get(key) || [];
                bucket.push(entity);
                groupedEntities.set(key, bucket);
            }
            for (const entities of groupedEntities.values()) {
                if (entities.length < 2)
                    continue;
                entities.sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt));
                const primary = entities[0];
                for (const duplicate of entities.slice(1)) {
                    this.deps.entityStore.addRelation({
                        sourceEntityId: duplicate.entityId,
                        targetEntityId: primary.entityId,
                        relationType: 'same_as',
                        createdAt: Date.now()
                    });
                    this.deps.entityStore.archiveEntity(duplicate.entityId, Date.now());
                    archivedEntityIds.push(duplicate.entityId);
                    correctedEntityBindings.push({
                        targetId: duplicate.entityId,
                        targetType: 'entity',
                        fromEntityId: duplicate.entityId,
                        toEntityId: primary.entityId,
                        reason: 'same_name_entity_merge_during_offline_consolidation'
                    });
                    for (const fact of workingFacts.filter((item) => item.entityId === duplicate.entityId)) {
                        this.deps.factStore?.bindFactEntity(fact.factId, primary.entityId, Math.max(fact.confidence, 0.84), {
                            offlineConsolidatedAt: Date.now(),
                            rebindReason: 'entity_merge'
                        });
                    }
                }
            }
        }
        for (const suggestion of reviewResult.aliasMergeSuggestions) {
            const primary = workingEntities.find((entity) => entity.entityId === suggestion.primaryEntityId);
            const duplicate = workingEntities.find((entity) => entity.entityId === suggestion.duplicateEntityId);
            if (!primary || !duplicate || duplicate.status === 'archived')
                continue;
            this.deps.entityStore?.addRelation({
                sourceEntityId: duplicate.entityId,
                targetEntityId: primary.entityId,
                relationType: 'same_as',
                createdAt: Date.now()
            });
            this.deps.entityStore?.archiveEntity(duplicate.entityId, Date.now());
            archivedEntityIds.push(duplicate.entityId);
            correctedEntityBindings.push({
                targetId: duplicate.entityId,
                targetType: 'entity',
                fromEntityId: duplicate.entityId,
                toEntityId: primary.entityId,
                reason: suggestion.reason
            });
            for (const fact of workingFacts.filter((item) => item.entityId === duplicate.entityId)) {
                this.deps.factStore?.bindFactEntity(fact.factId, primary.entityId, Math.max(fact.confidence, 0.84), {
                    offlineConsolidatedAt: Date.now(),
                    rebindReason: 'alias_merge_suggestion_phase1'
                });
            }
            duplicate.status = 'archived';
        }
        this.applyReviewAdjudications({
            adjudications: reviewResult.adjudications,
            facts: workingFacts,
            verifiedFacts,
            archivedFactIds,
            rejectedFactIds
        });
        for (const fact of verifiedFacts) {
            const candidate = this.factToBeliefCandidate(fact, episodeById.get(fact.neuronId), input.window.projectId);
            if (!candidate || !this.deps.beliefStore)
                continue;
            const result = this.deps.beliefStore.upsert(candidate, fact.validFrom);
            if (result.belief) {
                this.deps.beliefStore.attachEvidence([
                    {
                        beliefId: result.belief.id,
                        neuronId: fact.neuronId,
                        evidenceType: 'verification',
                        weight: 1,
                        createdAt: fact.validFrom
                    }
                ]);
                consolidatedBeliefs.push(result.belief);
            }
        }
        const plasticityProposals = this.plasticityProposalEmitter.emit({
            rawEpisodes: input.rawEpisodes,
            interactionUnits: input.interactionUnits,
            provisionalFacts: workingFacts,
            provisionalEvents: input.provisionalEvents,
            provisionalEntities: workingEntities,
            verifiedFacts,
            verifiedEvents,
            archivedFactIds,
            rejectedFactIds,
            archivedEntityIds,
            correctedEntityBindings,
            window: input.window
        });
        this.deps.plasticityProposalLedgerStore?.append?.(plasticityProposals);
        let autoEdgeSeeding;
        if (this.enableAutoEdgeSeeding) {
            autoEdgeSeeding = { seededEdgeCount: 0, archived: true };
        }
        await this.refreshTopicMaintenance(input);
        return {
            verifiedFacts,
            verifiedEvents,
            correctedEntityBindings,
            consolidatedBeliefs,
            archivedFactIds,
            rejectedFactIds,
            archivedEntityIds,
            unresolvedReferenceIds,
            plasticityProposals,
            autoEdgeSeeding
        };
    }
    async refreshTopicMaintenance(input) {
        const runId = `offline-maintenance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const startedAt = Date.now();
        const timings = [];
        let aborted = false;
        const maxBudgetMs = this.deps.maxBudgetMs ?? 30_000;
        const runStep = async (stepName, fn, budgeted = true) => {
            if (aborted)
                return;
            const stepStartedAt = Date.now();
            await fn();
            const completedAt = Date.now();
            timings.push({ stepName, durationMs: completedAt - stepStartedAt, completedAt });
            if (budgeted && maxBudgetMs > 0 && completedAt - startedAt >= maxBudgetMs)
                aborted = true;
        };
        const projectId = input.window.projectId;
        const topicPaths = Array.from(new Set(input.rawEpisodes.map((episode) => episode.metadata.topicPath).filter((path) => Boolean(path))));
        const steps = [
            ['MemoryConsolidationEngine', async () => {
                    if (projectId === undefined)
                        return;
                    if (this.deps.topicSummaryBoard) {
                        for (const topicPath of topicPaths)
                            this.deps.topicSummaryBoard.refresh(topicPath, projectId);
                    }
                    this.deps.topicDecayPolicy?.applyDecay(projectId);
                    await this.deps.memoryConsolidationEngine?.run(projectId);
                    this.deps.userModelManager?.refresh(projectId);
                }],
            ['ProceduralLearningBridge', async () => { if (projectId !== undefined)
                    await this.deps.proceduralLearningBridge?.scan(projectId); }],
            ['CrossTopicSynthesizer', async () => { if (projectId !== undefined)
                    await this.deps.crossTopicSynthesizer?.run(projectId); }],
            ['PrincipleDecayPolicy', async () => { if (projectId !== undefined)
                    await this.deps.principleDecayPolicy?.run(projectId); }],
            ['GraphCommunityEngine', async () => {
                    if (projectId === undefined)
                        return;
                    await this.deps.graphCommunityEngine?.run(projectId);
                    this.deps.orphanCleaner?.run(projectId);
                }],
            ['WorkingMemoryDeltaCleanup', () => { this.deps.workingMemoryDelta?.cleanup(); }, false]
        ];
        let startIndex = projectId !== undefined ? this.readCheckpointIndex(projectId, steps.map(([name]) => name)) : 0;
        for (let index = startIndex; index < steps.length; index += 1) {
            const [stepName, fn, budgeted] = steps[index];
            await runStep(stepName, fn, budgeted !== false);
            if (aborted) {
                if (maxBudgetMs > 0) {
                    this.recordRunAndCheckpoint(runId, timings, Date.now() - startedAt, true, projectId, projectId !== undefined ? steps[Math.min(index + 1, steps.length - 1)][0] : undefined);
                }
                break;
            }
        }
        if (!aborted)
            this.recordRunAndCheckpoint(runId, timings, Date.now() - startedAt, false, projectId);
    }
    initCheckpointSchema() {
        this.deps.db?.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
        projectId TEXT NOT NULL PRIMARY KEY,
        nextStep TEXT NOT NULL,
        savedAt INTEGER NOT NULL
      );
    `);
    }
    assertInputProjectScope(input) {
        if (input.window.projectId === undefined)
            return;
        const scope = input.window.projectId;
        const db = this.deps.factStore?.getDatabase();
        const neuronMatches = (neuronId) => {
            if (!neuronId || !db)
                return false;
            const row = db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0`).get(neuronId);
            return row?.scope === scope;
        };
        const invalid = input.rawEpisodes.some((neuron) => (neuron.metadata.projectId ?? '') !== scope)
            || input.provisionalFacts.some((fact) => !neuronMatches(fact.neuronId))
            || input.provisionalEvents.some((event) => !neuronMatches(event.neuronId))
            || input.recentBeliefs.some((belief) => (belief.projectId ?? '') !== scope)
            || input.provisionalEntities.some((entity) => entity.metadata?.projectId !== scope
                && (this.deps.entityStore?.listTimeline({ entityId: entity.entityId, projectId: scope, limit: 1 }).length ?? 0) === 0)
            || input.unresolvedReferences.some((pending) => !neuronMatches(pending.contextNeuronId));
        if (invalid)
            throw new Error('offline_consolidation_project_scope_mismatch');
    }
    readCheckpointIndex(projectId, steps) {
        if (!this.deps.db)
            return 0;
        const row = this.deps.db.prepare(`SELECT nextStep, savedAt FROM pipeline_checkpoints WHERE projectId = ?`).get(projectId);
        if (!row)
            return 0;
        const expiryMs = this.deps.checkpointExpiryMs ?? 24 * 60 * 60 * 1000;
        if (row.savedAt < Date.now() - expiryMs) {
            this.deps.db.prepare(`DELETE FROM pipeline_checkpoints WHERE projectId = ?`).run(projectId);
            return 0;
        }
        const index = steps.indexOf(row.nextStep);
        return index >= 0 ? index : 0;
    }
    recordRunAndCheckpoint(runId, timings, totalMs, aborted, projectId, nextStep) {
        const write = () => {
            this.deps.pipelineMetrics?.record(runId, timings, totalMs, aborted);
            if (projectId === undefined || !this.deps.db)
                return;
            if (aborted && nextStep) {
                this.deps.db.prepare(`
          INSERT INTO pipeline_checkpoints (projectId, nextStep, savedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(projectId) DO UPDATE SET
            nextStep = excluded.nextStep,
            savedAt = excluded.savedAt
        `).run(projectId, nextStep, Date.now());
            }
            else {
                this.deps.db.prepare(`DELETE FROM pipeline_checkpoints WHERE projectId = ?`).run(projectId);
            }
        };
        if (this.deps.db)
            this.deps.db.transaction(write)();
        else
            write();
    }
    shouldVerifyFact(fact, episode, corroborationCount, lowConfidenceIndex) {
        if (fact.status === 'verified')
            return true;
        if (lowConfidenceIndex.has(`fact:${fact.factId}`))
            return corroborationCount > 1;
        if (this.isImportedSummarySupport(fact, episode)) {
            return corroborationCount > 1 && !this.isImportedSummaryOnlyGroup(fact, episode);
        }
        const compilerRun = this.deps.compilerConfidenceStore
            ?.listByTarget('memory', fact.neuronId)
            .find((run) => run.targetId === fact.neuronId);
        const semanticConfidence = compilerRun?.confidence || this.semanticCompiler.compileMemory({
            text: episode?.content || fact.sourceText,
            projectId: episode?.metadata.projectId,
            type: episode?.metadata.type || 'doc',
            createdAt: fact.validFrom
        }).confidence;
        const sourceBoost = episode?.metadata.sourceType === 'user_input' ? 0.06 : 0;
        return fact.confidence + sourceBoost >= 0.8 || corroborationCount > 1 || semanticConfidence >= 0.78;
    }
    factToBeliefCandidate(fact, episode, projectId) {
        const objectValue = fact.object || fact.predicateValue;
        if (!objectValue)
            return null;
        const predicateMap = {
            owns: 'ownership',
            purchased: 'purchase',
            likes: 'preference',
            dislikes: 'preference',
            worked_on: 'project_state',
            has_issue: 'current_issue'
        };
        const predicate = predicateMap[fact.predicateFamily];
        if (!predicate)
            return null;
        if (this.isImportedSummarySupport(fact, episode))
            return null;
        return {
            projectId,
            scope: 'project',
            subject: fact.subject,
            predicate,
            objectValue: {
                raw: objectValue,
                normalized: normalizeLexiconText(objectValue).toLowerCase(),
                type: 'string'
            },
            confidence: Math.min(0.98, Math.max(fact.confidence, 0.86)),
            sourceNeuronId: fact.neuronId,
            sourceType: 'verified_fact',
            validFrom: fact.validFrom,
            explanation: `offline verified from fact:${fact.factId}`,
            metadata: {
                factId: fact.factId,
                entityId: fact.entityId,
                source: 'offline_deep_consolidation_v1'
            },
            extractionReason: fact.predicateFamily === 'likes' || fact.predicateFamily === 'dislikes'
                ? 'preference_signal'
                : 'tool_verified_fact'
        };
    }
    toFactKey(fact) {
        if (fact.predicateFamily === 'has_issue' || fact.metadata?.imported_summary_support === true) {
            const issueAnchor = fact.entityId || normalizeLexiconText(fact.object || '') || fact.subject;
            return [
                issueAnchor,
                fact.predicateFamily,
                normalizeLexiconText(fact.predicateValue || ''),
                normalizeLexiconText(fact.object || '')
            ].join('|');
        }
        return [
            fact.entityId || fact.subject,
            fact.predicateFamily,
            normalizeLexiconText(fact.predicateValue || ''),
            normalizeLexiconText(fact.object || ''),
            normalizeLexiconText(fact.sourceText)
        ].join('|');
    }
    inferEntityTypeFromFact(fact) {
        if (fact.predicateFamily === 'worked_on')
            return 'project';
        if (fact.predicateFamily === 'owns' || fact.predicateFamily === 'purchased' || fact.predicateFamily === 'has_issue')
            return 'device';
        return undefined;
    }
    scoreFactEvidence(episode) {
        if (!episode)
            return 0;
        const tags = episode.metadata.tags || [];
        if (tags.includes('reliability:imported_summary'))
            return 0;
        if (tags.includes('reliability:raw_utterance')) {
            return episode.metadata.sourceType === 'user_input' ? 4 : 3;
        }
        if (tags.includes('reliability:self_summary'))
            return 2;
        if (tags.includes('reliability:reflection'))
            return 1;
        return episode.metadata.sourceType === 'user_input' ? 3 : 1;
    }
    isImportedSummarySupport(fact, episode) {
        return fact.metadata?.imported_summary_support === true
            || (episode?.metadata.tags || []).includes('reliability:imported_summary');
    }
    isImportedSummaryOnlyGroup(fact, episode) {
        if (fact.predicateFamily !== 'has_issue')
            return false;
        return this.isImportedSummarySupport(fact, episode);
    }
    applyReviewAdjudications(input) {
        const verifiedIds = new Set(input.verifiedFacts.map((fact) => fact.factId));
        const archivedIds = new Set(input.archivedFactIds);
        const rejectedIds = new Set(input.rejectedFactIds);
        const factById = new Map(input.facts.map((fact) => [fact.factId, fact]));
        for (const adjudication of input.adjudications) {
            const fact = factById.get(adjudication.factId);
            if (!fact)
                continue;
            if (adjudication.action === 'verify' && fact.metadata?.imported_summary_support === true) {
                continue;
            }
            if (adjudication.action === 'verify' && !verifiedIds.has(fact.factId)) {
                fact.status = 'verified';
                fact.confidence = Math.max(fact.confidence, adjudication.confidence || 0.86);
                this.deps.factStore?.updateFactStatus(fact.factId, 'verified', fact.confidence, {
                    offlineConsolidatedAt: Date.now(),
                    provenance: 'offline_deep_consolidation_v2',
                    ...(adjudication.metadata || {})
                });
                input.verifiedFacts.push(fact);
                verifiedIds.add(fact.factId);
            }
            if (adjudication.action === 'supersede') {
                fact.status = 'superseded';
                this.deps.factStore?.updateFactStatus(fact.factId, 'superseded', fact.confidence, {
                    offlineConsolidatedAt: Date.now(),
                    supersededByFactId: adjudication.supersededByFactId,
                    ...(adjudication.metadata || {})
                });
                const verifiedIndex = input.verifiedFacts.findIndex((item) => item.factId === fact.factId);
                if (verifiedIndex >= 0)
                    input.verifiedFacts.splice(verifiedIndex, 1);
                if (!rejectedIds.has(fact.factId)) {
                    input.rejectedFactIds.push(fact.factId);
                    rejectedIds.add(fact.factId);
                }
            }
            if (adjudication.action === 'archive' && !archivedIds.has(fact.factId)) {
                fact.status = 'archived';
                this.deps.factStore?.updateFactStatus(fact.factId, 'archived', fact.confidence, {
                    offlineConsolidatedAt: Date.now(),
                    ...(adjudication.metadata || {})
                });
                const verifiedIndex = input.verifiedFacts.findIndex((item) => item.factId === fact.factId);
                if (verifiedIndex >= 0)
                    input.verifiedFacts.splice(verifiedIndex, 1);
                input.archivedFactIds.push(fact.factId);
                archivedIds.add(fact.factId);
            }
            if (adjudication.action === 'reject' && !rejectedIds.has(fact.factId)) {
                fact.status = 'rejected';
                this.deps.factStore?.updateFactStatus(fact.factId, 'rejected', fact.confidence, {
                    offlineConsolidatedAt: Date.now(),
                    ...(adjudication.metadata || {})
                });
                const verifiedIndex = input.verifiedFacts.findIndex((item) => item.factId === fact.factId);
                if (verifiedIndex >= 0)
                    input.verifiedFacts.splice(verifiedIndex, 1);
                input.rejectedFactIds.push(fact.factId);
                rejectedIds.add(fact.factId);
            }
        }
    }
}
