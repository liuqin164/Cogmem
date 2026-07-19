import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
import {
  extractDeviceCandidate,
  extractProjectCandidate,
  extractRelativeReferences,
  inferReferenceType,
  isLatestReference,
  isPreviousReference,
  normalizeLexiconText
} from '../lexicon/coreMemoryLexicon.js';

export interface EntityRecord {
  entityId: string;
  canonicalEntityId?: string;
  canonicalName: string;
  type: string;
  aliases: string[];
  status: 'active' | 'pending_resolution' | 'archived';
  createdFrom?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface EntityAliasRecord {
  aliasId: string;
  entityId: string;
  aliasText: string;
  normalizedAlias: string;
  createdAt: number;
  updatedAt: number;
}

export interface EntityAttributeRecord {
  attributeId: string;
  entityId: string;
  attributeKey: string;
  attributeValue: string;
  normalizedValue: string;
  sourceNeuronId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EntityRelationRecord {
  relationId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: 'same_as' | 'related_to' | 'replaced_by' | 'mentioned_with';
  sourceNeuronId?: string;
  createdAt: number;
}

export interface PendingEntityResolutionRecord {
  pendingId: string;
  referenceText: string;
  entityType?: string;
  contextNeuronId?: string;
  resolvedEntityId?: string;
  status: 'pending' | 'resolved';
  createdAt: number;
  updatedAt: number;
}

export interface ResolveEntityReferenceOptions {
  projectId?: string;
  beforeTime?: number;
}

export interface EntityDisambiguationCandidate {
  entity: EntityRecord;
  score: number;
  reasons: string[];
  mentionCount: number;
  latestMentionAt?: number;
}

export interface EntityMentionRecord {
  mentionId: string;
  entityId: string;
  neuronId?: string;
  projectId?: string;
  mentionType: 'declared' | 'referenced' | 'attributed' | 'related';
  createdAt: number;
}

export interface EntityTimelineItem {
  entityId: string;
  canonicalName: string;
  type: string;
  mentionId: string;
  neuronId?: string;
  projectId?: string;
  mentionType: EntityMentionRecord['mentionType'];
  createdAt: number;
}

export interface EntityAliasConflictRecord {
  conflictId: string;
  normalizedAlias: string;
  entityType: string;
  entityIds: string[];
  policy: 'prefer_project_context' | 'prefer_recent_mention' | 'require_explicit_disambiguation';
  status: 'active' | 'resolved';
  createdAt: number;
  updatedAt: number;
}

export class EntityStore {
  private db: Database;
  private readonly ownsDb: boolean;

  constructor(dbOrPath: Database | string = ':memory:') {
    if (typeof dbOrPath === 'string') {
      this.db = new Database(dbOrPath);
      this.ownsDb = true;
    } else {
      this.db = dbOrPath;
      this.ownsDb = false;
    }
    this.initializeSchema();
  }

  getDatabase(): Database {
    return this.db;
  }

