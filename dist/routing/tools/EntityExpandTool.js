/**
 * EntityExpandTool.ts
 * expand_entity tool — builds a full entity profile from facts/events/beliefs.
 * Phase 48 — v1.1
 */
import { matchesProjectScope } from '../../topology/ProjectScope.js';
/** SI-16: upper bound on facts returned per entity expand */
const MAX_FACTS = 20;
export class EntityExpandTool {
    factStore;
    entityStore;
    beliefStore;
    constructor(factStore, entityStore, beliefStore) {
        this.factStore = factStore;
        this.entityStore = entityStore;
        this.beliefStore = beliefStore;
    }
    execute(entityName, entityType, projectId) {
        // Resolve entity: try canonical name first, then alias
        let entity = this.entityStore.findByCanonicalName(entityName, entityType, projectId);
        if (!entity) {
            entity = this.entityStore.findByAlias(entityName, entityType, projectId);
        }
        if (!entity)
            return null;
        // Fetch facts (capped at MAX_FACTS)
        const facts = this.factStore
            .listFactsByEntityIds([entity.entityId], { limit: MAX_FACTS, projectId })
            .filter((fact) => inProject(fact, projectId))
            .slice(0, MAX_FACTS);
        // Fetch events via neuron IDs associated with those facts
        const neuronIds = [...new Set(facts.map((f) => f.neuronId).filter(Boolean))];
        const events = this.factStore
            .listEventsByNeuronIds(neuronIds, MAX_FACTS, projectId)
            .filter((event) => inProject(event, projectId));
        // Fetch active beliefs related to the entity name
        const beliefs = this.beliefStore.getActiveBeliefsForQuery({
            query: entityName,
            entities: [entityName],
            projectId,
        }).filter((belief) => matchesProjectScope(projectId, belief.projectId)).slice(0, 10);
        return {
            entityId: entity.entityId,
            canonicalName: entity.canonicalName,
            entityType: entity.type,
            facts,
            events,
            beliefs,
        };
    }
}
function inProject(record, projectId) {
    const metadata = record && typeof record === 'object' && 'metadata' in record
        ? record.metadata
        : undefined;
    const recordProjectId = metadata?.projectId;
    return matchesProjectScope(projectId, typeof recordProjectId === 'string' ? recordProjectId : undefined);
}
