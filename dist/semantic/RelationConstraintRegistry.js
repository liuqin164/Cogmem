const CONSTRAINTS = [
    ['actor', 'PARTICIPATED_IN', 'event'], ['actor', 'PARTICIPATED_IN', 'raw_event'], ['actor', 'PERFORMED', 'task'], ['event', 'PART_OF_PROJECT', 'project'],
    ['event', 'PART_OF_EVENT', 'event'], ['event', 'ADDRESSES_ISSUE', 'issue'], ['event', 'OCCURRED_ON', 'time'], ['raw_event', 'OCCURRED_ON', 'time'], ['episode', 'OCCURRED_ON', 'time'],
    ['event', 'OCCURRED_IN', 'location'], ['task', 'ADVANCES_TASK', 'event'], ['event', 'ADVANCES_TASK', 'task'], ['task', 'HAS_STATE', 'state'],
    ['issue', 'ABOUT_TOPIC', 'topic'], ['topic', 'NARROWER_THAN', 'topic'], ['topic', 'BROADER_THAN', 'topic'], ['episode', 'SUPPORTED_BY', 'event'], ['episode', 'SUPPORTED_BY', 'raw_event'],
    ['event', 'INVOLVES', 'entity'], ['event', 'INVOLVES', 'object'], ['task', 'INVOLVES', 'object'], ['object', 'LOCATED_AT', 'location'], ['object', 'HAS_STATE', 'state'], ['task', 'DEPENDS_ON', 'task'], ['task', 'BLOCKED_BY', 'issue'],
    ['entity', 'HAS_STATE', 'state'], ['event', 'HAS_STATE', 'state'], ['event', 'DERIVED_FROM', 'event'], ['event', 'SAME_EVENT', 'event'], ['issue', 'SAME_ISSUE', 'issue'],
    ['episode', 'FOLLOWS_UP', 'episode'], ['episode', 'RELATED_TO', 'episode'], ['episode', 'CORRECTS', 'episode'], ['episode', 'CONTRADICTS', 'episode'], ['episode', 'SUPERSEDES', 'episode'],
    ['event', 'LOCATED_AT', 'location'], ['event', 'CHANGED_FROM', 'state'], ['event', 'CHANGED_TO', 'state'], ['event', 'ABOUT_TOPIC', 'topic'], ['event', 'ADDRESSES_ISSUE', 'issue'],
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
