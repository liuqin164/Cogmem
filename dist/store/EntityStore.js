import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { extractDeviceCandidate, extractProjectCandidate, extractRelativeReferences, inferReferenceType, isLatestReference, isPreviousReference, normalizeLexiconText } from '../lexicon/coreMemoryLexicon.js';
export class EntityStore {
    db;
    ownsDb;
    constructor(dbOrPath = ':memory:') {
        if (typeof dbOrPath === 'string') {
            this.db = new Database(dbOrPath);
            this.ownsDb = true;
        }
        else {
            this.db = dbOrPath;
            this.ownsDb = false;
        }
        this.initializeSchema();
    }
    getDatabase() {
        return this.db;
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        entity_id TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        type TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_from TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entities_name_type
        ON entities(canonical_name, type, updated_at DESC);

      CREATE TABLE IF NOT EXISTS entity_instances (
        instance_id TEXT PRIMARY KEY,
        canonical_entity_id TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        type TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_from TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entity_instances_name_type
        ON entity_instances(canonical_name, type, updated_at DESC);

      CREATE TABLE IF NOT EXISTS entity_aliases (
        alias_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        alias_text TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(entity_id, normalized_alias)
      );

      CREATE INDEX IF NOT EXISTS idx_entity_aliases_lookup
        ON entity_aliases(normalized_alias, updated_at DESC);

      CREATE TABLE IF NOT EXISTS entity_attributes (
        attribute_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        attribute_key TEXT NOT NULL,
        attribute_value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        source_neuron_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entity_attributes_lookup
        ON entity_attributes(entity_id, attribute_key, updated_at DESC);

      CREATE TABLE IF NOT EXISTS entity_relations (
        relation_id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        source_neuron_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(source_entity_id, target_entity_id, relation_type)
      );

      CREATE TABLE IF NOT EXISTS pending_entity_resolution (
        pending_id TEXT PRIMARY KEY,
        reference_text TEXT NOT NULL,
        entity_type TEXT,
        context_neuron_id TEXT,
        resolved_entity_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pending_entity_resolution_status
        ON pending_entity_resolution(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS entity_mentions (
        mention_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        neuron_id TEXT,
        project_id TEXT,
        mention_type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity
        ON entity_mentions(entity_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_entity_mentions_project
        ON entity_mentions(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS entity_alias_conflicts (
        conflict_id TEXT PRIMARY KEY,
        normalized_alias TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_ids_json TEXT NOT NULL,
        policy TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(normalized_alias, entity_type)
      );

      CREATE INDEX IF NOT EXISTS idx_entity_alias_conflicts_lookup
        ON entity_alias_conflicts(normalized_alias, entity_type, status);
    `);
    }
    upsertEntity(input) {
        const now = input.createdAt ?? Date.now();
        const rawMention = typeof input.metadata?.rawMention === 'string'
            ? String(input.metadata.rawMention)
            : undefined;
        const answerDisplayName = typeof input.metadata?.answerDisplayName === 'string'
            ? String(input.metadata.answerDisplayName)
            : undefined;
        const aliases = Array.from(new Set([
            ...(input.aliases || []),
            answerDisplayName
        ].filter((value) => Boolean(value && value.trim()))));
        const metadata = {
            ...(input.metadata || {}),
            ens1CanonicalIdentityName: input.canonicalName,
            ens1IdentityFields: ['canonicalName', 'type', 'canonicalEntityId', 'entityId'],
            ens1DisplayFields: ['answerDisplayName'],
            ...(rawMention ? { ens1RawMention: rawMention } : {}),
            ...(rawMention ? { ens1RawMentions: [rawMention] } : {}),
            ...(answerDisplayName ? { ens1AnswerDisplayName: answerDisplayName } : {})
        };
        const canonicalEntityId = this.ensureCanonicalEntity({
            canonicalName: input.canonicalName,
            type: input.type,
            aliases,
            status: input.status,
            createdFrom: input.createdFrom,
            metadata,
            createdAt: now
        });
        const existing = this.findExistingInstance(input);
        if (existing) {
            const mergedAliases = Array.from(new Set([...(existing.aliases || []), ...aliases]));
            const existingRawMentions = Array.isArray(existing.metadata?.ens1RawMentions)
                ? existing.metadata.ens1RawMentions.filter((value) => typeof value === 'string')
                : [];
            const mergedMetadata = {
                ...(existing.metadata || {}),
                ...metadata,
                ens1RawMentions: Array.from(new Set([
                    ...existingRawMentions,
                    ...(rawMention ? [rawMention] : [])
                ]))
            };
            this.db.prepare(`
        UPDATE entity_instances
        SET aliases_json = ?, status = ?, metadata_json = ?, updated_at = ?
        WHERE instance_id = ?
      `).run(JSON.stringify(mergedAliases), input.status || existing.status, JSON.stringify(mergedMetadata), now, existing.entityId);
            this.upsertAliases(existing.entityId, input.type, mergedAliases, now);
            return this.findByEntityId(existing.entityId);
        }
        const record = {
            entityId: `entity-${randomUUID()}`,
            canonicalEntityId,
            canonicalName: input.canonicalName,
            type: input.type,
            aliases,
            status: input.status || 'active',
            createdFrom: input.createdFrom,
            metadata,
            createdAt: now,
            updatedAt: now
        };
        this.db.prepare(`
      INSERT INTO entity_instances (
        instance_id, canonical_entity_id, canonical_name, type, aliases_json, status, created_from, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.entityId, canonicalEntityId, record.canonicalName, record.type, JSON.stringify(record.aliases), record.status, record.createdFrom || null, record.metadata ? JSON.stringify(record.metadata) : null, record.createdAt, record.updatedAt);
        this.upsertAliases(record.entityId, input.type, [record.canonicalName, ...(record.aliases || [])], now);
        return record;
    }
    findByAlias(aliasText, type) {
        const matches = this.listByAlias(aliasText, type);
        return matches[0] || null;
    }
    listByAlias(aliasText, type) {
        const normalizedAlias = this.normalizeAlias(aliasText);
        const rows = type
            ? this.db.prepare(`
          SELECT e.*
          FROM entity_aliases ea
          JOIN entity_instances e ON e.instance_id = ea.entity_id
          WHERE ea.normalized_alias = ? AND e.type = ?
          ORDER BY ea.updated_at DESC
          LIMIT 12
        `).all(normalizedAlias, type)
            : this.db.prepare(`
          SELECT e.*
          FROM entity_aliases ea
          JOIN entity_instances e ON e.instance_id = ea.entity_id
          WHERE ea.normalized_alias = ?
          ORDER BY ea.updated_at DESC
          LIMIT 12
        `).all(normalizedAlias);
        return rows.map((row) => this.mapRow(row));
    }
    findByCanonicalName(canonicalName, type) {
        const row = type
            ? this.db.prepare(`
          SELECT * FROM entity_instances WHERE canonical_name = ? AND type = ? ORDER BY updated_at DESC LIMIT 1
        `).get(canonicalName, type)
            : this.db.prepare(`
          SELECT * FROM entity_instances WHERE canonical_name = ? ORDER BY updated_at DESC LIMIT 1
        `).get(canonicalName);
        return row ? this.mapRow(row) : null;
    }
    findByEntityId(entityId) {
        const row = this.db.prepare(`
      SELECT * FROM entity_instances WHERE instance_id = ?
    `).get(entityId);
        return row ? this.mapRow(row) : null;
    }
    findLatestByType(type) {
        const row = this.db.prepare(`
      SELECT * FROM entity_instances WHERE type = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1
    `).get(type);
        return row ? this.mapRow(row) : null;
    }
    listRecentByType(type, limit = 8) {
        const rows = this.db.prepare(`
      SELECT * FROM entity_instances
      WHERE type = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).all(type, limit);
        return rows.map((row) => this.mapRow(row));
    }
    listByCreationOrder(type, limit = 8) {
        const rows = this.db.prepare(`
      SELECT * FROM entity_instances
      WHERE type = ?
      ORDER BY created_at DESC, updated_at DESC
      LIMIT ?
    `).all(type, limit);
        return rows.map((row) => this.mapRow(row));
    }
    listRelations(entityId, relationType) {
        const rows = relationType
            ? this.db.prepare(`
          SELECT * FROM entity_relations
          WHERE (source_entity_id = ? OR target_entity_id = ?)
            AND relation_type = ?
          ORDER BY created_at DESC
        `).all(entityId, entityId, relationType)
            : this.db.prepare(`
          SELECT * FROM entity_relations
          WHERE source_entity_id = ? OR target_entity_id = ?
          ORDER BY created_at DESC
        `).all(entityId, entityId);
        return rows.map((row) => ({
            relationId: row.relation_id,
            sourceEntityId: row.source_entity_id,
            targetEntityId: row.target_entity_id,
            relationType: row.relation_type,
            sourceNeuronId: row.source_neuron_id || undefined,
            createdAt: row.created_at
        }));
    }
    resolveReference(referenceText, typeHint, options) {
        const disambiguation = this.listDisambiguationCandidates(referenceText, typeHint, options);
        if (disambiguation.length > 0)
            return disambiguation[0].entity;
        const directMatches = [
            ...this.listByAlias(referenceText, typeHint),
            ...(typeHint
                ? (() => {
                    const exact = this.findByCanonicalName(referenceText, typeHint);
                    return exact ? [exact] : [];
                })()
                : [])
        ];
        const direct = this.pickBestEntity(directMatches, options);
        if (direct)
            return direct;
        const normalized = this.normalizeAlias(referenceText);
        if (normalized === '之前那个') {
            return null;
        }
        const relativeReference = extractRelativeReferences(normalized)[0];
        if (relativeReference) {
            return this.resolveRelativeReference(relativeReference, typeHint || inferReferenceType(relativeReference, referenceText) || 'device', options);
        }
        if (typeHint) {
            return this.resolveRelativeReference('最新', typeHint, options);
        }
        return null;
    }
    listDisambiguationCandidates(referenceText, typeHint, options) {
        const directMatches = [
            ...this.listByAlias(referenceText, typeHint),
            ...(typeHint
                ? (() => {
                    const exact = this.findByCanonicalName(referenceText, typeHint);
                    return exact ? [exact] : [];
                })()
                : [])
        ];
        const uniqueCandidates = Array.from(new Map(directMatches.map((entity) => [entity.entityId, entity])).values());
        if (uniqueCandidates.length === 0)
            return [];
        const normalizedAlias = this.normalizeAlias(referenceText);
        const conflicts = typeHint
            ? this.listAliasConflicts(typeHint).filter((conflict) => conflict.normalizedAlias === normalizedAlias)
            : this.listAliasConflicts().filter((conflict) => conflict.normalizedAlias === normalizedAlias);
        const conflictPolicy = conflicts[0]?.policy;
        const scored = uniqueCandidates.map((entity) => this.scoreDisambiguationCandidate(entity, normalizedAlias, conflictPolicy, options));
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }
    listReferenceCandidatesWithRelativeSupport(referenceText, typeHint, options) {
        const direct = this.listDisambiguationCandidates(referenceText, typeHint, options);
        if (direct.length > 0)
            return direct;
        const normalized = this.normalizeAlias(referenceText);
        const effectiveType = typeHint || inferReferenceType(normalized, referenceText) || 'device';
        const explicitNameHint = this.extractRelativeNameHint(referenceText, effectiveType);
        const recent = this.listByCreationOrder(effectiveType, 12)
            .filter((entity) => this.matchesResolutionOptions(entity.entityId, options))
            .filter((entity) => !this.isBareRelativeEntity(entity, effectiveType))
            .filter((entity) => this.matchesExplicitRelativeHint(entity, explicitNameHint))
            .slice(0, 4);
        if (recent.length === 0)
            return [];
        const relativeReference = extractRelativeReferences(normalized)[0];
        if (relativeReference && isPreviousReference(relativeReference)) {
            return [recent[1], recent[0]]
                .filter((entity) => Boolean(entity))
                .map((entity, index) => ({
                entity,
                score: index === 0 ? 0.72 : 0.42,
                reasons: ['relative_reference_previous'],
                mentionCount: this.listTimeline({ entityId: entity.entityId, limit: 8 }).length,
                latestMentionAt: this.listTimeline({ entityId: entity.entityId, limit: 1 })[0]?.createdAt
            }));
        }
        if (relativeReference && isLatestReference(relativeReference) && !isWeakAmbiguousRelativeReference(relativeReference)) {
            return recent
                .slice(0, 2)
                .map((entity, index) => ({
                entity,
                score: index === 0 ? 0.74 : 0.38,
                reasons: ['relative_reference_latest'],
                mentionCount: this.listTimeline({ entityId: entity.entityId, limit: 8 }).length,
                latestMentionAt: this.listTimeline({ entityId: entity.entityId, limit: 1 })[0]?.createdAt
            }));
        }
        return recent
            .slice(0, 2)
            .map((entity, index, items) => ({
            entity,
            score: items.length === 1
                ? 0.71
                : index === 0
                    ? 0.58
                    : 0.52,
            reasons: items.length === 1
                ? ['relative_reference_ambiguous_single_candidate']
                : ['relative_reference_ambiguous_scope_only'],
            mentionCount: this.listTimeline({ entityId: entity.entityId, limit: 8 }).length,
            latestMentionAt: this.listTimeline({ entityId: entity.entityId, limit: 1 })[0]?.createdAt
        }));
    }
    recordMention(input) {
        const record = {
            mentionId: `ement-${randomUUID()}`,
            entityId: input.entityId,
            neuronId: input.neuronId,
            projectId: input.projectId,
            mentionType: input.mentionType || 'referenced',
            createdAt: input.createdAt ?? Date.now()
        };
        this.db.prepare(`
      INSERT INTO entity_mentions (
        mention_id, entity_id, neuron_id, project_id, mention_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(record.mentionId, record.entityId, record.neuronId || null, record.projectId || null, record.mentionType, record.createdAt);
        this.touchEntity(record.entityId, record.createdAt);
        const entity = this.findByEntityId(record.entityId);
        if (entity) {
            for (const alias of [entity.canonicalName, ...(entity.aliases || [])]) {
                this.refreshAliasConflict(this.normalizeAlias(alias), entity.type, record.createdAt);
            }
        }
        return record;
    }
    listTimeline(input) {
        const limit = input.limit ?? 50;
        let sql = `
      SELECT em.*
      FROM entity_mentions em
      JOIN entity_instances e ON e.instance_id = em.entity_id
      WHERE 1 = 1
    `;
        const params = [];
        if (input.entityId) {
            sql += ` AND em.entity_id = ?`;
            params.push(input.entityId);
        }
        if (input.type) {
            sql += ` AND e.type = ?`;
            params.push(input.type);
        }
        if (input.projectId) {
            sql += ` AND em.project_id = ?`;
            params.push(input.projectId);
        }
        sql += ` ORDER BY em.created_at DESC LIMIT ?`;
        params.push(limit);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => ({
            mentionId: row.mention_id,
            entityId: row.entity_id,
            neuronId: row.neuron_id || undefined,
            projectId: row.project_id || undefined,
            mentionType: row.mention_type,
            createdAt: row.created_at
        }));
    }
    getEntityTimeline(input) {
        const limit = input.limit ?? 50;
        let sql = `
      SELECT em.*, e.canonical_name, e.type
      FROM entity_mentions em
      JOIN entity_instances e ON e.instance_id = em.entity_id
      WHERE 1 = 1
    `;
        const params = [];
        if (input.type) {
            sql += ` AND e.type = ?`;
            params.push(input.type);
        }
        if (input.projectId) {
            sql += ` AND em.project_id = ?`;
            params.push(input.projectId);
        }
        if (input.entityIds?.length) {
            sql += ` AND em.entity_id IN (${input.entityIds.map(() => '?').join(', ')})`;
            params.push(...input.entityIds);
        }
        sql += ` ORDER BY em.created_at DESC LIMIT ?`;
        params.push(limit);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => ({
            entityId: row.entity_id,
            canonicalName: row.canonical_name,
            type: row.type,
            mentionId: row.mention_id,
            neuronId: row.neuron_id || undefined,
            projectId: row.project_id || undefined,
            mentionType: row.mention_type,
            createdAt: row.created_at
        }));
    }
    listEntitiesUpdatedInRange(startTime, endTime, type) {
        const rows = type
            ? this.db.prepare(`
          SELECT *
          FROM entity_instances
          WHERE updated_at >= ? AND updated_at < ? AND type = ?
          ORDER BY updated_at DESC, created_at DESC
        `).all(startTime, endTime, type)
            : this.db.prepare(`
          SELECT *
          FROM entity_instances
          WHERE updated_at >= ? AND updated_at < ?
          ORDER BY updated_at DESC, created_at DESC
        `).all(startTime, endTime);
        return rows.map((row) => this.mapRow(row));
    }
    archiveEntity(entityId, updatedAt = Date.now()) {
        this.db.prepare(`
      UPDATE entity_instances
      SET status = 'archived', updated_at = ?
      WHERE instance_id = ?
    `).run(updatedAt, entityId);
    }
    addAttribute(input) {
        const now = input.createdAt ?? Date.now();
        const record = {
            attributeId: `eattr-${randomUUID()}`,
            entityId: input.entityId,
            attributeKey: input.attributeKey,
            attributeValue: input.attributeValue,
            normalizedValue: this.normalizeAlias(input.attributeValue),
            sourceNeuronId: input.sourceNeuronId,
            createdAt: now,
            updatedAt: now
        };
        this.db.prepare(`
      INSERT INTO entity_attributes (
        attribute_id, entity_id, attribute_key, attribute_value, normalized_value, source_neuron_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.attributeId, record.entityId, record.attributeKey, record.attributeValue, record.normalizedValue, record.sourceNeuronId || null, record.createdAt, record.updatedAt);
        this.touchEntity(record.entityId, now);
        return record;
    }
    listAttributes(entityId, attributeKey) {
        const rows = attributeKey
            ? this.db.prepare(`
          SELECT * FROM entity_attributes
          WHERE entity_id = ? AND attribute_key = ?
          ORDER BY updated_at DESC
        `).all(entityId, attributeKey)
            : this.db.prepare(`
          SELECT * FROM entity_attributes
          WHERE entity_id = ?
          ORDER BY updated_at DESC
        `).all(entityId);
        return rows.map((row) => ({
            attributeId: row.attribute_id,
            entityId: row.entity_id,
            attributeKey: row.attribute_key,
            attributeValue: row.attribute_value,
            normalizedValue: row.normalized_value,
            sourceNeuronId: row.source_neuron_id || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    addRelation(input) {
        const createdAt = input.createdAt ?? Date.now();
        const existing = this.db.prepare(`
      SELECT relation_id, created_at
      FROM entity_relations
      WHERE source_entity_id = ? AND target_entity_id = ? AND relation_type = ?
    `).get(input.sourceEntityId, input.targetEntityId, input.relationType);
        const relationId = existing?.relation_id || `erel-${randomUUID()}`;
        this.db.prepare(`
      INSERT OR REPLACE INTO entity_relations (
        relation_id, source_entity_id, target_entity_id, relation_type, source_neuron_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(relationId, input.sourceEntityId, input.targetEntityId, input.relationType, input.sourceNeuronId || null, existing?.created_at || createdAt);
        return {
            relationId,
            sourceEntityId: input.sourceEntityId,
            targetEntityId: input.targetEntityId,
            relationType: input.relationType,
            sourceNeuronId: input.sourceNeuronId,
            createdAt: existing?.created_at || createdAt
        };
    }
    registerPendingResolution(input) {
        const now = input.createdAt ?? Date.now();
        const record = {
            pendingId: `eper-${randomUUID()}`,
            referenceText: input.referenceText,
            entityType: input.entityType,
            contextNeuronId: input.contextNeuronId,
            status: 'pending',
            createdAt: now,
            updatedAt: now
        };
        this.db.prepare(`
      INSERT INTO pending_entity_resolution (
        pending_id, reference_text, entity_type, context_neuron_id, resolved_entity_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.pendingId, record.referenceText, record.entityType || null, record.contextNeuronId || null, null, record.status, record.createdAt, record.updatedAt);
        return record;
    }
    resolvePendingReference(pendingId, entityId, resolvedAt = Date.now()) {
        const row = this.db.prepare(`
      SELECT * FROM pending_entity_resolution WHERE pending_id = ?
    `).get(pendingId);
        if (!row)
            return null;
        this.db.prepare(`
      UPDATE pending_entity_resolution
      SET resolved_entity_id = ?, status = 'resolved', updated_at = ?
      WHERE pending_id = ?
    `).run(entityId, resolvedAt, pendingId);
        return {
            pendingId,
            referenceText: row.reference_text,
            entityType: row.entity_type || undefined,
            contextNeuronId: row.context_neuron_id || undefined,
            resolvedEntityId: entityId,
            status: 'resolved',
            createdAt: row.created_at,
            updatedAt: resolvedAt
        };
    }
    listPendingResolutions(filter) {
        const rows = this.db.prepare(`
      SELECT *
      FROM pending_entity_resolution
      WHERE (? IS NULL OR status = ?)
        AND (? IS NULL OR entity_type = ?)
      ORDER BY updated_at DESC, created_at DESC
    `).all(filter?.status || null, filter?.status || null, filter?.entityType || null, filter?.entityType || null);
        return rows.map((row) => ({
            pendingId: row.pending_id,
            referenceText: row.reference_text,
            entityType: row.entity_type || undefined,
            contextNeuronId: row.context_neuron_id || undefined,
            resolvedEntityId: row.resolved_entity_id || undefined,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    listAliasConflicts(type) {
        const rows = type
            ? this.db.prepare(`
          SELECT * FROM entity_alias_conflicts
          WHERE entity_type = ? AND status = 'active'
          ORDER BY updated_at DESC
        `).all(type)
            : this.db.prepare(`
          SELECT * FROM entity_alias_conflicts
          WHERE status = 'active'
          ORDER BY updated_at DESC
        `).all();
        return rows.map((row) => ({
            conflictId: row.conflict_id,
            normalizedAlias: row.normalized_alias,
            entityType: row.entity_type,
            entityIds: row.entity_ids_json ? JSON.parse(row.entity_ids_json) : [],
            policy: row.policy,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
    addAlias(entityId, alias, updatedAt = Date.now()) {
        const entity = this.findByEntityId(entityId);
        if (!entity || !alias.trim())
            return;
        const aliases = Array.from(new Set([...entity.aliases, alias.trim()]));
        this.db.prepare(`UPDATE entity_instances SET aliases_json = ?, updated_at = ? WHERE instance_id = ?`)
            .run(JSON.stringify(aliases), updatedAt, entityId);
        this.upsertAliases(entityId, entity.type, [alias], updatedAt);
    }
    removeAlias(entityId, alias, updatedAt = Date.now()) {
        const entity = this.findByEntityId(entityId);
        if (!entity || entity.canonicalName === alias)
            return;
        const normalized = this.normalizeAlias(alias);
        const aliases = entity.aliases.filter((item) => this.normalizeAlias(item) !== normalized);
        this.db.prepare(`UPDATE entity_instances SET aliases_json = ?, updated_at = ? WHERE instance_id = ?`)
            .run(JSON.stringify(aliases), updatedAt, entityId);
        this.db.prepare(`DELETE FROM entity_aliases WHERE entity_id = ? AND normalized_alias = ?`).run(entityId, normalized);
        this.refreshAliasConflict(normalized, entity.type, updatedAt);
    }
    redirectInstance(input) {
        this.db.prepare(`
      UPDATE entity_instances
      SET canonical_entity_id = ?, status = ?, updated_at = ?
      WHERE instance_id = ?
    `).run(input.targetCanonicalEntityId, input.status || 'archived', input.updatedAt ?? Date.now(), input.sourceEntityId);
    }
    restoreInstance(input) {
        this.db.prepare(`
      UPDATE entity_instances
      SET canonical_entity_id = ?, status = ?, updated_at = ?
      WHERE instance_id = ?
    `).run(input.canonicalEntityId, input.status, input.updatedAt ?? Date.now(), input.entityId);
    }
    upsertAliases(entityId, entityType, aliases, timestamp) {
        const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO entity_aliases (
        alias_id, entity_id, alias_text, normalized_alias, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
        for (const alias of Array.from(new Set(aliases.map((item) => item.trim()).filter(Boolean)))) {
            stmt.run(`ealias-${randomUUID()}`, entityId, alias, this.normalizeAlias(alias), timestamp, timestamp);
            this.refreshAliasConflict(this.normalizeAlias(alias), entityType, timestamp);
        }
    }
    touchEntity(entityId, updatedAt) {
        this.db.prepare(`
      UPDATE entity_instances SET updated_at = ? WHERE instance_id = ?
    `).run(updatedAt, entityId);
    }
    ensureCanonicalEntity(input) {
        const existing = this.db.prepare(`
      SELECT entity_id, aliases_json, metadata_json
      FROM entities
      WHERE canonical_name = ? AND type = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(input.canonicalName, input.type);
        if (existing) {
            const existingAliases = existing.aliases_json ? JSON.parse(existing.aliases_json) : [];
            const existingMetadata = existing.metadata_json ? JSON.parse(existing.metadata_json) : {};
            this.db.prepare(`
        UPDATE entities
        SET aliases_json = ?, metadata_json = ?, updated_at = ?
        WHERE entity_id = ?
      `).run(JSON.stringify(Array.from(new Set([...existingAliases, ...(input.aliases || [])]))), JSON.stringify({ ...existingMetadata, ...(input.metadata || {}) }), input.createdAt, existing.entity_id);
            return existing.entity_id;
        }
        const canonicalEntityId = `ecanon-${randomUUID()}`;
        this.db.prepare(`
      INSERT INTO entities (
        entity_id, canonical_name, type, aliases_json, status, created_from, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(canonicalEntityId, input.canonicalName, input.type, JSON.stringify(Array.from(new Set(input.aliases || []))), input.status || 'active', input.createdFrom || null, input.metadata ? JSON.stringify(input.metadata) : null, input.createdAt, input.createdAt);
        return canonicalEntityId;
    }
    findExistingInstance(input) {
        if (input.instanceMode === 'new_instance')
            return null;
        const projectId = typeof input.metadata?.projectId === 'string' ? String(input.metadata.projectId) : undefined;
        const rows = this.db.prepare(`
      SELECT *
      FROM entity_instances
      WHERE canonical_name = ? AND type = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 12
    `).all(input.canonicalName, input.type);
        const candidates = rows.map((row) => this.mapRow(row));
        if (input.instanceMode === 'canonical')
            return candidates[0] || null;
        if (input.createdFrom) {
            const exact = candidates.find((candidate) => candidate.createdFrom === input.createdFrom);
            if (exact)
                return exact;
        }
        if (projectId) {
            const inProject = candidates.find((candidate) => candidate.metadata?.projectId === projectId);
            if (inProject)
                return inProject;
            return null;
        }
        return candidates[0] || null;
    }
    refreshAliasConflict(normalizedAlias, entityType, timestamp) {
        const rows = this.db.prepare(`
      SELECT DISTINCT ei.instance_id
      FROM entity_aliases ea
      JOIN entity_instances ei ON ei.instance_id = ea.entity_id
      WHERE ea.normalized_alias = ?
        AND ei.type = ?
        AND ei.status = 'active'
      ORDER BY ei.updated_at DESC
    `).all(normalizedAlias, entityType);
        const entityIds = rows.map((row) => row.instance_id);
        if (entityIds.length <= 1) {
            this.db.prepare(`
        UPDATE entity_alias_conflicts
        SET status = 'resolved', updated_at = ?
        WHERE normalized_alias = ? AND entity_type = ?
      `).run(timestamp, normalizedAlias, entityType);
            return;
        }
        const policy = this.inferAliasConflictPolicy(entityIds);
        const existing = this.db.prepare(`
      SELECT conflict_id, created_at
      FROM entity_alias_conflicts
      WHERE normalized_alias = ? AND entity_type = ?
    `).get(normalizedAlias, entityType);
        this.db.prepare(`
      INSERT OR REPLACE INTO entity_alias_conflicts (
        conflict_id, normalized_alias, entity_type, entity_ids_json, policy, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(existing?.conflict_id || `econf-${randomUUID()}`, normalizedAlias, entityType, JSON.stringify(entityIds), policy, existing?.created_at || timestamp, timestamp);
    }
    inferAliasConflictPolicy(entityIds) {
        const projectIds = new Set();
        for (const entityId of entityIds) {
            const mentions = this.listTimeline({ entityId, limit: 8 });
            for (const mention of mentions) {
                if (mention.projectId)
                    projectIds.add(mention.projectId);
            }
        }
        if (projectIds.size > 1)
            return 'prefer_project_context';
        if (entityIds.length > 2)
            return 'require_explicit_disambiguation';
        return 'prefer_recent_mention';
    }
    resolveRelativeReference(referenceText, type, options) {
        const explicitNameHint = this.extractRelativeNameHint(referenceText, type);
        const recent = this.listByCreationOrder(type, 12)
            .filter((entity) => this.matchesResolutionOptions(entity.entityId, options))
            .filter((entity) => this.matchesExplicitRelativeHint(entity, explicitNameHint))
            .slice(0, 4);
        if (recent.length === 0)
            return null;
        const normalizedReference = this.normalizeAlias(referenceText);
        const relativeReference = extractRelativeReferences(normalizedReference)[0] || normalizedReference;
        if (isLatestReference(relativeReference))
            return recent[0] || null;
        if (isPreviousReference(relativeReference))
            return recent[1] || recent[0] || null;
        return recent[0] || null;
    }
    pickBestEntity(candidates, options) {
        if (candidates.length === 0)
            return null;
        const scored = candidates.map((entity) => this.scoreDisambiguationCandidate(entity, undefined, undefined, options));
        scored.sort((a, b) => b.score - a.score);
        return scored[0]?.entity || null;
    }
    matchesResolutionOptions(entityId, options) {
        if (!options?.projectId && !options?.beforeTime)
            return true;
        const mentions = this.listTimeline({ entityId, limit: 12 });
        if (options.projectId && !mentions.some((mention) => mention.projectId === options.projectId))
            return false;
        if (options.beforeTime && !mentions.some((mention) => mention.createdAt <= options.beforeTime))
            return false;
        return true;
    }
    normalizeAlias(value) {
        return normalizeLexiconText(value).toLowerCase();
    }
    scoreDisambiguationCandidate(entity, normalizedAlias, conflictPolicy, options) {
        const mentions = this.listTimeline({ entityId: entity.entityId, limit: 12 });
        const attributes = this.listAttributes(entity.entityId);
        const reasons = [];
        let score = 0.2;
        if (!normalizedAlias || this.normalizeAlias(entity.canonicalName) === normalizedAlias) {
            score += 1.2;
            reasons.push('canonical_name_match');
        }
        if (normalizedAlias && entity.aliases.some((alias) => this.normalizeAlias(alias) === normalizedAlias)) {
            score += 1.1;
            reasons.push('alias_match');
        }
        if (mentions.length > 0) {
            score += Math.min(1.2, 0.2 + mentions.length * 0.12);
            reasons.push('mention_history');
        }
        const latestMention = mentions[0];
        if (latestMention) {
            score += latestMention.createdAt / 1e13;
            reasons.push('recent_mention');
        }
        if (options?.projectId && mentions.some((mention) => mention.projectId === options.projectId)) {
            score += 2.1;
            reasons.push('project_context_match');
        }
        if (options?.beforeTime && mentions.some((mention) => mention.createdAt <= options.beforeTime)) {
            score += 0.9;
            reasons.push('historical_match');
        }
        if (attributes.some((attribute) => /bluetooth|issue|device|topic/i.test(attribute.attributeKey) || /bluetooth|disconnect|断连/i.test(attribute.attributeValue))) {
            score += 0.35;
            reasons.push('attribute_support');
        }
        if (conflictPolicy === 'prefer_project_context' && options?.projectId && !mentions.some((mention) => mention.projectId === options.projectId)) {
            score -= 0.6;
            reasons.push('project_conflict_penalty');
        }
        if (conflictPolicy === 'require_explicit_disambiguation' && !options?.projectId && mentions.length > 1) {
            score -= 0.25;
            reasons.push('ambiguous_without_context');
        }
        return {
            entity,
            score,
            reasons,
            mentionCount: mentions.length,
            latestMentionAt: latestMention?.createdAt
        };
    }
    extractRelativeNameHint(referenceText, type) {
        if (type === 'device')
            return extractDeviceCandidate(referenceText);
        if (type === 'project')
            return extractProjectCandidate(referenceText);
        return undefined;
    }
    matchesExplicitRelativeHint(entity, explicitNameHint) {
        if (!explicitNameHint)
            return true;
        const normalizedHint = this.normalizeAlias(explicitNameHint);
        return this.normalizeAlias(entity.canonicalName).includes(normalizedHint)
            || entity.aliases.some((alias) => this.normalizeAlias(alias).includes(normalizedHint));
    }
    isBareRelativeEntity(entity, type) {
        const normalizedName = this.normalizeAlias(entity.canonicalName);
        const relativeRefs = extractRelativeReferences(normalizedName).map((reference) => this.normalizeAlias(reference));
        if (!relativeRefs.includes(normalizedName))
            return false;
        if (type === 'device')
            return !extractDeviceCandidate(entity.canonicalName);
        if (type === 'project')
            return !extractProjectCandidate(entity.canonicalName);
        return false;
    }
    mapRow(row) {
        return {
            entityId: row.entity_id || row.instance_id,
            canonicalEntityId: row.canonical_entity_id || undefined,
            canonicalName: row.canonical_name,
            type: row.type,
            aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
            status: row.status,
            createdFrom: row.created_from || undefined,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}
function isWeakAmbiguousRelativeReference(reference) {
    return /^(that project|this project|that one|this one|那个项目|这个项目|那个耳机|这个耳机|那个设备|这个设备)$/i.test(normalizeLexiconText(reference).toLowerCase());
}
