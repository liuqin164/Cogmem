import Database from 'bun:sqlite';
import { projectQueryValue, projectScope } from '../topology/ProjectScope.js';
import { isCanonicalEventClusterKey } from '../topology/EventClusterIdentity.js';
export class TopologyStore {
    db;
    ownsDb;
    constructor(dbOrPath = ':memory:') {
        if (typeof dbOrPath === 'string') {
            this.ownsDb = true;
            this.db = new Database(dbOrPath);
        }
        else {
            this.ownsDb = false;
            this.db = dbOrPath;
        }
        this.initializeSchema();
    }
    initializeSchema() {
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
            if (!this.hasColumn(table, 'project_id'))
                this.db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`);
        }
        if (!this.hasColumn('branch_links', 'project_id'))
            this.db.exec(`ALTER TABLE branch_links ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`);
        this.installBranchScopeTriggers();
    }
    timeProjectionNeedsRebuild(projectId, timeZone) {
        return !this.hasUsableTimeProjection(projectId, timeZone);
    }
    hasDirtyTimeProjection(projectId) {
        const scope = projectId === undefined ? undefined : projectScope(projectId);
        return Boolean(scope === undefined
            ? this.db.prepare(`SELECT 1 FROM topology_projection_state s LEFT JOIN topology_source_revisions r ON r.project_id=s.project_id WHERE r.project_id IS NULL OR s.projection_version<>4 OR s.status<>'clean' OR s.source_revision<>r.revision UNION ALL SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE s.project_id IS NULL LIMIT 1`).get()
            : this.db.prepare(`SELECT 1 FROM topology_projection_state s LEFT JOIN topology_source_revisions r ON r.project_id=s.project_id WHERE s.project_id=? AND (r.project_id IS NULL OR s.projection_version<>4 OR s.status<>'clean' OR s.source_revision<>r.revision) UNION ALL SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE r.project_id=? AND s.project_id IS NULL LIMIT 1`).get(scope, scope));
    }
    hasUsableTimeProjection(projectId, timeZone) {
        const scope = projectScope(projectId);
        const revisionRow = this.db.prepare(`SELECT revision FROM topology_source_revisions WHERE project_id=?`).get(scope);
        const row = this.db.prepare(`SELECT projection_version,status,time_zone,source_revision FROM topology_projection_state WHERE project_id=?`).get(scope);
        if (!revisionRow)
            return !row;
        return Boolean(row && row.projection_version === 4 && row.status === 'clean' && row.time_zone === timeZone && row.source_revision === revisionRow.revision);
    }
    hasUsableTimeProjections(timeZone) {
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
    beginTimeProjectionSourceUpdate(projectId, timeZone, updatedAt) {
        const scope = projectScope(projectId);
        return this.db.transaction(() => {
            const previousRevision = this.getTimeProjectionSourceRevision(scope);
            const state = this.db.prepare(`SELECT projection_version,status,time_zone,source_revision FROM topology_projection_state WHERE project_id=?`).get(scope);
            const incremental = state
                ? state.projection_version === 4 && state.status === 'clean' && state.time_zone === timeZone && state.source_revision === previousRevision
                : previousRevision === 0;
            const sourceRevision = previousRevision + 1;
            this.db.prepare(`INSERT INTO topology_source_revisions(project_id,revision,updated_at) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at`).run(scope, sourceRevision, updatedAt);
            this.markTimeProjection(scope, 'dirty', timeZone, updatedAt, undefined, sourceRevision);
            return { sourceRevision, incremental };
        })();
    }
    getTimeProjectionSourceRevision(projectId) {
        const row = this.db.prepare(`SELECT revision FROM topology_source_revisions WHERE project_id=?`).get(projectScope(projectId));
        return Number(row?.revision ?? 0);
    }
    markTimeProjection(projectId, status, timeZone, updatedAt, error, sourceRevision = this.getTimeProjectionSourceRevision(projectId)) {
        const scope = projectScope(projectId);
        this.db.prepare(`INSERT OR IGNORE INTO topology_source_revisions(project_id,revision,updated_at) VALUES(?,?,?)`).run(scope, sourceRevision, updatedAt);
        this.db.prepare(`
      INSERT INTO topology_projection_state(project_id,projection_version,status,time_zone,updated_at,error,source_revision)
      VALUES(?,4,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET projection_version=4,status=excluded.status,time_zone=excluded.time_zone,updated_at=excluded.updated_at,error=excluded.error,source_revision=excluded.source_revision
    `).run(scope, status, timeZone, updatedAt, error ?? null, sourceRevision);
    }
    markTimeProjectionCleanIfCurrent(projectId, timeZone, updatedAt, sourceRevision) {
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
    resetProjectTimeBuckets(projectId) {
        const scope = projectScope(projectId);
        this.db.prepare(`DELETE FROM topology_membership WHERE COALESCE(project_id,'')=? AND dimension_type='time_bucket'`).run(scope);
        this.db.prepare(`DELETE FROM time_bucket_entries WHERE COALESCE(project_id,'')=?`).run(scope);
        this.db.exec(`DELETE FROM time_buckets WHERE bucket_id NOT IN (SELECT DISTINCT bucket_id FROM time_bucket_entries);`);
    }
    listProjectTimeBucketsByNeuron(projectId, neuronIds) {
        if (neuronIds.length === 0 || this.hasDirtyTimeProjection(projectId))
            return new Map();
        const placeholders = neuronIds.map(() => '?').join(',');
        const rows = this.db.prepare(`
      SELECT e.neuron_id,b.bucket_id,b.project_id,b.time_zone,b.bucket_type,b.bucket_start,b.bucket_end,b.label
      FROM time_bucket_entries e
      JOIN time_buckets b ON b.bucket_id=e.bucket_id
      WHERE COALESCE(e.project_id,'')=? AND e.neuron_id IN (${placeholders})
      ORDER BY e.created_at ASC,b.bucket_type ASC
    `).all(projectScope(projectId), ...neuronIds);
        const result = new Map();
        for (const row of rows) {
            const values = result.get(row.neuron_id) ?? [];
            values.push({ bucketId: row.bucket_id, projectId: row.project_id == null ? undefined : String(row.project_id), timeZone: row.time_zone, bucketType: row.bucket_type, bucketStart: row.bucket_start, bucketEnd: row.bucket_end, label: row.label });
            result.set(row.neuron_id, values);
        }
        return result;
    }
    upsertTimeBucket(bucket) {
        const projectScope = bucket.projectId ?? '';
        const timeZone = bucket.timeZone ?? 'UTC';
        const existing = this.db.prepare(`SELECT project_id,time_zone,bucket_type,bucket_start,bucket_end FROM time_buckets WHERE bucket_id=?`).get(bucket.bucketId);
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
    `).run(bucket.bucketId, projectScope, timeZone, bucket.bucketType, bucket.bucketStart, bucket.bucketEnd, bucket.label);
        return bucket;
    }
    attachToTimeBucket(bucketId, ref) {
        this.db.transaction(() => {
            const bucket = this.db.prepare(`SELECT project_id,label FROM time_buckets WHERE bucket_id=?`).get(bucketId);
            if (!bucket || bucket.project_id !== projectScope(ref.projectId))
                throw new Error('time_bucket_project_scope_mismatch');
            this.assertReferenceScope(bucket.project_id, ref);
            this.db.prepare(`
      INSERT OR IGNORE INTO time_bucket_entries (
        bucket_id, neuron_id, unit_id, belief_id, fact_id, event_id, project_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bucketId, ref.neuronId || null, ref.unitId || null, ref.beliefId || null, ref.factId || null, ref.eventId || null, projectScope(ref.projectId), ref.createdAt);
            if (ref.neuronId)
                this.upsertMembership(ref.neuronId, ref.projectId, 'time_bucket', bucketId, bucket.label, ref.createdAt);
        })();
    }
    upsertProjectBranch(input) {
        return this.db.transaction(() => {
            const idOwner = this.db.prepare(`SELECT project_id,branch_key FROM project_branches WHERE branch_id=?`).get(input.branchId);
            if (idOwner && (idOwner.project_id !== input.projectId || idOwner.branch_key !== input.branchKey))
                throw new Error('project_branch_identity_conflict');
            const existing = this.db.prepare(`SELECT * FROM project_branches WHERE project_id=? AND branch_key=?`).get(input.projectId, input.branchKey);
            const branchId = existing?.branch_id || input.branchId;
            const createdAt = existing?.created_at || input.createdAt;
            this.db.prepare(`
      INSERT INTO project_branches (
        branch_id, project_id, branch_key, branch_kind, title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id,branch_key) DO UPDATE SET
        branch_kind=excluded.branch_kind,title=excluded.title,updated_at=excluded.updated_at
    `).run(branchId, input.projectId, input.branchKey, input.branchKind, input.title, createdAt, input.createdAt);
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
    linkBranches(parentBranchId, childBranchId, relationType, createdAt) {
        this.db.transaction(() => {
            const parent = this.db.prepare(`SELECT project_id FROM project_branches WHERE branch_id=?`).get(parentBranchId);
            const child = this.db.prepare(`SELECT project_id FROM project_branches WHERE branch_id=?`).get(childBranchId);
            if (!parent || !child)
                throw new Error('topology_parent_not_found');
            if (parent.project_id !== child.project_id)
                throw new Error('topology_branch_link_project_scope_mismatch');
            this.db.prepare(`
      INSERT OR IGNORE INTO branch_links (
        parent_branch_id, child_branch_id, project_id, relation_type, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(parentBranchId, childBranchId, parent.project_id, relationType, createdAt);
        })();
    }
    attachToBranch(branchId, ref) {
        this.db.transaction(() => {
            const row = this.db.prepare(`SELECT project_id, branch_key, title FROM project_branches WHERE branch_id = ?`)
                .get(branchId);
            if (!row)
                throw new Error('topology_parent_not_found');
            this.assertReferenceScope(row.project_id, ref);
            this.db.prepare(`
      INSERT OR IGNORE INTO branch_entries (
        branch_id, project_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(branchId, row.project_id, ref.neuronId || null, ref.unitId || null, ref.beliefId || null, ref.factId || null, ref.eventId || null, ref.createdAt);
            if (ref.neuronId) {
                this.upsertMembership(ref.neuronId, row.project_id, 'project_branch', row.branch_key, row.title, ref.createdAt);
            }
        })();
    }
    upsertTaskBranch(input) {
        const scope = projectScope(input.projectId);
        if (this.isUnresolvedTask(input.taskId)
            || this.isUnresolvedTaskIdentity(scope, input.taskKey))
            throw new Error('task_identity_unresolved');
        const existing = this.db.prepare(`
      SELECT * FROM task_branches WHERE project_id = ? AND task_key = ?
    `).get(scope, input.taskKey);
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
    `).run(taskId, scope, input.taskKey, input.title, status, createdAt, input.createdAt);
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
    attachToTask(taskId, ref) {
        this.db.transaction(() => {
            if (this.isUnresolvedTask(taskId))
                throw new Error('task_identity_unresolved');
            const row = this.db.prepare(`SELECT project_id, task_key, title FROM task_branches WHERE task_id = ?`)
                .get(taskId);
            if (!row)
                throw new Error('topology_parent_not_found');
            this.assertReferenceScope(row.project_id, ref);
            this.db.prepare(`
      INSERT OR IGNORE INTO task_branch_entries (
        task_id, project_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, row.project_id, ref.neuronId || null, ref.unitId || null, ref.beliefId || null, ref.factId || null, ref.eventId || null, ref.createdAt);
            if (ref.neuronId) {
                this.upsertMembership(ref.neuronId, row.project_id == null ? undefined : String(row.project_id), 'task_branch', row.task_key, row.title, ref.createdAt);
            }
        })();
    }
    upsertEventCluster(input) {
        const scope = projectScope(input.projectId);
        if (!isCanonicalEventClusterKey(input.clusterType, input.clusterKey))
            throw new Error('event_cluster_key_noncanonical');
        const existing = this.db.prepare(`
      SELECT * FROM event_clusters WHERE project_id = ? AND cluster_key = ?
    `).get(scope, input.clusterKey);
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
    `).run(clusterId, scope, input.clusterKey, input.clusterType, input.title, createdAt, input.createdAt);
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
    attachToEventCluster(clusterId, ref) {
        this.db.transaction(() => {
            const row = this.db.prepare(`SELECT project_id, cluster_key, title FROM event_clusters WHERE cluster_id = ?`)
                .get(clusterId);
            if (!row)
                throw new Error('topology_parent_not_found');
            this.assertReferenceScope(row.project_id, ref);
            this.db.prepare(`
      INSERT OR IGNORE INTO event_cluster_entries (
        cluster_id, project_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clusterId, row.project_id, ref.neuronId || null, ref.unitId || null, ref.beliefId || null, ref.factId || null, ref.eventId || null, ref.createdAt);
            if (ref.neuronId) {
                this.upsertMembership(ref.neuronId, row.project_id == null ? undefined : String(row.project_id), 'event_cluster', row.cluster_key, row.title, ref.createdAt);
            }
        })();
    }
    listProjectBranches(projectId) {
        const rows = this.db.prepare(`
      SELECT * FROM project_branches
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC
    `).all(projectId);
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
    listTaskBranches(projectId) {
        const guard = this.taskRuntimeGuard();
        const rows = projectId !== undefined
            ? this.db.prepare(`SELECT * FROM task_branches WHERE COALESCE(project_id, '') = ? ${guard} ORDER BY updated_at DESC`).all(projectScope(projectId))
            : this.db.prepare(`SELECT * FROM task_branches WHERE 1=1 ${guard} ORDER BY updated_at DESC`).all();
        return rows.map((row) => ({
            taskId: row.task_id,
            projectId: row.project_id == null ? undefined : String(row.project_id),
            taskKey: row.task_key,
            title: row.title,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    listEventClusters(projectId) {
        const rows = projectId !== undefined
            ? this.db.prepare(`SELECT * FROM event_clusters WHERE COALESCE(project_id, '') = ? ORDER BY updated_at DESC`).all(projectScope(projectId))
            : this.db.prepare(`SELECT * FROM event_clusters ORDER BY updated_at DESC`).all();
        return rows.map((row) => ({
            clusterId: row.cluster_id,
            projectId: row.project_id == null ? undefined : String(row.project_id),
            clusterKey: row.cluster_key,
            clusterType: row.cluster_type,
            title: row.title,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    listNeuronIdsByProject(projectId) {
        const rows = this.db.prepare(`
      SELECT DISTINCT be.neuron_id
      FROM branch_entries be
      JOIN project_branches pb ON pb.branch_id = be.branch_id
      JOIN neurons n ON n.id = be.neuron_id AND n.is_deleted = 0
      WHERE pb.project_id = ?
        AND COALESCE(n.project_id, '') = COALESCE(pb.project_id, '')
      ORDER BY be.created_at DESC
    `).all(projectId);
        return rows.map((row) => row.neuron_id).filter((value) => Boolean(value));
    }
    listNeuronIdsByTemporalRange(start, end, projectId) {
        if (this.hasDirtyTimeProjection(projectId))
            return [];
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
    `).all(start, end, queryProject, queryProject);
        return rows.map((row) => row.neuron_id).filter((value) => Boolean(value));
    }
    listTimeBucketIdsByNeuronIds(neuronIds, projectId, limit = 80) {
        if (neuronIds.length === 0 || this.hasDirtyTimeProjection(projectId))
            return [];
        const scopedNeuronIds = Array.from(new Set(neuronIds.filter(Boolean))).slice(0, 200);
        if (scopedNeuronIds.length === 0)
            return [];
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
    `).all(...scopedNeuronIds, queryProject, queryProject, rowLimit);
        return rows.map((row) => row.bucket_id);
    }
    collectCandidateNeuronIds(input) {
        const limit = input.limit ?? 200;
        const collected = new Set();
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
    `).all(queryProject, queryProject, input.excludeTemporal ? 1 : 0, input.startTime ?? null, input.startTime ?? null, input.endTime ?? null, input.endTime ?? null, limit * 2);
        for (const row of baseRows) {
            collected.add(row.neuron_id);
            if (collected.size >= limit)
                break;
        }
        for (const term of terms) {
            if (collected.size >= limit)
                break;
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
      `).all(queryProject, queryProject, input.excludeTemporal ? 1 : 0, `%${term}%`, `%${term}%`, limit);
            for (const row of rows) {
                collected.add(row.neuron_id);
                if (collected.size >= limit)
                    break;
            }
        }
        return Array.from(collected).slice(0, limit);
    }
    collectBranchNavigation(input) {
        const limit = input.limit ?? 120;
        const siblingDepth = Math.max(0, input.siblingDepth ?? 1);
        const terms = (input.terms || []).map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 2);
        const queryProject = projectQueryValue(input.projectId);
        const branchIds = new Set();
        const taskIds = new Set();
        const clusterIds = new Set();
        const neuronIds = new Set();
        const addNeuronRows = (rows) => {
            for (const row of rows) {
                if (!row.neuron_id)
                    continue;
                neuronIds.add(row.neuron_id);
                if (neuronIds.size >= limit)
                    break;
            }
        };
        if (input.projectId !== undefined) {
            const rootRows = this.db.prepare(`
        SELECT branch_id
        FROM project_branches
        WHERE COALESCE(project_id, '') = ?
      `).all(projectScope(input.projectId));
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
      `).all(queryProject, queryProject, `%${term}%`, `%${term}%`, limit);
            for (const row of branchRows)
                branchIds.add(row.branch_id);
            const taskRows = this.db.prepare(`
        SELECT task_id
        FROM task_branches
        WHERE (? IS NULL OR COALESCE(project_id, '') = ?)
          ${this.taskRuntimeGuard()}
          AND (lower(title) LIKE ? OR lower(task_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(queryProject, queryProject, `%${term}%`, `%${term}%`, limit);
            for (const row of taskRows)
                taskIds.add(row.task_id);
            const clusterRows = this.db.prepare(`
        SELECT cluster_id
        FROM event_clusters
        WHERE (? IS NULL OR COALESCE(project_id, '') = ?)
          AND (lower(title) LIKE ? OR lower(cluster_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(queryProject, queryProject, `%${term}%`, `%${term}%`, limit);
            for (const row of clusterRows)
                clusterIds.add(row.cluster_id);
        }
        if (branchIds.size > 0 && siblingDepth > 0) {
            const frontier = Array.from(branchIds);
            const visited = new Set(frontier);
            for (let depth = 0; depth < siblingDepth; depth += 1) {
                const next = [];
                for (const branchId of frontier) {
                    const linked = this.listScopedBranchLinks(branchId, queryProject);
                    for (const row of linked) {
                        const candidates = [row.parent_branch_id, row.child_branch_id];
                        for (const candidate of candidates) {
                            if (visited.has(candidate))
                                continue;
                            visited.add(candidate);
                            branchIds.add(candidate);
                            next.push(candidate);
                        }
                    }
                }
                frontier.splice(0, frontier.length, ...next);
                if (frontier.length === 0)
                    break;
            }
        }
        if (branchIds.size > 0) {
            const placeholders = Array.from(branchIds).map(() => '?').join(', ');
            addNeuronRows(this.db.prepare(`
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
        `).all(...Array.from(branchIds), queryProject, queryProject, limit));
        }
        if (taskIds.size > 0) {
            const placeholders = Array.from(taskIds).map(() => '?').join(', ');
            addNeuronRows(this.db.prepare(`
          SELECT DISTINCT tbe.neuron_id
          FROM task_branch_entries tbe
          JOIN task_branches tb ON tb.task_id=tbe.task_id
          JOIN neurons n ON n.id=tbe.neuron_id AND n.is_deleted=0
          WHERE tbe.task_id IN (${placeholders})
            AND (? IS NULL OR COALESCE(tb.project_id,'') = ?)
            ${this.taskRuntimeGuard('tb')}
            AND COALESCE(n.project_id,'')=COALESCE(tb.project_id,'')
          ORDER BY tbe.created_at DESC
          LIMIT ?
        `).all(...Array.from(taskIds), queryProject, queryProject, limit));
        }
        if (clusterIds.size > 0) {
            const placeholders = Array.from(clusterIds).map(() => '?').join(', ');
            addNeuronRows(this.db.prepare(`
          SELECT DISTINCT ece.neuron_id
          FROM event_cluster_entries ece
          JOIN event_clusters ec ON ec.cluster_id=ece.cluster_id
          JOIN neurons n ON n.id=ece.neuron_id AND n.is_deleted=0
          WHERE ece.cluster_id IN (${placeholders})
            AND (? IS NULL OR COALESCE(ec.project_id,'') = ?)
            AND COALESCE(n.project_id,'')=COALESCE(ec.project_id,'')
          ORDER BY ece.created_at DESC
          LIMIT ?
        `).all(...Array.from(clusterIds), queryProject, queryProject, limit));
        }
        return {
            branchIds: Array.from(branchIds).slice(0, limit),
            taskIds: Array.from(taskIds).slice(0, limit),
            clusterIds: Array.from(clusterIds).slice(0, limit),
            neuronIds: Array.from(neuronIds).slice(0, limit)
        };
    }
    collectNavigationFromNeuronIds(input) {
        const limit = input.limit ?? 120;
        const siblingDepth = Math.max(0, input.siblingDepth ?? 1);
        if (input.neuronIds.length === 0) {
            return { branchIds: [], taskIds: [], clusterIds: [], neuronIds: [] };
        }
        const queryProject = projectQueryValue(input.projectId);
        const requestedNeuronIds = Array.from(new Set(input.neuronIds.filter(Boolean))).slice(0, 200);
        const scopedNeuronIds = queryProject === null
            ? requestedNeuronIds
            : this.db.prepare(`
          SELECT id
          FROM neurons
          WHERE id IN (${requestedNeuronIds.map(() => '?').join(', ')})
            AND is_deleted=0
            AND COALESCE(project_id,'')=?
        `).all(...requestedNeuronIds, queryProject).map((row) => row.id);
        if (scopedNeuronIds.length === 0) {
            return { branchIds: [], taskIds: [], clusterIds: [], neuronIds: [] };
        }
        const branchIds = new Set();
        const taskIds = new Set();
        const clusterIds = new Set();
        const neuronIds = new Set(scopedNeuronIds);
        const placeholders = scopedNeuronIds.map(() => '?').join(', ');
        const branchRows = this.db.prepare(`
      SELECT DISTINCT be.branch_id
      FROM branch_entries be
      JOIN project_branches pb ON pb.branch_id = be.branch_id
      WHERE be.neuron_id IN (${placeholders})
        AND (? IS NULL OR COALESCE(pb.project_id, '') = ?)
      ORDER BY be.created_at DESC
      LIMIT ?
    `).all(...scopedNeuronIds, queryProject, queryProject, limit);
        for (const row of branchRows)
            branchIds.add(row.branch_id);
        const taskRows = this.db.prepare(`
      SELECT DISTINCT tbe.task_id
      FROM task_branch_entries tbe
      JOIN task_branches tb ON tb.task_id = tbe.task_id
      WHERE tbe.neuron_id IN (${placeholders})
        AND (? IS NULL OR COALESCE(tb.project_id, '') = ?)
        ${this.taskRuntimeGuard('tb')}
      ORDER BY tbe.created_at DESC
      LIMIT ?
    `).all(...scopedNeuronIds, queryProject, queryProject, limit);
        for (const row of taskRows)
            taskIds.add(row.task_id);
        const clusterRows = this.db.prepare(`
      SELECT DISTINCT ece.cluster_id
      FROM event_cluster_entries ece
      JOIN event_clusters ec ON ec.cluster_id = ece.cluster_id
      WHERE ece.neuron_id IN (${placeholders})
        AND (? IS NULL OR COALESCE(ec.project_id, '') = ?)
      ORDER BY ece.created_at DESC
      LIMIT ?
    `).all(...scopedNeuronIds, queryProject, queryProject, limit);
        for (const row of clusterRows)
            clusterIds.add(row.cluster_id);
        if (branchIds.size > 0 && siblingDepth > 0) {
            const frontier = Array.from(branchIds);
            const visited = new Set(frontier);
            for (let depth = 0; depth < siblingDepth; depth += 1) {
                const next = [];
                for (const branchId of frontier) {
                    const linked = this.listScopedBranchLinks(branchId, queryProject);
                    for (const row of linked) {
                        for (const candidate of [row.parent_branch_id, row.child_branch_id]) {
                            if (visited.has(candidate))
                                continue;
                            visited.add(candidate);
                            branchIds.add(candidate);
                            next.push(candidate);
                        }
                    }
                }
                frontier.splice(0, frontier.length, ...next);
                if (frontier.length === 0)
                    break;
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
      `).all(...Array.from(branchIds), queryProject, queryProject, limit);
            for (const row of rows) {
                if (row.neuron_id)
                    neuronIds.add(row.neuron_id);
                if (neuronIds.size >= limit)
                    break;
            }
        }
        return {
            branchIds: Array.from(branchIds).slice(0, limit),
            taskIds: Array.from(taskIds).slice(0, limit),
            clusterIds: Array.from(clusterIds).slice(0, limit),
            neuronIds: Array.from(neuronIds).slice(0, limit)
        };
    }
    collectTemporalContext(input) {
        if (this.hasDirtyTimeProjection(input.projectId))
            return { bucketType: input.preferredBucketType ?? 'day', bucketIds: [], bucketLabels: [], neuronIds: [] };
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
    `).all(bucketType, queryProject, queryProject, input.startTime ?? null, input.startTime ?? null, input.endTime ?? null, input.endTime ?? null, limit * 4);
        const bucketIds = [];
        const bucketLabels = [];
        const neuronIds = [];
        const seenBuckets = new Set();
        const seenNeurons = new Set();
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
            if (neuronIds.length >= limit && bucketIds.length >= Math.min(limit, 12))
                break;
        }
        return {
            bucketType,
            bucketIds: bucketIds.slice(0, limit),
            bucketLabels: bucketLabels.slice(0, 12),
            neuronIds: neuronIds.slice(0, limit)
        };
    }
    getTimeBucketEntryCount(bucketType, start, options = {}) {
        if (this.hasDirtyTimeProjection(options.projectId))
            return 0;
        const clauses = ['b.bucket_type=?', 'b.bucket_start=?'];
        const params = [bucketType, start];
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
    `).get(...params);
        return row?.count || 0;
    }
    getMaterializedMembershipCount() {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM topology_membership`).get();
        return row?.count || 0;
    }
    upsertMembership(neuronId, projectId, dimensionType, dimensionKey, title, createdAt) {
        this.db.prepare(`
      INSERT OR IGNORE INTO topology_membership (
        neuron_id, project_id, dimension_type, dimension_key, title, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(neuronId, projectScope(projectId), dimensionType, dimensionKey, title || null, createdAt);
    }
    listScopedBranchLinks(branchId, queryProject) {
        return this.db.prepare(`
      SELECT bl.parent_branch_id,bl.child_branch_id
      FROM branch_links bl
      JOIN project_branches parent ON parent.branch_id=bl.parent_branch_id
      JOIN project_branches child ON child.branch_id=bl.child_branch_id
      WHERE (bl.parent_branch_id=? OR bl.child_branch_id=?)
        AND parent.project_id=child.project_id
        AND COALESCE(bl.project_id,'')=COALESCE(parent.project_id,'')
        AND (? IS NULL OR COALESCE(parent.project_id,'')=?)
    `).all(branchId, branchId, queryProject, queryProject);
    }
    assertReferenceScope(parentScope, ref) {
        const expected = projectScope(ref.projectId);
        if (expected !== parentScope)
            throw new Error('topology_reference_project_scope_mismatch');
        const scopes = [];
        const addNeuron = (neuronId) => {
            if (!neuronId)
                throw new Error('topology_reference_unresolved');
            const row = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0`)
                .get(neuronId);
            if (!row)
                throw new Error('topology_reference_unresolved');
            scopes.push(row.scope);
        };
        if (ref.neuronId)
            addNeuron(ref.neuronId);
        if (ref.factId) {
            const row = this.db.prepare(`SELECT neuron_id FROM facts WHERE fact_id=?`).get(ref.factId);
            if (!row)
                throw new Error('topology_reference_unresolved');
            addNeuron(row.neuron_id);
        }
        if (ref.eventId) {
            const row = this.db.prepare(`SELECT neuron_id FROM compiled_events WHERE event_id=?`).get(ref.eventId);
            if (!row)
                throw new Error('topology_reference_unresolved');
            addNeuron(row.neuron_id);
        }
        if (ref.unitId) {
            const row = this.db.prepare(`SELECT message_neuron_ids_json FROM interaction_units WHERE unit_id=?`).get(ref.unitId);
            if (!row)
                throw new Error('topology_reference_unresolved');
            const ids = parseStringIds(row.message_neuron_ids_json);
            if (ids.length === 0)
                throw new Error('topology_reference_unresolved');
            for (const neuronId of ids)
                addNeuron(neuronId);
        }
        if (ref.beliefId) {
            const belief = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope,source_neuron_id FROM beliefs WHERE id=?`)
                .get(ref.beliefId);
            if (!belief)
                throw new Error('topology_reference_unresolved');
            scopes.push(belief.scope);
            if (belief.source_neuron_id)
                addNeuron(belief.source_neuron_id);
            const evidence = this.db.prepare(`SELECT neuron_id,event_id FROM belief_evidence WHERE belief_id=?`).all(ref.beliefId);
            for (const item of evidence) {
                if (item.neuron_id)
                    addNeuron(item.neuron_id);
                if (item.event_id) {
                    const event = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM memory_events WHERE event_id=?`).get(item.event_id);
                    if (!event)
                        throw new Error('topology_reference_unresolved');
                    scopes.push(event.scope);
                }
            }
        }
        if (scopes.length === 0)
            throw new Error('topology_reference_unresolved');
        if (scopes.some((scope) => scope !== parentScope))
            throw new Error('topology_reference_project_scope_mismatch');
    }
    hasColumn(table, column) {
        return Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name=?`).get(table, column));
    }
    hasTable(table) {
        return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
    }
    taskRuntimeGuard(alias = 'task_branches') {
        if (!this.hasTable('task_identity_restoration_manifest')
            || !this.hasColumn('task_identity_restoration_manifest', 'recovery_status'))
            return '';
        return `AND NOT EXISTS (
      SELECT 1 FROM task_identity_restoration_manifest task_recovery
      WHERE task_recovery.task_id=${alias}.task_id AND task_recovery.recovery_status='unresolved'
    )`;
    }
    isUnresolvedTask(taskId) {
        if (!this.hasTable('task_identity_restoration_manifest')
            || !this.hasColumn('task_identity_restoration_manifest', 'recovery_status'))
            return false;
        return Boolean(this.db.prepare(`SELECT 1 FROM task_identity_restoration_manifest
      WHERE task_id=? AND recovery_status='unresolved'`).get(taskId));
    }
    isUnresolvedTaskIdentity(projectId, taskKey) {
        if (!this.hasTable('task_identity_restoration_manifest')
            || !this.hasColumn('task_identity_restoration_manifest', 'recovery_status'))
            return false;
        return Boolean(this.db.prepare(`SELECT 1 FROM task_identity_restoration_manifest
      WHERE project_id=? AND task_key=? AND recovery_status='unresolved'`).get(projectId, taskKey));
    }
    installBranchScopeTriggers() {
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
    close() {
        if (this.ownsDb)
            this.db.close();
    }
}
function parseStringIds(value) {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.length > 0) : [];
    }
    catch {
        return [];
    }
}
