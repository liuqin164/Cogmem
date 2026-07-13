import { relationConstraintRegistry } from './RelationConstraintRegistry.js';
import { isMemoryFrame } from './MemoryFrameSchema.js';
export function validateMemoryFrame(value, options = {}) {
    if (!isMemoryFrame(value))
        return { valid: false, errors: ['invalid_memory_frame_shape'] };
    const frame = value;
    const errors = [];
    if (!frame.frameId.trim())
        errors.push('empty_frame_id');
    if (!frame.processor || typeof frame.processor.promptVersion !== 'string' || !frame.processor.promptVersion.trim() || !Number.isFinite(frame.processor.generatedAt))
        errors.push('invalid_processor_metadata');
    const evidence = new Set(frame.evidenceEventIds);
    const dimensions = new Set(['actor', 'entity', 'project', 'topic', 'issue', 'event', 'raw_event', 'episode', 'task', 'object', 'location', 'time', 'state']);
    const allowedAuthorities = new Set(['processor', 'deterministic_fallback']);
    const allowedCompleteness = new Set(['full', 'minimal']);
    if (frame.sourceAuthority !== undefined && !allowedAuthorities.has(frame.sourceAuthority))
        errors.push('invalid_source_authority');
    if (frame.semanticCompleteness !== undefined && !allowedCompleteness.has(frame.semanticCompleteness))
        errors.push('invalid_semantic_completeness');
    for (const node of frame.nodes)
        if (!dimensions.has(String(node.dimension)))
            errors.push(`invalid_memory_dimension:${node.frameNodeId}`);
    if (frame.evidenceEventIds.length === 0 && !options.allowEmptyEvidence)
        errors.push('frame_evidence_required');
    if (!Number.isFinite(frame.confidence) || frame.confidence < 0 || frame.confidence > 1)
        errors.push('invalid_frame_confidence');
    const nodes = new Map(frame.nodes.map((node) => [node.frameNodeId, node]));
    if (nodes.size !== frame.nodes.length)
        errors.push('duplicate_frame_node_id');
    for (const node of frame.nodes) {
        if (!node.label.trim())
            errors.push(`empty_frame_node_label:${node.frameNodeId}`);
        if (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1)
            errors.push(`invalid_node_confidence:${node.frameNodeId}`);
        if (!node.evidenceEventIds.length && !options.allowEmptyEvidence)
            errors.push(`node_evidence_required:${node.frameNodeId}`);
        if (!node.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push(`node_evidence_not_in_frame:${node.frameNodeId}`);
        if (node.aliases !== undefined && (!Array.isArray(node.aliases) || node.aliases.some((alias) => typeof alias !== 'string')))
            errors.push(`invalid_node_aliases:${node.frameNodeId}`);
    }
    for (const relation of frame.relations) {
        const source = nodes.get(relation.sourceFrameNodeId);
        const target = nodes.get(relation.targetFrameNodeId);
        if (!source || !target) {
            errors.push('relation_node_missing');
            continue;
        }
        try {
            relationConstraintRegistry.validate(source.dimension, relation.relationType, target.dimension);
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : 'invalid_memory_frame_relation');
        }
        if (!relation.evidenceEventIds.length && !options.allowEmptyEvidence)
            errors.push('relation_evidence_required');
        if (!relation.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push('relation_evidence_not_in_frame');
        if (relation.validFrom !== undefined && relation.validTo !== undefined && relation.validFrom > relation.validTo)
            errors.push('relation_invalid_valid_range');
    }
    for (const reference of frame.temporalReferences) {
        if (!reference.label.trim() || !Number.isFinite(reference.confidence) || reference.confidence < 0 || reference.confidence > 1 || !reference.evidenceEventIds.length)
            errors.push('invalid_temporal_reference');
        if (reference.occurredAt !== undefined && !Number.isFinite(reference.occurredAt))
            errors.push('invalid_temporal_reference_time');
        if (!reference.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push('temporal_reference_evidence_not_in_frame');
    }
    for (const transition of frame.stateTransitions) {
        if (!nodes.has(transition.subjectFrameNodeId))
            errors.push('state_transition_node_missing');
        if (!transition.to.trim() || !Number.isFinite(transition.confidence) || transition.confidence < 0 || transition.confidence > 1 || !transition.evidenceEventIds.length)
            errors.push('invalid_state_transition');
        if (!transition.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push('state_transition_evidence_not_in_frame');
    }
    return { valid: errors.length === 0, errors, frame: errors.length === 0 ? frame : undefined };
}
