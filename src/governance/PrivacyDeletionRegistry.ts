import { dreamLedgerProjectKey } from '../store/DreamLedgerStore.js';

export interface PrivacyDeletionContext {
  scope: string;
  neuronIds: string[];
  runDelete(sql: string, params?: Array<string | number>): number;
}

export type PrivacyDeletionAudit = Record<string, number>;

/** Child-first registry for user-derived content outside canonical neurons/events. */
export function deleteRegisteredProjectContent(context: PrivacyDeletionContext): PrivacyDeletionAudit {
  const { scope, neuronIds, runDelete } = context;
  const audit: PrivacyDeletionAudit = {};
  const remove = (name: string, sql: string, params: Array<string | number> = [scope]): void => {
    audit[name] = runDelete(sql, params);
  };

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
    (SELECT episode_id FROM episodes WHERE COALESCE(project_id, '') = ?)`);
  remove('episode_dream_jobs', `DELETE FROM episode_dream_jobs WHERE COALESCE(project_id, '') = ?`);
  remove('dream_ledger_state', `DELETE FROM dream_ledger_state WHERE project_key = ?`, [dreamLedgerProjectKey(scope)]);
  remove('topology_identity_quarantine', `DELETE FROM topology_identity_quarantine WHERE project_scope = ?`);

  if (neuronIds.length > 0) {
    const placeholders = neuronIds.map(() => '?').join(', ');
    audit.reasoning_steps_by_neuron = runDelete(`DELETE FROM reasoning_steps WHERE neuron_id IN (${placeholders})`, neuronIds);
    audit.vector_write_outbox = runDelete(`DELETE FROM vector_write_outbox WHERE neuron_id IN (${placeholders})`, neuronIds);
  }
  return audit;
}
