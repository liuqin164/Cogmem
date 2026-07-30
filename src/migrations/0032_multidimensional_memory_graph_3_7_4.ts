import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';
import { migration_0032 as memoryFrames } from './v3_7_4/0032_memory_frames.js';
import { migration_0033 as atlasAliases } from './v3_7_4/0033_atlas_aliases_and_supports.js';
import { migration_0034 as atlasProjection } from './v3_7_4/0034_atlas_projection_v2.js';
import { migration_0035 as frameIntegrity } from './v3_7_4/0035_memory_frame_integrity.js';
import { migration_0036 as framePublication } from './v3_7_4/0036_memory_frame_publication_repair.js';
import { migration_0037 as frameRevisions } from './v3_7_4/0037_memory_frame_revisions.js';
import { migration_0038 as frameRevisionIntegrity } from './v3_7_4/0038_memory_frame_revision_integrity.js';
import { migration_0039 as framePublicationRepair } from './v3_7_4/0039_memory_frame_publication_and_revision_repair.js';
import { migration_0040 as atlasAliasSupports } from './v3_7_4/0040_atlas_alias_supports.js';
import { migration_0041 as frameIntegrityRepair } from './v3_7_4/0041_memory_frame_integrity_repair.js';
import { migration_0042 as frameAliasRepair } from './v3_7_4/0042_memory_frame_revision_alias_repair.js';
import { migration_0043 as frameProvenance } from './v3_7_4/0043_memory_frame_provenance_finalize.js';
import { migration_0044 as migrationReceipts } from './v3_7_4/0044_migration_receipts_and_alias_guard.js';
import { migration_0045 as supportPayloads } from './v3_7_4/0045_support_payload_reduction.js';
import { migration_0046 as stableChecksums } from './v3_7_4/0046_stable_migration_checksums.js';
import { migration_0047 as aliasProvenance } from './v3_7_4/0047_memory_frame_alias_provenance_repair.js';
import { migration_0048 as projectTimeTopology } from './v3_7_4/0048_project_time_topology_v2.js';
import { migration_0049 as graphIdentity } from './v3_7_4/0049_project_scoped_graph_identity.js';
import { migration_0050 as resumableTopology } from './v3_7_4/0050_resumable_time_topology_rebuild.js';
import { migration_0051 as topologySourceIntegrity } from './v3_7_4/0051_time_projection_source_integrity.js';
import { migration_0052 as topologyIdentity } from './v3_7_4/0052_project_scoped_topology_identity.js';
import { migration_0053 as topologyPrivacy } from './v3_7_4/0053_topology_privacy_and_recovery.js';
import {
  migration_0054 as topologySemantics,
  topologyIntegritySatisfied,
} from './v3_7_4/0054_topology_semantic_integrity.js';
import {
  migration_0055 as topologyFinalization,
  topologyFinalizationSatisfied,
} from './v3_7_4/0055_topology_scope_finalization.js';
import {
  migration_0056 as isolationFinalization,
  projectIsolationFinalizationSatisfied,
} from './v3_7_4/0056_project_isolation_finalization.js';
import {
  migration_0057 as isolationCompensation,
  projectIsolationCompensationSatisfied,
} from './v3_7_4/0057_project_isolation_compensation.js';
import {
  migration_0058 as isolationGuards,
  projectIsolationRuntimeGuardsSatisfied,
} from './v3_7_4/0058_project_isolation_runtime_guards.js';
import {
  migration_0059 as executionGuards,
  projectExecutionAndProvenanceGuardsSatisfied,
} from './v3_7_4/0059_project_execution_and_provenance_guards.js';
import {
  migration_0060 as projectionReliability,
} from './v3_7_4/0060_execution_projection_and_atlas_reliability.js';
import {
  atlasProjectionDirtyTriggersV3Satisfied,
  installAtlasProjectionDirtyTriggersV3,
  migration_0061 as runtimeScopeIntegrity,
} from './v3_7_4/0061_runtime_scope_and_projection_integrity.js';
import {
  migration_0062 as outboxRecovery,
  projectionScopeAndOutboxRecoverySatisfied,
} from './v3_7_4/0062_projection_scope_and_outbox_recovery.js';

