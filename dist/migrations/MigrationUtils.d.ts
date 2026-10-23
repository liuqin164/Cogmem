import type Database from 'bun:sqlite';
/**
 * v0.5 baseline tables - used for privacy classification.
 * These are the tables that existed in the v0.5 schema snapshot.
 * 4.0 fresh installs don't have legacy data, but this list is used
 * by PrivacyDeletionRegistry to classify operational tables.
 */
export declare const V0_5_BASELINE_TABLES: readonly ["agent_approval_queue", "agent_task_records", "anchors", "background_jobs", "belief_evidence", "beliefs", "branch_entries", "branch_links", "cognitive_edges", "cognitive_nodes", "compiled_events", "compiler_confidence_runs", "entities", "entity_alias_conflicts", "entity_aliases", "entity_attributes", "entity_instances", "entity_mentions", "entity_relations", "event_cluster_entries", "event_clusters", "fact_access_log", "fact_supersede_chain", "facts", "graph_signals", "ingestion_processed_records", "ingestion_source_cursors", "interaction_units", "memory_events", "meta_proposals", "neurons", "pending_bindings", "pending_entity_resolution", "plasticity_graph_edge_audit", "plasticity_graph_edges", "plasticity_proposal_review_decisions", "plasticity_proposals", "policy_executions", "policy_projection_state", "project_branches", "projection_observability_rollups", "projection_observability_samples", "reasoning_chains", "reasoning_steps", "runtime_projection_state", "runtime_states", "runtime_transitions", "sandbox_snapshots", "synapses", "task_branch_entries", "task_branches", "temporal_adjacency", "time_bucket_entries", "time_buckets", "topology_membership", "trace_events", "user_session_scopes", "user_sessions", "vector_projection_state"];
/**
 * Checks if a table exists in the database.
 */
export declare function tableExists(db: Database, name: string): boolean;
/**
 * Backfills memory_atlas_documents from source tables.
 * Used by MemoryAtlasIndexer for reindexing.
 * Column names match the 0032 final schema (3.7.4).
 */
export declare function backfillAtlasDocuments(db: Database, projectId?: string): void;
//# sourceMappingURL=MigrationUtils.d.ts.map