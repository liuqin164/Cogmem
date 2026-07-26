import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0058: Migration = {
  version: '0058',
  description: 'enforce runtime project isolation and quarantine unresolved provenance',
  up(db) {
    isolateUnresolvedTasks(db);
    repairBeliefIsolation(db);
    repairSynapseIsolation(db);
    migratePendingEntityScope(db);
    assertProjectIsolationRuntimeGuards(db);
  },
  down() {},
};

function isolateUnresolvedTasks(db: Database): void {
  if (!tableExists(db, 'task_identity_restoration_manifest')) return;
  if (tableExists(db, 'topology_membership')) {
    db.exec(`DELETE FROM topology_membership
      WHERE dimension_type='task_branch' AND EXISTS (
        SELECT 1 FROM task_identity_restoration_manifest m
        WHERE m.recovery_status='unresolved'
          AND m.project_id=COALESCE(topology_membership.project_id,'')
          AND m.task_key=topology_membership.dimension_key
      )`);
  }
  if (tableExists(db, 'cognitive_nodes') && tableExists(db, 'cognitive_edges')) {
    db.exec(`DELETE FROM cognitive_edges WHERE source_node_id IN (
      SELECT n.node_id FROM cognitive_nodes n JOIN task_identity_restoration_manifest m
        ON m.project_id=n.project_id AND m.task_key=n.node_key
      WHERE n.node_type='task_branch' AND m.recovery_status='unresolved'
    ) OR target_node_id IN (
      SELECT n.node_id FROM cognitive_nodes n JOIN task_identity_restoration_manifest m
        ON m.project_id=n.project_id AND m.task_key=n.node_key
      WHERE n.node_type='task_branch' AND m.recovery_status='unresolved'
    );
    DELETE FROM cognitive_nodes WHERE node_type='task_branch' AND EXISTS (
      SELECT 1 FROM task_identity_restoration_manifest m
      WHERE m.project_id=cognitive_nodes.project_id
        AND m.task_key=cognitive_nodes.node_key
        AND m.recovery_status='unresolved'
    )`);
  }
  if (tableExists(db, 'task_branch_entries')) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS task_branch_entries_reject_unresolved_insert
      BEFORE INSERT ON task_branch_entries
      WHEN EXISTS (
        SELECT 1 FROM task_identity_restoration_manifest m
        WHERE m.task_id=NEW.task_id AND m.recovery_status='unresolved'
      )
      BEGIN SELECT RAISE(ABORT,'task_identity_unresolved'); END`);
  }
}

function repairBeliefIsolation(db: Database): void {
  if (!tableExists(db, 'beliefs')) return;
  db.exec(`CREATE INDEX IF NOT EXISTS idx_beliefs_project_canonical
    ON beliefs(project_id,canonical_key,status,valid_from DESC);
  UPDATE beliefs SET status='active',superseded_by_belief_id=NULL,valid_to=NULL
    WHERE status='superseded' AND superseded_by_belief_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM beliefs winner WHERE winner.id=beliefs.superseded_by_belief_id
        AND COALESCE(winner.project_id,'')<>COALESCE(beliefs.project_id,'')
    );
  UPDATE beliefs SET supersedes_belief_id=NULL
    WHERE supersedes_belief_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM beliefs previous WHERE previous.id=beliefs.supersedes_belief_id
        AND COALESCE(previous.project_id,'')<>COALESCE(beliefs.project_id,'')
    )`);
  if (tableExists(db, 'belief_evidence')) {
    db.exec(`DELETE FROM belief_evidence
      WHERE NOT EXISTS (SELECT 1 FROM beliefs b WHERE b.id=belief_evidence.belief_id)
        OR (neuron_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM beliefs b JOIN neurons n ON n.id=belief_evidence.neuron_id AND n.is_deleted=0
          WHERE b.id=belief_evidence.belief_id AND COALESCE(b.project_id,'')=COALESCE(n.project_id,'')
        ))
        OR (event_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM beliefs b JOIN memory_events e ON e.event_id=belief_evidence.event_id
          WHERE b.id=belief_evidence.belief_id AND COALESCE(b.project_id,'')=COALESCE(e.project_id,'')
        ))`);
  }
}

function repairSynapseIsolation(db: Database): void {
  if (!tableExists(db, 'synapses')) return;
  if (!tableColumns(db, 'synapses').has('project_id')) {
    db.exec(`ALTER TABLE synapses ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`);
  }
  const invalid = db.prepare(`SELECT s.* FROM synapses s
    LEFT JOIN neurons source ON source.id=s.source_id AND source.is_deleted=0
    LEFT JOIN neurons target ON target.id=s.target_id AND target.is_deleted=0
    WHERE source.id IS NULL OR target.id IS NULL
      OR COALESCE(source.project_id,'')<>COALESCE(target.project_id,'')`).all() as Array<Record<string, unknown>>;
  for (const row of invalid) quarantine(db, 'synapse_0058', `${row.source_id}:${row.target_id}:${row.type}`, row, 'synapse_endpoint_scope_invalid');
  db.exec(`DELETE FROM synapses WHERE NOT EXISTS (
      SELECT 1 FROM neurons source JOIN neurons target
        ON target.id=synapses.target_id AND target.is_deleted=0
      WHERE source.id=synapses.source_id AND source.is_deleted=0
        AND COALESCE(source.project_id,'')=COALESCE(target.project_id,'')
    );
    UPDATE synapses SET project_id=(
      SELECT COALESCE(project_id,'') FROM neurons WHERE id=synapses.source_id
    );
    CREATE INDEX IF NOT EXISTS idx_synapses_project_source ON synapses(project_id,source_id)`);
}

function migratePendingEntityScope(db: Database): void {
  if (!tableExists(db, 'pending_entity_resolution')) return;
  if (!tableColumns(db, 'pending_entity_resolution').has('project_scope')) {
    db.exec(`ALTER TABLE pending_entity_resolution ADD COLUMN project_scope TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS pending_entity_resolution_quarantine (
    pending_id TEXT PRIMARY KEY,record_json TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL
  )`);
  const invalid = db.prepare(`SELECT p.* FROM pending_entity_resolution p LEFT JOIN neurons n
    ON n.id=p.context_neuron_id AND n.is_deleted=0
    WHERE p.context_neuron_id IS NULL OR n.id IS NULL`).all() as Array<Record<string, unknown>>;
  const insert = db.prepare(`INSERT OR REPLACE INTO pending_entity_resolution_quarantine VALUES(?,?,?,?)`);
  for (const row of invalid) insert.run(String(row.pending_id), JSON.stringify(row), 'pending_context_unproven', Date.now());
  db.exec(`DELETE FROM pending_entity_resolution WHERE context_neuron_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM neurons n WHERE n.id=pending_entity_resolution.context_neuron_id AND n.is_deleted=0
    );
    UPDATE pending_entity_resolution SET project_scope=(
      SELECT COALESCE(project_id,'') FROM neurons WHERE id=pending_entity_resolution.context_neuron_id
    );
    CREATE INDEX IF NOT EXISTS idx_pending_entity_resolution_scope
      ON pending_entity_resolution(project_scope,status,updated_at DESC)`);
}

export function projectIsolationRuntimeGuardsSatisfied(db: Database): boolean {
  try {
    assertProjectIsolationRuntimeGuards(db);
    return true;
  } catch {
    return false;
  }
}

function assertProjectIsolationRuntimeGuards(db: Database): void {
  if (tableExists(db, 'task_identity_restoration_manifest')) {
    if (tableExists(db, 'topology_membership') && db.prepare(`SELECT 1 FROM topology_membership t
      JOIN task_identity_restoration_manifest m
        ON m.project_id=COALESCE(t.project_id,'') AND m.task_key=t.dimension_key
      WHERE t.dimension_type='task_branch' AND m.recovery_status='unresolved' LIMIT 1`).get()) {
      throw new Error('unresolved_task_membership_active');
    }
  }
  if (tableExists(db, 'beliefs') && db.prepare(`SELECT 1 FROM beliefs b JOIN beliefs linked
    ON linked.id=COALESCE(b.superseded_by_belief_id,b.supersedes_belief_id)
    WHERE COALESCE(b.project_id,'')<>COALESCE(linked.project_id,'') LIMIT 1`).get()) {
    throw new Error('belief_cross_project_revision');
  }
  if (tableExists(db, 'synapses')) {
    if (!tableColumns(db, 'synapses').has('project_id')) throw new Error('synapse_project_scope_missing');
    if (db.prepare(`SELECT 1 FROM synapses s JOIN neurons a ON a.id=s.source_id JOIN neurons b ON b.id=s.target_id
      WHERE a.is_deleted<>0 OR b.is_deleted<>0 OR COALESCE(a.project_id,'')<>COALESCE(b.project_id,'')
        OR s.project_id<>COALESCE(a.project_id,'') LIMIT 1`).get()) throw new Error('synapse_project_scope_invalid');
  }
  if (tableExists(db, 'pending_entity_resolution')
    && !tableColumns(db, 'pending_entity_resolution').has('project_scope')) throw new Error('pending_project_scope_missing');
}

function quarantine(db: Database, type: string, id: string, row: unknown, reason: string): void {
  if (!tableExists(db, 'topology_identity_quarantine')) return;
  const scope = String(row && typeof row === 'object' && 'project_id' in row ? (row as Record<string, unknown>).project_id ?? '' : '');
  db.prepare(`INSERT OR REPLACE INTO topology_identity_quarantine(
    quarantine_id,identity_type,old_parent_id,project_scope,entry_json,reason,created_at,implicated_scopes_json
  ) VALUES(?,?,?,?,?,?,?,?)`).run(
    `quarantine-${createHash('sha256').update(`${type}\0${id}`).digest('hex').slice(0,32)}`,
    type,id,scope,JSON.stringify(row),reason,Date.now(),JSON.stringify([scope]),
  );
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}
function tableColumns(db: Database, name: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((row) => row.name));
}
