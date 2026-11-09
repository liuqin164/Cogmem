/**
 * Bumped when the prompt or the vocabulary it names changes, so a stored frame
 * records which reading produced it: v2 added LIKES / FRIEND_OF / FAMILY_OF.
 */
import { RELATION_ENDPOINTS_TEXT } from './RelationConstraintRegistry.js';
import { DEFAULT_TAXONOMY, type MemoryTaxonomy } from '../config/MemoryTaxonomy.js';

export const MEMORY_FRAME_PROMPT_VERSION = '3.7.4-v6';

export function memoryFrameSystemPrompt(taxonomy: MemoryTaxonomy = DEFAULT_TAXONOMY): string {
  return `Return only JSON matching memory_frame.v1. Required top-level fields are schemaVersion, frameId, projectId, episodeId, title, summary, episodeKind, nodes, relations, temporalReferences, stateTransitions, confidence, evidenceEventIds, processor. Dimensions: actor, entity, project, topic, issue, event, raw_event, episode, task, object, location, time, state. The frame must contain one node with dimension episode and one with dimension project. episodeKind must be one of ${taxonomy.episodeKinds.map((kind) => kind.id).join(', ')}. Relations are constrained to exactly these source -[relation]-> target pairs and no others: ${RELATION_ENDPOINTS_TEXT}. Registered relation names: ${taxonomy.relationNames.join(', ')}. Every frame, node, relation, temporal reference, and state transition must cite one or more supplied evidence event IDs. Do not invent people, projects, events, tasks, or relations. Preserve labels in their source language. Do not choose canonical IDs; omit uncertain claims. Node objects carry exactly frameNodeId, dimension, label, confidence and evidenceEventIds. Relation objects carry exactly sourceFrameNodeId, relationType, targetFrameNodeId, confidence and evidenceEventIds. Temporal reference objects carry exactly label, occurredAt, confidence and evidenceEventIds. State transition objects carry exactly subjectFrameNodeId, from, to, confidence and evidenceEventIds. No object may carry a key that is not listed here. The processor field is an OBJECT, not a string: {"promptVersion": "${MEMORY_FRAME_PROMPT_VERSION}", "generatedAt": <epoch milliseconds>}. A node whose dimension is raw_event must cite exactly one evidence eventId. Return JSON only.`;
}

/** The prompt for the shipped vocabulary. Built from the taxonomy, so there is one list of kinds (#132). */
export const MEMORY_FRAME_SYSTEM_PROMPT = memoryFrameSystemPrompt();
