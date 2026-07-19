/**
 * EntityExpandTool.ts
 * expand_entity tool — builds a full entity profile from facts/events/beliefs.
 * Phase 48 — v1.1
 */

import type { FactRecord, EventRecord, FactStore } from '../../store/FactStore.js';
import type { EntityStore } from '../../store/EntityStore.js';
import type { BeliefStore } from '../../belief/BeliefStore.js';
import type { BeliefRecord } from '../../types/index.js';
import { matchesProjectScope } from '../../topology/ProjectScope.js';

/** SI-16: upper bound on facts returned per entity expand */
const MAX_FACTS = 20;

export interface EntityProfile {
  entityId: string;
  canonicalName: string;
  entityType: string;
  facts: FactRecord[];
  events: EventRecord[];
  beliefs: BeliefRecord[];
}

export class EntityExpandTool {
  constructor(
    private readonly factStore: FactStore,
    private readonly entityStore: EntityStore,
    private readonly beliefStore: BeliefStore
  ) {}

  execute(entityName: string, entityType?: string, projectId?: string): EntityProfile | null {
    // Resolve entity: try canonical name first, then alias
    let entity = this.entityStore.findByCanonicalName(entityName, entityType, projectId);
    if (!entity) {
      entity = this.entityStore.findByAlias(entityName, entityType, projectId);
    }
    if (!entity) return null;

    // Fetch facts (capped at MAX_FACTS)
    const facts = this.factStore
      .listFactsByEntityIds([entity.entityId], { limit: MAX_FACTS, projectId })
      .filter((fact) => inProject(fact, projectId))
      .slice(0, MAX_FACTS);

    // Fetch events via neuron IDs associated with those facts
    const neuronIds = [...new Set(facts.map((f) => f.neuronId).filter(Boolean) as string[])];
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

function inProject(record: unknown, projectId?: string): boolean {
  const metadata = record && typeof record === 'object' && 'metadata' in record
    ? (record as { metadata?: Record<string, unknown> }).metadata
    : undefined;
  const recordProjectId = metadata?.projectId;
  return matchesProjectScope(projectId, typeof recordProjectId === 'string' ? recordProjectId : undefined);
}
