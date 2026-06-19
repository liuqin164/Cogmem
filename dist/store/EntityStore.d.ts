import Database from 'bun:sqlite';
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
export declare class EntityStore {
    private db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string);
    getDatabase(): Database;
    private initializeSchema;
    upsertEntity(input: {
        canonicalName: string;
        type: string;
        aliases?: string[];
        status?: 'active' | 'pending_resolution' | 'archived';
        createdFrom?: string;
        metadata?: Record<string, unknown>;
        createdAt?: number;
        instanceMode?: 'auto' | 'canonical' | 'new_instance';
    }): EntityRecord;
    findByAlias(aliasText: string, type?: string): EntityRecord | null;
    listByAlias(aliasText: string, type?: string): EntityRecord[];
    findByCanonicalName(canonicalName: string, type?: string): EntityRecord | null;
    findByEntityId(entityId: string): EntityRecord | null;
    findLatestByType(type: string): EntityRecord | null;
    listRecentByType(type: string, limit?: number): EntityRecord[];
    private listByCreationOrder;
    listRelations(entityId: string, relationType?: EntityRelationRecord['relationType']): EntityRelationRecord[];
    resolveReference(referenceText: string, typeHint?: string, options?: ResolveEntityReferenceOptions): EntityRecord | null;
    listDisambiguationCandidates(referenceText: string, typeHint?: string, options?: ResolveEntityReferenceOptions): EntityDisambiguationCandidate[];
    listReferenceCandidatesWithRelativeSupport(referenceText: string, typeHint?: string, options?: ResolveEntityReferenceOptions): EntityDisambiguationCandidate[];
    recordMention(input: {
        entityId: string;
        neuronId?: string;
        projectId?: string;
        mentionType?: EntityMentionRecord['mentionType'];
        createdAt?: number;
    }): EntityMentionRecord;
    listTimeline(input: {
        entityId?: string;
        type?: string;
        projectId?: string;
        limit?: number;
    }): EntityMentionRecord[];
    getEntityTimeline(input: {
        type?: string;
        projectId?: string;
        entityIds?: string[];
        limit?: number;
    }): EntityTimelineItem[];
    listEntitiesUpdatedInRange(startTime: number, endTime: number, type?: string): EntityRecord[];
    archiveEntity(entityId: string, updatedAt?: number): void;
    addAttribute(input: {
        entityId: string;
        attributeKey: string;
        attributeValue: string;
        sourceNeuronId?: string;
        createdAt?: number;
    }): EntityAttributeRecord;
    listAttributes(entityId: string, attributeKey?: string): EntityAttributeRecord[];
    addRelation(input: {
        sourceEntityId: string;
        targetEntityId: string;
        relationType: EntityRelationRecord['relationType'];
        sourceNeuronId?: string;
        createdAt?: number;
    }): EntityRelationRecord;
    registerPendingResolution(input: {
        referenceText: string;
        entityType?: string;
        contextNeuronId?: string;
        createdAt?: number;
    }): PendingEntityResolutionRecord;
    resolvePendingReference(pendingId: string, entityId: string, resolvedAt?: number): PendingEntityResolutionRecord | null;
    listPendingResolutions(filter?: {
        status?: PendingEntityResolutionRecord['status'];
        entityType?: string;
    }): PendingEntityResolutionRecord[];
    listAliasConflicts(type?: string): EntityAliasConflictRecord[];
    close(): void;
    addAlias(entityId: string, alias: string, updatedAt?: number): void;
    removeAlias(entityId: string, alias: string, updatedAt?: number): void;
    redirectInstance(input: {
        sourceEntityId: string;
        targetCanonicalEntityId: string;
        status?: EntityRecord['status'];
        updatedAt?: number;
    }): void;
    restoreInstance(input: {
        entityId: string;
        canonicalEntityId: string;
        status: EntityRecord['status'];
        updatedAt?: number;
    }): void;
    private upsertAliases;
    private touchEntity;
    private ensureCanonicalEntity;
    private findExistingInstance;
    private refreshAliasConflict;
    private inferAliasConflictPolicy;
    private resolveRelativeReference;
    private pickBestEntity;
    private matchesResolutionOptions;
    private normalizeAlias;
    private scoreDisambiguationCandidate;
    private extractRelativeNameHint;
    private matchesExplicitRelativeHint;
    private isBareRelativeEntity;
    private mapRow;
}
//# sourceMappingURL=EntityStore.d.ts.map