import { dreamLedgerProjectKey } from '../store/DreamLedgerStore.js';
import { V0_5_BASELINE_TABLES } from '../migrations/0001_init.js';

export type PrivacyTableClassification = 'project_owned' | 'provenance_owned' | 'shared_canonical' | 'operational_non_personal' | 'immutable_audit';

function explicitClassification(
  tables: readonly string[],
  groups: Readonly<Record<PrivacyTableClassification, readonly string[]>>,
): Readonly<Record<string, PrivacyTableClassification>> {
  const expected = new Set(tables);
  const result: Record<string, PrivacyTableClassification> = {};
  for (const [classification, names] of Object.entries(groups) as Array<[PrivacyTableClassification, readonly string[]]>) {
    for (const name of names) {
      if (!expected.has(name)) throw new Error(`privacy_schema_classification_extra:${name}`);
      if (result[name]) throw new Error(`privacy_schema_classification_duplicate:${name}`);
      result[name] = classification;
    }
  }
  const missing = tables.filter((table) => !result[table]);
  if (missing.length > 0) throw new Error(`privacy_schema_classification_missing:${missing.join(',')}`);
  return Object.freeze(result);
}

const BASELINE_PROJECT_OWNED = [
  'anchors','beliefs','branch_entries','branch_links','cognitive_edges','cognitive_nodes','compiler_confidence_runs',
  'event_cluster_entries','event_clusters','ingestion_source_cursors','memory_events','neurons','project_branches',
  'reasoning_chains','task_branch_entries','task_branches','temporal_adjacency','time_bucket_entries','time_buckets',
  'topology_membership','trace_events','user_session_scopes','user_sessions',
] as const;
const BASELINE_PROVENANCE_OWNED = [
  'agent_approval_queue','agent_task_records','belief_evidence','compiled_events','fact_access_log','fact_supersede_chain',
  'facts','graph_signals','ingestion_processed_records','interaction_units','meta_proposals','pending_bindings',
  'plasticity_graph_edge_audit','plasticity_graph_edges','plasticity_proposal_review_decisions','plasticity_proposals',
  'policy_executions','reasoning_steps','runtime_states','runtime_transitions','sandbox_snapshots','synapses',
] as const;
const BASELINE_SHARED_CANONICAL = [
  'entities','entity_alias_conflicts','entity_aliases','entity_attributes','entity_instances','entity_mentions',
  'entity_relations','pending_entity_resolution',
] as const;
const BASELINE_OPERATIONAL_NON_PERSONAL = [
  'background_jobs','policy_projection_state','projection_observability_rollups','projection_observability_samples',
  'runtime_projection_state','vector_projection_state',
] as const;
export const PRIVACY_BASELINE_CLASSIFICATION = explicitClassification(V0_5_BASELINE_TABLES, {
  project_owned: BASELINE_PROJECT_OWNED,
  provenance_owned: BASELINE_PROVENANCE_OWNED,
  shared_canonical: BASELINE_SHARED_CANONICAL,
  operational_non_personal: BASELINE_OPERATIONAL_NON_PERSONAL,
  immutable_audit: [],
});

