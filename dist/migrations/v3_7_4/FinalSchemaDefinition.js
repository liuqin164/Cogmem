// Generated from the verified fresh 3.7.4 schema. This is the immutable final DDL catalog;
// schema31 data conversion lives separately in the release migration.
export const FINAL_TABLES = [
    { type: "table", name: "facts", table: "facts", sql: `CREATE TABLE facts (
        fact_id TEXT PRIMARY KEY,
        neuron_id TEXT NOT NULL,
        unit_id TEXT,
        subject TEXT NOT NULL,
        predicate_family TEXT NOT NULL,
        predicate_value TEXT,
        object_value TEXT,
        entity_id TEXT,
        time_text TEXT,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        certainty_level TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        source_text TEXT NOT NULL,
        metadata_json TEXT
      )` },
    { type: "table", name: "compiled_events", table: "compiled_events", sql: `CREATE TABLE compiled_events (
        event_id TEXT PRIMARY KEY,
        neuron_id TEXT NOT NULL,
        unit_id TEXT,
        event_type TEXT NOT NULL,
        actor TEXT,
        target TEXT,
        payload_json TEXT,
        time_text TEXT,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        confidence REAL NOT NULL,
        status TEXT NOT NULL
      )` },
    { type: "table", name: "neurons", table: "neurons", sql: `CREATE TABLE neurons (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        self_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        spatial_x REAL NOT NULL,
        spatial_y REAL NOT NULL,
        spatial_z REAL NOT NULL,
        vector_blob BLOB,
        project_id TEXT,
        topic_path TEXT,
        file_id TEXT,
        file_path TEXT,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        last_activated INTEGER,
        activation_count INTEGER NOT NULL DEFAULT 0,
        aaak_summary TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        tags TEXT,
        file_size INTEGER,
        mime_type TEXT,
        original_name TEXT,
        blob_path TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        source_type TEXT,
        source_event_id TEXT,
        importance_level TEXT NOT NULL DEFAULT 'normal',
        is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
        stability REAL NOT NULL DEFAULT 1.0,
        repetitions INTEGER NOT NULL DEFAULT 0,
        procedural_link_json TEXT,
        community_id TEXT,
        last_reinforced_at INTEGER,
        is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1))
      )` },
    { type: "table", name: "synapses", table: "synapses", sql: `CREATE TABLE synapses (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        PRIMARY KEY (source_id, target_id, type)
      )` },
    { type: "table", name: "anchors", table: "anchors", sql: `CREATE TABLE anchors (
        id TEXT PRIMARY KEY,
        neuron_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        prev_anchor_id TEXT,
        summary_hash TEXT NOT NULL,
        project_id TEXT,
        version TEXT NOT NULL
      )` },
    { type: "table", name: "neurons_fts", table: "neurons_fts", sql: `CREATE VIRTUAL TABLE neurons_fts USING fts5(
        id UNINDEXED,
        content,
        aaak_summary,
        project_id UNINDEXED,
        file_path UNINDEXED,
        tokenize='unicode61'
      )` },
    { type: "table", name: "memory_events_fts", table: "memory_events_fts", sql: `CREATE VIRTUAL TABLE memory_events_fts USING fts5(
        event_id UNINDEXED,
        text,
        project_id UNINDEXED,
        workspace_id UNINDEXED,
        thread_id UNINDEXED,
        session_id UNINDEXED,
        local_date UNINDEXED,
        role UNINDEXED,
        raw_event_type UNINDEXED,
        tokenize='unicode61'
      )` },
    { type: "table", name: "vector_projection_state", table: "vector_projection_state", sql: `CREATE TABLE vector_projection_state (
        projection_name TEXT PRIMARY KEY,
        last_event_id TEXT,
        last_event_time INTEGER,
        last_global_seq INTEGER,
        last_rebuild_at INTEGER,
        last_full_count INTEGER NOT NULL DEFAULT 0,
        last_checksum TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        metadata_json TEXT
      )` },
    { type: "table", name: "event_sequence_counters", table: "event_sequence_counters", sql: `CREATE TABLE event_sequence_counters (
        counter_key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )` },
    { type: "table", name: "import_source_anchors", table: "import_source_anchors", sql: `CREATE TABLE import_source_anchors (
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        import_anchor TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, source_id, import_anchor)
      )` },
    { type: "table", name: "_schema_migrations", table: "_schema_migrations", sql: `CREATE TABLE _schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      , checksum TEXT)` },
    { type: "table", name: "entity_scope_migration_quarantine", table: "entity_scope_migration_quarantine", sql: `CREATE TABLE entity_scope_migration_quarantine (
      quarantine_id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      implicated_scopes_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )` },
    { type: "table", name: "memory_governance_plans", table: "memory_governance_plans", sql: `CREATE TABLE memory_governance_plans (
        plan_id TEXT PRIMARY KEY,
        project_id TEXT,
        proposed_by TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        applied_at INTEGER
      )` },
    { type: "table", name: "memory_governance_operations", table: "memory_governance_operations", sql: `CREATE TABLE memory_governance_operations (
        operation_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        project_id TEXT,
        operation_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        expected_version INTEGER,
        evidence_event_ids_json TEXT NOT NULL,
        source_role TEXT NOT NULL,
        ownership TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        applied_at INTEGER
      )` },
    { type: "table", name: "memory_governance_audit", table: "memory_governance_audit", sql: `CREATE TABLE memory_governance_audit (
        audit_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        project_id TEXT,
        operation_type TEXT NOT NULL,
        evidence_event_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "entity_merge_candidates", table: "entity_merge_candidates", sql: `CREATE TABLE entity_merge_candidates (
        candidate_id TEXT PRIMARY KEY,
        project_id TEXT,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        review_reasons_json TEXT NOT NULL,
        evidence_event_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )` },
    { type: "table", name: "entity_resolution_log", table: "entity_resolution_log", sql: `CREATE TABLE entity_resolution_log (
        log_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        previous_canonical_entity_id TEXT NOT NULL,
        previous_status TEXT NOT NULL,
        alias TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "belief_graph_nodes", table: "belief_graph_nodes", sql: `CREATE TABLE belief_graph_nodes (
        belief_id TEXT PRIMARY KEY, project_id TEXT, ownership TEXT NOT NULL, belief_type TEXT NOT NULL,
        canonical_key TEXT NOT NULL, statement TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, valid_from INTEGER NOT NULL, valid_to INTEGER,
        supersedes_belief_id TEXT, superseded_by_belief_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "belief_graph_evidence", table: "belief_graph_evidence", sql: `CREATE TABLE belief_graph_evidence (
        belief_id TEXT NOT NULL, event_id TEXT NOT NULL, source_role TEXT NOT NULL,
        evidence_type TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0, created_at INTEGER NOT NULL,
        PRIMARY KEY (belief_id, event_id, evidence_type)
      )` },
    { type: "table", name: "belief_graph_versions", table: "belief_graph_versions", sql: `CREATE TABLE belief_graph_versions (
        belief_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
        reason TEXT NOT NULL, evidence_event_id TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (belief_id, version)
      )` },
    { type: "table", name: "belief_graph_conflicts", table: "belief_graph_conflicts", sql: `CREATE TABLE belief_graph_conflicts (
        conflict_id TEXT PRIMARY KEY, project_id TEXT, prior_belief_id TEXT NOT NULL,
        proposed_belief_id TEXT NOT NULL, relation TEXT NOT NULL, status TEXT NOT NULL,
        reason TEXT, evidence_event_ids_json TEXT NOT NULL, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_timeline_entries", table: "memory_timeline_entries", sql: `CREATE TABLE memory_timeline_entries (
        entry_id TEXT PRIMARY KEY, project_id TEXT, entry_type TEXT NOT NULL, canonical_key TEXT,
        entity_id TEXT, belief_id TEXT, title TEXT NOT NULL, summary TEXT, reason TEXT,
        occurred_at INTEGER NOT NULL, evidence_event_ids_json TEXT NOT NULL, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "context_activation_receipts", table: "context_activation_receipts", sql: `CREATE TABLE context_activation_receipts (
        receipt_id TEXT PRIMARY KEY, project_id TEXT, intent TEXT NOT NULL,
        budget_tokens INTEGER NOT NULL, used_tokens INTEGER NOT NULL,
        receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "prospective_memories", table: "prospective_memories", sql: `CREATE TABLE prospective_memories (
        candidate_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_type TEXT NOT NULL,
        canonical_key TEXT NOT NULL, title TEXT NOT NULL, details TEXT, status TEXT NOT NULL,
        proposed_by TEXT NOT NULL, evidence_event_ids_json TEXT NOT NULL,
        confirmation_evidence_event_id TEXT, due_at INTEGER, deferred_until INTEGER,
        version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "prospective_memory_transitions", table: "prospective_memory_transitions", sql: `CREATE TABLE prospective_memory_transitions (
        transition_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, from_status TEXT,
        to_status TEXT NOT NULL, action TEXT NOT NULL, evidence_event_id TEXT, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "context_strategy_outcomes", table: "context_strategy_outcomes", sql: `CREATE TABLE context_strategy_outcomes (
        outcome_id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, project_id TEXT,
        strategy_id TEXT NOT NULL, strategy_template TEXT NOT NULL, intent TEXT NOT NULL,
        score REAL NOT NULL, unsafe_leak INTEGER NOT NULL DEFAULT 0,
        outcome_json TEXT NOT NULL, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_episodes", table: "memory_episodes", sql: `CREATE TABLE memory_episodes (
        episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
        source_agent TEXT, topic_path TEXT, episode_type TEXT NOT NULL, status TEXT NOT NULL,
        importance REAL NOT NULL, summary TEXT, start_event_id TEXT NOT NULL, end_event_id TEXT NOT NULL,
        start_seq INTEGER, end_seq INTEGER, event_count INTEGER NOT NULL,
        started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sealed_at INTEGER
      , conversation_thread_id TEXT, semantic_summary_json TEXT, episode_tags_json TEXT NOT NULL DEFAULT '[]', candidate_types_json TEXT NOT NULL DEFAULT '[]', importance_signals_json TEXT NOT NULL DEFAULT '[]', importance_reason TEXT, linked_episode_id TEXT, dream_status TEXT NOT NULL DEFAULT 'none', last_dream_run_id TEXT, last_dreamed_at INTEGER, dream_candidate_count INTEGER NOT NULL DEFAULT 0, dream_error TEXT)` },
    { type: "table", name: "memory_episode_events", table: "memory_episode_events", sql: `CREATE TABLE memory_episode_events (
        episode_id TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE, position INTEGER NOT NULL,
        relation TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (episode_id, event_id),
        FOREIGN KEY (episode_id) REFERENCES memory_episodes(episode_id) ON DELETE CASCADE
      )` },
    { type: "table", name: "episode_closure_receipts", table: "episode_closure_receipts", sql: `CREATE TABLE episode_closure_receipts (
        receipt_id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, project_id TEXT NOT NULL,
        closure_mode TEXT NOT NULL, closure_reason TEXT NOT NULL, source_event_ids_json TEXT NOT NULL,
        start_seq INTEGER, end_seq INTEGER, topic_path TEXT, episode_type TEXT NOT NULL,
        importance REAL NOT NULL, dream_recommended INTEGER NOT NULL, dream_mode TEXT NOT NULL,
        created_at INTEGER NOT NULL
      , closure_reason_code TEXT NOT NULL DEFAULT 'manual', closure_reason_detail TEXT, requires_review INTEGER NOT NULL DEFAULT 0, ignored_nearby_event_ids_json TEXT NOT NULL DEFAULT '[]', unassigned_nearby_event_ids_json TEXT NOT NULL DEFAULT '[]')` },
    { type: "table", name: "episode_dream_jobs", table: "episode_dream_jobs", sql: `CREATE TABLE episode_dream_jobs (
        episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL,
        priority INTEGER NOT NULL, mode_hint TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        lease_id TEXT, lease_until INTEGER, last_error TEXT, candidate_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      , retry_after INTEGER, failure_category TEXT)` },
    { type: "table", name: "episode_dream_runs", table: "episode_dream_runs", sql: `CREATE TABLE episode_dream_runs (
        run_id TEXT PRIMARY KEY, project_id TEXT, requested_mode TEXT NOT NULL,
        selected_mode TEXT NOT NULL, reason TEXT NOT NULL, episode_ids_json TEXT NOT NULL,
        candidate_ids_json TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER NOT NULL,
        error TEXT, created_at INTEGER NOT NULL
      , failed_episode_ids_json TEXT NOT NULL DEFAULT '[]', failure_details_json TEXT NOT NULL DEFAULT '[]')` },
    { type: "table", name: "episode_ingest_keys", table: "episode_ingest_keys", sql: `CREATE TABLE episode_ingest_keys (
        ingest_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_agent TEXT NOT NULL,
        source_session_id TEXT NOT NULL, external_message_id TEXT NOT NULL,
        event_id TEXT NOT NULL, created_at INTEGER NOT NULL
      , state TEXT NOT NULL DEFAULT 'committed', updated_at INTEGER, last_error TEXT)` },
    { type: "table", name: "episode_event_dispositions", table: "episode_event_dispositions", sql: `CREATE TABLE episode_event_dispositions (
        event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, disposition TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "topic_nodes", table: "topic_nodes", sql: `CREATE TABLE topic_nodes (
        topic_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, topic_path TEXT NOT NULL, canonical_name TEXT NOT NULL,
        parent_topic_id TEXT, ontology_class TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL,
        confidence REAL NOT NULL, evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        evidence_episode_ids_json TEXT NOT NULL DEFAULT '[]', last_used_at INTEGER NOT NULL,
        merge_candidates_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(project_id, topic_path)
      )` },
    { type: "table", name: "topic_aliases", table: "topic_aliases", sql: `CREATE TABLE topic_aliases (
        alias_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, normalized_alias TEXT NOT NULL, alias TEXT NOT NULL,
        topic_id TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(project_id, normalized_alias, topic_id),
        FOREIGN KEY(topic_id) REFERENCES topic_nodes(topic_id) ON DELETE CASCADE
      )` },
    { type: "table", name: "topic_relations", table: "topic_relations", sql: `CREATE TABLE topic_relations (
        relation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_topic_id TEXT NOT NULL, relation TEXT NOT NULL,
        target_topic_id TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', evidence_episode_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "topic_operations", table: "topic_operations", sql: `CREATE TABLE topic_operations (
        operation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, operation_type TEXT NOT NULL, actor TEXT NOT NULL,
        target_topic_id TEXT, payload_json TEXT NOT NULL, before_json TEXT, after_json TEXT, inverse_operation_json TEXT,
        status TEXT NOT NULL, evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, reverted_at INTEGER
      )` },
    { type: "table", name: "episode_cross_refs", table: "episode_cross_refs", sql: `CREATE TABLE episode_cross_refs (
        cross_ref_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, episode_id TEXT NOT NULL, referenced_episode_id TEXT,
        event_id TEXT, relation TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "episode_repair_audit", table: "episode_repair_audit", sql: `CREATE TABLE episode_repair_audit (
        repair_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, operation TEXT NOT NULL, payload_json TEXT NOT NULL,
        before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_atlas_documents", table: "memory_atlas_documents", sql: `CREATE TABLE memory_atlas_documents (
        node_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        memory_kind TEXT,
        source_id TEXT NOT NULL,
        label TEXT NOT NULL,
        summary TEXT,
        topic_path TEXT,
        confidence REAL NOT NULL DEFAULT 1,
        support_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        occurred_at INTEGER,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_atlas_fts", table: "memory_atlas_fts", sql: `CREATE VIRTUAL TABLE memory_atlas_fts USING fts5(
        node_id UNINDEXED,
        project_id UNINDEXED,
        node_type UNINDEXED,
        label,
        summary,
        topic_path,
        tokenize='unicode61'
      )` },
    { type: "table", name: "memory_action_frames", table: "memory_action_frames", sql: `CREATE TABLE memory_action_frames (
        action_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        frame_type TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        target_entity_id TEXT,
        target_label TEXT,
        topic_path TEXT,
        episode_id TEXT,
        occurred_at INTEGER NOT NULL,
        confidence REAL NOT NULL,
        source_authority TEXT NOT NULL DEFAULT 'raw_evidence',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_action_frame_evidence", table: "memory_action_frame_evidence", sql: `CREATE TABLE memory_action_frame_evidence (
        action_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (action_id, event_id),
        FOREIGN KEY(action_id) REFERENCES memory_action_frames(action_id) ON DELETE CASCADE
      )` },
    { type: "table", name: "memory_atlas_access", table: "memory_atlas_access", sql: `CREATE TABLE memory_atlas_access (
        access_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        access_kind TEXT NOT NULL,
        query_hash TEXT,
        accessed_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_atlas_activation", table: "memory_atlas_activation", sql: `CREATE TABLE memory_atlas_activation (
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        activation REAL NOT NULL DEFAULT 0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, node_id)
      )` },
    { type: "table", name: "memory_atlas_projection_state", table: "memory_atlas_projection_state", sql: `CREATE TABLE memory_atlas_projection_state (
        project_id TEXT NOT NULL,
        projection_name TEXT NOT NULL,
        cursor_value TEXT,
        status TEXT NOT NULL,
        last_rebuild_at INTEGER,
        last_error TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}', projection_version TEXT NOT NULL DEFAULT 'v1', processor_prompt_version TEXT, frame_schema_version TEXT, source_fingerprint TEXT, last_backfill_cursor TEXT,
        PRIMARY KEY (project_id, projection_name)
      )` },
    { type: "table", name: "deep_write_candidate_reviews", table: "deep_write_candidate_reviews", sql: `CREATE TABLE deep_write_candidate_reviews (
        review_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        project_id TEXT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        confirmation_event_id TEXT,
        target_belief_id TEXT,
        replacement_candidate_id TEXT,
        review_after INTEGER,
        decision_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY(candidate_id) REFERENCES deep_write_candidates(candidate_id)
      )` },
    { type: "table", name: "episode_boundary_decisions", table: "episode_boundary_decisions", sql: `CREATE TABLE episode_boundary_decisions (
        decision_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        source_agent TEXT,
        thread_id TEXT,
        primary_event_id TEXT NOT NULL,
        previous_episode_id TEXT,
        resulting_episode_id TEXT,
        policy_version TEXT NOT NULL,
        mode TEXT NOT NULL,
        guard_action TEXT NOT NULL,
        guard_codes_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        cpu_decision_json TEXT NOT NULL,
        reviewer_invoked INTEGER NOT NULL,
        reviewer_decision_json TEXT,
        final_decision_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, primary_event_id, policy_version)
      )` },
    { type: "table", name: "_episode_integrity_markers", table: "_episode_integrity_markers", sql: `CREATE TABLE _episode_integrity_markers (
        marker TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_atlas_aliases", table: "memory_atlas_aliases", sql: `CREATE TABLE memory_atlas_aliases (
        alias_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        alias TEXT NOT NULL,
        dimension TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        confidence REAL NOT NULL DEFAULT 1,
        source_frame_id TEXT,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, normalized_alias, dimension, node_id)
      )` },
    { type: "table", name: "memory_atlas_supports", table: "memory_atlas_supports", sql: `CREATE TABLE memory_atlas_supports (
        support_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_episode_id TEXT,
        source_frame_id TEXT,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        invalidated_at INTEGER, payload_json TEXT NOT NULL DEFAULT '{}', confidence REAL, valid_from INTEGER, valid_to INTEGER, source_authority TEXT NOT NULL DEFAULT 'memory_frame_projector',
        UNIQUE(node_id, source_type, source_id)
      )` },
    { type: "table", name: "memory_atlas_alias_supports", table: "memory_atlas_alias_supports", sql: `CREATE TABLE memory_atlas_alias_supports (
        support_id TEXT PRIMARY KEY,
        alias_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        source_frame_id TEXT NOT NULL,
        source_episode_id TEXT,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','invalidated')),
        created_at INTEGER NOT NULL,
        invalidated_at INTEGER
      , payload_json TEXT NOT NULL DEFAULT '{}', confidence REAL, source_authority TEXT NOT NULL DEFAULT 'memory_frame_projector')` },
    { type: "table", name: "memory_atlas_alias_ambiguities", table: "memory_atlas_alias_ambiguities", sql: `CREATE TABLE memory_atlas_alias_ambiguities (
          candidate_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          dimension TEXT NOT NULL,
          normalized_alias TEXT NOT NULL,
          node_ids_json TEXT NOT NULL,
          source_frame_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL
        )` },
    { type: "table", name: "topology_projection_state", table: "topology_projection_state", sql: `CREATE TABLE topology_projection_state (
        project_id TEXT PRIMARY KEY,
        projection_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK(status IN ('dirty','building','clean','failed')),
        time_zone TEXT,
        updated_at INTEGER NOT NULL,
        error TEXT
      , source_revision INTEGER NOT NULL DEFAULT 0)` },
    { type: "table", name: "topology_time_rebuild_jobs", table: "topology_time_rebuild_jobs", sql: `CREATE TABLE topology_time_rebuild_jobs (
        project_id TEXT PRIMARY KEY,
        generation TEXT NOT NULL UNIQUE,
        time_zone TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('building','ready','failed')),
        cursor_created_at INTEGER,
        cursor_neuron_id TEXT,
        neuron_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        error TEXT
      , source_revision INTEGER NOT NULL DEFAULT 0, publish_token TEXT, publish_lease_until INTEGER)` },
    { type: "table", name: "topology_time_rebuild_buckets", table: "topology_time_rebuild_buckets", sql: `CREATE TABLE topology_time_rebuild_buckets (
        generation TEXT NOT NULL,
        bucket_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        bucket_type TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        bucket_end INTEGER NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY(generation,bucket_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      )` },
    { type: "table", name: "topology_time_rebuild_entries", table: "topology_time_rebuild_entries", sql: `CREATE TABLE topology_time_rebuild_entries (
        generation TEXT NOT NULL,
        bucket_id TEXT NOT NULL,
        neuron_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(generation,bucket_id,neuron_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      )` },
    { type: "table", name: "topology_time_rebuild_active_neurons", table: "topology_time_rebuild_active_neurons", sql: `CREATE TABLE topology_time_rebuild_active_neurons (
        generation TEXT NOT NULL,
        neuron_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY(generation,neuron_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      )` },
    { type: "table", name: "topology_source_revisions", table: "topology_source_revisions", sql: `CREATE TABLE topology_source_revisions (
        project_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "topology_time_rebuild_cognitive_nodes", table: "topology_time_rebuild_cognitive_nodes", sql: `CREATE TABLE topology_time_rebuild_cognitive_nodes (
        generation TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        node_key TEXT NOT NULL,
        title TEXT NOT NULL,
        project_id TEXT NOT NULL,
        source_neuron_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(generation,node_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      )` },
    { type: "table", name: "topology_time_rebuild_cognitive_edges", table: "topology_time_rebuild_cognitive_edges", sql: `CREATE TABLE topology_time_rebuild_cognitive_edges (
        generation TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL,
        project_id TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(generation,edge_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      )` },
    { type: "table", name: "topology_time_rebuild_adjacency", table: "topology_time_rebuild_adjacency", sql: `CREATE TABLE topology_time_rebuild_adjacency (
        generation TEXT NOT NULL,
        project_id TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        source_bucket_id TEXT NOT NULL,
        adjacent_bucket_id TEXT NOT NULL,
        bucket_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(generation,source_bucket_id,adjacent_bucket_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      )` },
    { type: "table", name: "vector_write_outbox", table: "vector_write_outbox", sql: `CREATE TABLE vector_write_outbox (
        neuron_id TEXT PRIMARY KEY, vector_json TEXT NOT NULL, created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "ingestion_source_cursors", table: "ingestion_source_cursors", sql: `CREATE TABLE ingestion_source_cursors (
    project_scope TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL, source_path TEXT NOT NULL,
    source_type TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
    last_processed_at INTEGER,last_seen_hash TEXT,last_seen_mtime INTEGER,content_window_start INTEGER,
    content_window_end INTEGER,updated_at INTEGER NOT NULL,PRIMARY KEY(project_scope,source_id)
  )` },
    { type: "table", name: "ingestion_processed_records", table: "ingestion_processed_records", sql: `CREATE TABLE ingestion_processed_records (
    project_scope TEXT NOT NULL DEFAULT '',record_hash TEXT NOT NULL,source_id TEXT NOT NULL,
    source_path TEXT NOT NULL,source_type TEXT NOT NULL,content_hash TEXT NOT NULL,
    content_window_start INTEGER NOT NULL,content_window_end INTEGER NOT NULL,processed_at INTEGER NOT NULL,
    neuron_id TEXT,project_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(project_scope,source_id,record_hash)
  )` },
    { type: "table", name: "policy_execution_quarantine", table: "policy_execution_quarantine", sql: `CREATE TABLE policy_execution_quarantine (
    execution_id TEXT PRIMARY KEY,
    record_hash TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )` },
    { type: "table", name: "policy_execution_legacy_tombstones", table: "policy_execution_legacy_tombstones", sql: `CREATE TABLE policy_execution_legacy_tombstones (
    idempotency_key_hash TEXT PRIMARY KEY,
    legacy_execution_id TEXT NOT NULL,
    legacy_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )` },
    { type: "table", name: "policy_executions", table: "policy_executions", sql: `CREATE TABLE policy_executions (
    execution_id TEXT PRIMARY KEY,
    project_scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    runtime_id TEXT,
    policy TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    status TEXT NOT NULL CHECK(status IN ('in_progress','executed','skipped','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER,
    dead_lettered_at INTEGER,
    replay_policy TEXT,
    actor_id TEXT,
    causation_id TEXT,
    correlation_id TEXT,
    policy_group TEXT,
    stream_type TEXT,
    event_type TEXT,
    detail TEXT,
    metadata_json TEXT,
    lease_owner TEXT,
    lease_until INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    execution_outcome TEXT,
    CHECK (
      (status IN ('executed','skipped') AND execution_outcome='executed')
      OR (status='failed' AND execution_outcome IN ('definitely_not_executed','failed_before_execution','outcome_unknown'))
      OR (status='in_progress' AND execution_outcome IS NULL)
    ),
    UNIQUE(project_scope,idempotency_key)
  )` },
    { type: "table", name: "policy_projection_state", table: "policy_projection_state", sql: `CREATE TABLE policy_projection_state (
      projection_name TEXT PRIMARY KEY,
      last_event_id TEXT,
      last_event_time INTEGER,
      last_global_seq INTEGER,
      last_rebuild_at INTEGER,
      last_full_count INTEGER NOT NULL DEFAULT 0,
      last_checksum TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT
    )` },
    { type: "table", name: "runtime_projection_state", table: "runtime_projection_state", sql: `CREATE TABLE runtime_projection_state (
      projection_name TEXT PRIMARY KEY,
      last_event_id TEXT,
      last_event_time INTEGER,
      last_global_seq INTEGER,
      last_rebuild_at INTEGER,
      last_full_count INTEGER NOT NULL DEFAULT 0,
      last_checksum TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT
    )` },
    { type: "table", name: "runtime_states", table: "runtime_states", sql: `CREATE TABLE runtime_states (
      project_scope TEXT NOT NULL, runtime_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY(project_scope,runtime_id,entity_type,entity_key)
    )` },
    { type: "table", name: "runtime_transitions", table: "runtime_transitions", sql: `CREATE TABLE runtime_transitions (
      project_scope TEXT NOT NULL, transition_id TEXT NOT NULL, runtime_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, transition_type TEXT NOT NULL,
      from_status TEXT, to_status TEXT NOT NULL, payload_json TEXT, occurred_at INTEGER NOT NULL,
      PRIMARY KEY(project_scope,transition_id)
    )` },
    { type: "table", name: "runtime_projection_states", table: "runtime_projection_states", sql: `CREATE TABLE runtime_projection_states (
      projection_name TEXT NOT NULL, project_scope TEXT NOT NULL, runtime_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT,
      updated_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(projection_name,project_scope,runtime_id,entity_type,entity_key)
    )` },
    { type: "table", name: "runtime_projection_transitions", table: "runtime_projection_transitions", sql: `CREATE TABLE runtime_projection_transitions (
      projection_name TEXT NOT NULL, project_scope TEXT NOT NULL, transition_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL,
      transition_type TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, payload_json TEXT,
      occurred_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(projection_name,project_scope,transition_id)
    )` },
    { type: "table", name: "runtime_scope_discard_receipts", table: "runtime_scope_discard_receipts", sql: `CREATE TABLE runtime_scope_discard_receipts (
    quarantine_id TEXT PRIMARY KEY,
    source_table TEXT NOT NULL,
    record_hash TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )` },
    { type: "table", name: "projection_event_discard_receipts", table: "projection_event_discard_receipts", sql: `CREATE TABLE projection_event_discard_receipts (
        projector TEXT NOT NULL,
        event_id TEXT NOT NULL,
        global_seq INTEGER NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL,
        event_identity_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(projector,event_id)
      )` },
    { type: "table", name: "_meta", table: "_meta", sql: `CREATE TABLE _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )` },
    { type: "table", name: "entities", table: "entities", sql: `CREATE TABLE entities (
        entity_id TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        type TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_from TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "entity_instances", table: "entity_instances", sql: `CREATE TABLE entity_instances (
        instance_id TEXT PRIMARY KEY,
        canonical_entity_id TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        type TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_from TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "entity_attributes", table: "entity_attributes", sql: `CREATE TABLE entity_attributes (
        attribute_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        attribute_key TEXT NOT NULL,
        attribute_value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        source_neuron_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "pending_entity_resolution", table: "pending_entity_resolution", sql: `CREATE TABLE pending_entity_resolution (
        pending_id TEXT PRIMARY KEY,
        reference_text TEXT NOT NULL,
        entity_type TEXT,
        context_neuron_id TEXT,
        project_scope TEXT NOT NULL DEFAULT '',
        resolved_entity_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "entity_mentions", table: "entity_mentions", sql: `CREATE TABLE entity_mentions (
        mention_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        neuron_id TEXT,
        project_id TEXT,
        mention_type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "governance_audit_log", table: "governance_audit_log", sql: `CREATE TABLE governance_audit_log (
        audit_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        project_id TEXT,
        reason TEXT,
        details_json TEXT,
        created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "beliefs", table: "beliefs", sql: `CREATE TABLE beliefs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        scope TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_value TEXT NOT NULL,
        object_type TEXT NOT NULL DEFAULT 'string',
        canonical_key TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        trust_score REAL NOT NULL DEFAULT 1.0,
        source_neuron_id TEXT,
        source_event_id TEXT,
        source_type TEXT NOT NULL DEFAULT 'user_input',
        validity_kind TEXT NOT NULL DEFAULT 'open',
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        supersedes_belief_id TEXT,
        superseded_by_belief_id TEXT,
        contradiction_group TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        explanation TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "belief_evidence", table: "belief_evidence", sql: `CREATE TABLE belief_evidence (
        belief_id TEXT NOT NULL,
        neuron_id TEXT,
        event_id TEXT,
        evidence_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (belief_id, neuron_id, event_id, evidence_type)
      )` },
    { type: "table", name: "vector_index", table: "vector_index", sql: `CREATE TABLE vector_index (
        neuron_id TEXT PRIMARY KEY,
        dimensions INTEGER NOT NULL,
        vector_blob BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "project_branches", table: "project_branches", sql: `CREATE TABLE project_branches (
        branch_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch_key TEXT NOT NULL,
        branch_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, branch_key)
      )` },
    { type: "table", name: "branch_links", table: "branch_links", sql: `CREATE TABLE branch_links (
        parent_branch_id TEXT NOT NULL,
        child_branch_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        relation_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(parent_branch_id, child_branch_id, relation_type)
      )` },
    { type: "table", name: "branch_entries", table: "branch_entries", sql: `CREATE TABLE branch_entries (
        branch_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        neuron_id TEXT,
        unit_id TEXT,
        belief_id TEXT,
        fact_id TEXT,
        event_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(branch_id, neuron_id, unit_id, belief_id, fact_id, event_id)
      )` },
    { type: "table", name: "topology_membership", table: "topology_membership", sql: `CREATE TABLE topology_membership (
        neuron_id TEXT NOT NULL,
        project_id TEXT,
        dimension_type TEXT NOT NULL,
        dimension_key TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(neuron_id, dimension_type, dimension_key)
      )` },
    { type: "table", name: "interaction_units", table: "interaction_units", sql: `CREATE TABLE interaction_units (
        unit_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        message_neuron_ids_json TEXT NOT NULL,
        semantic_text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "pending_bindings", table: "pending_bindings", sql: `CREATE TABLE pending_bindings (
        pending_id TEXT PRIMARY KEY,
        binding_type TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        reference_text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "compiler_confidence_runs", table: "compiler_confidence_runs", sql: `CREATE TABLE compiler_confidence_runs (
        run_id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT,
        project_id TEXT,
        compiler_name TEXT NOT NULL,
        confidence REAL NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "dream_ledger_state", table: "dream_ledger_state", sql: `CREATE TABLE dream_ledger_state (
        project_key TEXT PRIMARY KEY,
        project_id TEXT,
        last_dreamed_global_seq INTEGER,
        last_dreamed_at INTEGER,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_activation", table: "memory_activation", sql: `CREATE TABLE memory_activation (
        neuron_id TEXT PRIMARY KEY,
        project_id TEXT,
        activation REAL NOT NULL DEFAULT 0,
        touch_count INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        last_touched_at INTEGER NOT NULL,
        last_decayed_at INTEGER
      )` },
    { type: "table", name: "memory_entities", table: "memory_entities", sql: `CREATE TABLE memory_entities (
        entity_id TEXT PRIMARY KEY,
        project_id TEXT,
        canonical_name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        stable_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_entity_scope_identity", table: "memory_entity_scope_identity", sql: `CREATE TABLE memory_entity_scope_identity (
        root_entity_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        scoped_entity_id TEXT NOT NULL UNIQUE,
        entity_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (root_entity_id, project_id)
      )` },
    { type: "table", name: "memory_topics", table: "memory_topics", sql: `CREATE TABLE memory_topics (
        topic_path TEXT NOT NULL,
        project_id TEXT,
        project_id_key TEXT NOT NULL DEFAULT '',
        parent_path TEXT,
        topic_type TEXT NOT NULL,
        summary TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (topic_path, project_id_key)
      )` },
    { type: "table", name: "memory_bindings", table: "memory_bindings", sql: `CREATE TABLE memory_bindings (
        binding_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        project_id TEXT,
        role TEXT,
        raw_event_type TEXT,
        entity_id TEXT,
        entity_name TEXT,
        entity_type TEXT,
        topic_path TEXT NOT NULL,
        binding_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        source TEXT NOT NULL,
        signal TEXT NOT NULL,
        claim_key TEXT NOT NULL DEFAULT 'default',
        binding_action TEXT NOT NULL DEFAULT 'create_new_cluster',
        cluster_id TEXT,
        related_event_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_clusters", table: "memory_clusters", sql: `CREATE TABLE memory_clusters (
        cluster_id TEXT PRIMARY KEY,
        project_id TEXT,
        topic_path TEXT NOT NULL,
        cluster_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        claim_key TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL,
        review_flags_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL,
        support_count INTEGER NOT NULL,
        evidence_event_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_edges", table: "memory_edges", sql: `CREATE TABLE memory_edges (
        edge_id TEXT PRIMARY KEY,
        project_id TEXT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        base_weight REAL NOT NULL DEFAULT 1,
        stability REAL NOT NULL DEFAULT 1,
        activation REAL NOT NULL DEFAULT 1,
        evidence_event_ids_json TEXT NOT NULL,
        status TEXT NOT NULL,
        valid_from INTEGER NOT NULL DEFAULT 0,
        valid_to INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        source_authority TEXT NOT NULL DEFAULT 'raw_evidence',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0
      )` },
    { type: "table", name: "pipeline_runs", table: "pipeline_runs", sql: `CREATE TABLE pipeline_runs (
        run_id TEXT PRIMARY KEY,
        total_ms INTEGER NOT NULL,
        aborted INTEGER NOT NULL CHECK (aborted IN (0, 1)),
        completed_at INTEGER NOT NULL
      )` },
    { type: "table", name: "pipeline_step_timings", table: "pipeline_step_timings", sql: `CREATE TABLE pipeline_step_timings (
        run_id TEXT NOT NULL,
        step_name TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        completed_at INTEGER NOT NULL
      )` },
    { type: "table", name: "pipeline_nonfatal_events", table: "pipeline_nonfatal_events", sql: `CREATE TABLE pipeline_nonfatal_events (
        event_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        project_id TEXT,
        message TEXT,
        details_json TEXT,
        occurred_at INTEGER NOT NULL
      )` },
    { type: "table", name: "deep_write_summaries", table: "deep_write_summaries", sql: `CREATE TABLE deep_write_summaries (
        summary_id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        scope TEXT NOT NULL,
        window_start INTEGER,
        window_end INTEGER,
        text TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        source_neuron_ids_json TEXT NOT NULL,
        deep_write_run_id TEXT,
        deep_write_candidate_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        superseded_by_summary_id TEXT
      )` },
    { type: "table", name: "deep_write_summaries_fts", table: "deep_write_summaries_fts", sql: `CREATE VIRTUAL TABLE deep_write_summaries_fts
        USING fts5(text, content='deep_write_summaries', content_rowid='rowid')` },
    { type: "table", name: "deep_write_runs", table: "deep_write_runs", sql: `CREATE TABLE deep_write_runs (
        run_id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        source_neuron_ids_json TEXT NOT NULL,
        model_provider TEXT,
        model_name TEXT,
        mode TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        output_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        source_episode_id TEXT,
        dream_job_lease_id TEXT,
        lease_until INTEGER,
        attempt_generation INTEGER,
        updated_at INTEGER
      )` },
    { type: "table", name: "deep_write_candidates", table: "deep_write_candidates", sql: `CREATE TABLE deep_write_candidates (
        candidate_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        candidate_type TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        content_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        promotion_target_type TEXT,
        promotion_target_id TEXT,
        status_reason TEXT,
        review_after INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, publish_status TEXT,
        FOREIGN KEY(run_id) REFERENCES deep_write_runs(run_id)
      )` },
    { type: "table", name: "working_memory_deltas", table: "working_memory_deltas", sql: `CREATE TABLE working_memory_deltas (
        delta_id TEXT PRIMARY KEY,
        project_id TEXT,
        neuron_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1)),
        payload TEXT
      )` },
    { type: "table", name: "pipeline_checkpoints", table: "pipeline_checkpoints", sql: `CREATE TABLE pipeline_checkpoints (
        projectId TEXT NOT NULL PRIMARY KEY,
        nextStep TEXT NOT NULL,
        savedAt INTEGER NOT NULL
      )` },
    { type: "table", name: "memory_frames", table: "memory_frames", sql: `CREATE TABLE memory_frames (
        frame_id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL DEFAULT 1,
        supersedes_frame_id TEXT,
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        processor_prompt_version TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        episode_kind TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        processor_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','active','needs_confirmation','superseded','failed')),
        source_authority TEXT NOT NULL DEFAULT 'processor',
        semantic_completeness TEXT NOT NULL DEFAULT 'full',
        needs_review INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        primary_language TEXT,
        temporal_references_json TEXT NOT NULL DEFAULT '[]',
        state_transitions_json TEXT NOT NULL DEFAULT '[]',
        publish_status TEXT NOT NULL DEFAULT 'active' CHECK(publish_status IN ('active','needs_confirmation')),
        dream_job_lease_id TEXT,
        dream_lease_until INTEGER,
        attempt_generation INTEGER,
        UNIQUE(episode_id, source_fingerprint, processor_prompt_version, revision_id),
        UNIQUE(episode_id, source_fingerprint, processor_prompt_version, revision_number)
      )` },
    { type: "table", name: "memory_frame_nodes", table: "memory_frame_nodes", sql: `CREATE TABLE memory_frame_nodes (
        frame_node_id TEXT PRIMARY KEY, frame_id TEXT NOT NULL, dimension TEXT NOT NULL, label TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]', description TEXT, confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', canonical_hint_json TEXT,
        FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE,
        UNIQUE(frame_id, frame_node_id)
      )` },
    { type: "table", name: "memory_frame_relations", table: "memory_frame_relations", sql: `CREATE TABLE memory_frame_relations (
        frame_relation_id TEXT PRIMARY KEY, frame_id TEXT NOT NULL, source_frame_node_id TEXT NOT NULL,
        relation_type TEXT NOT NULL, target_frame_node_id TEXT NOT NULL, confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', valid_from INTEGER, valid_to INTEGER,
        FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE,
        FOREIGN KEY(source_frame_node_id) REFERENCES memory_frame_nodes(frame_node_id) ON DELETE CASCADE,
        FOREIGN KEY(target_frame_node_id) REFERENCES memory_frame_nodes(frame_node_id) ON DELETE CASCADE
      )` },
    { type: "table", name: "memory_frame_reviews", table: "memory_frame_reviews", sql: `CREATE TABLE memory_frame_reviews (
        review_id TEXT PRIMARY KEY, frame_id TEXT NOT NULL, project_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('approve','reject')), actor TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL,
        FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE
      )` },
    { type: "table", name: "time_buckets", table: "time_buckets", sql: `CREATE TABLE "time_buckets" (
      bucket_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      time_zone TEXT NOT NULL DEFAULT 'UTC',
      bucket_type TEXT NOT NULL,
      bucket_start INTEGER NOT NULL,
      bucket_end INTEGER NOT NULL,
      label TEXT NOT NULL,
      UNIQUE(project_id,time_zone,bucket_type,bucket_start,bucket_end)
    )` },
    { type: "table", name: "temporal_adjacency", table: "temporal_adjacency", sql: `CREATE TABLE temporal_adjacency (
      project_id TEXT NOT NULL DEFAULT '',
      time_zone TEXT NOT NULL DEFAULT 'UTC',
      source_bucket_id TEXT NOT NULL,
      adjacent_bucket_id TEXT NOT NULL,
      bucket_type TEXT NOT NULL,
      weight REAL NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id,time_zone,source_bucket_id,adjacent_bucket_id)
    )` },
    { type: "table", name: "cognitive_nodes", table: "cognitive_nodes", sql: `CREATE TABLE "cognitive_nodes" (
      node_id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      node_key TEXT NOT NULL,
      title TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT '',
      source_neuron_id TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id,node_type,node_key)
    )` },
    { type: "table", name: "cognitive_edges", table: "cognitive_edges", sql: `CREATE TABLE "cognitive_edges" (
      edge_id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight REAL NOT NULL,
      project_id TEXT NOT NULL DEFAULT '',
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id,source_node_id,target_node_id,edge_type)
    )` },
    { type: "table", name: "time_bucket_entries", table: "time_bucket_entries", sql: `CREATE TABLE "time_bucket_entries"(bucket_id TEXT NOT NULL,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,project_id TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,UNIQUE(bucket_id,neuron_id,unit_id,belief_id,fact_id,event_id))` },
    { type: "table", name: "task_branches", table: "task_branches", sql: `CREATE TABLE "task_branches"(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',task_key TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(project_id,task_key))` },
    { type: "table", name: "task_branch_entries", table: "task_branch_entries", sql: `CREATE TABLE "task_branch_entries"(task_id TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT '',neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER NOT NULL)` },
    { type: "table", name: "event_clusters", table: "event_clusters", sql: `CREATE TABLE "event_clusters"(cluster_id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',cluster_key TEXT NOT NULL,cluster_type TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(project_id,cluster_key))` },
    { type: "table", name: "event_cluster_entries", table: "event_cluster_entries", sql: `CREATE TABLE "event_cluster_entries"(cluster_id TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT '',neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER NOT NULL)` },
    { type: "table", name: "entity_aliases", table: "entity_aliases", sql: `CREATE TABLE entity_aliases (
    alias_id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
    alias_text TEXT NOT NULL, normalized_alias TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(project_id,entity_id,normalized_alias)
  )` },
    { type: "table", name: "entity_relations", table: "entity_relations", sql: `CREATE TABLE entity_relations (
    relation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL, relation_type TEXT NOT NULL, source_neuron_id TEXT, created_at INTEGER NOT NULL,
    UNIQUE(project_id,source_entity_id,target_entity_id,relation_type)
  )` },
    { type: "table", name: "entity_alias_conflicts", table: "entity_alias_conflicts", sql: `CREATE TABLE entity_alias_conflicts (
    conflict_id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', normalized_alias TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_ids_json TEXT NOT NULL, policy TEXT NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(project_id,normalized_alias,entity_type)
  )` },
    { type: "table", name: "memory_events", table: "memory_events", sql: `CREATE TABLE memory_events (
    event_id TEXT PRIMARY KEY, global_seq INTEGER, stream_id TEXT NOT NULL, stream_type TEXT NOT NULL,
    event_type TEXT NOT NULL, raw_event_type TEXT, event_version INTEGER NOT NULL, project_id TEXT,
    project_scope TEXT NOT NULL DEFAULT '', workspace_id TEXT, actor_id TEXT, causation_id TEXT, correlation_id TEXT,
    source_neuron_id TEXT, source_id TEXT, content_hash TEXT, thread_id TEXT, session_id TEXT, local_date TEXT,
    local_date_source TEXT NOT NULL DEFAULT 'legacy_unknown', thread_seq INTEGER, turn_id TEXT, turn_seq INTEGER,
    event_ordinal INTEGER, role TEXT, parent_event_id TEXT, prev_event_id TEXT, next_event_id TEXT, causality_type TEXT,
    source_offset INTEGER, line_start INTEGER, line_end INTEGER, char_start INTEGER, char_end INTEGER,
    ordering_confidence TEXT, occurred_at INTEGER NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), UNIQUE(project_scope,stream_id,event_version)
  )` },
    { type: "table", name: "neuron_embeddings", table: "neuron_embeddings", sql: `CREATE TABLE neuron_embeddings (
    neuron_id TEXT NOT NULL, project_id TEXT, model_id TEXT NOT NULL, dimensions INTEGER NOT NULL,
    vector_blob BLOB NOT NULL, status TEXT NOT NULL DEFAULT 'done', retry_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, PRIMARY KEY(neuron_id,model_id), FOREIGN KEY(neuron_id) REFERENCES neurons(id) ON DELETE CASCADE
  )` },
    { type: "table", name: "pending_entity_resolution_quarantine", table: "pending_entity_resolution_quarantine", sql: `CREATE TABLE pending_entity_resolution_quarantine (
    pending_id TEXT PRIMARY KEY,record_json TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL
  , project_scope TEXT NOT NULL DEFAULT '', implicated_scopes_json TEXT NOT NULL DEFAULT '[]', context_neuron_id TEXT, scope_resolved INTEGER NOT NULL DEFAULT 0)` },
    { type: "table", name: "policy_execution_read_model", table: "policy_execution_read_model", sql: `CREATE TABLE policy_execution_read_model (
      execution_id TEXT NOT NULL, project_scope TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      runtime_id TEXT, policy TEXT NOT NULL, action TEXT NOT NULL, target TEXT,
      status TEXT NOT NULL CHECK(status IN ('in_progress','executed','skipped','failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER, dead_lettered_at INTEGER,
      replay_policy TEXT, actor_id TEXT, causation_id TEXT, correlation_id TEXT, policy_group TEXT,
      stream_type TEXT, event_type TEXT, detail TEXT, metadata_json TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
      execution_outcome TEXT,
      CHECK (
        (status IN ('executed','skipped') AND execution_outcome='executed')
        OR (status='failed' AND execution_outcome IN ('definitely_not_executed','failed_before_execution','outcome_unknown'))
        OR (status='in_progress' AND execution_outcome IS NULL)
      ),
      PRIMARY KEY(project_scope,idempotency_key)
    )` },
    { type: "table", name: "policy_execution_audit_outbox", table: "policy_execution_audit_outbox", sql: `CREATE TABLE policy_execution_audit_outbox (
      outbox_id TEXT NOT NULL PRIMARY KEY, project_scope TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
    , attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_retry_at INTEGER, dead_lettered_at INTEGER)` },
    { type: "table", name: "runtime_event_outbox", table: "runtime_event_outbox", sql: `CREATE TABLE runtime_event_outbox (
      project_scope TEXT NOT NULL, outbox_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_retry_at INTEGER, dead_lettered_at INTEGER,
      PRIMARY KEY(project_scope,outbox_id)
    )` },
];
export const FINAL_AUXILIARY_OBJECTS = [
    { type: "index", name: "idx_facts_subject_predicate", table: "facts", sql: `CREATE INDEX idx_facts_subject_predicate
        ON facts(subject, predicate_family, valid_from DESC)` },
    { type: "index", name: "idx_facts_entity_id", table: "facts", sql: `CREATE INDEX idx_facts_entity_id
        ON facts(entity_id, valid_from DESC)` },
    { type: "index", name: "idx_neurons_temporal", table: "neurons", sql: `CREATE INDEX idx_neurons_temporal ON neurons(timestamp)` },
    { type: "index", name: "idx_neurons_project", table: "neurons", sql: `CREATE INDEX idx_neurons_project ON neurons(project_id)` },
    { type: "index", name: "idx_neurons_type_project_created", table: "neurons", sql: `CREATE INDEX idx_neurons_type_project_created ON neurons(type, project_id, created_at DESC)` },
    { type: "index", name: "idx_neurons_status", table: "neurons", sql: `CREATE INDEX idx_neurons_status ON neurons(status, last_activated DESC)` },
    { type: "index", name: "idx_neurons_stability", table: "neurons", sql: `CREATE INDEX idx_neurons_stability ON neurons(stability DESC)` },
    { type: "index", name: "idx_neurons_repetitions", table: "neurons", sql: `CREATE INDEX idx_neurons_repetitions ON neurons(repetitions DESC)` },
    { type: "index", name: "idx_neurons_not_deleted", table: "neurons", sql: `CREATE INDEX idx_neurons_not_deleted ON neurons(is_deleted, updated_at DESC)` },
    { type: "index", name: "idx_synapses_source", table: "synapses", sql: `CREATE INDEX idx_synapses_source ON synapses(source_id)` },
    { type: "index", name: "idx_synapses_target", table: "synapses", sql: `CREATE INDEX idx_synapses_target ON synapses(target_id)` },
    { type: "index", name: "idx_neurons_topic_path", table: "neurons", sql: `CREATE INDEX idx_neurons_topic_path ON neurons(project_id, topic_path)` },
    { type: "index", name: "idx_neurons_pinned", table: "neurons", sql: `CREATE INDEX idx_neurons_pinned ON neurons(is_pinned) WHERE is_pinned = 1` },
    { type: "index", name: "idx_synapses_project_source", table: "synapses", sql: `CREATE INDEX idx_synapses_project_source ON synapses(project_id, source_id)` },
    { type: "index", name: "idx_memory_governance_operations_plan", table: "memory_governance_operations", sql: `CREATE INDEX idx_memory_governance_operations_plan
        ON memory_governance_operations(plan_id, created_at)` },
    { type: "index", name: "idx_memory_governance_audit_project", table: "memory_governance_audit", sql: `CREATE INDEX idx_memory_governance_audit_project
        ON memory_governance_audit(project_id, created_at DESC)` },
    { type: "index", name: "idx_entity_merge_candidates_project", table: "entity_merge_candidates", sql: `CREATE INDEX idx_entity_merge_candidates_project
        ON entity_merge_candidates(project_id, status, updated_at DESC)` },
    { type: "index", name: "idx_belief_graph_current", table: "belief_graph_nodes", sql: `CREATE UNIQUE INDEX idx_belief_graph_current
        ON belief_graph_nodes(project_id, canonical_key) WHERE status = 'active'` },
    { type: "index", name: "idx_belief_graph_history", table: "belief_graph_nodes", sql: `CREATE INDEX idx_belief_graph_history
        ON belief_graph_nodes(project_id, canonical_key, updated_at DESC)` },
    { type: "index", name: "idx_memory_timeline_project_time", table: "memory_timeline_entries", sql: `CREATE INDEX idx_memory_timeline_project_time
        ON memory_timeline_entries(project_id, occurred_at DESC)` },
    { type: "index", name: "idx_memory_timeline_canonical_time", table: "memory_timeline_entries", sql: `CREATE INDEX idx_memory_timeline_canonical_time
        ON memory_timeline_entries(project_id, canonical_key, occurred_at DESC)` },
    { type: "index", name: "idx_memory_timeline_entity_time", table: "memory_timeline_entries", sql: `CREATE INDEX idx_memory_timeline_entity_time
        ON memory_timeline_entries(project_id, entity_id, occurred_at DESC)` },
    { type: "index", name: "idx_context_activation_project_time", table: "context_activation_receipts", sql: `CREATE INDEX idx_context_activation_project_time
        ON context_activation_receipts(project_id, created_at DESC)` },
    { type: "index", name: "idx_prospective_project_status_due", table: "prospective_memories", sql: `CREATE INDEX idx_prospective_project_status_due
        ON prospective_memories(project_id, status, due_at, updated_at DESC)` },
    { type: "index", name: "idx_prospective_project_status_deferred", table: "prospective_memories", sql: `CREATE INDEX idx_prospective_project_status_deferred
        ON prospective_memories(project_id, status, deferred_until, updated_at DESC)` },
    { type: "index", name: "idx_prospective_project_key_version", table: "prospective_memories", sql: `CREATE INDEX idx_prospective_project_key_version
        ON prospective_memories(project_id, canonical_key, version DESC)` },
    { type: "index", name: "idx_prospective_project_key_version_unique", table: "prospective_memories", sql: `CREATE UNIQUE INDEX idx_prospective_project_key_version_unique
        ON prospective_memories(project_id, canonical_key, version)` },
    { type: "index", name: "idx_prospective_confirmation_evidence_unique", table: "prospective_memories", sql: `CREATE UNIQUE INDEX idx_prospective_confirmation_evidence_unique
        ON prospective_memories(project_id, confirmation_evidence_event_id)
        WHERE confirmation_evidence_event_id IS NOT NULL` },
    { type: "index", name: "idx_prospective_transitions_candidate", table: "prospective_memory_transitions", sql: `CREATE INDEX idx_prospective_transitions_candidate
        ON prospective_memory_transitions(candidate_id, created_at DESC)` },
    { type: "index", name: "idx_context_strategy_project_time", table: "context_strategy_outcomes", sql: `CREATE INDEX idx_context_strategy_project_time
        ON context_strategy_outcomes(project_id, created_at DESC)` },
    { type: "index", name: "idx_context_strategy_template_intent", table: "context_strategy_outcomes", sql: `CREATE INDEX idx_context_strategy_template_intent
        ON context_strategy_outcomes(strategy_template, intent, created_at DESC)` },
    { type: "index", name: "idx_memory_episodes_scope", table: "memory_episodes", sql: `CREATE INDEX idx_memory_episodes_scope
        ON memory_episodes(project_id, session_id, status, updated_at DESC)` },
    { type: "index", name: "idx_memory_episode_events_episode", table: "memory_episode_events", sql: `CREATE INDEX idx_memory_episode_events_episode
        ON memory_episode_events(episode_id, position)` },
    { type: "index", name: "idx_episode_closure_episode", table: "episode_closure_receipts", sql: `CREATE INDEX idx_episode_closure_episode
        ON episode_closure_receipts(episode_id, created_at DESC)` },
    { type: "index", name: "idx_episode_dream_jobs_queue", table: "episode_dream_jobs", sql: `CREATE INDEX idx_episode_dream_jobs_queue
        ON episode_dream_jobs(project_id, state, priority DESC, created_at)` },
    { type: "index", name: "idx_episode_dream_runs_project", table: "episode_dream_runs", sql: `CREATE INDEX idx_episode_dream_runs_project
        ON episode_dream_runs(project_id, created_at DESC)` },
    { type: "index", name: "idx_episode_ingest_identity", table: "episode_ingest_keys", sql: `CREATE UNIQUE INDEX idx_episode_ingest_identity
        ON episode_ingest_keys(project_id, source_agent, source_session_id, external_message_id)` },
    { type: "index", name: "idx_episode_event_dispositions_project", table: "episode_event_dispositions", sql: `CREATE INDEX idx_episode_event_dispositions_project
        ON episode_event_dispositions(project_id, disposition, created_at)` },
    { type: "index", name: "idx_memory_episodes_active_scope", table: "memory_episodes", sql: `CREATE INDEX idx_memory_episodes_active_scope
        ON memory_episodes(project_id, session_id, source_agent, conversation_thread_id, status, updated_at DESC)` },
    { type: "index", name: "idx_episode_dream_retry", table: "episode_dream_jobs", sql: `CREATE INDEX idx_episode_dream_retry
        ON episode_dream_jobs(state, retry_after, priority DESC, created_at)` },
    { type: "index", name: "idx_topic_nodes_project_status", table: "topic_nodes", sql: `CREATE INDEX idx_topic_nodes_project_status ON topic_nodes(project_id, status, last_used_at DESC)` },
    { type: "index", name: "idx_topic_alias_lookup", table: "topic_aliases", sql: `CREATE INDEX idx_topic_alias_lookup ON topic_aliases(project_id, normalized_alias, status)` },
    { type: "index", name: "idx_topic_relations_project", table: "topic_relations", sql: `CREATE INDEX idx_topic_relations_project ON topic_relations(project_id, source_topic_id, status)` },
    { type: "index", name: "idx_topic_operations_project", table: "topic_operations", sql: `CREATE INDEX idx_topic_operations_project ON topic_operations(project_id, created_at DESC)` },
    { type: "index", name: "idx_episode_cross_refs_episode", table: "episode_cross_refs", sql: `CREATE INDEX idx_episode_cross_refs_episode ON episode_cross_refs(project_id, episode_id, created_at)` },
    { type: "index", name: "idx_memory_atlas_documents_project_type", table: "memory_atlas_documents", sql: `CREATE INDEX idx_memory_atlas_documents_project_type
        ON memory_atlas_documents(project_id, node_type, updated_at DESC)` },
    { type: "index", name: "idx_memory_atlas_documents_project_topic", table: "memory_atlas_documents", sql: `CREATE INDEX idx_memory_atlas_documents_project_topic
        ON memory_atlas_documents(project_id, topic_path, updated_at DESC)` },
    { type: "index", name: "idx_memory_action_frames_query", table: "memory_action_frames", sql: `CREATE INDEX idx_memory_action_frames_query
        ON memory_action_frames(project_id, target_label, occurred_at DESC)` },
    { type: "index", name: "idx_memory_action_evidence_event", table: "memory_action_frame_evidence", sql: `CREATE INDEX idx_memory_action_evidence_event
        ON memory_action_frame_evidence(project_id, event_id)` },
    { type: "index", name: "idx_memory_atlas_access_node", table: "memory_atlas_access", sql: `CREATE INDEX idx_memory_atlas_access_node
        ON memory_atlas_access(project_id, node_id, accessed_at DESC)` },
    { type: "index", name: "idx_candidate_reviews_project_created", table: "deep_write_candidate_reviews", sql: `CREATE INDEX idx_candidate_reviews_project_created
        ON deep_write_candidate_reviews(project_id, created_at DESC)` },
    { type: "index", name: "idx_candidate_reviews_candidate_created", table: "deep_write_candidate_reviews", sql: `CREATE INDEX idx_candidate_reviews_candidate_created
        ON deep_write_candidate_reviews(candidate_id, created_at DESC)` },
    { type: "index", name: "idx_atlas_documents_project_occurred", table: "memory_atlas_documents", sql: `CREATE INDEX idx_atlas_documents_project_occurred
        ON memory_atlas_documents(project_id, occurred_at DESC, node_type)` },
    { type: "index", name: "idx_atlas_documents_project_kind", table: "memory_atlas_documents", sql: `CREATE INDEX idx_atlas_documents_project_kind
        ON memory_atlas_documents(project_id, memory_kind, occurred_at DESC)` },
    { type: "index", name: "idx_atlas_access_project_time", table: "memory_atlas_access", sql: `CREATE INDEX idx_atlas_access_project_time
        ON memory_atlas_access(project_id, accessed_at DESC)` },
    { type: "index", name: "idx_episode_boundary_project_created", table: "episode_boundary_decisions", sql: `CREATE INDEX idx_episode_boundary_project_created
        ON episode_boundary_decisions(project_id, created_at)` },
    { type: "index", name: "idx_episode_boundary_previous", table: "episode_boundary_decisions", sql: `CREATE INDEX idx_episode_boundary_previous
        ON episode_boundary_decisions(previous_episode_id)` },
    { type: "index", name: "idx_episode_boundary_resulting", table: "episode_boundary_decisions", sql: `CREATE INDEX idx_episode_boundary_resulting
        ON episode_boundary_decisions(resulting_episode_id)` },
    { type: "index", name: "idx_episode_boundary_primary", table: "episode_boundary_decisions", sql: `CREATE INDEX idx_episode_boundary_primary
        ON episode_boundary_decisions(primary_event_id)` },
    { type: "index", name: "idx_memory_episodes_one_active_scope", table: "memory_episodes", sql: `CREATE UNIQUE INDEX idx_memory_episodes_one_active_scope
        ON memory_episodes(project_id, session_id, COALESCE(source_agent, ''), COALESCE(conversation_thread_id, ''))
        WHERE status = 'open'` },
    { type: "index", name: "idx_memory_episode_events_episode_position_unique", table: "memory_episode_events", sql: `CREATE UNIQUE INDEX idx_memory_episode_events_episode_position_unique
          ON memory_episode_events(episode_id, position)` },
    { type: "index", name: "idx_memory_atlas_aliases_lookup", table: "memory_atlas_aliases", sql: `CREATE INDEX idx_memory_atlas_aliases_lookup
        ON memory_atlas_aliases(project_id, dimension, normalized_alias, status)` },
    { type: "index", name: "idx_memory_atlas_supports_node", table: "memory_atlas_supports", sql: `CREATE INDEX idx_memory_atlas_supports_node
        ON memory_atlas_supports(project_id, node_id, status)` },
    { type: "index", name: "idx_memory_atlas_supports_source", table: "memory_atlas_supports", sql: `CREATE INDEX idx_memory_atlas_supports_source
        ON memory_atlas_supports(project_id, source_type, source_id, status)` },
    { type: "index", name: "idx_memory_atlas_alias_support_identity", table: "memory_atlas_alias_supports", sql: `CREATE UNIQUE INDEX idx_memory_atlas_alias_support_identity
        ON memory_atlas_alias_supports(alias_id, source_frame_id)` },
    { type: "index", name: "idx_memory_atlas_alias_support_lookup", table: "memory_atlas_alias_supports", sql: `CREATE INDEX idx_memory_atlas_alias_support_lookup
        ON memory_atlas_alias_supports(project_id, node_id, status)` },
    { type: "index", name: "idx_memory_atlas_supports_reduction", table: "memory_atlas_supports", sql: `CREATE INDEX idx_memory_atlas_supports_reduction
        ON memory_atlas_supports(project_id, node_id, source_authority, status, confidence)` },
    { type: "index", name: "idx_memory_atlas_alias_supports_reduction", table: "memory_atlas_alias_supports", sql: `CREATE INDEX idx_memory_atlas_alias_supports_reduction
        ON memory_atlas_alias_supports(project_id, alias_id, source_authority, status, confidence)` },
    { type: "index", name: "idx_topology_time_rebuild_entries_neuron", table: "topology_time_rebuild_entries", sql: `CREATE INDEX idx_topology_time_rebuild_entries_neuron
        ON topology_time_rebuild_entries(generation,created_at,neuron_id)` },
    { type: "index", name: "idx_topology_time_rebuild_active_neurons", table: "topology_time_rebuild_active_neurons", sql: `CREATE INDEX idx_topology_time_rebuild_active_neurons
        ON topology_time_rebuild_active_neurons(generation,created_at,neuron_id)` },
    { type: "index", name: "idx_ingestion_processed_source_window", table: "ingestion_processed_records", sql: `CREATE INDEX idx_ingestion_processed_source_window
    ON ingestion_processed_records(project_scope,source_id,content_window_start,content_window_end,processed_at DESC)` },
    { type: "index", name: "idx_policy_executions_runtime", table: "policy_executions", sql: `CREATE INDEX idx_policy_executions_runtime
    ON policy_executions(project_scope,runtime_id,updated_at DESC)` },
    { type: "index", name: "idx_policy_executions_policy_group", table: "policy_executions", sql: `CREATE INDEX idx_policy_executions_policy_group
    ON policy_executions(project_scope,policy_group,updated_at DESC)` },
    { type: "index", name: "idx_entities_name_type", table: "entities", sql: `CREATE INDEX idx_entities_name_type
        ON entities(canonical_name, type, updated_at DESC)` },
    { type: "index", name: "idx_entity_instances_name_type", table: "entity_instances", sql: `CREATE INDEX idx_entity_instances_name_type
        ON entity_instances(canonical_name, type, updated_at DESC)` },
    { type: "index", name: "idx_entity_attributes_lookup", table: "entity_attributes", sql: `CREATE INDEX idx_entity_attributes_lookup
        ON entity_attributes(entity_id, attribute_key, updated_at DESC)` },
    { type: "index", name: "idx_pending_entity_resolution_status", table: "pending_entity_resolution", sql: `CREATE INDEX idx_pending_entity_resolution_status
        ON pending_entity_resolution(status, updated_at DESC)` },
    { type: "index", name: "idx_entity_mentions_entity", table: "entity_mentions", sql: `CREATE INDEX idx_entity_mentions_entity
        ON entity_mentions(entity_id, created_at DESC)` },
    { type: "index", name: "idx_entity_mentions_project", table: "entity_mentions", sql: `CREATE INDEX idx_entity_mentions_project
        ON entity_mentions(project_id, created_at DESC)` },
    { type: "index", name: "idx_pending_entity_resolution_scope", table: "pending_entity_resolution", sql: `CREATE INDEX idx_pending_entity_resolution_scope
      ON pending_entity_resolution(project_scope,status,updated_at DESC)` },
    { type: "index", name: "idx_governance_audit_project", table: "governance_audit_log", sql: `CREATE INDEX idx_governance_audit_project
        ON governance_audit_log(project_id, created_at DESC)` },
    { type: "index", name: "idx_beliefs_canonical", table: "beliefs", sql: `CREATE INDEX idx_beliefs_canonical ON beliefs(canonical_key, status, valid_from DESC)` },
    { type: "index", name: "idx_beliefs_subject_predicate", table: "beliefs", sql: `CREATE INDEX idx_beliefs_subject_predicate ON beliefs(subject, predicate, status, valid_from DESC)` },
    { type: "index", name: "idx_vector_index_dimensions", table: "vector_index", sql: `CREATE INDEX idx_vector_index_dimensions
        ON vector_index(dimensions)` },
    { type: "index", name: "idx_project_branches_project", table: "project_branches", sql: `CREATE INDEX idx_project_branches_project
        ON project_branches(project_id, updated_at DESC)` },
    { type: "index", name: "idx_topology_membership_project", table: "topology_membership", sql: `CREATE INDEX idx_topology_membership_project
        ON topology_membership(project_id, dimension_type, created_at DESC)` },
    { type: "index", name: "idx_topology_membership_dimension", table: "topology_membership", sql: `CREATE INDEX idx_topology_membership_dimension
        ON topology_membership(dimension_type, dimension_key, created_at DESC)` },
    { type: "index", name: "idx_branch_entries_reference_unique", table: "branch_entries", sql: `CREATE UNIQUE INDEX idx_branch_entries_reference_unique
        ON branch_entries(branch_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''))` },
    { type: "trigger", name: "trg_project_branch_scope_immutable", table: "project_branches", sql: `CREATE TRIGGER trg_project_branch_scope_immutable
      BEFORE UPDATE OF project_id,branch_key ON project_branches
      WHEN NEW.project_id<>OLD.project_id OR NEW.branch_key<>OLD.branch_key
      BEGIN SELECT RAISE(ABORT,'project_branch_identity_conflict'); END` },
    { type: "trigger", name: "trg_branch_link_scope_insert", table: "branch_links", sql: `CREATE TRIGGER trg_branch_link_scope_insert
      BEFORE INSERT ON branch_links
      WHEN NOT EXISTS (
        SELECT 1 FROM project_branches p JOIN project_branches c
          ON p.project_id=c.project_id
        WHERE p.branch_id=NEW.parent_branch_id AND c.branch_id=NEW.child_branch_id
          AND p.project_id=COALESCE(NEW.project_id,'')
      )
      BEGIN SELECT RAISE(ABORT,'topology_branch_link_project_scope_mismatch'); END` },
    { type: "trigger", name: "trg_branch_link_scope_update", table: "branch_links", sql: `CREATE TRIGGER trg_branch_link_scope_update
      BEFORE UPDATE ON branch_links
      WHEN NOT EXISTS (
        SELECT 1 FROM project_branches p JOIN project_branches c
          ON p.project_id=c.project_id
        WHERE p.branch_id=NEW.parent_branch_id AND c.branch_id=NEW.child_branch_id
          AND p.project_id=COALESCE(NEW.project_id,'')
      )
      BEGIN SELECT RAISE(ABORT,'topology_branch_link_project_scope_mismatch'); END` },
    { type: "trigger", name: "trg_branch_entry_parent_scope_insert", table: "branch_entries", sql: `CREATE TRIGGER trg_branch_entry_parent_scope_insert
      BEFORE INSERT ON branch_entries
      WHEN NOT EXISTS (SELECT 1 FROM project_branches p WHERE p.branch_id=NEW.branch_id AND p.project_id=COALESCE(NEW.project_id,''))
      BEGIN SELECT RAISE(ABORT,'topology_reference_project_scope_mismatch'); END` },
    { type: "trigger", name: "trg_branch_entry_parent_scope_update", table: "branch_entries", sql: `CREATE TRIGGER trg_branch_entry_parent_scope_update
      BEFORE UPDATE ON branch_entries
      WHEN NOT EXISTS (SELECT 1 FROM project_branches p WHERE p.branch_id=NEW.branch_id AND p.project_id=COALESCE(NEW.project_id,''))
      BEGIN SELECT RAISE(ABORT,'topology_reference_project_scope_mismatch'); END` },
    { type: "index", name: "idx_pending_bindings_status_time", table: "pending_bindings", sql: `CREATE INDEX idx_pending_bindings_status_time
        ON pending_bindings(status, updated_at DESC)` },
    { type: "index", name: "idx_compiler_confidence_target", table: "compiler_confidence_runs", sql: `CREATE INDEX idx_compiler_confidence_target
        ON compiler_confidence_runs(target_type, target_id, created_at DESC)` },
    { type: "index", name: "idx_compiler_confidence_project", table: "compiler_confidence_runs", sql: `CREATE INDEX idx_compiler_confidence_project
        ON compiler_confidence_runs(project_id, created_at DESC)` },
    { type: "index", name: "idx_memory_activation_project", table: "memory_activation", sql: `CREATE INDEX idx_memory_activation_project
        ON memory_activation(project_id, activation DESC, last_touched_at DESC)` },
    { type: "index", name: "idx_memory_entities_project_name", table: "memory_entities", sql: `CREATE INDEX idx_memory_entities_project_name
        ON memory_entities(project_id, canonical_name)` },
    { type: "index", name: "idx_memory_topics_project", table: "memory_topics", sql: `CREATE INDEX idx_memory_topics_project
        ON memory_topics(project_id, parent_path)` },
    { type: "index", name: "idx_memory_bindings_project_topic", table: "memory_bindings", sql: `CREATE INDEX idx_memory_bindings_project_topic
        ON memory_bindings(project_id, topic_path, created_at DESC)` },
    { type: "index", name: "idx_memory_bindings_event", table: "memory_bindings", sql: `CREATE INDEX idx_memory_bindings_event
        ON memory_bindings(event_id)` },
    { type: "index", name: "idx_memory_bindings_entity", table: "memory_bindings", sql: `CREATE INDEX idx_memory_bindings_entity
        ON memory_bindings(project_id, entity_name)` },
    { type: "index", name: "idx_memory_clusters_project_topic", table: "memory_clusters", sql: `CREATE INDEX idx_memory_clusters_project_topic
        ON memory_clusters(project_id, topic_path, updated_at DESC)` },
    { type: "index", name: "idx_memory_edges_project_source", table: "memory_edges", sql: `CREATE INDEX idx_memory_edges_project_source
        ON memory_edges(project_id, source_type, source_id)` },
    { type: "index", name: "idx_memory_edges_project_target", table: "memory_edges", sql: `CREATE INDEX idx_memory_edges_project_target
        ON memory_edges(project_id, target_type, target_id)` },
    { type: "index", name: "idx_memory_edges_logical_unique", table: "memory_edges", sql: `CREATE UNIQUE INDEX idx_memory_edges_logical_unique
        ON memory_edges(COALESCE(project_id,''),source_type,source_id,relation_type,target_type,target_id)` },
    { type: "index", name: "idx_pipeline_runs_completed_at", table: "pipeline_runs", sql: `CREATE INDEX idx_pipeline_runs_completed_at
        ON pipeline_runs(completed_at DESC)` },
    { type: "index", name: "idx_pipeline_step_name", table: "pipeline_step_timings", sql: `CREATE INDEX idx_pipeline_step_name
        ON pipeline_step_timings(step_name, completed_at DESC)` },
    { type: "index", name: "idx_pipeline_nonfatal_kind_project", table: "pipeline_nonfatal_events", sql: `CREATE INDEX idx_pipeline_nonfatal_kind_project
        ON pipeline_nonfatal_events(kind, project_id, occurred_at DESC)` },
    { type: "index", name: "idx_deep_write_summaries_project_scope", table: "deep_write_summaries", sql: `CREATE INDEX idx_deep_write_summaries_project_scope
        ON deep_write_summaries(project_id, scope, window_end DESC)` },
    { type: "index", name: "idx_deep_write_summaries_session", table: "deep_write_summaries", sql: `CREATE INDEX idx_deep_write_summaries_session
        ON deep_write_summaries(session_id, created_at DESC)` },
    { type: "trigger", name: "deep_write_summaries_ai", table: "deep_write_summaries", sql: `CREATE TRIGGER deep_write_summaries_ai
      AFTER INSERT ON deep_write_summaries BEGIN
        INSERT INTO deep_write_summaries_fts(rowid, text) VALUES (new.rowid, new.text);
      END` },
    { type: "trigger", name: "deep_write_summaries_ad", table: "deep_write_summaries", sql: `CREATE TRIGGER deep_write_summaries_ad
      AFTER DELETE ON deep_write_summaries BEGIN
        INSERT INTO deep_write_summaries_fts(deep_write_summaries_fts, rowid, text)
        VALUES('delete', old.rowid, old.text);
      END` },
    { type: "trigger", name: "deep_write_summaries_au", table: "deep_write_summaries", sql: `CREATE TRIGGER deep_write_summaries_au
      AFTER UPDATE ON deep_write_summaries BEGIN
        INSERT INTO deep_write_summaries_fts(deep_write_summaries_fts, rowid, text)
        VALUES('delete', old.rowid, old.text);
        INSERT INTO deep_write_summaries_fts(rowid, text) VALUES (new.rowid, new.text);
      END` },
    { type: "index", name: "idx_deep_write_runs_project_created", table: "deep_write_runs", sql: `CREATE INDEX idx_deep_write_runs_project_created
        ON deep_write_runs(project_id, created_at DESC)` },
    { type: "index", name: "idx_deep_write_candidates_run", table: "deep_write_candidates", sql: `CREATE INDEX idx_deep_write_candidates_run
        ON deep_write_candidates(run_id)` },
    { type: "index", name: "idx_deep_write_candidates_status", table: "deep_write_candidates", sql: `CREATE INDEX idx_deep_write_candidates_status
        ON deep_write_candidates(status, candidate_type)` },
    { type: "index", name: "idx_working_memory_deltas_created", table: "working_memory_deltas", sql: `CREATE INDEX idx_working_memory_deltas_created
        ON working_memory_deltas(created_at ASC)` },
    { type: "index", name: "idx_working_memory_deltas_project", table: "working_memory_deltas", sql: `CREATE INDEX idx_working_memory_deltas_project
        ON working_memory_deltas(project_id, created_at ASC)` },
    { type: "index", name: "idx_memory_frames_project_status", table: "memory_frames", sql: `CREATE INDEX idx_memory_frames_project_status ON memory_frames(project_id, status, updated_at DESC)` },
    { type: "index", name: "idx_memory_frames_episode", table: "memory_frames", sql: `CREATE INDEX idx_memory_frames_episode ON memory_frames(project_id, episode_id, updated_at DESC)` },
    { type: "index", name: "idx_memory_frame_nodes_lookup", table: "memory_frame_nodes", sql: `CREATE INDEX idx_memory_frame_nodes_lookup ON memory_frame_nodes(dimension, label, confidence DESC)` },
    { type: "index", name: "idx_memory_frame_relations_frame", table: "memory_frame_relations", sql: `CREATE INDEX idx_memory_frame_relations_frame ON memory_frame_relations(frame_id, relation_type)` },
    { type: "index", name: "idx_memory_frames_dream_lease", table: "memory_frames", sql: `CREATE INDEX idx_memory_frames_dream_lease ON memory_frames(status, dream_lease_until)` },
    { type: "index", name: "idx_memory_frames_revision_number", table: "memory_frames", sql: `CREATE UNIQUE INDEX idx_memory_frames_revision_number ON memory_frames(episode_id, source_fingerprint, processor_prompt_version, revision_number)` },
    { type: "index", name: "idx_memory_frames_one_active_episode", table: "memory_frames", sql: `CREATE UNIQUE INDEX idx_memory_frames_one_active_episode
        ON memory_frames(episode_id) WHERE status='active'` },
    { type: "index", name: "idx_time_buckets_project_range", table: "time_buckets", sql: `CREATE INDEX idx_time_buckets_project_range ON time_buckets(project_id,time_zone,bucket_type,bucket_start,bucket_end)` },
    { type: "index", name: "idx_temporal_adjacency_source", table: "temporal_adjacency", sql: `CREATE INDEX idx_temporal_adjacency_source ON temporal_adjacency(source_bucket_id,created_at DESC)` },
    { type: "index", name: "idx_cognitive_nodes_type_project", table: "cognitive_nodes", sql: `CREATE INDEX idx_cognitive_nodes_type_project ON cognitive_nodes(node_type,project_id,updated_at DESC)` },
    { type: "index", name: "idx_cognitive_nodes_title", table: "cognitive_nodes", sql: `CREATE INDEX idx_cognitive_nodes_title ON cognitive_nodes(title,updated_at DESC)` },
    { type: "index", name: "idx_cognitive_edges_source", table: "cognitive_edges", sql: `CREATE INDEX idx_cognitive_edges_source ON cognitive_edges(source_node_id,created_at DESC)` },
    { type: "index", name: "idx_cognitive_edges_target", table: "cognitive_edges", sql: `CREATE INDEX idx_cognitive_edges_target ON cognitive_edges(target_node_id,created_at DESC)` },
    { type: "index", name: "idx_cognitive_edges_project", table: "cognitive_edges", sql: `CREATE INDEX idx_cognitive_edges_project ON cognitive_edges(project_id,edge_type,created_at DESC)` },
    { type: "index", name: "idx_time_bucket_entries_bucket", table: "time_bucket_entries", sql: `CREATE INDEX idx_time_bucket_entries_bucket ON time_bucket_entries(bucket_id,created_at DESC)` },
    { type: "index", name: "idx_time_bucket_entries_reference_unique", table: "time_bucket_entries", sql: `CREATE UNIQUE INDEX idx_time_bucket_entries_reference_unique ON time_bucket_entries(bucket_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''))` },
    { type: "index", name: "idx_task_branch_entries_reference_unique", table: "task_branch_entries", sql: `CREATE UNIQUE INDEX idx_task_branch_entries_reference_unique ON task_branch_entries(task_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''))` },
    { type: "index", name: "idx_task_branches_project", table: "task_branches", sql: `CREATE INDEX idx_task_branches_project ON task_branches(project_id,updated_at DESC)` },
    { type: "index", name: "idx_event_cluster_entries_reference_unique", table: "event_cluster_entries", sql: `CREATE UNIQUE INDEX idx_event_cluster_entries_reference_unique ON event_cluster_entries(cluster_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''))` },
    { type: "index", name: "idx_event_clusters_project", table: "event_clusters", sql: `CREATE INDEX idx_event_clusters_project ON event_clusters(project_id,updated_at DESC)` },
    { type: "index", name: "idx_entity_aliases_lookup", table: "entity_aliases", sql: `CREATE INDEX idx_entity_aliases_lookup ON entity_aliases(project_id,normalized_alias,updated_at DESC)` },
    { type: "index", name: "idx_entity_alias_conflicts_lookup", table: "entity_alias_conflicts", sql: `CREATE INDEX idx_entity_alias_conflicts_lookup ON entity_alias_conflicts(project_id,normalized_alias,entity_type,status)` },
    { type: "index", name: "idx_memory_events_stream", table: "memory_events", sql: `CREATE INDEX idx_memory_events_stream ON memory_events(project_scope,stream_type,stream_id,event_version)` },
    { type: "index", name: "idx_memory_events_type_time", table: "memory_events", sql: `CREATE INDEX idx_memory_events_type_time ON memory_events(event_type,occurred_at DESC)` },
    { type: "index", name: "idx_memory_events_global_seq", table: "memory_events", sql: `CREATE INDEX idx_memory_events_global_seq ON memory_events(global_seq)` },
    { type: "index", name: "idx_memory_events_thread_order", table: "memory_events", sql: `CREATE INDEX idx_memory_events_thread_order ON memory_events(project_scope,thread_id,thread_seq,event_ordinal,global_seq)` },
    { type: "index", name: "idx_memory_events_parent", table: "memory_events", sql: `CREATE INDEX idx_memory_events_parent ON memory_events(parent_event_id)` },
    { type: "index", name: "idx_neuron_embeddings_project", table: "neuron_embeddings", sql: `CREATE INDEX idx_neuron_embeddings_project ON neuron_embeddings(project_id,model_id)` },
    { type: "index", name: "idx_beliefs_project_canonical", table: "beliefs", sql: `CREATE INDEX idx_beliefs_project_canonical
    ON beliefs(project_id,canonical_key,status,valid_from DESC)` },
    { type: "trigger", name: "synapses_scope_insert", table: "synapses", sql: `CREATE TRIGGER synapses_scope_insert BEFORE INSERT ON synapses
    WHEN NOT EXISTS (
    SELECT 1 FROM neurons a JOIN neurons b ON b.id=NEW.target_id
    WHERE a.id=NEW.source_id AND a.is_deleted=0 AND b.is_deleted=0
      AND COALESCE(a.project_id,'')=COALESCE(b.project_id,'')
      AND NEW.project_id=COALESCE(a.project_id,'')) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "synapses_scope_update", table: "synapses", sql: `CREATE TRIGGER synapses_scope_update BEFORE UPDATE ON synapses
    WHEN NOT EXISTS (
    SELECT 1 FROM neurons a JOIN neurons b ON b.id=NEW.target_id
    WHERE a.id=NEW.source_id AND a.is_deleted=0 AND b.is_deleted=0
      AND COALESCE(a.project_id,'')=COALESCE(b.project_id,'')
      AND NEW.project_id=COALESCE(a.project_id,'')) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "belief_evidence_scope_insert", table: "belief_evidence", sql: `CREATE TRIGGER belief_evidence_scope_insert BEFORE INSERT ON belief_evidence
    WHEN (NEW.neuron_id IS NULL AND NEW.event_id IS NULL)
    OR NOT EXISTS (SELECT 1 FROM beliefs b WHERE b.id=NEW.belief_id)
    OR (NEW.neuron_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM beliefs b JOIN neurons n ON n.id=NEW.neuron_id AND n.is_deleted=0
      WHERE b.id=NEW.belief_id AND COALESCE(b.project_id,'')=COALESCE(n.project_id,'')
    ))
    OR (NEW.event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM beliefs b JOIN memory_events e ON e.event_id=NEW.event_id
      WHERE b.id=NEW.belief_id AND COALESCE(b.project_id,'')=COALESCE(e.project_id,'')
    )) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "belief_evidence_scope_update", table: "belief_evidence", sql: `CREATE TRIGGER belief_evidence_scope_update BEFORE UPDATE ON belief_evidence
    WHEN (NEW.neuron_id IS NULL AND NEW.event_id IS NULL)
    OR NOT EXISTS (SELECT 1 FROM beliefs b WHERE b.id=NEW.belief_id)
    OR (NEW.neuron_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM beliefs b JOIN neurons n ON n.id=NEW.neuron_id AND n.is_deleted=0
      WHERE b.id=NEW.belief_id AND COALESCE(b.project_id,'')=COALESCE(n.project_id,'')
    ))
    OR (NEW.event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM beliefs b JOIN memory_events e ON e.event_id=NEW.event_id
      WHERE b.id=NEW.belief_id AND COALESCE(b.project_id,'')=COALESCE(e.project_id,'')
    )) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "cognitive_node_source_insert", table: "cognitive_nodes", sql: `CREATE TRIGGER cognitive_node_source_insert BEFORE INSERT ON cognitive_nodes
    WHEN NEW.source_neuron_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM neurons n WHERE n.id=NEW.source_neuron_id AND n.is_deleted=0
      AND COALESCE(n.project_id,'')=NEW.project_id) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "cognitive_node_source_update", table: "cognitive_nodes", sql: `CREATE TRIGGER cognitive_node_source_update BEFORE UPDATE ON cognitive_nodes
    WHEN NEW.source_neuron_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM neurons n WHERE n.id=NEW.source_neuron_id AND n.is_deleted=0
      AND COALESCE(n.project_id,'')=NEW.project_id) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "pending_entity_scope_insert", table: "pending_entity_resolution", sql: `CREATE TRIGGER pending_entity_scope_insert BEFORE INSERT ON pending_entity_resolution
    WHEN NEW.context_neuron_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM neurons n WHERE n.id=NEW.context_neuron_id AND n.is_deleted=0
      AND COALESCE(n.project_id,'')=NEW.project_scope) OR (NEW.status='resolved' AND (
        NEW.resolved_entity_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM entity_instances i WHERE i.instance_id=NEW.resolved_entity_id AND i.status='active'
            AND (json_extract(i.metadata_json,'$.projectId')=NEW.project_scope OR EXISTS (
              SELECT 1 FROM entity_mentions m WHERE m.entity_id=i.instance_id
                AND COALESCE(m.project_id,'')=NEW.project_scope
            ))
        )
      )) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "pending_entity_scope_update", table: "pending_entity_resolution", sql: `CREATE TRIGGER pending_entity_scope_update BEFORE UPDATE ON pending_entity_resolution
    WHEN NEW.context_neuron_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM neurons n WHERE n.id=NEW.context_neuron_id AND n.is_deleted=0
      AND COALESCE(n.project_id,'')=NEW.project_scope) OR (NEW.status='resolved' AND (
        NEW.resolved_entity_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM entity_instances i WHERE i.instance_id=NEW.resolved_entity_id AND i.status='active'
            AND (json_extract(i.metadata_json,'$.projectId')=NEW.project_scope OR EXISTS (
              SELECT 1 FROM entity_mentions m WHERE m.entity_id=i.instance_id
                AND COALESCE(m.project_id,'')=NEW.project_scope
            ))
        )
      )) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "memory_binding_scope_insert", table: "memory_bindings", sql: `CREATE TRIGGER memory_binding_scope_insert BEFORE INSERT ON memory_bindings
    WHEN NOT EXISTS (
    SELECT 1 FROM memory_events e WHERE e.event_id=NEW.event_id
      AND COALESCE(e.project_id,'')=COALESCE(NEW.project_id,'')
  ) OR NOT EXISTS (
    SELECT 1 FROM memory_topics t WHERE t.topic_path=NEW.topic_path
      AND COALESCE(t.project_id,'')=COALESCE(NEW.project_id,'')
  ) OR (NEW.entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memory_entities e WHERE e.entity_id=NEW.entity_id
      AND COALESCE(e.project_id,'')=COALESCE(NEW.project_id,'')
  )) OR (NEW.cluster_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memory_clusters c WHERE c.cluster_id=NEW.cluster_id
      AND COALESCE(c.project_id,'')=COALESCE(NEW.project_id,'')
  )) OR NOT json_valid(NEW.related_event_ids_json) OR EXISTS (
    SELECT 1 FROM json_each(CASE WHEN json_valid(NEW.related_event_ids_json) THEN NEW.related_event_ids_json ELSE '[]' END) r
    WHERE r.type<>'text' OR NOT EXISTS (
      SELECT 1 FROM memory_events e WHERE e.event_id=r.value
        AND COALESCE(e.project_id,'')=COALESCE(NEW.project_id,'')
    )
  ) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "memory_binding_scope_update", table: "memory_bindings", sql: `CREATE TRIGGER memory_binding_scope_update BEFORE UPDATE ON memory_bindings
    WHEN NOT EXISTS (
    SELECT 1 FROM memory_events e WHERE e.event_id=NEW.event_id
      AND COALESCE(e.project_id,'')=COALESCE(NEW.project_id,'')
  ) OR NOT EXISTS (
    SELECT 1 FROM memory_topics t WHERE t.topic_path=NEW.topic_path
      AND COALESCE(t.project_id,'')=COALESCE(NEW.project_id,'')
  ) OR (NEW.entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memory_entities e WHERE e.entity_id=NEW.entity_id
      AND COALESCE(e.project_id,'')=COALESCE(NEW.project_id,'')
  )) OR (NEW.cluster_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memory_clusters c WHERE c.cluster_id=NEW.cluster_id
      AND COALESCE(c.project_id,'')=COALESCE(NEW.project_id,'')
  )) OR NOT json_valid(NEW.related_event_ids_json) OR EXISTS (
    SELECT 1 FROM json_each(CASE WHEN json_valid(NEW.related_event_ids_json) THEN NEW.related_event_ids_json ELSE '[]' END) r
    WHERE r.type<>'text' OR NOT EXISTS (
      SELECT 1 FROM memory_events e WHERE e.event_id=r.value
        AND COALESCE(e.project_id,'')=COALESCE(NEW.project_id,'')
    )
  ) BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_entities_insert", table: "memory_entities", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_entities_insert AFTER INSERT ON memory_entities BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_entities_update", table: "memory_entities", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_entities_update AFTER UPDATE ON memory_entities BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_entities_delete", table: "memory_entities", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_entities_delete AFTER DELETE ON memory_entities BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_topics_insert", table: "memory_topics", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_topics_insert AFTER INSERT ON memory_topics BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_topics_update", table: "memory_topics", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_topics_update AFTER UPDATE ON memory_topics BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_topics_delete", table: "memory_topics", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_topics_delete AFTER DELETE ON memory_topics BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_clusters_insert", table: "memory_clusters", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_clusters_insert AFTER INSERT ON memory_clusters BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_clusters_update", table: "memory_clusters", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_clusters_update AFTER UPDATE ON memory_clusters BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_clusters_delete", table: "memory_clusters", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_clusters_delete AFTER DELETE ON memory_clusters BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_episodes_insert", table: "memory_episodes", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_episodes_insert AFTER INSERT ON memory_episodes BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_episodes_update", table: "memory_episodes", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_episodes_update AFTER UPDATE ON memory_episodes BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_episodes_delete", table: "memory_episodes", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_episodes_delete AFTER DELETE ON memory_episodes BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_beliefs_insert", table: "beliefs", sql: `CREATE TRIGGER trg_memory_atlas_dirty_beliefs_insert AFTER INSERT ON beliefs BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_beliefs_update", table: "beliefs", sql: `CREATE TRIGGER trg_memory_atlas_dirty_beliefs_update AFTER UPDATE ON beliefs BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_beliefs_delete", table: "beliefs", sql: `CREATE TRIGGER trg_memory_atlas_dirty_beliefs_delete AFTER DELETE ON beliefs BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_bindings_insert", table: "memory_bindings", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_bindings_insert AFTER INSERT ON memory_bindings BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_bindings_update", table: "memory_bindings", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_bindings_update AFTER UPDATE ON memory_bindings BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_bindings_delete", table: "memory_bindings", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_bindings_delete AFTER DELETE ON memory_bindings BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_nodes_insert", table: "topic_nodes", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_nodes_insert AFTER INSERT ON topic_nodes BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_nodes_update", table: "topic_nodes", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_nodes_update AFTER UPDATE ON topic_nodes BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_nodes_delete", table: "topic_nodes", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_nodes_delete AFTER DELETE ON topic_nodes BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_aliases_insert", table: "topic_aliases", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_aliases_insert AFTER INSERT ON topic_aliases BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_aliases_update", table: "topic_aliases", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_aliases_update AFTER UPDATE ON topic_aliases BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_aliases_delete", table: "topic_aliases", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_aliases_delete AFTER DELETE ON topic_aliases BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_relations_insert", table: "topic_relations", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_relations_insert AFTER INSERT ON topic_relations BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_relations_update", table: "topic_relations", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_relations_update AFTER UPDATE ON topic_relations BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_topic_relations_delete", table: "topic_relations", sql: `CREATE TRIGGER trg_memory_atlas_dirty_topic_relations_delete AFTER DELETE ON topic_relations BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE 1
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


        END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_events_insert", table: "memory_events", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_events_insert AFTER INSERT ON memory_events
        WHEN NEW.role IN ('user','tool') BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE NEW.role IN ('user','tool')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE NEW.role IN ('user','tool')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


      END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_events_update", table: "memory_events", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_events_update AFTER UPDATE OF project_id,role,payload_json,occurred_at,local_date,event_type ON memory_events
        WHEN NEW.role IN ('user','tool') OR OLD.role IN ('user','tool') BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE NEW.role IN ('user','tool')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(NEW.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE NEW.role IN ('user','tool')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE OLD.role IN ('user','tool')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE OLD.role IN ('user','tool')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;

      END` },
    { type: "trigger", name: "trg_memory_atlas_dirty_memory_events_delete", table: "memory_events", sql: `CREATE TRIGGER trg_memory_atlas_dirty_memory_events_delete AFTER DELETE ON memory_events
        WHEN OLD.role IN ('user','tool') BEGIN

    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE OLD.role IN ('user','tool')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT COALESCE(OLD.project_id,''),'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE OLD.role IN ('user','tool')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;


      END` },
    { type: "index", name: "idx_policy_execution_read_model_runtime", table: "policy_execution_read_model", sql: `CREATE INDEX idx_policy_execution_read_model_runtime ON policy_execution_read_model(project_scope,runtime_id,updated_at)` },
    { type: "index", name: "idx_runtime_states_scope_runtime", table: "runtime_states", sql: `CREATE INDEX idx_runtime_states_scope_runtime ON runtime_states(project_scope,runtime_id,entity_type,updated_at)` },
    { type: "index", name: "idx_runtime_transitions_scope_runtime", table: "runtime_transitions", sql: `CREATE INDEX idx_runtime_transitions_scope_runtime ON runtime_transitions(project_scope,runtime_id,occurred_at)` },
    { type: "index", name: "idx_runtime_event_outbox_scope", table: "runtime_event_outbox", sql: `CREATE INDEX idx_runtime_event_outbox_scope ON runtime_event_outbox(project_scope,created_at,outbox_id)` },
    { type: "index", name: "idx_runtime_projection_states_scope", table: "runtime_projection_states", sql: `CREATE INDEX idx_runtime_projection_states_scope ON runtime_projection_states(projection_name,project_scope,runtime_id)` },
    { type: "index", name: "idx_runtime_projection_transitions_scope", table: "runtime_projection_transitions", sql: `CREATE INDEX idx_runtime_projection_transitions_scope ON runtime_projection_transitions(projection_name,project_scope,runtime_id)` },
];
