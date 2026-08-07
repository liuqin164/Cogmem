import { FINAL_AUXILIARY_OBJECTS } from './FinalSchemaDefinition.js';
const PROVENANCE_TRIGGER_PREFIXES = [
    'synapses_scope_',
    'belief_evidence_scope_',
    'cognitive_node_source_',
    'reasoning_step_scope_',
    'pending_entity_scope_',
    'memory_binding_scope_',
];
export function installRuntimeProvenanceGuards(db) {
    installFinalTriggers(db, (name) => PROVENANCE_TRIGGER_PREFIXES.some((prefix) => name.startsWith(prefix))
        && provenanceDependenciesPresent(db, name));
}
export function installAtlasProjectionDirtyTriggersV3(db) {
    if (tableExists(db, 'memory_atlas_projection_state')) {
        installFinalTriggers(db, (name) => name.startsWith('trg_memory_atlas_dirty_'));
    }
}
function installFinalTriggers(db, matches) {
    for (const trigger of FINAL_AUXILIARY_OBJECTS) {
        if (trigger.type !== 'trigger' || !matches(trigger.name) || !tableExists(db, trigger.table))
            continue;
        const current = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?
    `).get(trigger.name);
        if (current?.sql && normalizeSql(current.sql) === normalizeSql(trigger.sql))
            continue;
        db.exec(`DROP TRIGGER IF EXISTS "${trigger.name.replaceAll('"', '""')}"`);
        db.exec(trigger.sql);
    }
}
function tableExists(db, name) {
    return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type='table' AND name=?
  `).get(name));
}
function provenanceDependenciesPresent(db, name) {
    const dependencies = name.startsWith('synapses_scope_') ? ['neurons']
        : name.startsWith('belief_evidence_scope_') ? ['beliefs', 'neurons', 'memory_events']
            : name.startsWith('cognitive_node_source_') ? ['neurons']
                : name.startsWith('reasoning_step_scope_') ? ['reasoning_chains', 'neurons']
                    : name.startsWith('pending_entity_scope_') ? ['neurons', 'entity_instances', 'entity_mentions']
                        : ['memory_events', 'memory_topics', 'memory_entities', 'memory_clusters'];
    return dependencies.every((table) => tableExists(db, table));
}
function normalizeSql(value) {
    return value.replace(/\s+/gu, ' ').trim().replace(/;$/u, '').toLowerCase();
}
