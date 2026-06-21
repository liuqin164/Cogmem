export const MEMORY_ONTOLOGY_CLASSES = [
    'Time', 'Person', 'Object', 'Place', 'Project', 'Event', 'Decision', 'Goal',
    'Preference', 'Correction', 'Plan', 'Evidence', 'Conversation', 'Topic', 'Entity', 'Relation',
];
export function isMemoryOntologyClass(value) {
    return typeof value === 'string' && MEMORY_ONTOLOGY_CLASSES.includes(value);
}