const MIGRATION_TABLES = [
  '_episode_integrity_markers','_memory_frame_integrity_markers','_meta','_schema_migrations','agent_brain_health_checks','archived_sessions',
  'belief_graph_conflicts','belief_graph_evidence','belief_graph_nodes','belief_graph_versions','context_activation_receipts','context_strategy_outcomes',
  'chat_sessions','chat_turns','deep_write_candidate_reviews','deep_write_candidates','deep_write_runs','deep_write_summaries','dream_ledger_state','entity_merge_candidates','entity_resolution_log','event_sequence_counters',
  'episode_boundary_decisions','episode_closure_receipts','episode_cross_refs','episode_dream_attempts','episode_dream_jobs','episode_dream_runs','episode_event_dispositions','episode_ingest_keys','episode_repair_audit',
  'governance_audit_log','import_source_anchors','memory_action_frame_evidence','memory_action_frames','memory_atlas_access','memory_atlas_activation','memory_atlas_alias_ambiguities',
  'memory_atlas_alias_supports','memory_atlas_aliases','memory_atlas_documents','memory_atlas_projection_state','memory_atlas_supports','memory_bindings','memory_clusters','memory_edges','memory_entities',
  'memory_episode_events','memory_episodes','memory_frame_nodes','memory_frame_relations','memory_frame_reviews','memory_frames','memory_governance_audit','memory_governance_operations',
  'memory_governance_plans','memory_timeline_entries','memory_topics','migration_repair_receipts','neuron_embeddings','pipeline_checkpoints','pipeline_nonfatal_events','pipeline_runs','pipeline_step_timings',
  'prospective_memories','prospective_memory_transitions','re_embedding_progress','scheduled_job_runs','scheduled_jobs','notification_records','notification_rules','workspace_settings','workspaces','meta_observations',
  'task_identity_restoration_manifest','task_identity_recovery_quarantine','pending_entity_resolution_quarantine','policy_execution_quarantine','policy_execution_legacy_tombstones','project_isolation_compensation_audit','topic_aliases','topic_nodes','topic_operations','topic_relations','topology_identity_quarantine','topology_projection_state','topology_source_revisions',
  'topology_time_rebuild_active_neurons','topology_time_rebuild_adjacency','topology_time_rebuild_buckets','topology_time_rebuild_cognitive_edges','topology_time_rebuild_cognitive_nodes',
  'topology_time_rebuild_entries','topology_time_rebuild_jobs','user_session_runtime','vector_index','vector_write_outbox','web_session_tokens','working_memory_deltas','memory_activation',
  'file_assets','file_blocks','file_chunks','file_chunk_edges','user_insights',
  'policy_execution_read_model','policy_execution_audit_outbox','runtime_event_outbox','runtime_projection_states','runtime_projection_transitions',
] as const;
const MIGRATION_PROJECT_OWNED = [
  'archived_sessions','belief_graph_conflicts','belief_graph_nodes','context_activation_receipts','context_strategy_outcomes',
  'chat_sessions','deep_write_candidate_reviews','deep_write_runs','deep_write_summaries','dream_ledger_state',
  'entity_merge_candidates','episode_boundary_decisions','episode_closure_receipts','episode_cross_refs','episode_dream_jobs',
  'episode_dream_runs','episode_event_dispositions','episode_ingest_keys','episode_repair_audit','import_source_anchors',
  'memory_action_frame_evidence','memory_action_frames','memory_atlas_access','memory_atlas_activation',
  'memory_atlas_alias_ambiguities','memory_atlas_alias_supports','memory_atlas_aliases','memory_atlas_documents',
  'memory_atlas_projection_state','memory_atlas_supports','memory_bindings','memory_clusters','memory_edges','memory_entities',
  'memory_episodes','memory_frame_reviews','memory_frames','memory_governance_audit','memory_governance_operations',
  'memory_governance_plans','memory_timeline_entries','memory_topics','neuron_embeddings','pipeline_checkpoints',
  'pipeline_nonfatal_events','prospective_memories','re_embedding_progress','task_identity_restoration_manifest','task_identity_recovery_quarantine','topic_aliases','topic_nodes','topic_operations','topic_relations',
  'topology_projection_state','topology_source_revisions','topology_time_rebuild_active_neurons',
  'topology_time_rebuild_adjacency','topology_time_rebuild_buckets','topology_time_rebuild_cognitive_edges',
  'topology_time_rebuild_cognitive_nodes','topology_time_rebuild_entries','topology_time_rebuild_jobs','user_session_runtime',
  'web_session_tokens','working_memory_deltas','memory_activation',
  'file_assets','user_insights',
  'policy_execution_read_model','policy_execution_audit_outbox',
] as const;
const MIGRATION_PROVENANCE_OWNED = [
  'belief_graph_evidence','belief_graph_versions','chat_turns','deep_write_candidates','entity_resolution_log',
  'episode_dream_attempts','memory_episode_events','memory_frame_nodes','memory_frame_relations',
  'prospective_memory_transitions','scheduled_job_runs','scheduled_jobs','notification_records','notification_rules',
  'workspace_settings','workspaces','meta_observations','pending_entity_resolution_quarantine','topology_identity_quarantine','vector_index','vector_write_outbox',
  'file_blocks','file_chunks','file_chunk_edges',
  'runtime_event_outbox','runtime_projection_states','runtime_projection_transitions',
] as const;
const MIGRATION_OPERATIONAL_NON_PERSONAL = [
  '_episode_integrity_markers','_memory_frame_integrity_markers','_meta','agent_brain_health_checks','pipeline_runs',
  'pipeline_step_timings','policy_execution_quarantine','policy_execution_legacy_tombstones','project_isolation_compensation_audit','event_sequence_counters',
] as const;
const MIGRATION_IMMUTABLE_AUDIT = ['_schema_migrations','migration_repair_receipts','governance_audit_log'] as const;
const MIGRATION_CLASSIFICATION = explicitClassification(MIGRATION_TABLES, {
  project_owned: MIGRATION_PROJECT_OWNED,
  provenance_owned: MIGRATION_PROVENANCE_OWNED,
  shared_canonical: [],
  operational_non_personal: MIGRATION_OPERATIONAL_NON_PERSONAL,
  immutable_audit: MIGRATION_IMMUTABLE_AUDIT,
});
export const PRIVACY_SCHEMA_CLASSIFICATION: Readonly<Record<string, PrivacyTableClassification>> = Object.freeze({
  ...PRIVACY_BASELINE_CLASSIFICATION,
  ...MIGRATION_CLASSIFICATION,
} as Record<string, PrivacyTableClassification>);