const INSTALL_STEPS = [
  memoryFrames, atlasAliases, atlasProjection, frameIntegrity, framePublication,
  frameRevisions, frameRevisionIntegrity, framePublicationRepair, atlasAliasSupports,
  frameIntegrityRepair, frameAliasRepair, frameProvenance, migrationReceipts,
  supportPayloads, stableChecksums, aliasProvenance, projectTimeTopology, graphIdentity,
  resumableTopology, topologySourceIntegrity, topologyIdentity, topologyPrivacy,
  topologySemantics, topologyFinalization, isolationFinalization, isolationCompensation,
  isolationGuards, executionGuards, projectionReliability, runtimeScopeIntegrity, outboxRecovery,
] as const;

export const migration_0032: Migration = {
  version: '0032',
  description: 'install the final 3.7.4 multidimensional memory graph schema',
  requiresBackup: true,
  up(db) {
    installMultidimensionalMemoryGraph374(db);
  },
  down() {},
};

export function installMultidimensionalMemoryGraph374(db: Database): void {
  preservePreTransitionTaskIdentity(db);
  for (const step of INSTALL_STEPS) step.up(db);
  installAtlasProjectionDirtyTriggersV3(db);
  const issue = multidimensionalMemoryGraph374Issue(db);
  if (issue) throw new Error(`multidimensional_memory_graph_3_7_4_postcondition_failed:${issue}`);
}

export function multidimensionalMemoryGraph374Satisfied(db: Database): boolean {
  return multidimensionalMemoryGraph374Issue(db) === undefined;
}

export function multidimensionalMemoryGraph374Issue(db: Database): string | undefined {
  const checks: Array<[string, boolean]> = [
    ['memory_frames', hasColumns(db, 'memory_frames', ['revision_id', 'project_id', 'episode_id', 'source_fingerprint', 'status'])],
    ['memory_atlas_alias_supports', hasColumns(db, 'memory_atlas_alias_supports', ['alias_id', 'project_id', 'node_id', 'source_frame_id', 'status'])],
    ['topology_projection_state', hasColumns(db, 'topology_projection_state', ['project_id', 'projection_version', 'source_revision', 'status'])],
    ['topology_integrity', topologyIntegritySatisfied(db)],
    ['topology_finalization', topologyFinalizationSatisfied(db)],
    ['project_isolation_finalization', projectIsolationFinalizationSatisfied(db)],
    ['project_isolation_compensation', projectIsolationCompensationSatisfied(db)],
    ['project_isolation_runtime_guards', projectIsolationRuntimeGuardsSatisfied(db)],
    ['project_execution_and_provenance_guards', projectExecutionAndProvenanceGuardsSatisfied(db)],
    ['atlas_projection_dirty_triggers_v3', atlasProjectionDirtyTriggersV3Satisfied(db)],
    ['projection_scope_and_outbox_recovery', projectionScopeAndOutboxRecoverySatisfied(db)],
    ['runtime_scope_quarantine_removed', !tableExists(db, 'runtime_scope_quarantine')],
  ];
  return checks.find(([, satisfied]) => !satisfied)?.[0];
}

function preservePreTransitionTaskIdentity(db: Database): void {
  if (!tableExists(db, 'task_branches') || !tableExists(db, 'task_branch_entries')) return;
  db.exec(`
    DROP TABLE IF EXISTS temp._0055_task_metadata_backup;
    DROP TABLE IF EXISTS temp._0055_task_identity_backup;
    DROP TABLE IF EXISTS temp._0055_task_entry_backup;
    CREATE TEMP TABLE _0055_task_metadata_backup AS
      SELECT task_id,COALESCE(project_id,'') AS project_id,task_key,title,status FROM task_branches;
    CREATE TEMP TABLE _0055_task_identity_backup AS
      SELECT task_id,COALESCE(project_id,'') AS project_id,task_key,title,status,created_at,updated_at FROM task_branches;
    CREATE TEMP TABLE _0055_task_entry_backup AS SELECT * FROM task_branch_entries;
  `);
}

function hasColumns(db: Database, table: string, columns: string[]): boolean {
  if (!tableExists(db, table)) return false;
  const actual = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
  return columns.every((column) => actual.has(column));
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}