  private initializeSchema(): void {
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
        project_id TEXT NOT NULL DEFAULT '',
        alias_text TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, entity_id, normalized_alias)
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
        project_id TEXT NOT NULL DEFAULT '',
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        source_neuron_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, source_entity_id, target_entity_id, relation_type)
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
        project_id TEXT NOT NULL DEFAULT '',
        normalized_alias TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_ids_json TEXT NOT NULL,
        policy TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, normalized_alias, entity_type)
      );

      CREATE INDEX IF NOT EXISTS idx_entity_alias_conflicts_lookup
        ON entity_alias_conflicts(normalized_alias, entity_type, status);
    `);
  }

  upsertEntity(input: {
    canonicalName: string;
    type: string;
    aliases?: string[];
    status?: 'active' | 'pending_resolution' | 'archived';
    createdFrom?: string;
    metadata?: Record<string, unknown>;
    createdAt?: number;
    instanceMode?: 'auto' | 'canonical' | 'new_instance';
  }): EntityRecord {
    const now = input.createdAt ?? Date.now();
    const projectId = typeof input.metadata?.projectId === 'string' ? String(input.metadata.projectId) : '';
    const rawMention = typeof input.metadata?.rawMention === 'string'
      ? String(input.metadata.rawMention)
      : undefined;
    const answerDisplayName = typeof input.metadata?.answerDisplayName === 'string'
      ? String(input.metadata.answerDisplayName)
      : undefined;
    const aliases = Array.from(new Set([
      ...(input.aliases || []),
      answerDisplayName
    ].filter((value): value is string => Boolean(value && value.trim()))));
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
        ? existing.metadata.ens1RawMentions.filter((value): value is string => typeof value === 'string')
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
      `).run(
        JSON.stringify(mergedAliases),
        input.status || existing.status,
        JSON.stringify(mergedMetadata),
        now,
        existing.entityId
      );
      this.upsertAliases(existing.entityId, input.type, mergedAliases, projectId, now);
      return this.getByEntityId(existing.entityId)!;
    }

    const record: EntityRecord = {
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
    `).run(
      record.entityId,
      canonicalEntityId,
      record.canonicalName,
      record.type,
      JSON.stringify(record.aliases),
      record.status,
      record.createdFrom || null,
      record.metadata ? JSON.stringify(record.metadata) : null,
      record.createdAt,
      record.updatedAt
    );

    this.upsertAliases(record.entityId, input.type, [record.canonicalName, ...(record.aliases || [])], projectId, now);

    return record;
  }

  findByAlias(aliasText: string, type?: string, projectId?: string): EntityRecord | null {
    const matches = this.listByAlias(aliasText, type, projectId);
    return matches[0] || null;
  }

  listByAlias(aliasText: string, type?: string, projectId?: string): EntityRecord[] {
    const normalizedAlias = this.normalizeAlias(aliasText);
    const scopeClause = projectId === undefined ? '' : ` AND ea.project_id = ? AND (json_extract(e.metadata_json,'$.projectId') = ? OR EXISTS (SELECT 1 FROM entity_mentions em WHERE em.entity_id=e.instance_id AND COALESCE(em.project_id,'')=?))`;
    const rows = type
      ? this.db.prepare(`
          SELECT e.*
          FROM entity_aliases ea
          JOIN entity_instances e ON e.instance_id = ea.entity_id
          WHERE ea.normalized_alias = ? AND e.type = ? AND e.status = 'active'${scopeClause}
          ORDER BY ea.updated_at DESC
          LIMIT 12
        `).all(normalizedAlias, type, ...(projectId === undefined ? [] : [projectId, projectId, projectId]))
      : this.db.prepare(`
          SELECT e.*
          FROM entity_aliases ea
          JOIN entity_instances e ON e.instance_id = ea.entity_id
          WHERE ea.normalized_alias = ? AND e.status = 'active'${scopeClause}
          ORDER BY ea.updated_at DESC
          LIMIT 12
        `).all(normalizedAlias, ...(projectId === undefined ? [] : [projectId, projectId, projectId]));
    return (rows as any[]).map((row) => this.mapRowForProject(row, projectId));
  }

  findByCanonicalName(canonicalName: string, type?: string, projectId?: string): EntityRecord | null {
    const scopeClause = projectId === undefined ? '' : ` AND (json_extract(metadata_json,'$.projectId') = ? OR EXISTS (SELECT 1 FROM entity_mentions em WHERE em.entity_id=entity_instances.instance_id AND COALESCE(em.project_id,'')=?))`;
    const row = type
      ? this.db.prepare(`
          SELECT * FROM entity_instances WHERE canonical_name = ? AND type = ? AND status = 'active'${scopeClause} ORDER BY updated_at DESC LIMIT 1
        `).get(canonicalName, type, ...(projectId === undefined ? [] : [projectId, projectId]))
      : this.db.prepare(`
          SELECT * FROM entity_instances WHERE canonical_name = ? AND status = 'active'${scopeClause} ORDER BY updated_at DESC LIMIT 1
        `).get(canonicalName, ...(projectId === undefined ? [] : [projectId, projectId]));
    return row ? this.mapRowForProject(row as any, projectId) : null;
  }

  findByEntityId(entityId: string): EntityRecord | null {
    const row = this.db.prepare(`SELECT * FROM entity_instances WHERE instance_id = ?`).get(entityId) as any;
    return row ? this.mapRow(row) : null;
  }

  findActiveByEntityId(entityId: string): EntityRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM entity_instances WHERE instance_id = ? AND status = 'active'
    `).get(entityId) as any;
    return row ? this.mapRow(row) : null;
  }

  getByEntityId(entityId: string): EntityRecord | null {
    const row = this.db.prepare(`SELECT * FROM entity_instances WHERE instance_id = ?`).get(entityId) as any;
    return row ? this.mapRow(row) : null;
  }

  findLatestByType(type: string): EntityRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM entity_instances WHERE type = ? AND status = 'active' ORDER BY updated_at DESC, created_at DESC LIMIT 1
    `).get(type) as any;
    return row ? this.mapRow(row) : null;
  }

  listRecentByType(type: string, limit: number = 8): EntityRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM entity_instances
      WHERE type = ? AND status = 'active'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).all(type, limit) as any[];
    return rows.map((row) => this.mapRow(row));
  }

  private listByCreationOrder(type: string, limit: number = 8, projectId?: string): EntityRecord[] {
    const scope = projectId === undefined ? '' : ` AND (json_extract(metadata_json,'$.projectId') = ? OR EXISTS (
      SELECT 1 FROM entity_mentions em WHERE em.entity_id=entity_instances.instance_id AND COALESCE(em.project_id,'')=?
    ))`;
    const params: Array<string | number> = [type];
    if (projectId !== undefined) params.push(projectId, projectId);
    params.push(limit);
    const rows = this.db.prepare(`
      SELECT * FROM entity_instances
      WHERE type = ? AND status = 'active'${scope}
      ORDER BY created_at DESC, updated_at DESC
      LIMIT ?
    `).all(...params) as any[];
    return rows.map((row) => this.mapRowForProject(row, projectId));
  }

  listRelations(entityId: string, relationType?: EntityRelationRecord['relationType'], projectId?: string): EntityRelationRecord[] {
    const scope = projectId === undefined ? '' : ` AND project_id = ?`;
    const params = projectId === undefined ? [] : [projectId];
    const rows = relationType
      ? this.db.prepare(`
          SELECT * FROM entity_relations
          WHERE (source_entity_id = ? OR target_entity_id = ?)
            AND relation_type = ?${scope}
          ORDER BY created_at DESC
        `).all(entityId, entityId, relationType, ...params)
      : this.db.prepare(`
          SELECT * FROM entity_relations
          WHERE (source_entity_id = ? OR target_entity_id = ?)${scope}
          ORDER BY created_at DESC
        `).all(entityId, entityId, ...params);

    return (rows as any[]).map((row) => ({
      relationId: row.relation_id,
      sourceEntityId: row.source_entity_id,
      targetEntityId: row.target_entity_id,
      relationType: row.relation_type,
      sourceNeuronId: row.source_neuron_id || undefined,
      createdAt: row.created_at
    }));
  }

  resolveReference(referenceText: string, typeHint?: string, options?: ResolveEntityReferenceOptions): EntityRecord | null {
    const disambiguation = this.listDisambiguationCandidates(referenceText, typeHint, options);
    if (disambiguation.length > 0) return disambiguation[0]!.entity;

    const directMatches = [
      ...this.listByAlias(referenceText, typeHint, options?.projectId),
      ...(typeHint
        ? (() => {
            const exact = this.findByCanonicalName(referenceText, typeHint, options?.projectId);
            return exact ? [exact] : [];
          })()
        : [])
    ];
    const direct = this.pickBestEntity(directMatches, options);
    if (direct) return direct;

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

  listDisambiguationCandidates(
    referenceText: string,
    typeHint?: string,
    options?: ResolveEntityReferenceOptions
  ): EntityDisambiguationCandidate[] {
    const directMatches = [
      ...this.listByAlias(referenceText, typeHint, options?.projectId),
      ...(typeHint
        ? (() => {
            const exact = this.findByCanonicalName(referenceText, typeHint, options?.projectId);
            return exact ? [exact] : [];
          })()
        : [])
    ];
    const uniqueCandidates = Array.from(new Map(directMatches.map((entity) => [entity.entityId, entity])).values());
    if (uniqueCandidates.length === 0) return [];

    const normalizedAlias = this.normalizeAlias(referenceText);
    const conflicts = typeHint
      ? this.listAliasConflicts(typeHint, options?.projectId).filter((conflict) => conflict.normalizedAlias === normalizedAlias)
      : this.listAliasConflicts(undefined, options?.projectId).filter((conflict) => conflict.normalizedAlias === normalizedAlias);
    const conflictPolicy = conflicts[0]?.policy;

    const scored = uniqueCandidates.map((entity) => this.scoreDisambiguationCandidate(entity, normalizedAlias, conflictPolicy, options));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  listReferenceCandidatesWithRelativeSupport(
    referenceText: string,
    typeHint?: string,
    options?: ResolveEntityReferenceOptions
  ): EntityDisambiguationCandidate[] {
    const direct = this.listDisambiguationCandidates(referenceText, typeHint, options);
    if (direct.length > 0) return direct;

    const normalized = this.normalizeAlias(referenceText);
    const effectiveType = typeHint || inferReferenceType(normalized, referenceText) || 'device';
    const explicitNameHint = this.extractRelativeNameHint(referenceText, effectiveType);
    const recent = this.listByCreationOrder(effectiveType, 12, options?.projectId)
      .filter((entity) => this.matchesResolutionOptions(entity.entityId, options))
      .filter((entity) => !this.isBareRelativeEntity(entity, effectiveType))
      .filter((entity) => this.matchesExplicitRelativeHint(entity, explicitNameHint))
      .slice(0, 4);
    if (recent.length === 0) return [];

    const relativeReference = extractRelativeReferences(normalized)[0];
    if (relativeReference && isPreviousReference(relativeReference)) {
      return [recent[1], recent[0]]
        .filter((entity): entity is EntityRecord => Boolean(entity))
        .map((entity, index) => ({
          entity,
          score: index === 0 ? 0.72 : 0.42,
          reasons: ['relative_reference_previous'],
          mentionCount: this.listTimeline({ entityId: entity.entityId, projectId: options?.projectId, limit: 8 }).length,
          latestMentionAt: this.listTimeline({ entityId: entity.entityId, projectId: options?.projectId, limit: 1 })[0]?.createdAt
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

  recordMention(input: {
    entityId: string;
    neuronId?: string;
    projectId?: string;
    mentionType?: EntityMentionRecord['mentionType'];
    createdAt?: number;
  }): EntityMentionRecord {
    const record: EntityMentionRecord = {
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
    `).run(
      record.mentionId,
      record.entityId,
      record.neuronId || null,
      record.projectId ?? null,
      record.mentionType,
      record.createdAt
    );

    this.touchEntity(record.entityId, record.createdAt);
    const entity = this.getByEntityId(record.entityId);
    if (entity) {
      for (const alias of [entity.canonicalName, ...(entity.aliases || [])]) {
        this.refreshAliasConflict(this.normalizeAlias(alias), entity.type, record.projectId ?? '', record.createdAt);
      }
    }
    return record;
  }

  listTimeline(input: {
    entityId?: string;
    type?: string;
    projectId?: string;
    limit?: number;
    includeInactive?: boolean;
  }): EntityMentionRecord[] {
    const limit = input.limit ?? 50;
    let sql = `
      SELECT em.*
      FROM entity_mentions em
      JOIN entity_instances e ON e.instance_id = em.entity_id
      WHERE 1 = 1
    `;
    const params: Array<string | number | null> = [];

    if (input.entityId) {
      sql += ` AND em.entity_id = ?`;
      params.push(input.entityId);
    }
    if (input.type) {
      sql += ` AND e.type = ?`;
      params.push(input.type);
    }
    if (input.projectId !== undefined) {
      sql += ` AND COALESCE(em.project_id,'') = ?`;
      params.push(input.projectId);
    }
    if (!input.includeInactive) sql += ` AND e.status = 'active'`;

    sql += ` ORDER BY em.created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => ({
      mentionId: row.mention_id,
      entityId: row.entity_id,
      neuronId: row.neuron_id || undefined,
      projectId: row.project_id || undefined,
      mentionType: row.mention_type,
      createdAt: row.created_at
    }));
  }

  getEntityTimeline(input: {
    type?: string;
    projectId?: string;
    entityIds?: string[];
    limit?: number;
    includeInactive?: boolean;
  }): EntityTimelineItem[] {
    const limit = input.limit ?? 50;
    let sql = `
      SELECT em.*, e.canonical_name, e.type
      FROM entity_mentions em
      JOIN entity_instances e ON e.instance_id = em.entity_id
      WHERE 1 = 1
    `;
    const params: Array<string | number> = [];

    if (input.type) {
      sql += ` AND e.type = ?`;
      params.push(input.type);
    }
    if (input.projectId !== undefined) {
      sql += ` AND COALESCE(em.project_id,'') = ?`;
      params.push(input.projectId);
    }
    if (!input.includeInactive) sql += ` AND e.status = 'active'`;
    if (input.entityIds?.length) {
      sql += ` AND em.entity_id IN (${input.entityIds.map(() => '?').join(', ')})`;
      params.push(...input.entityIds);
    }

    sql += ` ORDER BY em.created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
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

  listEntitiesUpdatedInRange(startTime: number, endTime: number, type?: string, projectId?: string): EntityRecord[] {
    const clauses = ['updated_at >= ?', 'updated_at < ?'];
    const params: Array<string | number> = [startTime, endTime];
    if (type) { clauses.push('type = ?'); params.push(type); }
    if (projectId !== undefined) {
      clauses.push(`(json_extract(metadata_json,'$.projectId') = ? OR EXISTS (SELECT 1 FROM entity_mentions em WHERE em.entity_id=entity_instances.instance_id AND COALESCE(em.project_id,'')=?))`);
      params.push(projectId, projectId);
    }
    const rows = this.db.prepare(`SELECT * FROM entity_instances WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC,created_at DESC`).all(...params);

    return (rows as any[]).map((row) => this.mapRowForProject(row, projectId));
  }

  listProjectScopes(entityId: string): string[] {
    const scopes = new Set<string>();
    const row = this.db.prepare(`SELECT metadata_json FROM entity_instances WHERE instance_id=?`).get(entityId) as { metadata_json?: string | null } | null;
    if (row?.metadata_json) {
      const projectId = (JSON.parse(row.metadata_json) as Record<string, unknown>).projectId;
      if (typeof projectId === 'string') scopes.add(projectId);
    }
    const mentions = this.db.prepare(`SELECT DISTINCT COALESCE(project_id,'') AS project_id FROM entity_mentions WHERE entity_id=?`).all(entityId) as Array<{ project_id: string }>;
    for (const mention of mentions) scopes.add(mention.project_id);
    return [...scopes].sort();
  }

  isExclusiveToProject(entityId: string, projectId: string): boolean {
    const scopes = this.listProjectScopes(entityId);
    return scopes.length === 1 && scopes[0] === projectId;
  }

  archiveEntity(entityId: string, updatedAt: number = Date.now(), projectId?: string): void {
    if (projectId !== undefined && !this.isExclusiveToProject(entityId, projectId)) throw new Error('entity_project_scope_not_exclusive');
    this.db.prepare(`
      UPDATE entity_instances
      SET status = 'archived', updated_at = ?
      WHERE instance_id = ?
    `).run(updatedAt, entityId);
  }

  addAttribute(input: {
    entityId: string;
    attributeKey: string;
    attributeValue: string;
    sourceNeuronId?: string;
    createdAt?: number;
  }): EntityAttributeRecord {
    const now = input.createdAt ?? Date.now();
    const record: EntityAttributeRecord = {
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
    `).run(
      record.attributeId,
      record.entityId,
      record.attributeKey,
      record.attributeValue,
      record.normalizedValue,
      record.sourceNeuronId || null,
      record.createdAt,
      record.updatedAt
    );

    this.touchEntity(record.entityId, now);
    return record;
  }

  listAttributes(entityId: string, attributeKey?: string, projectId?: string): EntityAttributeRecord[] {
    const hasNeurons = this.hasTable('neurons');
    const scopeClause = projectId === undefined
      ? ''
      : hasNeurons
        ? ` AND (source_neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id,'')=?) OR (source_neuron_id IS NULL AND EXISTS (SELECT 1 FROM entity_instances e WHERE e.instance_id=entity_attributes.entity_id AND json_extract(e.metadata_json,'$.projectId')=?)))`
        : ` AND source_neuron_id IS NULL AND EXISTS (SELECT 1 FROM entity_instances e WHERE e.instance_id=entity_attributes.entity_id AND json_extract(e.metadata_json,'$.projectId')=?)`;
    const scopeParams = projectId === undefined ? [] : hasNeurons ? [projectId, projectId] : [projectId];
    const rows = attributeKey
      ? this.db.prepare(`
          SELECT * FROM entity_attributes
          WHERE entity_id = ? AND attribute_key = ?${scopeClause}
          ORDER BY updated_at DESC
        `).all(entityId, attributeKey, ...scopeParams)
      : this.db.prepare(`
          SELECT * FROM entity_attributes
          WHERE entity_id = ?${scopeClause}
          ORDER BY updated_at DESC
        `).all(entityId, ...scopeParams);

    return (rows as any[]).map((row) => ({
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

  addRelation(input: {
    sourceEntityId: string;
    targetEntityId: string;
    relationType: EntityRelationRecord['relationType'];
    projectId: string;
    sourceNeuronId?: string;
    createdAt?: number;
  }): EntityRelationRecord {
    if (!this.isExclusiveToProject(input.sourceEntityId, input.projectId)
      || !this.isExclusiveToProject(input.targetEntityId, input.projectId)) throw new Error('entity_relation_project_scope_mismatch');
    const createdAt = input.createdAt ?? Date.now();
    const existing = this.db.prepare(`
      SELECT relation_id, created_at
      FROM entity_relations
      WHERE project_id=? AND source_entity_id = ? AND target_entity_id = ? AND relation_type = ?
    `).get(input.projectId, input.sourceEntityId, input.targetEntityId, input.relationType) as any;
    const relationId = existing?.relation_id || `erel-${randomUUID()}`;

    this.db.prepare(`
      INSERT OR REPLACE INTO entity_relations (
        relation_id, project_id, source_entity_id, target_entity_id, relation_type, source_neuron_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      relationId,
      input.projectId,
      input.sourceEntityId,
      input.targetEntityId,
      input.relationType,
      input.sourceNeuronId || null,
      existing?.created_at || createdAt
    );

    return {
      relationId,
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      relationType: input.relationType,
      sourceNeuronId: input.sourceNeuronId,
      createdAt: existing?.created_at || createdAt
    };
  }

  registerPendingResolution(input: {
    referenceText: string;
    entityType?: string;
    contextNeuronId?: string;
    createdAt?: number;
  }): PendingEntityResolutionRecord {
    const now = input.createdAt ?? Date.now();
    const record: PendingEntityResolutionRecord = {
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
    `).run(
      record.pendingId,
      record.referenceText,
      record.entityType || null,
      record.contextNeuronId || null,
      null,
      record.status,
      record.createdAt,
      record.updatedAt
    );

    return record;
  }

  resolvePendingReference(pendingId: string, entityId: string, resolvedAt: number = Date.now()): PendingEntityResolutionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM pending_entity_resolution WHERE pending_id = ?
    `).get(pendingId) as any;
    if (!row) return null;

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

  listPendingResolutions(filter?: {
    status?: PendingEntityResolutionRecord['status'];
    entityType?: string;
    projectId?: string;
  }): PendingEntityResolutionRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM pending_entity_resolution
      WHERE (? IS NULL OR status = ?)
        AND (? IS NULL OR entity_type = ?)
        AND (? IS NULL OR context_neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id,'')=?))
      ORDER BY updated_at DESC, created_at DESC
    `).all(
      filter?.status || null,
      filter?.status || null,
      filter?.entityType || null,
      filter?.entityType || null,
      filter?.projectId === undefined ? null : filter.projectId,
      filter?.projectId === undefined ? null : filter.projectId
    ) as any[];

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

  listAliasConflicts(type?: string, projectId?: string): EntityAliasConflictRecord[] {
    const scope = projectId === undefined ? '' : ` AND project_id = ?`;
    const params = projectId === undefined ? [] : [projectId];
    const rows = type
      ? this.db.prepare(`
          SELECT * FROM entity_alias_conflicts
          WHERE entity_type = ? AND status = 'active'${scope}
          ORDER BY updated_at DESC
        `).all(type, ...params)
      : this.db.prepare(`
          SELECT * FROM entity_alias_conflicts
          WHERE status = 'active'${scope}
          ORDER BY updated_at DESC
        `).all(...params);

    return (rows as any[]).map((row) => ({
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

  close(): void {
    if (this.ownsDb) this.db.close();
  }

  addAlias(entityId: string, alias: string, projectId: string, updatedAt: number = Date.now()): void {
    const entity = this.getByEntityId(entityId);
    if (!entity || !alias.trim()) return;
    if (!this.isExclusiveToProject(entityId, projectId)) throw new Error('entity_project_scope_not_exclusive');
    this.touchEntity(entityId, updatedAt);
    this.upsertAliases(entityId, entity.type, [alias], projectId, updatedAt);
  }

  removeAlias(entityId: string, alias: string, projectId: string, updatedAt: number = Date.now()): void {
    const entity = this.getByEntityId(entityId);
    if (!entity || entity.canonicalName === alias) return;
    const normalized = this.normalizeAlias(alias);
    this.db.prepare(`DELETE FROM entity_aliases WHERE project_id=? AND entity_id = ? AND normalized_alias = ?`).run(projectId, entityId, normalized);
    this.refreshAliasConflict(normalized, entity.type, projectId, updatedAt);
  }

  redirectInstance(input: {
    sourceEntityId: string;
    targetCanonicalEntityId: string;
    status?: EntityRecord['status'];
    projectId: string;
    updatedAt?: number;
  }): void {
    if (!this.isExclusiveToProject(input.sourceEntityId, input.projectId)) throw new Error('entity_project_scope_not_exclusive');
    this.db.prepare(`
      UPDATE entity_instances
      SET canonical_entity_id = ?, status = ?, updated_at = ?
      WHERE instance_id = ?
    `).run(input.targetCanonicalEntityId, input.status || 'archived', input.updatedAt ?? Date.now(), input.sourceEntityId);
  }

  restoreInstance(input: {
    entityId: string;
    canonicalEntityId: string;
    status: EntityRecord['status'];
    updatedAt?: number;
  }): void {
    this.db.prepare(`
      UPDATE entity_instances
      SET canonical_entity_id = ?, status = ?, updated_at = ?
      WHERE instance_id = ?
    `).run(input.canonicalEntityId, input.status, input.updatedAt ?? Date.now(), input.entityId);
  }

  private upsertAliases(entityId: string, entityType: string, aliases: string[], projectId: string, timestamp: number): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO entity_aliases (
        alias_id, entity_id, project_id, alias_text, normalized_alias, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const alias of Array.from(new Set(aliases.map((item) => item.trim()).filter(Boolean)))) {
      stmt.run(
        `ealias-${randomUUID()}`,
        entityId,
        projectId,
        alias,
        this.normalizeAlias(alias),
        timestamp,
        timestamp
      );
      this.refreshAliasConflict(this.normalizeAlias(alias), entityType, projectId, timestamp);
    }
  }

  private touchEntity(entityId: string, updatedAt: number): void {
    this.db.prepare(`
      UPDATE entity_instances SET updated_at = ? WHERE instance_id = ?
    `).run(updatedAt, entityId);
  }

  private ensureCanonicalEntity(input: {
    canonicalName: string;
    type: string;
    aliases?: string[];
    status?: 'active' | 'pending_resolution' | 'archived';
    createdFrom?: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
  }): string {
    const existing = this.db.prepare(`
      SELECT entity_id, aliases_json, metadata_json
      FROM entities
      WHERE canonical_name = ? AND type = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(input.canonicalName, input.type) as { entity_id: string; aliases_json?: string; metadata_json?: string } | null;

    if (existing) {
      const existingAliases = existing.aliases_json ? JSON.parse(existing.aliases_json) as string[] : [];
      const existingMetadata = existing.metadata_json ? JSON.parse(existing.metadata_json) as Record<string, unknown> : {};
      this.db.prepare(`
        UPDATE entities
        SET aliases_json = ?, metadata_json = ?, updated_at = ?
        WHERE entity_id = ?
      `).run(
        JSON.stringify(Array.from(new Set([...existingAliases, ...(input.aliases || [])]))),
        JSON.stringify({ ...existingMetadata, ...(input.metadata || {}) }),
        input.createdAt,
        existing.entity_id
      );
      return existing.entity_id;
    }

    const canonicalEntityId = `ecanon-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO entities (
        entity_id, canonical_name, type, aliases_json, status, created_from, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      canonicalEntityId,
      input.canonicalName,
      input.type,
      JSON.stringify(Array.from(new Set(input.aliases || []))),
      input.status || 'active',
      input.createdFrom || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdAt,
      input.createdAt
    );
    return canonicalEntityId;
  }

  private findExistingInstance(input: {
    canonicalName: string;
    type: string;
    createdFrom?: string;
    metadata?: Record<string, unknown>;
    instanceMode?: 'auto' | 'canonical' | 'new_instance';
  }): EntityRecord | null {
    if (input.instanceMode === 'new_instance') return null;

    const projectId = typeof input.metadata?.projectId === 'string' ? String(input.metadata.projectId) : undefined;
    const scopeSql = projectId === undefined ? '' : ` AND (json_extract(metadata_json,'$.projectId') = ? OR EXISTS (
      SELECT 1 FROM entity_mentions em WHERE em.entity_id=entity_instances.instance_id AND COALESCE(em.project_id,'')=?
    ))`;
    const params: string[] = [input.canonicalName, input.type];
    if (projectId !== undefined) params.push(projectId, projectId);
    const rows = this.db.prepare(`
      SELECT *
      FROM entity_instances
      WHERE canonical_name = ? AND type = ?${scopeSql}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 12
    `).all(...params) as any[];
    const allCandidates = rows.map((row) => this.mapRow(row));
    const candidates = projectId === undefined
      ? allCandidates
      : allCandidates.filter((candidate) => candidate.metadata?.projectId === projectId
        || this.listTimeline({ entityId: candidate.entityId, projectId, limit: 1 }).length > 0);

    if (input.instanceMode === 'canonical') return candidates[0] || null;
    if (input.createdFrom) {
      const exact = candidates.find((candidate) => candidate.createdFrom === input.createdFrom);
      if (exact) return exact;
    }
    if (projectId !== undefined) return candidates[0] || null;
    return candidates[0] || null;
  }

  private refreshAliasConflict(normalizedAlias: string, entityType: string, projectId: string, timestamp: number): void {
    const rows = this.db.prepare(`
      SELECT DISTINCT ei.instance_id
      FROM entity_aliases ea
      JOIN entity_instances ei ON ei.instance_id = ea.entity_id
      WHERE ea.normalized_alias = ?
        AND ea.project_id = ?
        AND ei.type = ?
        AND ei.status = 'active'
      ORDER BY ei.updated_at DESC
    `).all(normalizedAlias, projectId, entityType) as Array<{ instance_id: string }>;

    const entityIds = rows.map((row) => row.instance_id);
    if (entityIds.length <= 1) {
      this.db.prepare(`
        UPDATE entity_alias_conflicts
        SET status = 'resolved', updated_at = ?
        WHERE project_id=? AND normalized_alias = ? AND entity_type = ?
      `).run(timestamp, projectId, normalizedAlias, entityType);
      return;
    }

    const policy = this.inferAliasConflictPolicy(entityIds);
    const existing = this.db.prepare(`
      SELECT conflict_id, created_at
      FROM entity_alias_conflicts
      WHERE project_id=? AND normalized_alias = ? AND entity_type = ?
    `).get(projectId, normalizedAlias, entityType) as { conflict_id: string; created_at: number } | null;

    this.db.prepare(`
      INSERT OR REPLACE INTO entity_alias_conflicts (
        conflict_id, project_id, normalized_alias, entity_type, entity_ids_json, policy, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      existing?.conflict_id || `econf-${randomUUID()}`,
      projectId,
      normalizedAlias,
      entityType,
      JSON.stringify(entityIds),
      policy,
      existing?.created_at || timestamp,
      timestamp
    );
  }

  private inferAliasConflictPolicy(entityIds: string[]): EntityAliasConflictRecord['policy'] {
    const projectIds = new Set<string>();
    for (const entityId of entityIds) {
      const mentions = this.listTimeline({ entityId, limit: 8 });
      for (const mention of mentions) {
        if (mention.projectId) projectIds.add(mention.projectId);
      }
    }

    if (projectIds.size > 1) return 'prefer_project_context';
    if (entityIds.length > 2) return 'require_explicit_disambiguation';
    return 'prefer_recent_mention';
  }

  private resolveRelativeReference(referenceText: string, type: string, options?: ResolveEntityReferenceOptions): EntityRecord | null {
    const explicitNameHint = this.extractRelativeNameHint(referenceText, type);
    const recent = this.listByCreationOrder(type, 12, options?.projectId)
      .filter((entity) => this.matchesResolutionOptions(entity.entityId, options))
      .filter((entity) => this.matchesExplicitRelativeHint(entity, explicitNameHint))
      .slice(0, 4);
    if (recent.length === 0) return null;

    const normalizedReference = this.normalizeAlias(referenceText);
    const relativeReference = extractRelativeReferences(normalizedReference)[0] || normalizedReference;
    if (isLatestReference(relativeReference)) return recent[0] || null;
    if (isPreviousReference(relativeReference)) return recent[1] || recent[0] || null;
    return recent[0] || null;
  }

  private pickBestEntity(candidates: EntityRecord[], options?: ResolveEntityReferenceOptions): EntityRecord | null {
    if (candidates.length === 0) return null;
    const scored = candidates.map((entity) => this.scoreDisambiguationCandidate(entity, undefined, undefined, options));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.entity || null;
  }

  private matchesResolutionOptions(entityId: string, options?: ResolveEntityReferenceOptions): boolean {
    if (options?.projectId === undefined && !options?.beforeTime) return true;
    const mentions = this.listTimeline({ entityId, projectId: options?.projectId, limit: 12 });
    if (options?.projectId !== undefined && mentions.length === 0) return false;
    if (options.beforeTime && !mentions.some((mention) => mention.createdAt <= options.beforeTime!)) return false;
    return true;
  }

  private normalizeAlias(value: string): string {
    return normalizeLexiconText(value).toLowerCase();
  }

  private scoreDisambiguationCandidate(
    entity: EntityRecord,
    normalizedAlias?: string,
    conflictPolicy?: EntityAliasConflictRecord['policy'],
    options?: ResolveEntityReferenceOptions
  ): EntityDisambiguationCandidate {
    const mentions = this.listTimeline({ entityId: entity.entityId, projectId: options?.projectId, limit: 12 });
    const attributes = this.listAttributes(entity.entityId, undefined, options?.projectId);
    const reasons: string[] = [];
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
    if (options?.projectId !== undefined && mentions.length > 0) {
      score += 2.1;
      reasons.push('project_context_match');
    }
    if (options?.beforeTime && mentions.some((mention) => mention.createdAt <= options.beforeTime!)) {
      score += 0.9;
      reasons.push('historical_match');
    }
    if (attributes.some((attribute) => /bluetooth|issue|device|topic/i.test(attribute.attributeKey) || /bluetooth|disconnect|断连/i.test(attribute.attributeValue))) {
      score += 0.35;
      reasons.push('attribute_support');
    }

    if (conflictPolicy === 'prefer_project_context' && options?.projectId !== undefined && mentions.length === 0) {
      score -= 0.6;
      reasons.push('project_conflict_penalty');
    }
    if (conflictPolicy === 'require_explicit_disambiguation' && options?.projectId === undefined && mentions.length > 1) {
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

  private extractRelativeNameHint(referenceText: string, type: string): string | undefined {
    if (type === 'device') return extractDeviceCandidate(referenceText);
    if (type === 'project') return extractProjectCandidate(referenceText);
    return undefined;
  }

  private matchesExplicitRelativeHint(entity: EntityRecord, explicitNameHint?: string): boolean {
    if (!explicitNameHint) return true;
    const normalizedHint = this.normalizeAlias(explicitNameHint);
    return this.normalizeAlias(entity.canonicalName).includes(normalizedHint)
      || entity.aliases.some((alias) => this.normalizeAlias(alias).includes(normalizedHint));
  }

  private isBareRelativeEntity(entity: EntityRecord, type: string): boolean {
    const normalizedName = this.normalizeAlias(entity.canonicalName);
    const relativeRefs = extractRelativeReferences(normalizedName).map((reference) => this.normalizeAlias(reference));
    if (!relativeRefs.includes(normalizedName)) return false;
    if (type === 'device') return !extractDeviceCandidate(entity.canonicalName);
    if (type === 'project') return !extractProjectCandidate(entity.canonicalName);
    return false;
  }

  private hasTable(table: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
  }

  private mapRow(row: any): EntityRecord {
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

  private mapRowForProject(row: any, projectId?: string): EntityRecord {
    const entity = this.mapRow(row);
    if (projectId === undefined) return entity;
    const aliases = this.db.prepare(`SELECT alias_text FROM entity_aliases WHERE entity_id=? AND project_id=? ORDER BY updated_at DESC`).all(entity.entityId, projectId) as Array<{ alias_text: string }>;
    return {
      ...entity,
      aliases: aliases.map((item) => item.alias_text),
      ...(this.listProjectScopes(entity.entityId).length > 1 ? { metadata: {} } : {}),
    };
  }
}

function isWeakAmbiguousRelativeReference(reference: string): boolean {
  return /^(that project|this project|that one|this one|那个项目|这个项目|那个耳机|这个耳机|那个设备|这个设备)$/i.test(
    normalizeLexiconText(reference).toLowerCase()
  );
}
