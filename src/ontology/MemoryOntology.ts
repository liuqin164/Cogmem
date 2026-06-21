export const MEMORY_ONTOLOGY_CLASSES = [
  'Time', 'Person', 'Object', 'Place', 'Project', 'Event', 'Decision', 'Goal',
  'Preference', 'Correction', 'Plan', 'Evidence', 'Conversation', 'Topic', 'Entity', 'Relation',
] as const;

export type MemoryOntologyClass = typeof MEMORY_ONTOLOGY_CLASSES[number];

export function isMemoryOntologyClass(value: unknown): value is MemoryOntologyClass {
  return typeof value === 'string' && (MEMORY_ONTOLOGY_CLASSES as readonly string[]).includes(value);
}