export interface PrivacyDeletionContext {
  scope: string;
  neuronIds: string[];
  listPersistentTables(): string[];
  hasColumn(table: string, column: string): boolean;
  runDelete(sql: string, params?: Array<string | number>): number;
}

export type PrivacyDeletionAudit = Record<string, number>;

/** Child-first registry for user-derived content outside canonical neurons/events. */
export function deleteRegisteredProjectContent(context: PrivacyDeletionContext): PrivacyDeletionAudit {
  const { scope, neuronIds, runDelete } = context;
  const persistentTables = new Set(context.listPersistentTables());
  assertPrivacySchemaClassified([...persistentTables]);
  const audit: PrivacyDeletionAudit = {};
  const remove = (name: string, sql: string, params: Array<string | number> = [scope]): void => {
    audit[name] = runDelete(sql, params);
  };

  if (persistentTables.has('file_assets')) {
    if (persistentTables.has('file_chunk_edges') && persistentTables.has('file_chunks')) {
      remove('file_chunk_edges', `DELETE FROM file_chunk_edges WHERE source_chunk_id IN (
        SELECT chunk_id FROM file_chunks WHERE asset_id IN (SELECT asset_id FROM file_assets WHERE COALESCE(project_id,'')=?)
      ) OR target_chunk_id IN (
        SELECT chunk_id FROM file_chunks WHERE asset_id IN (SELECT asset_id FROM file_assets WHERE COALESCE(project_id,'')=?)
      )`, [scope, scope]);
    }
    if (persistentTables.has('file_chunks')) remove('file_chunks', `DELETE FROM file_chunks
      WHERE asset_id IN (SELECT asset_id FROM file_assets WHERE COALESCE(project_id,'')=?)
         OR neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id,'')=?)`, [scope, scope]);
    if (persistentTables.has('file_blocks')) remove('file_blocks', `DELETE FROM file_blocks
      WHERE asset_id IN (SELECT asset_id FROM file_assets WHERE COALESCE(project_id,'')=?)`);
    remove('file_assets', `DELETE FROM file_assets WHERE COALESCE(project_id,'')=?`);
  }
  if (persistentTables.has('user_insights')) remove('user_insights', `DELETE FROM user_insights
    WHERE COALESCE(project_id,'')=?
       OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(evidence_neuron_ids) THEN evidence_neuron_ids ELSE '[]' END)
         WHERE value IN (SELECT id FROM neurons WHERE COALESCE(project_id,'')=?))`, [scope, scope]);

  remove('topology_identity_quarantine', `DELETE FROM topology_identity_quarantine
    WHERE project_scope = ?
       OR EXISTS (SELECT 1 FROM json_each(COALESCE(implicated_scopes_json, '[]')) WHERE value = ?)
       OR json_extract(entry_json, '$.neuron_id') IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?)
       OR json_extract(entry_json, '$.fact_id') IN (SELECT fact_id FROM facts WHERE neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?))
       OR json_extract(entry_json, '$.event_id') IN (SELECT event_id FROM compiled_events WHERE neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?))
       OR json_extract(entry_json, '$.belief_id') IN (SELECT id FROM beliefs WHERE COALESCE(project_id, '') = ?)`,
    [scope, scope, scope, scope, scope, scope]);

  remove('belief_evidence', `DELETE FROM belief_evidence
    WHERE belief_id IN (
      SELECT id FROM beliefs
      WHERE COALESCE(project_id, '') = ?
         OR source_neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?)
         OR source_event_id IN (SELECT event_id FROM memory_events WHERE COALESCE(project_id, '') = ?)
    )
       OR neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?)
       OR event_id IN (SELECT event_id FROM memory_events WHERE COALESCE(project_id, '') = ?)`,
    [scope, scope, scope, scope, scope]);
  remove('beliefs', `DELETE FROM beliefs
    WHERE COALESCE(project_id, '') = ?
       OR source_neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id, '') = ?)
       OR source_event_id IN (SELECT event_id FROM memory_events WHERE COALESCE(project_id, '') = ?)`,
    [scope, scope, scope]);

  remove('topic_operations', `DELETE FROM topic_operations WHERE COALESCE(project_id, '') = ?`);
  remove('topic_relations', `DELETE FROM topic_relations WHERE COALESCE(project_id, '') = ?`);
  remove('topic_aliases', `DELETE FROM topic_aliases WHERE COALESCE(project_id, '') = ?`);
  remove('topic_nodes', `DELETE FROM topic_nodes WHERE COALESCE(project_id, '') = ?`);
  remove('episode_cross_refs', `DELETE FROM episode_cross_refs WHERE COALESCE(project_id, '') = ?`);
  remove('episode_repair_audit', `DELETE FROM episode_repair_audit WHERE COALESCE(project_id, '') = ?`);
  remove('chat_turns', `DELETE FROM chat_turns WHERE session_id IN
    (SELECT session_id FROM chat_sessions WHERE COALESCE(project_id, '') = ?)`);
  remove('chat_sessions', `DELETE FROM chat_sessions WHERE COALESCE(project_id, '') = ?`);

  if (persistentTables.has('meta_observations')) {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (context.hasColumn('meta_observations', 'project_id')) { clauses.push(`COALESCE(project_id,'')=?`); params.push(scope); }
    if (context.hasColumn('meta_observations', 'neuron_id')) { clauses.push(`neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id,'')=?)`); params.push(scope); }
    if (context.hasColumn('meta_observations', 'fact_id')) { clauses.push(`fact_id IN (SELECT fact_id FROM facts WHERE neuron_id IN (SELECT id FROM neurons WHERE COALESCE(project_id,'')=?))`); params.push(scope); }
    if (context.hasColumn('meta_observations', 'evidence_event_ids')) {
      const sources = [
        `SELECT event_id AS id FROM memory_events WHERE COALESCE(project_id,'')=?`,
        ...(persistentTables.has('trace_events') ? [`SELECT id FROM trace_events WHERE COALESCE(project_id,'')=?`] : []),
      ];
      clauses.push(`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(evidence_event_ids) THEN evidence_event_ids ELSE '[]' END) evidence WHERE evidence.value IN (${sources.join(' UNION ALL ')}))`);
      params.push(scope);
      if (persistentTables.has('trace_events')) params.push(scope);
    }
    if (clauses.length > 0) remove('meta_observations', `DELETE FROM meta_observations WHERE ${clauses.join(' OR ')}`, params);
  }
  remove('scheduled_job_runs', `DELETE FROM scheduled_job_runs WHERE job_id IN (SELECT job_id FROM scheduled_jobs WHERE json_extract(payload_json,'$.projectId')=?)`);
  remove('scheduled_jobs', `DELETE FROM scheduled_jobs WHERE json_extract(payload_json,'$.projectId')=?`);
  remove('notification_records', `DELETE FROM notification_records WHERE rule_id IN (SELECT rule_id FROM notification_rules WHERE workspace_id=?) OR json_extract(payload_json,'$.projectId')=?`, [scope, scope]);
  remove('notification_rules', `DELETE FROM notification_rules WHERE workspace_id=? OR json_extract(trigger_json,'$.projectId')=? OR json_extract(channel_config_json,'$.projectId')=?`, [scope, scope, scope]);
  remove('workspaces', `DELETE FROM workspaces WHERE id=? OR json_extract(config_json,'$.projectId')=?`, [scope, scope]);
  if (persistentTables.has('workspace_settings')) remove('workspace_settings', `DELETE FROM workspace_settings
    WHERE key=? OR key LIKE ? OR (json_valid(value) AND json_extract(value,'$.projectId')=?)`, [scope, `project:${scope}:%`, scope]);
  if (persistentTables.has('meta_proposals') && persistentTables.has('trace_events')) remove('meta_proposals', `DELETE FROM meta_proposals
    WHERE EXISTS (
      SELECT 1 FROM json_each(COALESCE(meta_proposals.evidence,'[]')) evidence
      JOIN trace_events trace ON trace.id=json_extract(evidence.value,'$.traceEventId')
      WHERE COALESCE(trace.project_id,'')=?
    )`);
  if (persistentTables.has('ingestion_processed_records')) {
    const placeholders = neuronIds.map(() => '?').join(', ');
    audit.ingestion_processed_records = runDelete(`DELETE FROM ingestion_processed_records
      WHERE ${context.hasColumn('ingestion_processed_records', 'project_scope') ? `project_scope=? OR` : ''}
        ${context.hasColumn('ingestion_processed_records', 'project_id') ? `COALESCE(project_id,'')=? OR` : ''}
        ${neuronIds.length > 0 ? `neuron_id IN (${placeholders})` : '0'}`,
      [
        ...(context.hasColumn('ingestion_processed_records', 'project_scope') ? [scope] : []),
        ...(context.hasColumn('ingestion_processed_records', 'project_id') ? [scope] : []),
        ...neuronIds,
      ]);
  }
  if (persistentTables.has('pending_entity_resolution_quarantine')) {
    const placeholders = neuronIds.map(() => '?').join(', ');
    audit.pending_entity_resolution_quarantine = runDelete(`
      DELETE FROM pending_entity_resolution_quarantine
      WHERE (scope_resolved=1 AND project_scope=?)
        OR EXISTS (SELECT 1 FROM json_each(COALESCE(implicated_scopes_json,'[]')) WHERE value=?)
        ${neuronIds.length > 0 ? `OR (json_valid(record_json) AND json_extract(record_json,'$.context_neuron_id') IN (${placeholders}))` : ''}`,
      [scope, scope, ...neuronIds]);
  }
  if (persistentTables.has('policy_executions') && context.hasColumn('policy_executions', 'project_scope')) {
    remove('policy_executions', `DELETE FROM policy_executions WHERE project_scope=?`);
  }

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
  remove('policy_execution_read_model', `DELETE FROM policy_execution_read_model WHERE project_scope = ?`);
  remove('policy_execution_audit_outbox', `DELETE FROM policy_execution_audit_outbox WHERE project_scope = ?`);
  if (neuronIds.length > 0) {
    const placeholders = neuronIds.map(() => '?').join(', ');
    audit.reasoning_steps_by_neuron = runDelete(`DELETE FROM reasoning_steps WHERE neuron_id IN (${placeholders})`, neuronIds);
    audit.vector_write_outbox = runDelete(`DELETE FROM vector_write_outbox WHERE neuron_id IN (${placeholders})`, neuronIds);
  }
  return audit;
}

