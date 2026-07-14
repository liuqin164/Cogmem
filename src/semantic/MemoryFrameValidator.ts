import { relationConstraintRegistry } from './RelationConstraintRegistry.js';
import { isMemoryFrame } from './MemoryFrameSchema.js';
import type { MemoryFrameV1 } from './MemoryFrameTypes.js';

export interface MemoryFrameValidationResult { valid: boolean; errors: string[]; frame?: MemoryFrameV1; }

export function validateMemoryFrame(value: unknown, options: { allowEmptyEvidence?: boolean } = {}): MemoryFrameValidationResult {
  if (!isMemoryFrame(value)) return { valid: false, errors: ['invalid_memory_frame_shape'] };
  const frame = value as MemoryFrameV1;
  const errors: string[] = [];
  const limits = { nodes: 256, relations: 512, temporalReferences: 128, stateTransitions: 128, aliases: 64, evidence: 1000, text: 20000 };
  const episodeKinds = new Set(['discussion','operation','decision','correction','diagnostic','planning','status_update','preference','other']);
  const statuses = new Set(['staged','active','needs_confirmation','superseded','failed']);
  const publishStatuses = new Set(['active','needs_confirmation']);
  if (!episodeKinds.has(frame.episodeKind)) errors.push('invalid_episode_kind');
  if (frame.status !== undefined && !statuses.has(frame.status)) errors.push('invalid_frame_status');
  if (frame.publishStatus !== undefined && !publishStatuses.has(frame.publishStatus)) errors.push('invalid_publish_status');
  if (frame.needsReview !== undefined && typeof frame.needsReview !== 'boolean') errors.push('invalid_needs_review');
  if (frame.primaryLanguage !== undefined && typeof frame.primaryLanguage !== 'string') errors.push('invalid_primary_language');
  if (frame.nodes.length === 0) errors.push('frame_nodes_required');
  if (frame.nodes.length > limits.nodes) errors.push('frame_nodes_limit_exceeded');
  if (frame.relations.length > limits.relations) errors.push('frame_relations_limit_exceeded');
  if (frame.temporalReferences.length > limits.temporalReferences) errors.push('frame_temporal_references_limit_exceeded');
  if (frame.stateTransitions.length > limits.stateTransitions) errors.push('frame_state_transitions_limit_exceeded');
  if (!frame.frameId.trim() || !frame.projectId.trim() || !frame.episodeId.trim()) errors.push('empty_frame_identity');
  if (!frame.processor || typeof frame.processor.promptVersion !== 'string' || !frame.processor.promptVersion.trim() || !Number.isFinite(frame.processor.generatedAt)) errors.push('invalid_processor_metadata');
  const evidence = new Set(frame.evidenceEventIds);
  const dimensions = new Set(['actor','entity','project','topic','issue','event','raw_event','episode','task','object','location','time','state']);
  const allowedAuthorities = new Set(['processor','deterministic_fallback']);
  const allowedCompleteness = new Set(['full','minimal']);
  if (frame.sourceAuthority !== undefined && !allowedAuthorities.has(frame.sourceAuthority)) errors.push('invalid_source_authority');
  if (frame.semanticCompleteness !== undefined && !allowedCompleteness.has(frame.semanticCompleteness)) errors.push('invalid_semantic_completeness');
  for (const node of frame.nodes) if (!dimensions.has(String(node.dimension))) errors.push(`invalid_memory_dimension:${node.frameNodeId}`);
  if (frame.evidenceEventIds.length === 0 && !options.allowEmptyEvidence) errors.push('frame_evidence_required');
  if (frame.evidenceEventIds.length > limits.evidence) errors.push('frame_evidence_limit_exceeded');
  if (frame.title.length > limits.text || frame.summary.length > limits.text) errors.push('frame_text_limit_exceeded');
  if (!Number.isFinite(frame.confidence) || frame.confidence < 0 || frame.confidence > 1) errors.push('invalid_frame_confidence');
  const nodes = new Map(frame.nodes.map((node) => [node.frameNodeId, node]));
  if (nodes.size !== frame.nodes.length) errors.push('duplicate_frame_node_id');
  if (!frame.nodes.some((node) => node.dimension === 'episode' && node.label.trim())) errors.push('episode_node_required');
  if (!frame.nodes.some((node) => node.dimension === 'project' && node.label.trim())) errors.push('project_node_required');
  for (const node of frame.nodes) {
    if (typeof node.frameNodeId !== 'string' || typeof node.label !== 'string' || !Array.isArray(node.evidenceEventIds)) { errors.push('invalid_frame_node_shape'); continue; }
    if (!node.label.trim()) errors.push(`empty_frame_node_label:${node.frameNodeId}`);
    if (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1) errors.push(`invalid_node_confidence:${node.frameNodeId}`);
    if (!node.evidenceEventIds.length && !options.allowEmptyEvidence) errors.push(`node_evidence_required:${node.frameNodeId}`);
    if (!node.evidenceEventIds.every((id) => evidence.has(id))) errors.push(`node_evidence_not_in_frame:${node.frameNodeId}`);
    if (node.aliases !== undefined && (!Array.isArray(node.aliases) || node.aliases.length > limits.aliases || node.aliases.some((alias) => typeof alias !== 'string'))) errors.push(`invalid_node_aliases:${node.frameNodeId}`);
    if (Array.isArray(node.aliases) && node.aliases.some((alias) => !alias.trim())) errors.push(`empty_node_alias:${node.frameNodeId}`);
  }
  for (const relation of frame.relations) {
    const source = nodes.get(relation.sourceFrameNodeId); const target = nodes.get(relation.targetFrameNodeId);
    if (!source || !target) { errors.push('relation_node_missing'); continue; }
    try { relationConstraintRegistry.validate(source.dimension, relation.relationType, target.dimension); } catch (error) { errors.push(error instanceof Error ? error.message : 'invalid_memory_frame_relation'); }
    if (!Number.isFinite(relation.confidence) || relation.confidence < 0 || relation.confidence > 1) errors.push('invalid_relation_confidence');
    if (!Array.isArray(relation.evidenceEventIds) || (!relation.evidenceEventIds.length && !options.allowEmptyEvidence)) errors.push('relation_evidence_required');
    if (Array.isArray(relation.evidenceEventIds) && !relation.evidenceEventIds.every((id) => evidence.has(id))) errors.push('relation_evidence_not_in_frame');
    if (relation.validFrom !== undefined && relation.validTo !== undefined && relation.validFrom > relation.validTo) errors.push('relation_invalid_valid_range');
  }
  for (const node of frame.nodes) if (node.dimension === 'raw_event' && node.evidenceEventIds.length !== 1) errors.push(`raw_event_identity_requires_one_evidence:${node.frameNodeId}`);
  for (const reference of frame.temporalReferences) {
    if (typeof reference.label !== 'string' || !Array.isArray(reference.evidenceEventIds) || !reference.label.trim() || !Number.isFinite(reference.confidence) || reference.confidence < 0 || reference.confidence > 1 || !reference.evidenceEventIds.length) errors.push('invalid_temporal_reference');
    if (reference.occurredAt !== undefined && !Number.isFinite(reference.occurredAt)) errors.push('invalid_temporal_reference_time');
    if (Array.isArray(reference.evidenceEventIds) && !reference.evidenceEventIds.every((id) => evidence.has(id))) errors.push('temporal_reference_evidence_not_in_frame');
  }
  for (const transition of frame.stateTransitions) {
    if (typeof transition.subjectFrameNodeId !== 'string' || !nodes.has(transition.subjectFrameNodeId)) errors.push('state_transition_node_missing');
    if (typeof transition.to !== 'string' || !Array.isArray(transition.evidenceEventIds) || !transition.to.trim() || !Number.isFinite(transition.confidence) || transition.confidence < 0 || transition.confidence > 1 || !transition.evidenceEventIds.length) errors.push('invalid_state_transition');
    if (Array.isArray(transition.evidenceEventIds) && !transition.evidenceEventIds.every((id) => evidence.has(id))) errors.push('state_transition_evidence_not_in_frame');
  }
  return { valid: errors.length === 0, errors, frame: errors.length === 0 ? frame : undefined };
}
