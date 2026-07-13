import { relationConstraintRegistry } from './RelationConstraintRegistry.js';
import { isMemoryFrame } from './MemoryFrameSchema.js';
export function validateMemoryFrame(value) {
    if (!isMemoryFrame(value))
        return { valid: false, errors: ['invalid_memory_frame_shape'] };
    const frame = value;
    const errors = [];
    const evidence = new Set(frame.evidenceEventIds);
    if (!Number.isFinite(frame.confidence) || frame.confidence < 0 || frame.confidence > 1)
        errors.push('invalid_frame_confidence');
    const nodes = new Map(frame.nodes.map((node) => [node.frameNodeId, node]));
    for (const node of frame.nodes) {
        if (!node.label.trim())
            errors.push(`empty_frame_node_label:${node.frameNodeId}`);
        if (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1)
            errors.push(`invalid_node_confidence:${node.frameNodeId}`);
        if (!node.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push(`node_evidence_not_in_frame:${node.frameNodeId}`);
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
        if (!relation.evidenceEventIds.every((id) => evidence.has(id)))
            errors.push('relation_evidence_not_in_frame');
    }
    return { valid: errors.length === 0, errors, frame: errors.length === 0 ? frame : undefined };
}
