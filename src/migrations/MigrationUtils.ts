import type Database from 'bun:sqlite';

/**
 * v0.5 baseline tables - used for privacy classification.
 * These are the tables that existed in the v0.5 schema snapshot.
 * 4.0 fresh installs don't have legacy data, but this list is used
 * by PrivacyDeletionRegistry to classify operational tables.
 */
export const V0_5_BASELINE_TABLES = [
  'agent_approval_queue',
  'agent_task_records',
  'anchors',
  'background_jobs',
  'belief_evidence',
  'beliefs',
  'branch_entries',
  'branch_links',
  'cognitive_edges',
  'cognitive_nodes',
  'compiled_events',
  'compiler_confidence_runs',
  'entities',
  'entity_alias_conflicts',
  'entity_aliases',
  'entity_attributes',
  'entity_instances',
  'entity_mentions',
  'entity_relations',
  'event_cluster_entries',
  'event_clusters',
  'fact_access_log',
  'fact_supersede_chain',
  'facts',
  'graph_signals',
  'ingestion_processed_records',
  'ingestion_source_cursors',
  'interaction_units',
  'memory_events',
  'meta_proposals',
  'neurons',
  'pending_bindings',
  'pending_entity_resolution',
  'plasticity_graph_edge_audit',
  'plasticity_graph_edges',
  'plasticity_proposal_review_decisions',
  'plasticity_proposals',
  'policy_executions',
  'policy_projection_state',
  'project_branches',
  'projection_observability_rollups',
  'projection_observability_samples',
  'reasoning_chains',
  'reasoning_steps',
  'runtime_projection_state',
  'runtime_states',
  'runtime_transitions',
  'sandbox_snapshots',
  'synapses',
  'task_branch_entries',
  'task_branches',
  'temporal_adjacency',
  'time_bucket_entries',
  'time_buckets',
  'topology_membership',
  'trace_events',
  'user_session_scopes',
  'user_sessions',
  'vector_projection_state',
] as const;

/**
 * Checks if a table exists in the database.
 */
export function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

/**
 * Backfills memory_atlas_documents from source tables.
 * Used by MemoryAtlasIndexer for reindexing.
 * Column names match the 0032 final schema (3.7.4).
 */
