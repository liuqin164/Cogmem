import type { Migration } from '../types/Migration.js';
import { migration_0001 } from './0001_init.js';
import { migration_0002 } from './0002_v06_platform.js';
import { migration_0003 } from './0003_v07_dialogues.js';
import { migration_0004 } from './0004_v09_self_improvement.js';
import { migration_0005 } from './0005_dialogue_buffer.js';
import { migration_0006 } from './0006_deep_write_memory.js';
import { migration_0007 } from './0007_deep_write_summaries.js';
import { migration_0009 } from './0009_memory_importance.js';
import { migration_0010 } from './0010_skill_neurons.js';
import { migration_0011 } from './0011_topic_path.js';
import { migration_0012 } from './0012_governance_security.js';
import { migration_0015 } from './0015_memory_governance.js';
import { migration_0016 } from './0016_entity_governance.js';
import { migration_0017 } from './0017_belief_graph.js';
import { migration_0018 } from './0018_temporal_memory.js';
import { migration_0019 } from './0019_context_cortex.js';
import { migration_0020 } from './0020_prospective_memory.js';
import { migration_0021 } from './0021_strategy_cortex.js';
import { migration_0022 } from './0022_episode_dream_engine.js';
import { migration_0023 } from './0023_episode_dream_hardening.js';
import { migration_0024 } from './0024_episode_ontology_reliability.js';
import { migration_0025 } from './0025_memory_atlas.js';
import { migration_0026 } from './0026_runtime_governance_atlas_reliability.js';
import { migration_0027 } from './0027_openclaw_upgrade_hotfix.js';
import { migration_0028 } from './0028_episode_boundary_guardrails.js';
import { migration_0029 } from './0029_episode_active_scope_guard.js';
import { migration_0030 } from './0030_memory_event_local_date_source.js';
import { migration_0031 } from './0031_episode_boundary_integrity_repair.js';
import { migration_0032 } from './0032_memory_frames.js';
import { migration_0033 } from './0033_atlas_aliases_and_supports.js';
import { migration_0034 } from './0034_atlas_projection_v2.js';
import { migration_0035 } from './0035_memory_frame_integrity.js';
import { migration_0036 } from './0036_memory_frame_publication_repair.js';
import { migration_0037 } from './0037_memory_frame_revisions.js';
import { migration_0038 } from './0038_memory_frame_revision_integrity.js';
import { migration_0039 } from './0039_memory_frame_publication_and_revision_repair.js';
import { migration_0040 } from './0040_atlas_alias_supports.js';
import { migration_0041 } from './0041_memory_frame_integrity_repair.js';
import { migration_0042 } from './0042_memory_frame_revision_alias_repair.js';
import { migration_0043 } from './0043_memory_frame_provenance_finalize.js';
import { migration_0044 } from './0044_migration_receipts_and_alias_guard.js';
import { migration_0045 } from './0045_support_payload_reduction.js';
import { migration_0046 } from './0046_stable_migration_checksums.js';
import { migration_0047 } from './0047_memory_frame_alias_provenance_repair.js';
import { migration_0048 } from './0048_project_time_topology_v2.js';
import { migration_0049 } from './0049_project_scoped_graph_identity.js';
import { migration_0050 } from './0050_resumable_time_topology_rebuild.js';
import { migration_0051 } from './0051_time_projection_source_integrity.js';
import { migration_0052 } from './0052_project_scoped_topology_identity.js';
import { migration_0053 } from './0053_topology_privacy_and_recovery.js';
import { migration_0054 } from './0054_topology_semantic_integrity.js';
import { migration_0055 } from './0055_topology_scope_finalization.js';
import { migration_0056 } from './0056_project_isolation_finalization.js';

/**
 * Ordered list of all schema migrations.
 * Add new migrations here in ascending version order.
 * MigrationRunner.up() applies only the pending ones.
 */
export const ALL_MIGRATIONS: Migration[] = [
  migration_0001,
  migration_0002,
  migration_0003,
  migration_0004,
  migration_0005,
  migration_0006,
  migration_0007,
  migration_0009,
  migration_0010,
  migration_0011,
  migration_0012,
  migration_0015,
  migration_0016,
  migration_0017,
  migration_0018,
  migration_0019,
  migration_0020,
  migration_0021,
  migration_0022,
  migration_0023,
  migration_0024,
  migration_0025,
  migration_0026,
  migration_0027,
  migration_0028,
  migration_0029,
  migration_0030,
  migration_0031,
  migration_0032,
  migration_0033,
  migration_0034,
  migration_0035,
  migration_0036,
  migration_0037,
  migration_0038,
  migration_0039,
  migration_0040,
  migration_0041,
  migration_0042,
  migration_0043,
  migration_0044,
  migration_0045,
  migration_0046,
  migration_0047,
  migration_0048,
  migration_0049,
  migration_0050,
  migration_0051,
  migration_0052,
  migration_0053,
  migration_0054,
  migration_0055,
  migration_0056,
];

// Core stores bootstrap the pre-0015 tables themselves. Running the early
// historical migrations against a fresh kernel would try to ALTER optional
// legacy tables that do not exist yet. The kernel still runs every migration
// from the first schema that owns the runtime tables through the latest one;
// the CLI remains able to replay the complete historical chain.
export const KERNEL_MIGRATIONS: Migration[] = ALL_MIGRATIONS.filter((migration) => Number.parseInt(migration.version, 10) >= 15);

export { migration_0001, migration_0002, migration_0003, migration_0004, migration_0005, migration_0006, migration_0007, migration_0009, migration_0010, migration_0011, migration_0012, migration_0015, migration_0016, migration_0017, migration_0018, migration_0019, migration_0020, migration_0021, migration_0022, migration_0023, migration_0024, migration_0025, migration_0026, migration_0027, migration_0028, migration_0029, migration_0030, migration_0031, migration_0032, migration_0033, migration_0034, migration_0035, migration_0036, migration_0037, migration_0038, migration_0039, migration_0040, migration_0041, migration_0042, migration_0043, migration_0044, migration_0045, migration_0046, migration_0047, migration_0048, migration_0049, migration_0050, migration_0051, migration_0052, migration_0053, migration_0054, migration_0055, migration_0056 };
export { SchemaMigrationRunner } from './SchemaMigrationRunner.js';
export type { SchemaMigrationResult, SchemaMigrationRunOptions } from './SchemaMigrationRunner.js';
export type { Migration };