/** Final exact-scope sweep for versioned project-owned tables not known to the core deletion order. */
export function deleteResidualProjectOwnedContent(context: PrivacyDeletionContext): PrivacyDeletionAudit {
  const audit: PrivacyDeletionAudit = {};
  for (const table of context.listPersistentTables()) {
    if (table === 'neurons' || table === 'dream_ledger_state' || PRIVACY_SCHEMA_CLASSIFICATION[table] !== 'project_owned') continue;
    if (context.hasColumn(table, 'project_id')) {
      audit[table] = context.runDelete(`DELETE FROM ${table} WHERE COALESCE(project_id,'')=?`, [context.scope]);
    } else if (context.hasColumn(table, 'projectId')) {
      audit[table] = context.runDelete(`DELETE FROM ${table} WHERE projectId=?`, [context.scope]);
    }
  }
  return audit;
}

export function assertPrivacySchemaClassified(tables: string[]): void {
  const unknown = tables.filter((table) => {
    if (PRIVACY_SCHEMA_CLASSIFICATION[table]) return false;
    return !/^(?:neurons|memory_events|memory_atlas|deep_write_summaries)_fts(?:_|$)/.test(table);
  });
  if (unknown.length > 0) throw new Error(`privacy_schema_unclassified:${unknown.sort().join(',')}`);
}
