const CONSTRAINTS = [
    ['actor', 'PARTICIPATED_IN', 'event'], ['actor', 'PERFORMED', 'task'], ['event', 'PART_OF_PROJECT', 'project'],
    ['event', 'PART_OF_EVENT', 'event'], ['event', 'ADDRESSES_ISSUE', 'issue'], ['event', 'OCCURRED_ON', 'time'],
    ['event', 'OCCURRED_IN', 'location'], ['task', 'ADVANCES_TASK', 'event'], ['task', 'HAS_STATE', 'state'],
    ['issue', 'ABOUT_TOPIC', 'topic'], ['topic', 'NARROWER_THAN', 'topic'], ['episode', 'SUPPORTED_BY', 'event'],
    ['event', 'INVOLVES', 'entity'], ['task', 'DEPENDS_ON', 'task'], ['task', 'BLOCKED_BY', 'issue'],
    ['entity', 'HAS_STATE', 'state'], ['event', 'HAS_STATE', 'state'], ['event', 'DERIVED_FROM', 'event'],
    ['episode', 'PART_OF_PROJECT', 'project'], ['episode', 'PART_OF_EVENT', 'event'], ['episode', 'SUPPORTED_BY', 'event'],
];
export class RelationConstraintRegistry {
    isAllowed(source, relation, target) {
        return CONSTRAINTS.some(([s, r, t]) => s === source && r === relation && t === target);
    }
    validate(source, relation, target) {
        if (!this.isAllowed(source, relation, target))
            throw new Error(`invalid_memory_frame_relation:${source}:${relation}:${target}`);
    }
}
export const relationConstraintRegistry = new RelationConstraintRegistry();
