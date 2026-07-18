import Database from 'bun:sqlite';
import { projectQueryValue, projectScope } from '../topology/ProjectScope.js';
import { isCanonicalEventClusterKey } from '../topology/EventClusterIdentity.js';
import type {
  EventClusterRecord,
  EventClusterType,
  ProjectBranchKind,
  ProjectBranchRecord,
  TaskBranchRecord,
  TimeBucketRecord,
  TimeBucketType,
  TopologyReference
} from '../types/index.js';

export class TopologyStore {
  private db: Database;
  private readonly ownsDb: boolean;

  constructor(dbOrPath: Database | string = ':memory:') {
    if (typeof dbOrPath === 'string') {
      this.ownsDb = true;
      this.db = new Database(dbOrPath);
    } else {
      this.ownsDb = false;
      this.db = dbOrPath;
    }
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS time_buckets (
        bucket_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        time_zone TEXT NOT NULL DEFAULT 'UTC',
        bucket_type TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        bucket_end INTEGER NOT NULL,
        label TEXT NOT NULL,
        UNIQUE(project_id, time_zone, bucket_type, bucket_start, bucket_end)
      );

      CREATE TABLE IF NOT EXISTS time_bucket_entries (
        bucket_id TEXT NOT NULL,
        neuron_id TEXT,
        unit_id TEXT,
        belief_id TEXT,
        fact_id TEXT,
        event_id TEXT,
        project_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE(bucket_id, neuron_id, unit_id, belief_id, fact_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS project_branches (
        branch_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch_key TEXT NOT NULL,
        branch_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, branch_key)
      );

      CREATE TABLE IF NOT EXISTS branch_links (
        parent_branch_id TEXT NOT NULL,
        child_branch_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        relation_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(parent_branch_id, child_branch_id, relation_type)
      );

      CREATE TABLE IF NOT EXISTS branch_entries (
        branch_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        neuron_id TEXT,
        unit_id TEXT,
        belief_id TEXT,
        fact_id TEXT,
        event_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(branch_id, neuron_id, unit_id, belief_id, fact_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS task_branches (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        task_key TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, task_key)
      );

      CREATE TABLE IF NOT EXISTS task_branch_entries (
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        neuron_id TEXT,
        unit_id TEXT,
        belief_id TEXT,
        fact_id TEXT,
        event_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(task_id, neuron_id, unit_id, belief_id, fact_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS event_clusters (
        cluster_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        cluster_key TEXT NOT NULL,
        cluster_type TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, cluster_key)
      );

      CREATE TABLE IF NOT EXISTS event_cluster_entries (
        cluster_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        neuron_id TEXT,
        unit_id TEXT,
        belief_id TEXT,
        fact_id TEXT,
        event_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(cluster_id, neuron_id, unit_id, belief_id, fact_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS topology_membership (
        neuron_id TEXT NOT NULL,
        project_id TEXT,
        dimension_type TEXT NOT NULL,
        dimension_key TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(neuron_id, dimension_type, dimension_key)
      );

      CREATE INDEX IF NOT EXISTS idx_time_bucket_entries_bucket
        ON time_bucket_entries(bucket_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_project_branches_project
        ON project_branches(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_branches_project
        ON task_branches(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_clusters_project
        ON event_clusters(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topology_membership_project
        ON topology_membership(project_id, dimension_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topology_membership_dimension
        ON topology_membership(dimension_type, dimension_key, created_at DESC);

      CREATE TABLE IF NOT EXISTS topology_projection_state (
        project_id TEXT PRIMARY KEY,
        projection_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK(status IN ('dirty','building','clean','failed')),
        time_zone TEXT,
        updated_at INTEGER NOT NULL,
        error TEXT,
        source_revision INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS topology_source_revisions (
        project_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_time_bucket_entries_reference_unique
        ON time_bucket_entries(bucket_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_entries_reference_unique
        ON branch_entries(branch_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_branch_entries_reference_unique
        ON task_branch_entries(task_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_cluster_entries_reference_unique
        ON event_cluster_entries(cluster_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
    `);
    for (const table of ['branch_entries', 'task_branch_entries', 'event_cluster_entries']) {
      if (!this.hasColumn(table, 'project_id')) this.db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`);
    }
    if (!this.hasColumn('branch_links', 'project_id')) this.db.exec(`ALTER TABLE branch_links ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`);
    this.installBranchScopeTriggers();
  }

  timeProjectionNeedsRebuild(projectId: string, timeZone: string): boolean {
    return !this.hasUsableTimeProjection(projectId, timeZone);
  }

  hasDirtyTimeProjection(projectId?: string): boolean {
    const scope = projectId === undefined ? undefined : projectScope(projectId);
    return Boolean(scope === undefined
      ? this.db.prepare(`SELECT 1 FROM topology_projection_state s LEFT JOIN topology_source_revisions r ON r.project_id=s.project_id WHERE r.project_id IS NULL OR s.projection_version<>4 OR s.status<>'clean' OR s.source_revision<>r.revision UNION ALL SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE s.project_id IS NULL LIMIT 1`).get()
      : this.db.prepare(`SELECT 1 FROM topology_projection_state s LEFT JOIN topology_source_revisions r ON r.project_id=s.project_id WHERE s.project_id=? AND (r.project_id IS NULL OR s.projection_version<>4 OR s.status<>'clean' OR s.source_revision<>r.revision) UNION ALL SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE r.project_id=? AND s.project_id IS NULL LIMIT 1`).get(scope, scope));
  }

  hasUsableTimeProjection(projectId: string, timeZone: string): boolean {
    const scope = projectScope(projectId);
    const revisionRow = this.db.prepare(`SELECT revision FROM topology_source_revisions WHERE project_id=?`).get(scope) as { revision: number } | null;
    const row = this.db.prepare(`SELECT projection_version,status,time_zone,source_revision FROM topology_projection_state WHERE project_id=?`).get(scope) as { projection_version: number; status: string; time_zone?: string | null; source_revision: number } | null;
    if (!revisionRow) return !row;
    return Boolean(row && row.projection_version === 4 && row.status === 'clean' && row.time_zone === timeZone && row.source_revision === revisionRow.revision);
  }

  hasUsableTimeProjections(timeZone: string): boolean {
    return !Boolean(this.db.prepare(`
      SELECT 1
      FROM topology_source_revisions r
      LEFT JOIN topology_projection_state s ON s.project_id=r.project_id
      WHERE s.project_id IS NULL OR s.projection_version<>4 OR s.status<>'clean'
        OR s.time_zone<>? OR s.source_revision<>r.revision
      UNION ALL
      SELECT 1 FROM topology_projection_state s
      LEFT JOIN topology_source_revisions r ON r.project_id=s.project_id
      WHERE r.project_id IS NULL
      LIMIT 1
    `).get(timeZone));
  }

  beginTimeProjectionSourceUpdate(projectId: string | undefined, timeZone: string, updatedAt: number): { sourceRevision: number; incremental: boolean } {
    const scope = projectScope(projectId);
    return this.db.transaction(() => {
      const previousRevision = this.getTimeProjectionSourceRevision(scope);
      const state = this.db.prepare(`SELECT projection_version,status,time_zone,source_revision FROM topology_projection_state WHERE project_id=?`).get(scope) as { projection_version: number; status: string; time_zone?: string | null; source_revision: number } | null;
      const incremental = state
        ? state.projection_version === 4 && state.status === 'clean' && state.time_zone === timeZone && state.source_revision === previousRevision
        : previousRevision === 0;
      const sourceRevision = previousRevision + 1;
      this.db.prepare(`INSERT INTO topology_source_revisions(project_id,revision,updated_at) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at`).run(scope, sourceRevision, updatedAt);
      this.markTimeProjection(scope, 'dirty', timeZone, updatedAt, undefined, sourceRevision);
      return { sourceRevision, incremental };
    })();
  }

  getTimeProjectionSourceRevision(projectId: string | undefined): number {
    const row = this.db.prepare(`SELECT revision FROM topology_source_revisions WHERE project_id=?`).get(projectScope(projectId)) as { revision?: number } | null;
    return Number(row?.revision ?? 0);
  }

  markTimeProjection(projectId: string, status: 'dirty' | 'building' | 'clean' | 'failed', timeZone: string, updatedAt: number, error?: string, sourceRevision = this.getTimeProjectionSourceRevision(projectId)): void {
    const scope = projectScope(projectId);
    this.db.prepare(`INSERT OR IGNORE INTO topology_source_revisions(project_id,revision,updated_at) VALUES(?,?,?)`).run(scope, sourceRevision, updatedAt);
    this.db.prepare(`
      INSERT INTO topology_projection_state(project_id,projection_version,status,time_zone,updated_at,error,source_revision)
      VALUES(?,4,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET projection_version=4,status=excluded.status,time_zone=excluded.time_zone,updated_at=excluded.updated_at,error=excluded.error,source_revision=excluded.source_revision
    `).run(scope, status, timeZone, updatedAt, error ?? null, sourceRevision);
  }

  markTimeProjectionCleanIfCurrent(projectId: string, timeZone: string, updatedAt: number, sourceRevision: number): boolean {
    const scope = projectScope(projectId);
    const result = this.db.prepare(`
      INSERT INTO topology_projection_state(project_id,projection_version,status,time_zone,updated_at,error,source_revision)
      SELECT ?,4,'clean',?,?,NULL,?
      WHERE EXISTS (
        SELECT 1 FROM topology_source_revisions WHERE project_id=? AND revision=?
      )
      ON CONFLICT(project_id) DO UPDATE SET
        projection_version=4,
        status='clean',
        time_zone=excluded.time_zone,
        updated_at=excluded.updated_at,
        error=NULL,
        source_revision=excluded.source_revision
      WHERE topology_projection_state.status='dirty'
        AND topology_projection_state.time_zone=excluded.time_zone
        AND topology_projection_state.source_revision=excluded.source_revision
        AND EXISTS (
          SELECT 1 FROM topology_source_revisions WHERE project_id=excluded.project_id AND revision=excluded.source_revision
        )
    `).run(scope, timeZone, updatedAt, sourceRevision, scope, sourceRevision);
    return Number(result.changes ?? 0) === 1;
  }

  resetProjectTimeBuckets(projectId: string): void {
    const scope = projectScope(projectId);
    this.db.prepare(`DELETE FROM topology_membership WHERE COALESCE(project_id,'')=? AND dimension_type='time_bucket'`).run(scope);
    this.db.prepare(`DELETE FROM time_bucket_entries WHERE COALESCE(project_id,'')=?`).run(scope);
    this.db.exec(`DELETE FROM time_buckets WHERE bucket_id NOT IN (SELECT DISTINCT bucket_id FROM time_bucket_entries);`);
  }

  listProjectTimeBucketsByNeuron(projectId: string, neuronIds: string[]): Map<string, TimeBucketRecord[]> {
    if (neuronIds.length === 0 || this.hasDirtyTimeProjection(projectId)) return new Map();
    const placeholders = neuronIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT e.neuron_id,b.bucket_id,b.project_id,b.time_zone,b.bucket_type,b.bucket_start,b.bucket_end,b.label
      FROM time_bucket_entries e
      JOIN time_buckets b ON b.bucket_id=e.bucket_id
      WHERE COALESCE(e.project_id,'')=? AND e.neuron_id IN (${placeholders})
      ORDER BY e.created_at ASC,b.bucket_type ASC
    `).all(projectScope(projectId), ...neuronIds) as Array<{ neuron_id: string; bucket_id: string; project_id: string; time_zone: string; bucket_type: TimeBucketType; bucket_start: number; bucket_end: number; label: string }>;
    const result = new Map<string, TimeBucketRecord[]>();
    for (const row of rows) {
      const values = result.get(row.neuron_id) ?? [];
      values.push({ bucketId: row.bucket_id, projectId: row.project_id || undefined, timeZone: row.time_zone, bucketType: row.bucket_type, bucketStart: row.bucket_start, bucketEnd: row.bucket_end, label: row.label });
      result.set(row.neuron_id, values);
    }
    return result;
  }

  upsertTimeBucket(bucket: TimeBucketRecord): TimeBucketRecord {
    const projectScope = bucket.projectId ?? '';
    const timeZone = bucket.timeZone ?? 'UTC';
    const existing = this.db.prepare(`SELECT project_id,time_zone,bucket_type,bucket_start,bucket_end FROM time_buckets WHERE bucket_id=?`).get(bucket.bucketId) as { project_id: string; time_zone: string; bucket_type: string; bucket_start: number; bucket_end: number } | null;
    if (existing && (existing.project_id !== projectScope || existing.time_zone !== timeZone || existing.bucket_type !== bucket.bucketType || existing.bucket_start !== bucket.bucketStart || existing.bucket_end !== bucket.bucketEnd)) {
      throw new Error('time_bucket_identity_conflict');
    }
    this.db.prepare(`
      INSERT INTO time_buckets (
        bucket_id, project_id, time_zone, bucket_type, bucket_start, bucket_end, label
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket_id) DO UPDATE SET
        project_id=excluded.project_id,
        time_zone=excluded.time_zone,
        bucket_type=excluded.bucket_type,
        bucket_start=excluded.bucket_start,
        bucket_end=excluded.bucket_end,
        label=excluded.label
    `).run(
      bucket.bucketId,
      projectScope,
      timeZone,
      bucket.bucketType,
      bucket.bucketStart,
      bucket.bucketEnd,
      bucket.label
    );
    return bucket;
  }

  attachToTimeBucket(bucketId: string, ref: TopologyReference): void {
    this.db.transaction(() => {
      const bucket = this.db.prepare(`SELECT project_id,label FROM time_buckets WHERE bucket_id=?`).get(bucketId) as { project_id: string; label: string } | null;
      if (!bucket || bucket.project_id !== projectScope(ref.projectId)) throw new Error('time_bucket_project_scope_mismatch');
      this.assertReferenceScope(bucket.project_id, ref);
      this.db.prepare(`
      INSERT OR IGNORE INTO time_bucket_entries (
        bucket_id, neuron_id, unit_id, belief_id, fact_id, event_id, project_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bucketId,
      ref.neuronId || null,
      ref.unitId || null,
      ref.beliefId || null,
      ref.factId || null,
      ref.eventId || null,
      projectScope(ref.projectId),
      ref.createdAt
    );
      if (ref.neuronId) this.upsertMembership(ref.neuronId, ref.projectId, 'time_bucket', bucketId, bucket.label, ref.createdAt);
    })();
  }

  upsertProjectBranch(input: {
    branchId: string;
    projectId: string;
    branchKey: string;
    branchKind: ProjectBranchKind;
    title: string;
    createdAt: number;
  }): ProjectBranchRecord {
    return this.db.transaction(() => {
      const idOwner = this.db.prepare(`SELECT project_id,branch_key FROM project_branches WHERE branch_id=?`).get(input.branchId) as { project_id: string; branch_key: string } | null;
      if (idOwner && (idOwner.project_id !== input.projectId || idOwner.branch_key !== input.branchKey)) throw new Error('project_branch_identity_conflict');
      const existing = this.db.prepare(`SELECT * FROM project_branches WHERE project_id=? AND branch_key=?`).get(input.projectId, input.branchKey) as any;
      const branchId = existing?.branch_id || input.branchId;
      const createdAt = existing?.created_at || input.createdAt;
      this.db.prepare(`
      INSERT INTO project_branches (
        branch_id, project_id, branch_key, branch_kind, title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id,branch_key) DO UPDATE SET
        branch_kind=excluded.branch_kind,title=excluded.title,updated_at=excluded.updated_at
    `).run(
      branchId,
      input.projectId,
      input.branchKey,
      input.branchKind,
      input.title,
      createdAt,
      input.createdAt
    );

      return {
      branchId,
      projectId: input.projectId,
      branchKey: input.branchKey,
      branchKind: input.branchKind,
      title: input.title,
      createdAt,
      updatedAt: input.createdAt
      };
    })();
  }

  linkBranches(parentBranchId: string, childBranchId: string, relationType: string, createdAt: number): void {
    this.db.transaction(() => {
      const parent = this.db.prepare(`SELECT project_id FROM project_branches WHERE branch_id=?`).get(parentBranchId) as { project_id: string } | null;
      const child = this.db.prepare(`SELECT project_id FROM project_branches WHERE branch_id=?`).get(childBranchId) as { project_id: string } | null;
      if (!parent || !child) throw new Error('topology_parent_not_found');
      if (parent.project_id !== child.project_id) throw new Error('topology_branch_link_project_scope_mismatch');
      this.db.prepare(`
      INSERT OR IGNORE INTO branch_links (
        parent_branch_id, child_branch_id, project_id, relation_type, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(parentBranchId, childBranchId, parent.project_id, relationType, createdAt);
    })();
  }

  attachToBranch(branchId: string, ref: TopologyReference): void {
    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT project_id, branch_key, title FROM project_branches WHERE branch_id = ?`)
        .get(branchId) as { project_id: string; branch_key: string; title: string } | null;
      if (!row) throw new Error('topology_parent_not_found');
      this.assertReferenceScope(row.project_id, ref);
      this.db.prepare(`
      INSERT OR IGNORE INTO branch_entries (
        branch_id, project_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      branchId,
      row.project_id,
      ref.neuronId || null,
      ref.unitId || null,
      ref.beliefId || null,
      ref.factId || null,
      ref.eventId || null,
      ref.createdAt
    );
    if (ref.neuronId) {
      this.upsertMembership(ref.neuronId, row.project_id, 'project_branch', row.branch_key, row.title, ref.createdAt);
    }
    })();
  }

  upsertTaskBranch(input: {
    taskId: string;
    projectId?: string;
    taskKey: string;
    title: string;
    status?: 'active' | 'derived';
    createdAt: number;
  }): TaskBranchRecord {
    const scope = projectScope(input.projectId);
    const existing = this.db.prepare(`
      SELECT * FROM task_branches WHERE project_id = ? AND task_key = ?
    `).get(scope, input.taskKey) as any;

    const taskId = existing?.task_id || input.taskId;
    const createdAt = existing?.created_at || input.createdAt;
    const status = input.status || 'derived';
    this.db.prepare(`
      INSERT INTO task_branches (
        task_id, project_id, task_key, title, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, task_key) DO UPDATE SET
        title=excluded.title,
        status=excluded.status,
        updated_at=excluded.updated_at
    `).run(
      taskId,
      scope,
      input.taskKey,
      input.title,
      status,
      createdAt,
      input.createdAt
    );

    return {
      taskId,
      projectId: input.projectId,
      taskKey: input.taskKey,
      title: input.title,
      status,
      createdAt,
      updatedAt: input.createdAt
    };
  }

  attachToTask(taskId: string, ref: TopologyReference): void {
    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT project_id, task_key, title FROM task_branches WHERE task_id = ?`)
        .get(taskId) as { project_id: string; task_key: string; title: string } | null;
      if (!row) throw new Error('topology_parent_not_found');
      this.assertReferenceScope(row.project_id, ref);
      this.db.prepare(`
      INSERT OR IGNORE INTO task_branch_entries (
        task_id, project_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      row.project_id,
      ref.neuronId || null,
      ref.unitId || null,
      ref.beliefId || null,
      ref.factId || null,
      ref.eventId || null,
      ref.createdAt
    );
    if (ref.neuronId) {
      this.upsertMembership(ref.neuronId, row.project_id || undefined, 'task_branch', row.task_key, row.title, ref.createdAt);
    }
    })();
  }

  upsertEventCluster(input: {
    clusterId: string;
    projectId?: string;
    clusterKey: string;
    clusterType: EventClusterType;
    title: string;
    createdAt: number;
  }): EventClusterRecord {
    const scope = projectScope(input.projectId);
    if (!isCanonicalEventClusterKey(input.clusterType, input.clusterKey)) throw new Error('event_cluster_key_noncanonical');
    const existing = this.db.prepare(`
      SELECT * FROM event_clusters WHERE project_id = ? AND cluster_key = ?
    `).get(scope, input.clusterKey) as any;

    const clusterId = existing?.cluster_id || input.clusterId;
    const createdAt = existing?.created_at || input.createdAt;
    this.db.prepare(`
      INSERT INTO event_clusters (
        cluster_id, project_id, cluster_key, cluster_type, title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, cluster_key) DO UPDATE SET
        cluster_type=excluded.cluster_type,
        title=excluded.title,
        updated_at=excluded.updated_at
    `).run(
      clusterId,
      scope,
      input.clusterKey,
      input.clusterType,
      input.title,
      createdAt,
      input.createdAt
    );

    return {
      clusterId,
      projectId: input.projectId,
      clusterKey: input.clusterKey,
      clusterType: input.clusterType,
      title: input.title,
      createdAt,
      updatedAt: input.createdAt
    };
  }

  attachToEventCluster(clusterId: string, ref: TopologyReference): void {
    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT project_id, cluster_key, title FROM event_clusters WHERE cluster_id = ?`)
        .get(clusterId) as { project_id: string; cluster_key: string; title: string } | null;
      if (!row) throw new Error('topology_parent_not_found');
      this.assertReferenceScope(row.project_id, ref);
      this.db.prepare(`
      INSERT OR IGNORE INTO event_cluster_entries (
        cluster_id, project_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clusterId,
      row.project_id,
      ref.neuronId || null,
      ref.unitId || null,
      ref.beliefId || null,
      ref.factId || null,
      ref.eventId || null,
      ref.createdAt
    );
    if (ref.neuronId) {
      this.upsertMembership(ref.neuronId, row.project_id || undefined, 'event_cluster', row.cluster_key, row.title, ref.createdAt);
    }
    })();
  }

  listProjectBranches(projectId: string): ProjectBranchRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM project_branches
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC
    `).all(projectId) as any[];
    return rows.map((row) => ({
      branchId: row.branch_id,
      projectId: row.project_id,
      branchKey: row.branch_key,
      branchKind: row.branch_kind,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  listTaskBranches(projectId?: string): TaskBranchRecord[] {
    const rows = projectId !== undefined
      ? this.db.prepare(`SELECT * FROM task_branches WHERE COALESCE(project_id, '') = ? ORDER BY updated_at DESC`).all(projectScope(projectId))
      : this.db.prepare(`SELECT * FROM task_branches ORDER BY updated_at DESC`).all();
    return (rows as any[]).map((row) => ({
      taskId: row.task_id,
      projectId: row.project_id || undefined,
      taskKey: row.task_key,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  listEventClusters(projectId?: string): EventClusterRecord[] {
    const rows = projectId !== undefined
      ? this.db.prepare(`SELECT * FROM event_clusters WHERE COALESCE(project_id, '') = ? ORDER BY updated_at DESC`).all(projectScope(projectId))
      : this.db.prepare(`SELECT * FROM event_clusters ORDER BY updated_at DESC`).all();
    return (rows as any[]).map((row) => ({
      clusterId: row.cluster_id,
      projectId: row.project_id || undefined,
      clusterKey: row.cluster_key,
      clusterType: row.cluster_type,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  listNeuronIdsByProject(projectId: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT be.neuron_id
      FROM branch_entries be
      JOIN project_branches pb ON pb.branch_id = be.branch_id
      JOIN neurons n ON n.id = be.neuron_id AND n.is_deleted = 0
      WHERE pb.project_id = ?
        AND COALESCE(n.project_id, '') = COALESCE(pb.project_id, '')
      ORDER BY be.created_at DESC
    `).all(projectId) as Array<{ neuron_id: string | null }>;
    return rows.map((row) => row.neuron_id).filter((value): value is string => Boolean(value));
  }

  listNeuronIdsByTemporalRange(start: number, end: number, projectId?: string): string[] {
    if (this.hasDirtyTimeProjection(projectId)) return [];
    const queryProject = projectQueryValue(projectId);
    const rows = this.db.prepare(`
      SELECT DISTINCT tbe.neuron_id
      FROM time_bucket_entries tbe
      JOIN neurons n ON n.id=tbe.neuron_id AND n.is_deleted=0
      WHERE tbe.created_at >= ?
        AND tbe.created_at < ?
        AND (? IS NULL OR COALESCE(tbe.project_id,'') = ?)
        AND COALESCE(n.project_id,'')=COALESCE(tbe.project_id,'')
      ORDER BY tbe.created_at DESC
    `).all(start, end, queryProject, queryProject) as Array<{ neuron_id: string | null }>;
    return rows.map((row) => row.neuron_id).filter((value): value is string => Boolean(value));
  }

  listTimeBucketIdsByNeuronIds(neuronIds: string[], projectId?: string, limit: number = 80): string[] {
    if (neuronIds.length === 0 || this.hasDirtyTimeProjection(projectId)) return [];
    const scopedNeuronIds = Array.from(new Set(neuronIds.filter(Boolean))).slice(0, 200);
    if (scopedNeuronIds.length === 0) return [];
    const rowLimit = Math.max(1, Math.min(limit, 200));
    const placeholders = scopedNeuronIds.map(() => '?').join(', ');
    const queryProject = projectQueryValue(projectId);
    const rows = this.db.prepare(`
      SELECT DISTINCT bucket_id
      FROM time_bucket_entries
      WHERE neuron_id IN (${placeholders})
        AND (? IS NULL OR COALESCE(project_id, '') = ?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...scopedNeuronIds, queryProject, queryProject, rowLimit) as Array<{ bucket_id: string }>;
    return rows.map((row) => row.bucket_id);
  }

  collectCandidateNeuronIds(input: {
    projectId?: string;
    startTime?: number;
    endTime?: number;
    terms?: string[];
    limit?: number;
    excludeTemporal?: boolean;
  }): string[] {
    const limit = input.limit ?? 200;
    const collected = new Set<string>();
    const queryProject = projectQueryValue(input.projectId);
    const terms = (input.terms || []).map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 2);
    const hasNeurons = this.hasTable('neurons');
    const liveJoin = hasNeurons ? 'JOIN neurons n ON n.id=tm.neuron_id AND n.is_deleted=0' : '';
    const liveScope = hasNeurons ? "AND COALESCE(n.project_id,'')=COALESCE(tm.project_id,'')" : '';

    const baseRows = this.db.prepare(`
      SELECT tm.neuron_id
      FROM topology_membership tm
      ${liveJoin}
      WHERE (? IS NULL OR COALESCE(tm.project_id, '') = ?)
        ${liveScope}
        AND (? = 0 OR tm.dimension_type <> 'time_bucket')
        AND (? IS NULL OR tm.created_at >= ?)
        AND (? IS NULL OR tm.created_at < ?)
      ORDER BY tm.created_at DESC
      LIMIT ?
    `).all(
      queryProject,
      queryProject,
      input.excludeTemporal ? 1 : 0,
      input.startTime ?? null,
      input.startTime ?? null,
      input.endTime ?? null,
      input.endTime ?? null,
      limit * 2
    ) as Array<{ neuron_id: string }>;

    for (const row of baseRows) {
      collected.add(row.neuron_id);
      if (collected.size >= limit) break;
    }

    for (const term of terms) {
      if (collected.size >= limit) break;
      const rows = this.db.prepare(`
        SELECT tm.neuron_id
        FROM topology_membership tm
        ${liveJoin}
        WHERE (? IS NULL OR COALESCE(tm.project_id, '') = ?)
          ${liveScope}
          AND (? = 0 OR tm.dimension_type <> 'time_bucket')
          AND (lower(tm.title) LIKE ? OR lower(tm.dimension_key) LIKE ?)
        ORDER BY tm.created_at DESC
        LIMIT ?
      `).all(
        queryProject,
        queryProject,
        input.excludeTemporal ? 1 : 0,
        `%${term}%`,
        `%${term}%`,
        limit
      ) as Array<{ neuron_id: string }>;
      for (const row of rows) {
        collected.add(row.neuron_id);
        if (collected.size >= limit) break;
      }
    }

    return Array.from(collected).slice(0, limit);
  }

  collectBranchNavigation(input: {
    projectId?: string;
    terms?: string[];
    limit?: number;
    siblingDepth?: number;
  }): {
    branchIds: string[];
    taskIds: string[];
    clusterIds: string[];
    neuronIds: string[];
  } {
    const limit = input.limit ?? 120;
    const siblingDepth = Math.max(0, input.siblingDepth ?? 1);
    const terms = (input.terms || []).map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 2);
    const queryProject = projectQueryValue(input.projectId);

    const branchIds = new Set<string>();
    const taskIds = new Set<string>();
    const clusterIds = new Set<string>();
    const neuronIds = new Set<string>();

    const addNeuronRows = (rows: Array<{ neuron_id: string | null }>): void => {
      for (const row of rows) {
        if (!row.neuron_id) continue;
        neuronIds.add(row.neuron_id);
        if (neuronIds.size >= limit) break;
      }
    };

    if (input.projectId !== undefined) {
      const rootRows = this.db.prepare(`
        SELECT branch_id
        FROM project_branches
        WHERE COALESCE(project_id, '') = ?
      `).all(projectScope(input.projectId)) as Array<{ branch_id: string }>;

      for (const row of rootRows) {
        branchIds.add(row.branch_id);
      }
    }

    for (const term of terms) {
      const branchRows = this.db.prepare(`
        SELECT branch_id
        FROM project_branches
        WHERE (? IS NULL OR COALESCE(project_id, '') = ?)
          AND (lower(title) LIKE ? OR lower(branch_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(
        queryProject,
        queryProject,
        `%${term}%`,
        `%${term}%`,
        limit
      ) as Array<{ branch_id: string }>;
      for (const row of branchRows) branchIds.add(row.branch_id);

      const taskRows = this.db.prepare(`
        SELECT task_id
        FROM task_branches
        WHERE (? IS NULL OR COALESCE(project_id, '') = ?)
          AND (lower(title) LIKE ? OR lower(task_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(
        queryProject,
        queryProject,
        `%${term}%`,
        `%${term}%`,
        limit
      ) as Array<{ task_id: string }>;
      for (const row of taskRows) taskIds.add(row.task_id);

      const clusterRows = this.db.prepare(`
        SELECT cluster_id
        FROM event_clusters
        WHERE (? IS NULL OR COALESCE(project_id, '') = ?)
          AND (lower(title) LIKE ? OR lower(cluster_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(
        queryProject,
        queryProject,
        `%${term}%`,
        `%${term}%`,
        limit
      ) as Array<{ cluster_id: string }>;
      for (const row of clusterRows) clusterIds.add(row.cluster_id);
    }

    if (branchIds.size > 0 && siblingDepth > 0) {
      const frontier = Array.from(branchIds);
      const visited = new Set(frontier);

      for (let depth = 0; depth < siblingDepth; depth += 1) {
        const next: string[] = [];
        for (const branchId of frontier) {
          const linked = this.listScopedBranchLinks(branchId, queryProject);

          for (const row of linked) {
            const candidates = [row.parent_branch_id, row.child_branch_id];
            for (const candidate of candidates) {
              if (visited.has(candidate)) continue;
              visited.add(candidate);
              branchIds.add(candidate);
              next.push(candidate);
            }
          }
        }
        frontier.splice(0, frontier.length, ...next);
        if (frontier.length === 0) break;
      }
    }

    if (branchIds.size > 0) {
      const placeholders = Array.from(branchIds).map(() => '?').join(', ');
      addNeuronRows(
        this.db.prepare(`
          SELECT DISTINCT neuron_id
          FROM branch_entries be
          JOIN project_branches pb ON pb.branch_id=be.branch_id
          JOIN neurons n ON n.id=be.neuron_id AND n.is_deleted=0
          WHERE be.branch_id IN (${placeholders})
            AND (? IS NULL OR COALESCE(pb.project_id,'') = ?)
            AND COALESCE(n.project_id,'')=COALESCE(pb.project_id,'')
            AND neuron_id IS NOT NULL
          ORDER BY be.created_at DESC
          LIMIT ?
        `).all(...Array.from(branchIds), queryProject, queryProject, limit) as Array<{ neuron_id: string | null }>
      );
    }

    if (taskIds.size > 0) {
      const placeholders = Array.from(taskIds).map(() => '?').join(', ');
      addNeuronRows(
        this.db.prepare(`
          SELECT DISTINCT tbe.neuron_id
          FROM task_branch_entries tbe
          JOIN task_branches tb ON tb.task_id=tbe.task_id
          JOIN neurons n ON n.id=tbe.neuron_id AND n.is_deleted=0
          WHERE tbe.task_id IN (${placeholders})
            AND (? IS NULL OR COALESCE(tb.project_id,'') = ?)
            AND COALESCE(n.project_id,'')=COALESCE(tb.project_id,'')
          ORDER BY tbe.created_at DESC
          LIMIT ?
        `).all(...Array.from(taskIds), queryProject, queryProject, limit) as Array<{ neuron_id: string | null }>
      );
    }

    if (clusterIds.size > 0) {
      const placeholders = Array.from(clusterIds).map(() => '?').join(', ');
      addNeuronRows(
        this.db.prepare(`
          SELECT DISTINCT ece.neuron_id
          FROM event_cluster_entries ece
          JOIN event_clusters ec ON ec.cluster_id=ece.cluster_id
          JOIN neurons n ON n.id=ece.neuron_id AND n.is_deleted=0
          WHERE ece.cluster_id IN (${placeholders})
            AND (? IS NULL OR COALESCE(ec.project_id,'') = ?)
            AND COALESCE(n.project_id,'')=COALESCE(ec.project_id,'')
          ORDER BY ece.created_at DESC
          LIMIT ?
        `).all(...Array.from(clusterIds), queryProject, queryProject, limit) as Array<{ neuron_id: string | null }>
      );
    }

    return {
      branchIds: Array.from(branchIds).slice(0, limit),
      taskIds: Array.from(taskIds).slice(0, limit),
      clusterIds: Array.from(clusterIds).slice(0, limit),
      neuronIds: Array.from(neuronIds).slice(0, limit)
    };
  }

  collectNavigationFromNeuronIds(input: {
    neuronIds: string[];
    projectId?: string;
    limit?: number;
    siblingDepth?: number;
  }): {
    branchIds: string[];
    taskIds: string[];
    clusterIds: string[];
    neuronIds: string[];
  } {
    const limit = input.limit ?? 120;
    const siblingDepth = Math.max(0, input.siblingDepth ?? 1);
    if (input.neuronIds.length === 0) {
      return { branchIds: [], taskIds: [], clusterIds: [], neuronIds: [] };
    }

    const queryProject = projectQueryValue(input.projectId);
    const requestedNeuronIds = Array.from(new Set(input.neuronIds.filter(Boolean))).slice(0, 200);
    const scopedNeuronIds = queryProject === null
      ? requestedNeuronIds
      : (this.db.prepare(`
          SELECT id
          FROM neurons
          WHERE id IN (${requestedNeuronIds.map(() => '?').join(', ')})
            AND is_deleted=0
            AND COALESCE(project_id,'')=?
        `).all(...requestedNeuronIds, queryProject) as Array<{ id: string }>).map((row) => row.id);
    if (scopedNeuronIds.length === 0) {
      return { branchIds: [], taskIds: [], clusterIds: [], neuronIds: [] };
    }

    const branchIds = new Set<string>();
    const taskIds = new Set<string>();
    const clusterIds = new Set<string>();
    const neuronIds = new Set<string>(scopedNeuronIds);
    const placeholders = scopedNeuronIds.map(() => '?').join(', ');

    const branchRows = this.db.prepare(`
      SELECT DISTINCT be.branch_id
      FROM branch_entries be
      JOIN project_branches pb ON pb.branch_id = be.branch_id
      WHERE be.neuron_id IN (${placeholders})
        AND (? IS NULL OR COALESCE(pb.project_id, '') = ?)
      ORDER BY be.created_at DESC
      LIMIT ?
    `).all(...scopedNeuronIds, queryProject, queryProject, limit) as Array<{ branch_id: string }>;
    for (const row of branchRows) branchIds.add(row.branch_id);

    const taskRows = this.db.prepare(`
      SELECT DISTINCT tbe.task_id
      FROM task_branch_entries tbe
      JOIN task_branches tb ON tb.task_id = tbe.task_id
      WHERE tbe.neuron_id IN (${placeholders})
        AND (? IS NULL OR COALESCE(tb.project_id, '') = ?)
      ORDER BY tbe.created_at DESC
      LIMIT ?
    `).all(...scopedNeuronIds, queryProject, queryProject, limit) as Array<{ task_id: string }>;
    for (const row of taskRows) taskIds.add(row.task_id);

    const clusterRows = this.db.prepare(`
      SELECT DISTINCT ece.cluster_id
      FROM event_cluster_entries ece
      JOIN event_clusters ec ON ec.cluster_id = ece.cluster_id
      WHERE ece.neuron_id IN (${placeholders})
        AND (? IS NULL OR COALESCE(ec.project_id, '') = ?)
      ORDER BY ece.created_at DESC
      LIMIT ?
    `).all(...scopedNeuronIds, queryProject, queryProject, limit) as Array<{ cluster_id: string }>;
    for (const row of clusterRows) clusterIds.add(row.cluster_id);

    if (branchIds.size > 0 && siblingDepth > 0) {
      const frontier = Array.from(branchIds);
      const visited = new Set(frontier);
      for (let depth = 0; depth < siblingDepth; depth += 1) {
        const next: string[] = [];
        for (const branchId of frontier) {
          const linked = this.listScopedBranchLinks(branchId, queryProject);
          for (const row of linked) {
            for (const candidate of [row.parent_branch_id, row.child_branch_id]) {
              if (visited.has(candidate)) continue;
              visited.add(candidate);
              branchIds.add(candidate);
              next.push(candidate);
            }
          }
        }
        frontier.splice(0, frontier.length, ...next);
        if (frontier.length === 0) break;
      }
    }

    if (branchIds.size > 0) {
      const placeholders2 = Array.from(branchIds).map(() => '?').join(', ');
      const rows = this.db.prepare(`
        SELECT DISTINCT neuron_id
        FROM branch_entries be
        JOIN project_branches pb ON pb.branch_id=be.branch_id
        JOIN neurons n ON n.id=be.neuron_id AND n.is_deleted=0
        WHERE be.branch_id IN (${placeholders2})
          AND (? IS NULL OR COALESCE(pb.project_id,'') = ?)
          AND COALESCE(n.project_id,'')=COALESCE(pb.project_id,'')
          AND neuron_id IS NOT NULL
        ORDER BY be.created_at DESC
        LIMIT ?
      `).all(...Array.from(branchIds), queryProject, queryProject, limit) as Array<{ neuron_id: string | null }>;
      for (const row of rows) {
        if (row.neuron_id) neuronIds.add(row.neuron_id);
        if (neuronIds.size >= limit) break;
      }
    }

    return {
      branchIds: Array.from(branchIds).slice(0, limit),
      taskIds: Array.from(taskIds).slice(0, limit),
      clusterIds: Array.from(clusterIds).slice(0, limit),
      neuronIds: Array.from(neuronIds).slice(0, limit)
    };
  }

  collectTemporalContext(input: {
    projectId?: string;
    startTime?: number;
    endTime?: number;
    preferredBucketType?: TimeBucketType;
    limit?: number;
  }): {
    bucketType: TimeBucketType;
    bucketIds: string[];
    bucketLabels: string[];
    neuronIds: string[];
  } {
    if (this.hasDirtyTimeProjection(input.projectId)) return { bucketType: input.preferredBucketType ?? 'day', bucketIds: [], bucketLabels: [], neuronIds: [] };
    const limit = input.limit ?? 120;
    const bucketType = input.preferredBucketType ?? 'day';
    const queryProject = projectQueryValue(input.projectId);
    const rows = this.db.prepare(`
      SELECT tb.bucket_id, tb.label, tbe.neuron_id
      FROM time_bucket_entries tbe
      JOIN time_buckets tb ON tb.bucket_id = tbe.bucket_id
      JOIN neurons n ON n.id=tbe.neuron_id AND n.is_deleted=0
      WHERE tb.bucket_type = ?
        AND (? IS NULL OR COALESCE(tbe.project_id,'') = ?)
        AND COALESCE(n.project_id,'')=COALESCE(tbe.project_id,'')
        AND (? IS NULL OR tbe.created_at >= ?)
        AND (? IS NULL OR tbe.created_at < ?)
      ORDER BY tb.bucket_start DESC, tbe.created_at DESC
      LIMIT ?
    `).all(
      bucketType,
      queryProject,
      queryProject,
      input.startTime ?? null,
      input.startTime ?? null,
      input.endTime ?? null,
      input.endTime ?? null,
      limit * 4
    ) as Array<{ bucket_id: string; label: string; neuron_id: string | null }>;

    const bucketIds: string[] = [];
    const bucketLabels: string[] = [];
    const neuronIds: string[] = [];
    const seenBuckets = new Set<string>();
    const seenNeurons = new Set<string>();

    for (const row of rows) {
      if (!seenBuckets.has(row.bucket_id)) {
        seenBuckets.add(row.bucket_id);
        bucketIds.push(row.bucket_id);
        bucketLabels.push(row.label);
      }
      if (row.neuron_id && !seenNeurons.has(row.neuron_id)) {
        seenNeurons.add(row.neuron_id);
        neuronIds.push(row.neuron_id);
      }
      if (neuronIds.length >= limit && bucketIds.length >= Math.min(limit, 12)) break;
    }

    return {
      bucketType,
      bucketIds: bucketIds.slice(0, limit),
      bucketLabels: bucketLabels.slice(0, 12),
      neuronIds: neuronIds.slice(0, limit)
    };
  }

  getTimeBucketEntryCount(
    bucketType: TimeBucketType,
    start: number,
    options: { projectId?: string; timeZone?: string; end?: number } = {},
  ): number {
    if (this.hasDirtyTimeProjection(options.projectId)) return 0;
    const clauses = ['b.bucket_type=?', 'b.bucket_start=?'];
    const params: Array<string | number> = [bucketType, start];
    if (options.projectId !== undefined) {
      clauses.push('b.project_id=?');
      params.push(projectScope(options.projectId));
    }
    if (options.timeZone !== undefined) {
      clauses.push('b.time_zone=?');
      params.push(options.timeZone);
    }
    if (options.end !== undefined) {
      clauses.push('b.bucket_end=?');
      params.push(options.end);
    }
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM time_bucket_entries entry
      JOIN time_buckets b ON b.bucket_id=entry.bucket_id
      WHERE ${clauses.join(' AND ')}
    `).get(...params) as { count: number } | null;
    return row?.count || 0;
  }

  getMaterializedMembershipCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM topology_membership`).get() as { count: number } | null;
    return row?.count || 0;
  }

  private upsertMembership(
    neuronId: string,
    projectId: string | undefined,
    dimensionType: 'time_bucket' | 'project_branch' | 'task_branch' | 'event_cluster',
    dimensionKey: string,
    title: string | undefined,
    createdAt: number
  ): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO topology_membership (
        neuron_id, project_id, dimension_type, dimension_key, title, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      neuronId,
      projectScope(projectId),
      dimensionType,
      dimensionKey,
      title || null,
      createdAt
    );
  }

  private listScopedBranchLinks(branchId: string, queryProject: string | null): Array<{ parent_branch_id: string; child_branch_id: string }> {
    return this.db.prepare(`
      SELECT bl.parent_branch_id,bl.child_branch_id
      FROM branch_links bl
      JOIN project_branches parent ON parent.branch_id=bl.parent_branch_id
      JOIN project_branches child ON child.branch_id=bl.child_branch_id
      WHERE (bl.parent_branch_id=? OR bl.child_branch_id=?)
        AND parent.project_id=child.project_id
        AND COALESCE(bl.project_id,'')=COALESCE(parent.project_id,'')
        AND (? IS NULL OR COALESCE(parent.project_id,'')=?)
    `).all(branchId, branchId, queryProject, queryProject) as Array<{ parent_branch_id: string; child_branch_id: string }>;
  }

  private assertReferenceScope(parentScope: string, ref: TopologyReference): void {
    const expected = projectScope(ref.projectId);
    if (expected !== parentScope) throw new Error('topology_reference_project_scope_mismatch');
    const scopes: string[] = [];
    const addNeuron = (neuronId: string | null | undefined): void => {
      if (!neuronId) throw new Error('topology_reference_unresolved');
      const row = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0`)
        .get(neuronId) as { scope: string } | null;
      if (!row) throw new Error('topology_reference_unresolved');
      scopes.push(row.scope);
    };

    if (ref.neuronId) addNeuron(ref.neuronId);
    if (ref.factId) {
      const row = this.db.prepare(`SELECT neuron_id FROM facts WHERE fact_id=?`).get(ref.factId) as { neuron_id: string } | null;
      if (!row) throw new Error('topology_reference_unresolved');
      addNeuron(row.neuron_id);
    }
    if (ref.eventId) {
      const row = this.db.prepare(`SELECT neuron_id FROM compiled_events WHERE event_id=?`).get(ref.eventId) as { neuron_id: string } | null;
      if (!row) throw new Error('topology_reference_unresolved');
      addNeuron(row.neuron_id);
    }
    if (ref.unitId) {
      const row = this.db.prepare(`SELECT message_neuron_ids_json FROM interaction_units WHERE unit_id=?`).get(ref.unitId) as { message_neuron_ids_json: string } | null;
      if (!row) throw new Error('topology_reference_unresolved');
      const ids = parseStringIds(row.message_neuron_ids_json);
      if (ids.length === 0) throw new Error('topology_reference_unresolved');
      for (const neuronId of ids) addNeuron(neuronId);
    }
    if (ref.beliefId) {
      const belief = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope,source_neuron_id FROM beliefs WHERE id=?`)
        .get(ref.beliefId) as { scope: string; source_neuron_id: string | null } | null;
      if (!belief) throw new Error('topology_reference_unresolved');
      scopes.push(belief.scope);
      if (belief.source_neuron_id) addNeuron(belief.source_neuron_id);
      const evidence = this.db.prepare(`SELECT neuron_id,event_id FROM belief_evidence WHERE belief_id=?`).all(ref.beliefId) as Array<{ neuron_id: string | null; event_id: string | null }>;
      for (const item of evidence) {
        if (item.neuron_id) addNeuron(item.neuron_id);
        if (item.event_id) {
          const event = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM memory_events WHERE event_id=?`).get(item.event_id) as { scope: string } | null;
          if (!event) throw new Error('topology_reference_unresolved');
          scopes.push(event.scope);
        }
      }
    }
    if (scopes.length === 0) throw new Error('topology_reference_unresolved');
    if (scopes.some((scope) => scope !== parentScope)) throw new Error('topology_reference_project_scope_mismatch');
  }

  private hasColumn(table: string, column: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name=?`).get(table, column));
  }

  private hasTable(table: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
  }

  private installBranchScopeTriggers(): void {
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_project_branch_scope_immutable
      BEFORE UPDATE OF project_id,branch_key ON project_branches
      WHEN NEW.project_id<>OLD.project_id OR NEW.branch_key<>OLD.branch_key
      BEGIN SELECT RAISE(ABORT,'project_branch_identity_conflict'); END;
      CREATE TRIGGER IF NOT EXISTS trg_branch_link_scope_insert
      BEFORE INSERT ON branch_links
      WHEN NOT EXISTS (
        SELECT 1 FROM project_branches p JOIN project_branches c
          ON p.project_id=c.project_id
        WHERE p.branch_id=NEW.parent_branch_id AND c.branch_id=NEW.child_branch_id
          AND p.project_id=COALESCE(NEW.project_id,'')
      )
      BEGIN SELECT RAISE(ABORT,'topology_branch_link_project_scope_mismatch'); END;
      CREATE TRIGGER IF NOT EXISTS trg_branch_link_scope_update
      BEFORE UPDATE ON branch_links
      WHEN NOT EXISTS (
        SELECT 1 FROM project_branches p JOIN project_branches c
          ON p.project_id=c.project_id
        WHERE p.branch_id=NEW.parent_branch_id AND c.branch_id=NEW.child_branch_id
          AND p.project_id=COALESCE(NEW.project_id,'')
      )
      BEGIN SELECT RAISE(ABORT,'topology_branch_link_project_scope_mismatch'); END;
      CREATE TRIGGER IF NOT EXISTS trg_branch_entry_parent_scope_insert
      BEFORE INSERT ON branch_entries
      WHEN NOT EXISTS (SELECT 1 FROM project_branches p WHERE p.branch_id=NEW.branch_id AND p.project_id=COALESCE(NEW.project_id,''))
      BEGIN SELECT RAISE(ABORT,'topology_reference_project_scope_mismatch'); END;
      CREATE TRIGGER IF NOT EXISTS trg_branch_entry_parent_scope_update
      BEFORE UPDATE ON branch_entries
      WHEN NOT EXISTS (SELECT 1 FROM project_branches p WHERE p.branch_id=NEW.branch_id AND p.project_id=COALESCE(NEW.project_id,''))
      BEGIN SELECT RAISE(ABORT,'topology_reference_project_scope_mismatch'); END;
    `);
  }

  close(): void {
    if (this.ownsDb) this.db.close();
  }
}

function parseStringIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
  } catch {
    return [];
  }
}
