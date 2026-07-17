import { relationConstraintRegistry } from './RelationConstraintRegistry.js';
import { isMemoryFrame, MEMORY_DIMENSIONS, MEMORY_FRAME_LIMITS, MEMORY_FRAME_REQUIRED_DIMENSIONS } from './MemoryFrameSchema.js';
export function validateMemoryFrame(value, options = {}) {
    if (!isMemoryFrame(value))
        return { valid: false, errors: ['invalid_memory_frame_shape'] };
    const frame = value;
    const errors = [];
    const malformedNode = frame.nodes.some((node) => {
        const hint = node.canonicalHint;
        const malformedHint = hint !== undefined && (typeof hint !== 'object' || hint === null || Array.isArray(hint)
            || (hint.nodeId !== undefined && typeof hint.nodeId !== 'string')
            || (hint.canonicalLabel !== undefined && typeof hint.canonicalLabel !== 'string')
            || (hint.nodeId !== undefined && (!hint.nodeId.trim() || hint.nodeId.length > MEMORY_FRAME_LIMITS.id))
            || (hint.canonicalLabel !== undefined && hint.canonicalLabel.length > MEMORY_FRAME_LIMITS.text)
            || (hint.confidence !== undefined && (typeof hint.confidence !== 'number' || !Number.isFinite(hint.confidence) || hint.confidence < 0 || hint.confidence > 1)));
        return typeof node.frameNodeId !== 'string' || typeof node.dimension !== 'string' || typeof node.label !== 'string'
            || (node.description !== undefined && typeof node.description !== 'string')
            || (node.aliases !== undefined && (!Array.isArray(node.aliases) || node.aliases.some((alias) => typeof alias !== 'string')))
            || malformedHint || !Array.isArray(node.evidenceEventIds);
    });
    const malformedRelation = frame.relations.some((relation) => typeof relation.sourceFrameNodeId !== 'string' || typeof relation.targetFrameNodeId !== 'string' || typeof relation.relationType !== 'string' || !Array.isArray(relation.evidenceEventIds) || (relation.validFrom !== undefined && typeof relation.validFrom !== 'number') || (relation.validTo !== undefined && typeof relation.validTo !== 'number'));
    const malformedTime = frame.temporalReferences.some((reference) => typeof reference.label !== 'string' || !Array.isArray(reference.evidenceEventIds));
    const malformedState = frame.stateTransitions.some((transition) => typeof transition.subjectFrameNodeId !== 'string' || typeof transition.to !== 'string' || (transition.from !== undefined && typeof transition.from !== 'string') || !Array.isArray(transition.evidenceEventIds));
    if (malformedNode || malformedRelation || malformedTime || malformedState)
        return { valid: false, errors: ['invalid_memory_frame_nested_shape'] };
    const limits = MEMORY_FRAME_LIMITS;
    const idLimit = limits.id;
    const invalidEvidence = (ids) => ids.length > limits.evidence || ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > idLimit);
    const episodeKinds = new Set(['discussion', 'operation', 'decision', 'correction', 'diagnostic', 'planning', 'status_update', 'preference', 'other']);
    const statuses = new Set(['staged', 'active', 'needs_confirmation', 'superseded', 'failed']);
    const publishStatuses = new Set(['active', 'needs_confirmation']);
    if (!episodeKinds.has(frame.episodeKind))
        errors.push('invalid_episode_kind');
    if (frame.status !== undefined && !statuses.has(frame.status))
        errors.push('invalid_frame_status');
    if (frame.publishStatus !== undefined && !publishStatuses.has(frame.publishStatus))
        errors.push('invalid_publish_status');
    if (frame.needsReview !== undefined && typeof frame.needsReview !== 'boolean')
        errors.push('invalid_needs_review');
    if (frame.primaryLanguage !== undefined && (typeof frame.primaryLanguage !== 'string' || frame.primaryLanguage.length > limits.language))
        errors.push('invalid_primary_language');
    if (frame.nodes.length === 0)
        errors.push('frame_nodes_required');
    if (frame.nodes.length > limits.nodes)
        errors.push('frame_nodes_limit_exceeded');
    if (frame.relations.length > limits.relations)
        errors.push('frame_relations_limit_exceeded');
    if (frame.temporalReferences.length > limits.temporalReferences)
        errors.push('frame_temporal_references_limit_exceeded');
    if (frame.stateTransitions.length > limits.stateTransitions)
        errors.push('frame_state_transitions_limit_exceeded');
    if (!frame.frameId.trim() || !frame.projectId.trim() || !frame.episodeId.trim() || frame.frameId.length > idLimit || frame.projectId.length > idLimit || frame.episodeId.length > idLimit)
        errors.push('empty_frame_identity');
    if (!frame.processor || typeof frame.processor.promptVersion !== 'string' || !frame.processor.promptVersion.trim() || frame.processor.promptVersion.length > idLimit || !Number.isFinite(frame.processor.generatedAt) || (frame.processor.provider !== undefined && (typeof frame.processor.provider !== 'string' || frame.processor.provider.length > idLimit)) || (frame.processor.model !== undefined && (typeof frame.processor.model !== 'string' || frame.processor.model.length > idLimit)))
        errors.push('invalid_processor_metadata');
    const evidence = new Set(frame.evidenceEventIds);
    const dimensions = new Set(MEMORY_DIMENSIONS);
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
    if (invalidEvidence(frame.evidenceEventIds))
        errors.push('frame_evidence_limit_exceeded');
    if (frame.title.length > limits.text || frame.summary.length > limits.text)
        errors.push('frame_text_limit_exceeded');
    if (!Number.isFinite(frame.confidence) || frame.confidence < 0 || frame.confidence > 1)
        errors.push('invalid_frame_confidence');
    const nodes = new Map(frame.nodes.map((node) => [node.frameNodeId, node]));
    if (nodes.size !== frame.nodes.length)
        errors.push('duplicate_frame_node_id');
    for (const dimension of MEMORY_FRAME_REQUIRED_DIMENSIONS) {
        if (!frame.nodes.some((node) => node.dimension === dimension && node.label.trim()))
            errors.push(`${dimension}_node_required`);
    }
    for (const node of frame.nodes) {
        if (typeof node.frameNodeId !== 'string' || !node.frameNodeId.trim() || node.frameNodeId.length > idLimit || typeof node.label !== 'string' || !Array.isArray(node.evidenceEventIds)) {
            errors.push('invalid_frame_node_shape');
            continue;
        }
        if (!node.label.trim())
            errors.push(`empty_frame_node_label:${node.frameNodeId}`);
        if (node.label.length > limits.text || String(node.dimension).length > limits.dimension)
            errors.push(`frame_node_text_limit_exceeded:${node.frameNodeId}`);
        if (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1)
            errors.push(`invalid_node_confidence:${node.frameNodeId}`);
        if ((!node.evidenceEventIds.length && !options.allowEmptyEvidence) || invalidEvidence(node.evidenceEventIds))
            errors.push(`node_evidence_required:${node.frameNodeId}`);
        if (!node.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push(`node_evidence_not_in_frame:${node.frameNodeId}`);
        if (node.description !== undefined && node.description.length > limits.text)
            errors.push(`node_description_limit_exceeded:${node.frameNodeId}`);
        if (node.aliases !== undefined && (!Array.isArray(node.aliases) || node.aliases.length > limits.aliases || node.aliases.some((alias) => typeof alias !== 'string' || alias.length > limits.alias)))
            errors.push(`invalid_node_aliases:${node.frameNodeId}`);
        if (Array.isArray(node.aliases) && node.aliases.some((alias) => !alias.trim()))
            errors.push(`empty_node_alias:${node.frameNodeId}`);
        if (node.canonicalHint?.nodeId && !['episode', 'project', 'raw_event'].includes(node.dimension))
            errors.push(`mutable_identity_hint_not_allowed:${node.frameNodeId}`);
        if (node.canonicalHint?.nodeId && ['episode', 'project', 'raw_event'].includes(node.dimension)) {
            const expected = node.dimension === 'episode'
                ? `episode:${frame.episodeId}`
                : node.dimension === 'project'
                    ? `project:${frame.projectId}`
                    : node.evidenceEventIds.length === 1 ? `raw_event:${node.evidenceEventIds[0]}` : undefined;
            if (!expected || node.canonicalHint.nodeId !== expected)
                errors.push(`immutable_identity_hint_mismatch:${node.frameNodeId}`);
        }
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
        if (!relation.sourceFrameNodeId.trim() || !relation.targetFrameNodeId.trim() || !relation.relationType.trim() || relation.sourceFrameNodeId.length > idLimit || relation.targetFrameNodeId.length > idLimit || relation.relationType.length > idLimit)
            errors.push('invalid_relation_identity');
        if (!Number.isFinite(relation.confidence) || relation.confidence < 0 || relation.confidence > 1)
            errors.push('invalid_relation_confidence');
        if (!Array.isArray(relation.evidenceEventIds) || (!relation.evidenceEventIds.length && !options.allowEmptyEvidence) || invalidEvidence(relation.evidenceEventIds))
            errors.push('relation_evidence_required');
        if (Array.isArray(relation.evidenceEventIds) && !relation.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push('relation_evidence_not_in_frame');
        if ((relation.validFrom !== undefined && !Number.isFinite(relation.validFrom)) || (relation.validTo !== undefined && !Number.isFinite(relation.validTo)))
            errors.push('relation_invalid_time');
        if (relation.validFrom !== undefined && relation.validTo !== undefined && relation.validFrom > relation.validTo)
            errors.push('relation_invalid_valid_range');
    }
    for (const node of frame.nodes)
        if (node.dimension === 'raw_event' && node.evidenceEventIds.length !== 1)
            errors.push(`raw_event_identity_requires_one_evidence:${node.frameNodeId}`);
    for (const reference of frame.temporalReferences) {
        if (typeof reference.label !== 'string' || !Array.isArray(reference.evidenceEventIds) || !reference.label.trim() || reference.label.length > limits.text || !Number.isFinite(reference.confidence) || reference.confidence < 0 || reference.confidence > 1 || (!reference.evidenceEventIds.length && !options.allowEmptyEvidence) || invalidEvidence(reference.evidenceEventIds))
            errors.push('invalid_temporal_reference');
        if (reference.occurredAt !== undefined && !Number.isFinite(reference.occurredAt))
            errors.push('invalid_temporal_reference_time');
        if (Array.isArray(reference.evidenceEventIds) && !reference.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push('temporal_reference_evidence_not_in_frame');
    }
    for (const transition of frame.stateTransitions) {
        if (typeof transition.subjectFrameNodeId !== 'string' || !nodes.has(transition.subjectFrameNodeId))
            errors.push('state_transition_node_missing');
        if (typeof transition.to !== 'string' || (transition.from !== undefined && typeof transition.from !== 'string') || !Array.isArray(transition.evidenceEventIds) || !transition.to.trim() || transition.to.length > limits.text || (transition.from !== undefined && (!transition.from.trim() || transition.from.length > limits.text)) || !Number.isFinite(transition.confidence) || transition.confidence < 0 || transition.confidence > 1 || (!transition.evidenceEventIds.length && !options.allowEmptyEvidence) || invalidEvidence(transition.evidenceEventIds))
            errors.push('invalid_state_transition');
        if (Array.isArray(transition.evidenceEventIds) && !transition.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push('state_transition_evidence_not_in_frame');
    }
    return { valid: errors.length === 0, errors, frame: errors.length === 0 ? frame : undefined };
}
