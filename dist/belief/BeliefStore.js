// @ts-nocheck
import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { ConditionDslEvaluator } from '../retrieval/ConditionDslEvaluator.js';
import { PlanDslExecutor } from '../retrieval/PlanDslExecutor.js';
import { PolicyRuntimeEvaluator } from '../retrieval/PolicyRuntimeEvaluator.js';
export class BeliefStore {
    eventStore;
    static SOURCE_TRUST = {
        verified_fact: 1.0,
        external_tool: 0.9,
        user_input: 0.85,
        llm_inference: 0.55
    };
    static SCOPE_PRIORITY = {
        file: 5,
        session: 4,
        project: 3,
        agent: 2,
        global: 1
    };
    db;
    closed = false;
    constructor(dbPath = ':memory:', eventStore) {
        this.eventStore = eventStore;
        this.db = new Database(dbPath);
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS beliefs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        scope TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_value TEXT NOT NULL,
        object_type TEXT NOT NULL DEFAULT 'string',
        canonical_key TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        trust_score REAL NOT NULL DEFAULT 1.0,
        source_neuron_id TEXT,
        source_event_id TEXT,
        source_type TEXT NOT NULL DEFAULT 'user_input',
        validity_kind TEXT NOT NULL DEFAULT 'open',
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        supersedes_belief_id TEXT,
        superseded_by_belief_id TEXT,
        contradiction_group TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        explanation TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_beliefs_canonical ON beliefs(canonical_key, status, valid_from DESC);
      CREATE INDEX IF NOT EXISTS idx_beliefs_subject_predicate ON beliefs(subject, predicate, status, valid_from DESC);

      CREATE TABLE IF NOT EXISTS belief_evidence (
        belief_id TEXT NOT NULL,
        neuron_id TEXT,
        event_id TEXT,
        evidence_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (belief_id, neuron_id, event_id, evidence_type)
      );
    `);
    }
    findByCanonicalKey(canonicalKey) {
        const rows = this.db.prepare(`
      SELECT * FROM beliefs
      WHERE canonical_key = ?
      ORDER BY valid_from DESC, created_at DESC
    `).all(canonicalKey);
        return rows.map((row) => this.mapBelief(row));
    }
    countActive(projectId) {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM beliefs
      WHERE status = 'active'
        AND (? IS NULL OR project_id = ?)
    `).get(projectId || null, projectId || null);
        return row.count;
    }
    listByTimeRange(startTime, endTime, options) {
        const statuses = options?.statuses ?? ['active', 'superseded', 'suspect', 'expired', 'revoked'];
        const rows = this.db.prepare(`
      SELECT *
      FROM beliefs
      WHERE valid_from >= ?
        AND valid_from < ?
        AND (? IS NULL OR project_id = ?)
        AND status IN (${statuses.map(() => '?').join(', ')})
      ORDER BY valid_from DESC, updated_at DESC
      LIMIT ?
    `).all(startTime, endTime, options?.projectId || null, options?.projectId || null, ...statuses, options?.limit ?? 200);
        return rows.map((row) => this.mapBelief(row));
    }
    getActiveBeliefsForQuery(input) {
        const query = input.query.toLowerCase().trim();
        const atTime = input.atTime ?? Date.now();
        const tokens = this.extractQueryTokens(query, input.entities, input.mustMatch, input.shouldMatch);
        const structuredTargets = this.extractStructuredTargets(query, input.intent, tokens, input.semantics);
        const rows = this.db.prepare(`
      SELECT *
      FROM beliefs
      WHERE status = 'active'
        AND valid_from <= ?
        AND (valid_to IS NULL OR valid_to > ?)
        AND (? IS NULL OR project_id = ? OR scope = 'global')
      ORDER BY updated_at DESC, confidence DESC
      LIMIT 200
    `).all(atTime, atTime, input.projectId || null, input.projectId || null);
        const scored = rows
            .map((row) => this.mapBelief(row))
            .map((belief) => ({
            belief,
            score: this.scoreBeliefForQuery(belief, {
                query,
                tokens,
                projectId: input.projectId,
                intent: input.intent,
                structuredTargets,
                semantics: input.semantics
            })
        }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, input.limit ?? 8);
        return scored.map((item) => item.belief);
    }
    getBeliefHistoryForCanonicalKeys(canonicalKeys, options = {}) {
        if (canonicalKeys.length === 0)
            return new Map();
        const includeStatuses = options.includeStatuses ?? ['active', 'superseded', 'suspect', 'expired', 'revoked'];
        const keyPlaceholders = canonicalKeys.map(() => '?').join(', ');
        const statusPlaceholders = includeStatuses.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT *
      FROM beliefs
      WHERE canonical_key IN (${keyPlaceholders})
        AND status IN (${statusPlaceholders})
      ORDER BY updated_at DESC, valid_from DESC, created_at DESC
    `).all(...canonicalKeys, ...includeStatuses);
        const grouped = new Map();
        for (const row of rows) {
            const belief = this.mapBelief(row);
            const bucket = grouped.get(belief.canonicalKey) || [];
            if (bucket.length >= (options.limitPerCanonical ?? 6))
                continue;
            bucket.push(belief);
            grouped.set(belief.canonicalKey, bucket);
        }
        return grouped;
    }
    getExecutionFeedbackNeuronSignals(records) {
        if (records.length === 0)
            return [];
        const rows = this.db.prepare(`
      SELECT *
      FROM beliefs
      WHERE status = 'active'
        AND source_neuron_id IS NOT NULL
      ORDER BY updated_at DESC
    `).all();
        const signals = new Map();
        for (const row of rows) {
            const belief = this.mapBelief(row);
            if (!belief.sourceNeuronId)
                continue;
            const feedback = this.computeExecutionFeedbackForBelief(belief, records);
            if (!feedback)
                continue;
            const current = signals.get(belief.sourceNeuronId) || {
                neuronId: belief.sourceNeuronId,
                matchedExecutions: 0,
                executed: 0,
                failed: 0,
                latestUpdatedAt: undefined
            };
            current.matchedExecutions += feedback.matchedExecutions;
            current.executed += feedback.executed;
            current.failed += feedback.failed;
            current.latestUpdatedAt = Math.max(current.latestUpdatedAt || 0, feedback.latestUpdatedAt || 0) || undefined;
            signals.set(belief.sourceNeuronId, current);
        }
        return Array.from(signals.values());
    }
    applyExecutionFeedbackCalibration(records, now = Date.now()) {
        if (records.length === 0)
            return 0;
        const rows = this.db.prepare(`
      SELECT *
      FROM beliefs
      WHERE status = 'active'
      ORDER BY updated_at DESC
    `).all();
        let updated = 0;
        for (const row of rows) {
            const belief = this.mapBelief(row);
            const feedback = this.computeExecutionFeedbackForBelief(belief, records);
            if (!feedback)
                continue;
            const nextTrust = this.clamp(belief.trustScore + feedback.executed * 0.02 - feedback.failed * 0.03, 0.1, 1.0);
            const nextUpdatedAt = Math.max(belief.updatedAt, feedback.latestUpdatedAt || belief.updatedAt);
            if (Math.abs(nextTrust - belief.trustScore) < 0.0001 && nextUpdatedAt === belief.updatedAt)
                continue;
            const metadata = {
                ...(belief.metadata || {}),
                executionFeedbackCalibration: {
                    matchedExecutions: feedback.matchedExecutions,
                    executed: feedback.executed,
                    failed: feedback.failed,
                    latestUpdatedAt: feedback.latestUpdatedAt,
                    calibratedAt: now
                }
            };
            this.db.prepare(`
        UPDATE beliefs
        SET trust_score = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(nextTrust, JSON.stringify(metadata), nextUpdatedAt, belief.id);
            updated += 1;
            this.eventStore?.append({
                streamId: belief.id,
                streamType: 'belief',
                eventType: 'BELIEF_RECALIBRATED',
                projectId: belief.projectId,
                sourceNeuronId: belief.sourceNeuronId,
                occurredAt: now,
                payload: {
                    beliefId: belief.id,
                    previousTrustScore: belief.trustScore,
                    nextTrustScore: nextTrust,
                    matchedExecutions: feedback.matchedExecutions,
                    executed: feedback.executed,
                    failed: feedback.failed
                }
            });
        }
        return updated;
    }
    getEvidenceNeuronIds(beliefIds, limitPerBelief = 3) {
        if (beliefIds.length === 0)
            return [];
        const placeholders = beliefIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT belief_id, neuron_id
      FROM belief_evidence
      WHERE belief_id IN (${placeholders})
        AND neuron_id IS NOT NULL
      ORDER BY weight DESC, created_at DESC
    `).all(...beliefIds);
        const limited = new Map();
        for (const row of rows) {
            if (!row.neuron_id)
                continue;
            const bucket = limited.get(row.belief_id) || [];
            if (bucket.length >= limitPerBelief)
                continue;
            if (!bucket.includes(row.neuron_id))
                bucket.push(row.neuron_id);
            limited.set(row.belief_id, bucket);
        }
        return Array.from(new Set(Array.from(limited.values()).flat()));
    }
    upsert(candidate, now = Date.now()) {
        const canonicalKey = this.toCanonicalKey(candidate.subject, candidate.predicate, candidate.scope);
        const conflicts = this.findByCanonicalKey(canonicalKey).map((existing) => ({
            existing,
            incoming: candidate,
            reason: this.isSameBeliefValue(candidate.objectValue, existing.objectValue) ? 'same_value' : 'contradictory_value'
        }));
        const decision = this.resolveConflict(candidate, conflicts, now);
        if (decision.action === 'reject_incoming') {
            return { belief: null, decision };
        }
        const beliefId = `belief-${randomUUID()}`;
        const belief = {
            id: beliefId,
            projectId: candidate.projectId,
            scope: candidate.scope,
            subject: candidate.subject,
            predicate: candidate.predicate,
            objectValue: candidate.objectValue,
            canonicalKey,
            confidence: candidate.confidence,
            trustScore: candidate.trustScore ?? this.getSourceTrust(candidate.sourceType),
            sourceNeuronId: candidate.sourceNeuronId,
            sourceEventId: candidate.sourceEventId,
            sourceType: candidate.sourceType,
            validityKind: candidate.validityKind ?? 'open',
            validFrom: candidate.validFrom ?? now,
            validTo: candidate.validTo,
            supersedesBeliefId: decision.supersedeBeliefIds?.[0],
            supersededByBeliefId: undefined,
            contradictionGroup: decision.contradictionGroup,
            status: 'active',
            explanation: candidate.explanation,
            metadata: {
                ...candidate.metadata,
                ...decision.normalizedMetadata
            },
            createdAt: now,
            updatedAt: now
        };
        this.db.transaction(() => {
            if (decision.supersedeBeliefIds?.length) {
                for (const supersededId of decision.supersedeBeliefIds) {
                    this.db.prepare(`
            UPDATE beliefs
            SET status = 'superseded', superseded_by_belief_id = ?, valid_to = ?, updated_at = ?
            WHERE id = ?
          `).run(belief.id, belief.validFrom, now, supersededId);
                }
            }
            this.db.prepare(`
        INSERT INTO beliefs (
          id, project_id, scope, subject, predicate, object_value, object_type,
          canonical_key, confidence, trust_score, source_neuron_id, source_event_id,
          source_type, validity_kind, valid_from, valid_to, supersedes_belief_id,
          superseded_by_belief_id, contradiction_group, status, explanation,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(belief.id, belief.projectId || null, belief.scope, belief.subject, belief.predicate, belief.objectValue.normalized || belief.objectValue.raw, belief.objectValue.type, belief.canonicalKey, belief.confidence, belief.trustScore, belief.sourceNeuronId || null, belief.sourceEventId || null, belief.sourceType, belief.validityKind, belief.validFrom, belief.validTo || null, belief.supersedesBeliefId || null, null, belief.contradictionGroup || null, belief.status, belief.explanation || null, belief.metadata ? JSON.stringify(belief.metadata) : null, belief.createdAt, belief.updatedAt);
            if (belief.sourceNeuronId || belief.sourceEventId) {
                this.attachEvidence([
                    {
                        beliefId: belief.id,
                        neuronId: belief.sourceNeuronId,
                        eventId: belief.sourceEventId,
                        evidenceType: 'source',
                        weight: 1,
                        createdAt: now
                    }
                ]);
            }
        })();
        if (this.eventStore) {
            this.eventStore.append({
                streamId: belief.id,
                streamType: 'belief',
                eventType: 'BELIEF_UPSERTED',
                projectId: belief.projectId,
                sourceNeuronId: belief.sourceNeuronId,
                occurredAt: now,
                payload: {
                    beliefId: belief.id,
                    canonicalKey: belief.canonicalKey,
                    action: decision.action,
                    supersedeBeliefIds: decision.supersedeBeliefIds || []
                }
            });
        }
        return { belief, decision };
    }
    attachEvidence(records) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO belief_evidence (
        belief_id, neuron_id, event_id, evidence_type, weight, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
        for (const record of records) {
            stmt.run(record.beliefId, record.neuronId || null, record.eventId || null, record.evidenceType, record.weight, record.createdAt);
        }
    }
    resolveConflict(incoming, conflicts, now = Date.now()) {
        if (conflicts.length === 0)
            return { action: 'insert' };
        const activeConflicts = conflicts
            .map((conflict) => conflict.existing)
            .filter((belief) => belief.status === 'active' || belief.status === 'suspect');
        if (activeConflicts.length === 0)
            return { action: 'insert' };
        const incomingStrength = this.computeBeliefStrength({
            confidence: incoming.confidence,
            trustScore: incoming.trustScore ?? this.getSourceTrust(incoming.sourceType),
            sourceType: incoming.sourceType,
            validFrom: incoming.validFrom ?? now,
            scope: incoming.scope,
            predicate: incoming.predicate,
            now
        });
        let supersedeIds = [];
        let strongerExistingCount = 0;
        let sameValueCount = 0;
        let narrowerExistingCount = 0;
        for (const existing of activeConflicts) {
            if (this.isSameBeliefValue(incoming.objectValue, existing.objectValue)) {
                sameValueCount += 1;
                continue;
            }
            const compare = this.compareBeliefs(incoming, existing, now);
            if (this.getScopePriority(existing.scope) > this.getScopePriority(incoming.scope)) {
                narrowerExistingCount += 1;
            }
            if (compare === 'incoming')
                supersedeIds.push(existing.id);
            else if (compare === 'existing')
                strongerExistingCount += 1;
        }
        if (sameValueCount === activeConflicts.length) {
            return incomingStrength >= 0.72
                ? {
                    action: 'coexist_conditional',
                    contradictionGroup: this.buildContradictionGroup(incoming),
                    normalizedMetadata: { mergeEvidenceOnly: true, reason: 'same_value_additional_evidence' }
                }
                : {
                    action: 'reject_incoming',
                    rejectReason: 'duplicate_or_lower_value_restatement'
                };
        }
        if (narrowerExistingCount > 0 && supersedeIds.length > 0 && this.getScopePriority(incoming.scope) < 5) {
            return {
                action: 'coexist_conditional',
                contradictionGroup: this.buildContradictionGroup(incoming),
                normalizedMetadata: {
                    preserveExistingScope: true,
                    attemptedSupersedeIds: supersedeIds,
                    reason: 'incoming_scope_too_broad'
                }
            };
        }
        if (supersedeIds.length > 0 && strongerExistingCount === 0) {
            return {
                action: 'supersede_existing',
                supersedeBeliefIds: supersedeIds,
                contradictionGroup: this.buildContradictionGroup(incoming),
                normalizedMetadata: { reason: 'incoming_has_higher_strength', incomingStrength }
            };
        }
        if (strongerExistingCount === activeConflicts.length) {
            return {
                action: 'reject_incoming',
                rejectReason: 'existing_beliefs_have_higher_strength'
            };
        }
        return {
            action: 'coexist_conditional',
            contradictionGroup: this.buildContradictionGroup(incoming),
            normalizedMetadata: {
                reason: 'conditional_or_temporal_coexistence',
                incomingStrength,
                strongerExistingCount,
                supersedeIds
            }
        };
    }
    compareBeliefs(incoming, existing, now) {
        const incomingStrength = this.computeBeliefStrength({
            confidence: incoming.confidence,
            trustScore: incoming.trustScore ?? this.getSourceTrust(incoming.sourceType),
            sourceType: incoming.sourceType,
            validFrom: incoming.validFrom ?? now,
            scope: incoming.scope,
            predicate: incoming.predicate,
            now
        });
        const existingStrength = this.computeBeliefStrength({
            confidence: existing.confidence,
            trustScore: existing.trustScore,
            sourceType: existing.sourceType,
            validFrom: existing.validFrom,
            scope: existing.scope,
            predicate: existing.predicate,
            now
        });
        const delta = incomingStrength - existingStrength;
        const incomingValidFrom = incoming.validFrom ?? now;
        const sameSourceFamily = incoming.sourceType === existing.sourceType;
        const newerPreferenceRevision = ((incoming.predicate.startsWith('preference.') || incoming.predicate.startsWith('decision.')) &&
            incomingValidFrom > existing.validFrom &&
            sameSourceFamily &&
            delta > -0.05);
        if (newerPreferenceRevision)
            return 'incoming';
        if (delta >= 0.12)
            return 'incoming';
        if (delta <= -0.12)
            return 'existing';
        return 'tie';
    }
    computeBeliefStrength(input) {
        const sourceTrust = this.getSourceTrust(input.sourceType);
        const effectiveTrust = this.clamp((input.trustScore + sourceTrust) / 2, 0, 1);
        const freshness = this.computeTemporalFreshness((input.now - input.validFrom) / 3600000, input.predicate, input.sourceType);
        const scopeWeight = this.computeScopeWeight(input.scope, input.predicate);
        const weights = this.resolveWeightMatrix(input.predicate, input.sourceType);
        return input.confidence * weights.confidenceW
            + effectiveTrust * weights.trustW
            + freshness * weights.freshnessW
            + scopeWeight * weights.scopeW;
    }
    resolveWeightMatrix(predicate, sourceType) {
        if (predicate.startsWith('preference.') || predicate.startsWith('decision.')) {
            return { confidenceW: 0.28, trustW: 0.22, freshnessW: 0.38, scopeW: 0.12 };
        }
        if (predicate.startsWith('constraint.') || predicate.startsWith('workflow.')) {
            return { confidenceW: 0.3, trustW: 0.3, freshnessW: 0.24, scopeW: 0.16 };
        }
        if (sourceType === 'verified_fact') {
            return { confidenceW: 0.24, trustW: 0.46, freshnessW: 0.18, scopeW: 0.12 };
        }
        return { confidenceW: 0.3, trustW: 0.34, freshnessW: 0.24, scopeW: 0.12 };
    }
    computeTemporalFreshness(ageHours, predicate, sourceType) {
        let halfLifeHours = 24 * 30;
        if (predicate.startsWith('preference.'))
            halfLifeHours = 24 * 10;
        else if (predicate.startsWith('decision.'))
            halfLifeHours = 24 * 14;
        else if (predicate.startsWith('constraint.'))
            halfLifeHours = 24 * 21;
        else if (sourceType === 'verified_fact')
            halfLifeHours = 24 * 90;
        return Math.exp(-Math.log(2) * Math.max(ageHours, 0) / halfLifeHours);
    }
    computeScopeWeight(scope, predicate) {
        const base = {
            global: 0.45,
            agent: 0.5,
            project: 0.68,
            session: 0.82,
            file: 0.92
        }[scope];
        if (predicate.startsWith('fact.') && scope === 'global')
            return 0.8;
        if (predicate.startsWith('fact.') && scope === 'file')
            return 0.6;
        return base;
    }
    buildContradictionGroup(candidate) {
        return `${candidate.subject}|${candidate.predicate}|${candidate.scope}`;
    }
    mapBelief(row) {
        return {
            id: row.id,
            projectId: row.project_id || undefined,
            scope: row.scope,
            subject: row.subject,
            predicate: row.predicate,
            objectValue: {
                raw: row.object_value,
                normalized: row.object_value,
                type: row.object_type
            },
            canonicalKey: row.canonical_key,
            confidence: row.confidence,
            trustScore: row.trust_score,
            sourceNeuronId: row.source_neuron_id || undefined,
            sourceEventId: row.source_event_id || undefined,
            sourceType: row.source_type,
            validityKind: row.validity_kind,
            validFrom: row.valid_from,
            validTo: row.valid_to || undefined,
            supersedesBeliefId: row.supersedes_belief_id || undefined,
            supersededByBeliefId: row.superseded_by_belief_id || undefined,
            contradictionGroup: row.contradiction_group || undefined,
            status: row.status,
            explanation: row.explanation || undefined,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    isSameBeliefValue(a, b) {
        return (a.normalized || a.raw) === (b.normalized || b.raw);
    }
    toCanonicalKey(subject, predicate, scope) {
        return `${subject}|${predicate}|${scope}`;
    }
    getSourceTrust(sourceType) {
        return BeliefStore.SOURCE_TRUST[sourceType] ?? 0.5;
    }
    getScopePriority(scope) {
        return BeliefStore.SCOPE_PRIORITY[scope] ?? 0;
    }
    scoreBeliefForQuery(belief, input) {
        let score = 0;
        let matchedLexicalSignal = false;
        let matchedStructuredSignal = false;
        let matchedRuntimeSignal = false;
        const query = input.query;
        const tokens = input.tokens;
        const haystacks = [
            belief.subject.toLowerCase(),
            belief.predicate.toLowerCase(),
            (belief.objectValue.normalized || belief.objectValue.raw).toLowerCase(),
            belief.explanation?.toLowerCase() || ''
        ];
        for (const token of tokens) {
            if (haystacks.some((haystack) => haystack.includes(token))) {
                score += 1.2;
                matchedLexicalSignal = true;
            }
        }
        if (input.structuredTargets.subject && belief.subject === input.structuredTargets.subject) {
            score += 1.4;
        }
        if (input.structuredTargets.predicatePrefix && belief.predicate.startsWith(input.structuredTargets.predicatePrefix)) {
            score += 3.2;
            matchedStructuredSignal = true;
        }
        if (input.structuredTargets.entity && belief.predicate.includes(input.structuredTargets.entity)) {
            score += 2.4;
            matchedStructuredSignal = true;
        }
        if (input.structuredTargets.expectedValue) {
            const value = (belief.objectValue.normalized || belief.objectValue.raw).toLowerCase();
            if (value === input.structuredTargets.expectedValue) {
                score += 1.1;
                matchedStructuredSignal = true;
            }
        }
        if (input.structuredTargets.asksForHistory && belief.status !== 'active') {
            score += 0.9;
            matchedStructuredSignal = true;
        }
        if (input.intent === 'preference_lookup' && belief.predicate.startsWith('preference.')) {
            score += 1.8;
            matchedStructuredSignal = true;
        }
        if (input.intent === 'decision_lookup' && belief.predicate.startsWith('decision.')) {
            score += 1.8;
            matchedStructuredSignal = true;
        }
        if (input.intent === 'constraint_lookup' && (belief.predicate.startsWith('constraint.') || belief.predicate.startsWith('workflow.'))) {
            score += 1.8;
            matchedStructuredSignal = true;
        }
        if (input.intent === 'fact_lookup' && belief.predicate.startsWith('fact.')) {
            score += 1.6;
            matchedStructuredSignal = true;
        }
        const conditionDsl = belief.metadata?.conditionDsl;
        if (conditionDsl) {
            const conditionResult = ConditionDslEvaluator.evaluate(conditionDsl, {
                projectId: input.projectId,
                rawQuery: input.query,
                conditionHints: input.semantics?.conditionHints,
                entityHints: input.semantics?.entityHints,
                environmentHints: input.semantics?.environmentHints,
                stateHints: input.semantics?.stateHints,
                policyHints: input.semantics?.policyHints
            });
            if (conditionResult.matched) {
                score += 3.2 + conditionResult.score * 0.8;
                matchedRuntimeSignal = true;
            }
            else
                score -= 3.2;
        }
        const planDsl = belief.metadata?.planDsl;
        if (planDsl && input.structuredTargets.predicatePrefix === 'workflow.plan.') {
            const planText = JSON.stringify(planDsl).toLowerCase();
            for (const hint of input.semantics?.entityHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.7;
            }
            for (const hint of input.semantics?.environmentHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.55;
            }
            for (const hint of input.semantics?.stateHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.75;
            }
            for (const hint of input.semantics?.policyHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.75;
            }
            for (const hint of input.semantics?.guardHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.65;
            }
            for (const hint of input.semantics?.executorHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.75;
            }
            for (const hint of input.semantics?.validationHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.65;
            }
            for (const hint of input.semantics?.mergeHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.65;
            }
            for (const hint of input.semantics?.valueHints || []) {
                if (planText.includes(hint.toLowerCase()))
                    score += 0.6;
            }
            if (Array.isArray(planDsl.executionGuards) && /guard|approval|批准|审批/i.test(input.query)) {
                score += 0.8;
            }
            if (Array.isArray(planDsl.stateMachines) && (input.semantics?.stateHints?.length || 0) > 0) {
                score += 0.9;
            }
            if (Array.isArray(planDsl.policyRuntime) && (input.semantics?.policyHints?.length || 0) > 0) {
                score += 0.9;
            }
            if (Array.isArray(planDsl.mergeConstraints) && /merge|合并|constraint|约束/i.test(input.query)) {
                score += 0.7;
            }
            if (Array.isArray(planDsl.runtimeValidation) && /validate|校验|check/i.test(input.query)) {
                score += 0.7;
            }
            if (Array.isArray(planDsl.executorBindings) && /execute|executor|执行/i.test(input.query)) {
                score += 0.8;
            }
            if (Array.isArray(planDsl.mergePropagation) && /propagate|传播|merge/i.test(input.query)) {
                score += 0.8;
            }
            const defaultEntityStateKey = input.structuredTargets.entity || 'service';
            const executionAnalysis = PlanDslExecutor.analyze(planDsl, {
                completedSteps: input.semantics?.mergeHints,
                availableChecks: input.semantics?.validationHints,
                approvals: input.semantics?.guardHints,
                availableExecutors: input.semantics?.executorHints,
                activePolicies: input.semantics?.policyHints,
                entityStates: Object.fromEntries((input.semantics?.stateHints || []).map((state) => [defaultEntityStateKey, state])),
                mergeArtifacts: input.semantics?.mergeHints
            });
            if (executionAnalysis.executableSteps.length > 0) {
                score += Math.min(executionAnalysis.executableSteps.length, 3) * 0.25;
                matchedRuntimeSignal = true;
            }
            if (executionAnalysis.blockedSteps.length > 0)
                score -= Math.min(executionAnalysis.blockedSteps.length, 3) * 0.18;
            if (executionAnalysis.mergeReadiness.some((item) => item.ready)) {
                score += 0.45;
                matchedRuntimeSignal = true;
            }
            if (executionAnalysis.validationReadiness.some((item) => item.ready)) {
                score += 0.35;
                matchedRuntimeSignal = true;
            }
            if (executionAnalysis.executorMatches.some((item) => item.matched)) {
                score += 0.45;
                matchedRuntimeSignal = true;
            }
            if (executionAnalysis.policyCoverage.some((item) => item.matched)) {
                score += 0.4;
                matchedRuntimeSignal = true;
            }
            const runtimeDecision = PolicyRuntimeEvaluator.evaluate({
                conditionDsl: belief.metadata?.conditionDsl,
                planDsl
            }, {
                projectId: input.projectId,
                rawQuery: input.query,
                conditionHints: input.semantics?.conditionHints,
                entityHints: input.semantics?.entityHints,
                environmentHints: input.semantics?.environmentHints,
                stateHints: input.semantics?.stateHints,
                policyHints: input.semantics?.policyHints,
                completedSteps: input.semantics?.mergeHints,
                availableChecks: input.semantics?.validationHints,
                approvals: input.semantics?.guardHints,
                availableExecutors: input.semantics?.executorHints,
                activePolicies: input.semantics?.policyHints,
                entityStates: Object.fromEntries((input.semantics?.stateHints || []).map((state) => [defaultEntityStateKey, state])),
                mergeArtifacts: input.semantics?.mergeHints
            });
            if (runtimeDecision.allowed) {
                score += 0.9;
                matchedRuntimeSignal = true;
            }
            else
                score -= 0.5;
        }
        if (belief.canonicalKey.toLowerCase().includes(query)) {
            score += 1.5;
            matchedLexicalSignal = true;
        }
        if (!matchedLexicalSignal && !matchedStructuredSignal && !matchedRuntimeSignal) {
            return 0;
        }
        if (input.projectId && belief.projectId === input.projectId)
            score += 0.8;
        if (belief.scope === 'project')
            score += 0.3;
        if (belief.scope === 'global')
            score += 0.1;
        score += belief.confidence * 0.6;
        score += belief.trustScore * 0.6;
        if (belief.status === 'active')
            score += 0.4;
        return score;
    }
    computeExecutionFeedbackForBelief(belief, records) {
        const planDsl = belief.metadata?.planDsl;
        if (!planDsl)
            return null;
        const policyGroup = typeof planDsl.policyGroup === 'string'
            ? planDsl.policyGroup
            : typeof belief.metadata?.policyGroup === 'string'
                ? String(belief.metadata.policyGroup)
                : undefined;
        const serialized = JSON.stringify(planDsl);
        const policies = Array.from(new Set([...serialized.matchAll(/"(?:policy|name)"\s*:\s*"([^"]+)"/g)].map((match) => match[1] || ''))).filter(Boolean);
        const matched = records.filter((record) => {
            if (policyGroup && record.policyGroup === policyGroup)
                return true;
            if (policies.includes(record.policy))
                return true;
            return false;
        });
        if (matched.length === 0)
            return null;
        return {
            matchedExecutions: matched.length,
            executed: matched.filter((record) => record.status === 'executed').length,
            failed: matched.filter((record) => record.status === 'failed').length,
            latestUpdatedAt: matched.reduce((max, record) => Math.max(max, record.updatedAt), 0) || undefined
        };
    }
    extractQueryTokens(query, entities, mustMatch, shouldMatch) {
        const baseTokens = query
            .split(/[\s,，。！？、:：/]+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2);
        return Array.from(new Set([
            ...baseTokens,
            ...(entities || []),
            ...(mustMatch || []),
            ...(shouldMatch || [])
        ].map((token) => token.toLowerCase()).filter((token) => token.length >= 2)));
    }
    extractStructuredTargets(query, intent, tokens, semantics) {
        const target = {};
        target.subject = semantics?.subjectHint || (/(我|i|my|mine)/i.test(query) ? 'user' : undefined);
        target.asksForHistory = semantics?.asksForHistory;
        const predicateHint = semantics?.predicateHint;
        if (intent === 'preference_lookup' || predicateHint === 'preference') {
            target.predicatePrefix = 'preference.';
            if (/(喜欢|prefer|like)/i.test(query))
                target.expectedValue = 'like';
            if (/(讨厌|dislike|不喜欢)/i.test(query))
                target.expectedValue = 'dislike';
        }
        else if (intent === 'decision_lookup' || predicateHint === 'decision') {
            target.predicatePrefix = 'decision.';
            target.expectedValue = 'selected';
        }
        else if (intent === 'constraint_lookup' || predicateHint === 'constraint') {
            target.predicatePrefix = 'constraint.';
        }
        else if (intent === 'fact_lookup' || predicateHint === 'fact') {
            target.predicatePrefix = 'fact.';
        }
        else if (predicateHint === 'workflow') {
            target.predicatePrefix = 'workflow.';
        }
        else if (predicateHint === 'graph') {
            target.predicatePrefix = 'fact.graph.';
        }
        else if (predicateHint === 'sequence') {
            target.predicatePrefix = 'workflow.sequence.';
        }
        else if (predicateHint === 'plan') {
            target.predicatePrefix = 'workflow.plan.';
        }
        target.entity = semantics?.entityHints?.[0] || this.pickEntityToken(tokens, query, intent);
        if (!target.expectedValue && semantics?.valueHints?.[0])
            target.expectedValue = semantics.valueHints[0];
        return target;
    }
    pickEntityToken(tokens, query, intent) {
        const stopwords = new Set([
            'what', 'which', '喜欢', '讨厌', '偏好', 'prefer', 'preference', 'like', 'dislike',
            '决定', '选择', 'decide', 'decision', 'choose', '约束', '限制', '必须', '不能',
            'constraint', 'rule', 'debug', 'error', 'trace', 'project'
        ]);
        const preferred = tokens.find((token) => !stopwords.has(token) && !/^(我|i)$/i.test(token));
        if (preferred)
            return preferred.toLowerCase();
        if (intent === 'preference_lookup' || intent === 'decision_lookup') {
            const match = query.match(/(?:喜欢|讨厌|偏好|prefer|like|dislike|决定|选择|choose|decide(?:\s+to\s+use)?)\s+([\w\-./]+)/i);
            if (match?.[1])
                return match[1].toLowerCase();
        }
        return undefined;
    }
    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
    close() {
        if (this.closed)
            return;
        this.db.close();
        this.closed = true;
    }
}