export function backfillAtlasDocuments(db: Database, projectId?: string): void {
  const now = Date.now();
  const scoped = projectId !== undefined;
  const projectWhere = scoped ? ` WHERE COALESCE(project_id, '') = ?` : '';
  const projectParams = scoped ? [projectId] : [];

  if (tableExists(db, 'memory_entities')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, confidence,
        support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'entity:' || entity_id, COALESCE(project_id, ''), 'entity', entity_id,
        canonical_name, NULL, 1, 0, 'active', created_at, '[]',
        json_object('entityType', entity_type, 'aliases', aliases_json, 'stablePath', stable_path),
        COALESCE(updated_at, ?)
      FROM memory_entities${projectWhere}
    `).run(now, ...projectParams);
  }
  if (tableExists(db, 'memory_topics')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, topic_path,
        confidence, support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'topic:' || COALESCE(project_id, '') || ':' || topic_path, COALESCE(project_id, ''),
        'topic', topic_path, topic_path, summary, topic_path, 1, 0, 'active', created_at, '[]',
        json_object('topicType', topic_type, 'parentPath', parent_path), COALESCE(updated_at, ?)
      FROM memory_topics${projectWhere}
    `).run(now, ...projectParams);
  }
  if (tableExists(db, 'topic_nodes')) {
    // topic_nodes exists in 0032 schema with different columns than old 0025
    const legacySummary = tableExists(db, 'memory_topics')
      ? `(SELECT mt.summary FROM memory_topics mt WHERE mt.project_id=topic_nodes.project_id AND mt.topic_path=topic_nodes.topic_path LIMIT 1)`
      : 'NULL';
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, topic_path,
        confidence, support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'topic:' || project_id || ':' || topic_path, project_id, 'topic', topic_path,
        canonical_name,
        TRIM(COALESCE(${legacySummary}, '') || ' ' || COALESCE((
          SELECT group_concat(alias, ' ') FROM topic_aliases a
          WHERE a.project_id=topic_nodes.project_id AND a.topic_id=topic_nodes.topic_id AND a.status='active'
        ), '')),
        topic_path, confidence, 0, status, last_used_at, evidence_event_ids_json,
        json_object('topicId', topic_id, 'ontologyClass', ontology_class, 'createdBy', created_by), updated_at
      FROM topic_nodes${projectWhere}
    `).run(...projectParams);
  }
  if (tableExists(db, 'memory_clusters')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, memory_kind, source_id, label, summary, topic_path,
        confidence, support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'cluster:' || cluster_id, COALESCE(project_id, ''), 'cluster', LOWER(cluster_type), cluster_id,
        title, summary, topic_path, confidence, support_count, status, created_at,
        evidence_event_ids_json, json_object('clusterType', cluster_type, 'claimKey', claim_key),
        COALESCE(updated_at, ?)
      FROM memory_clusters${projectWhere}
    `).run(now, ...projectParams);
  }
  if (tableExists(db, 'memory_episodes')) {
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, memory_kind, source_id, label, summary, topic_path,
        confidence, support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'episode:' || episode_id, project_id, 'episode', LOWER(episode_type), episode_id,
        COALESCE(summary, topic_path, episode_type || ' episode'), summary, topic_path,
        importance, event_count, status, started_at,
        json_array(start_event_id, end_event_id),
        json_object('episodeType', episode_type, 'sessionId', session_id), updated_at
      FROM memory_episodes${projectWhere}
    `).run(...projectParams);
  }
  if (tableExists(db, 'beliefs')) {
    // beliefs table in 0032 has different columns: id, subject, predicate, object_value, etc.
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, confidence,
        support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'belief:' || id, COALESCE(project_id, ''), 'belief', id,
        subject || ' ' || predicate || ' ' || object_value, subject || ' ' || predicate || ' ' || object_value,
        confidence, 0, status, updated_at, '[]',
        json_object('beliefType', source_type, 'validity', validity_kind), COALESCE(updated_at, ?)
      FROM beliefs${projectWhere}
    `).run(now, ...projectParams);
  }
  if (tableExists(db, 'entity_aliases')) {
    // entity_aliases in 0032: alias_id, entity_id, project_id, alias_text, normalized_alias, created_at, updated_at
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, confidence,
        support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'alias:' || entity_id || ':' || alias_text, project_id, 'alias', entity_id,
        alias_text, NULL, 1, 0, 'active', created_at, '[]',
        json_object('aliasType', 'entity', 'normalized', normalized_alias), updated_at
      FROM entity_aliases${projectWhere}
    `).run(...projectParams);
  }
  if (tableExists(db, 'entity_relations')) {
    // entity_relations in 0032: relation_id, project_id, source_entity_id, target_entity_id, relation_type, source_neuron_id, created_at
    db.prepare(`
      INSERT OR REPLACE INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, confidence,
        support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      )
      SELECT 'relation:' || relation_id, project_id, 'relation', relation_id,
        relation_type, NULL, 1, 0, 'active', created_at, '[]',
        json_object('sourceEntity', source_entity_id, 'targetEntity', target_entity_id), created_at
      FROM entity_relations${projectWhere}
    `).run(...projectParams);
  }
  // Rebuild FTS index
  if (tableExists(db, 'memory_atlas_fts')) {
    db.exec(`DELETE FROM memory_atlas_fts;`);
    db.prepare(`
      INSERT INTO memory_atlas_fts (node_id, project_id, node_type, label, summary, topic_path)
      SELECT node_id, project_id, node_type, label, summary, topic_path
      FROM memory_atlas_documents${projectWhere}
    `).run(...projectParams);
  }
}
