import { dreamLedgerProjectKey } from '../store/DreamLedgerStore.js';
import { V0_5_BASELINE_TABLES } from '../migrations/0001_init.js';
const SHARED_CANONICAL = new Set(['entities', 'entity_alias_conflicts', 'entity_aliases', 'entity_attributes', 'entity_instances', 'entity_mentions', 'entity_relations', 'pending_entity_resolution']);
const OPERATIONAL_NON_PERSONAL = new Set(['background_jobs', 'policy_projection_state', 'projection_observability_rollups', 'projection_observability_samples', 'runtime_projection_state', 'vector_projection_state']);
export const PRIVACY_BASELINE_CLASSIFICATION = Object.freeze(Object.fromEntries(V0_5_BASELINE_TABLES.map((table) => [table, SHARED_CANONICAL.has(table) ? 'shared_canonical' : OPERATIONAL_NON_PERSONAL.has(table) ? 'operational_non_personal' : 'project_owned'])));
/** Child-first registry for user-derived content outside canonical neurons/events. */
export function deleteRegisteredProjectContent(context) {
    const { scope, neuronIds, runDelete } = context;
    const audit = {};
    const remove = (name, sql, params = [scope]) => {
        audit[name] = runDelete(sql, params);
    };
    remove('topology_identity_quarantine', `DELETE FROM topology_identity_quarantine
    WHERE project_scope = ?
       OR EXISTS (SELECT 1 FROM json_each(COALESCE(implicated_scopes_json, '[]')) WHERE value = ?)
       OR json_extract(entry_json, '$.neuron_id') IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?)
       OR json_extract(entry_json, '$.fact_id') IN (SELECT fact_id FROM facts WHERE neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?))
       OR json_extract(entry_json, '$.event_id') IN (SELECT event_id FROM compiled_events WHERE neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?))
       OR json_extract(entry_json, '$.belief_id') IN (SELECT id FROM beliefs WHERE COALESCE(project_id, '') = ?)`, [scope, scope, scope, scope, scope, scope]);
    remove('belief_evidence', `DELETE FROM belief_evidence
    WHERE belief_id IN (
      SELECT id FROM beliefs
      WHERE COALESCE(project_id, '') = ?
         OR source_neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?)
         OR source_event_id IN (SELECT event_id FROM memory_events WHERE COALESCE(project_id, '') = ?)
    )
       OR neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?)
       OR event_id IN (SELECT event_id FROM memory_events WHERE COALESCE(project_id, '') = ?)`, [scope, scope, scope, scope, scope]);
    remove('beliefs', `DELETE FROM beliefs
    WHERE COALESCE(project_id, '') = ?
       OR source_neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?)
       OR source_event_id IN (SELECT event_id FROM memory_events WHERE COALESCE(project_id, '') = ?)`, [scope, scope, scope]);
    remove('topic_operations', `DELETE FROM topic_operations WHERE COALESCE(project_id, '') = ?`);
    remove('topic_relations', `DELETE FROM topic_relations WHERE COALESCE(project_id, '') = ?`);
    remove('topic_aliases', `DELETE FROM topic_aliases WHERE COALESCE(project_id, '') = ?`);
    remove('topic_nodes', `DELETE FROM topic_nodes WHERE COALESCE(project_id, '') = ?`);
    remove('episode_cross_refs', `DELETE FROM episode_cross_refs WHERE COALESCE(project_id, '') = ?`);
    remove('episode_repair_audit', `DELETE FROM episode_repair_audit WHERE COALESCE(project_id, '') = ?`);
    remove('chat_turns', `DELETE FROM chat_turns WHERE session_id IN
    (SELECT session_id FROM chat_sessions WHERE COALESCE(project_id, '') = ?)`);
    remove('chat_sessions', `DELETE FROM chat_sessions WHERE COALESCE(project_id, '') = ?`);
    remove('deep_write_candidate_reviews', `DELETE FROM deep_write_candidate_reviews
    WHERE COALESCE(project_id, '') = ? OR candidate_id IN (
      SELECT c.candidate_id FROM deep_write_candidates c
      JOIN deep_write_runs r ON r.run_id=c.run_id
      WHERE COALESCE(r.project_id, '') = ?
    )`, [scope, scope]);
    remove('deep_write_candidates', `DELETE FROM deep_write_candidates
    WHERE run_id IN (SELECT run_id FROM deep_write_runs WHERE COALESCE(project_id, '') = ?)`);
    remove('deep_write_runs', `DELETE FROM deep_write_runs WHERE COALESCE(project_id, '') = ?`);
    remove('deep_write_summaries', `DELETE FROM deep_write_summaries WHERE COALESCE(project_id, '') = ?`);
    remove('pipeline_nonfatal_events', `DELETE FROM pipeline_nonfatal_events WHERE COALESCE(project_id, '') = ?`);
    remove('memory_frame_reviews', `DELETE FROM memory_frame_reviews WHERE COALESCE(project_id, '') = ?`);
    remove('memory_atlas_alias_supports', `DELETE FROM memory_atlas_alias_supports WHERE COALESCE(project_id, '') = ?`);
    remove('memory_frame_relations', `DELETE FROM memory_frame_relations WHERE frame_id IN
    (SELECT frame_id FROM memory_frames WHERE COALESCE(project_id, '') = ?)`);
    remove('memory_frame_nodes', `DELETE FROM memory_frame_nodes WHERE frame_id IN
    (SELECT frame_id FROM memory_frames WHERE COALESCE(project_id, '') = ?)`);
    remove('reasoning_steps', `DELETE FROM reasoning_steps WHERE chain_id IN
    (SELECT id FROM reasoning_chains WHERE COALESCE(project_id, '') = ?)`);
    remove('reasoning_chains', `DELETE FROM reasoning_chains WHERE COALESCE(project_id, '') = ?`);
    remove('episode_dream_attempts', `DELETE FROM episode_dream_attempts WHERE episode_id IN
    (SELECT episode_id FROM memory_episodes WHERE COALESCE(project_id, '') = ?)`);
    remove('episode_dream_jobs', `DELETE FROM episode_dream_jobs WHERE COALESCE(project_id, '') = ?`);
    remove('dream_ledger_state', `DELETE FROM dream_ledger_state WHERE project_key = ?`, [dreamLedgerProjectKey(scope)]);
    if (neuronIds.length > 0) {
        const placeholders = neuronIds.map(() => '?').join(', ');
        audit.reasoning_steps_by_neuron = runDelete(`DELETE FROM reasoning_steps WHERE neuron_id IN (${placeholders})`, neuronIds);
        audit.vector_write_outbox = runDelete(`DELETE FROM vector_write_outbox WHERE neuron_id IN (${placeholders})`, neuronIds);
    }
    return audit;
}
