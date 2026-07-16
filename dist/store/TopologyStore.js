import Database from 'bun:sqlite';
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
        bucket_type TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        bucket_end INTEGER NOT NULL,
        label TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS time_bucket_entries (
        bucket_id TEXT NOT NULL,
        neuron_id TEXT,
        unit_id TEXT,
        belief_id TEXT,
        fact_id TEXT,
        event_id TEXT,
        project_id TEXT,
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
        relation_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(parent_branch_id, child_branch_id, relation_type)
      );

      CREATE TABLE IF NOT EXISTS branch_entries (
        branch_id TEXT NOT NULL,
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
        project_id TEXT,
        task_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_branch_entries (
        task_id TEXT NOT NULL,
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
        project_id TEXT,
        cluster_key TEXT NOT NULL UNIQUE,
        cluster_type TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_cluster_entries (
        cluster_id TEXT NOT NULL,
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
        error TEXT
      );
    `);
    }
    timeProjectionNeedsRebuild(projectId, timeZone) {
        const row = this.db.prepare(`SELECT projection_version,status,time_zone FROM topology_projection_state WHERE project_id=?`).get(projectId);
        return Boolean(row && (row.projection_version !== 2 || row.status !== 'clean' || row.time_zone !== timeZone));
    }
    markTimeProjection(projectId, status, timeZone, updatedAt, error) {
        this.db.prepare(`
      INSERT INTO topology_projection_state(project_id,projection_version,status,time_zone,updated_at,error)
      VALUES(?,2,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET projection_version=2,status=excluded.status,time_zone=excluded.time_zone,updated_at=excluded.updated_at,error=excluded.error
    `).run(projectId, status, timeZone, updatedAt, error ?? null);
    }
    resetProjectTimeBuckets(projectId) {
        this.db.prepare(`DELETE FROM topology_membership WHERE project_id=? AND dimension_type='time_bucket'`).run(projectId);
        this.db.prepare(`DELETE FROM time_bucket_entries WHERE project_id=?`).run(projectId);
        this.db.exec(`DELETE FROM time_buckets WHERE bucket_id NOT IN (SELECT DISTINCT bucket_id FROM time_bucket_entries);`);
    }
    upsertTimeBucket(bucket) {
        this.db.prepare(`
      INSERT OR REPLACE INTO time_buckets (
        bucket_id, bucket_type, bucket_start, bucket_end, label
      ) VALUES (?, ?, ?, ?, ?)
    `).run(bucket.bucketId, bucket.bucketType, bucket.bucketStart, bucket.bucketEnd, bucket.label);
        return bucket;
    }
    attachToTimeBucket(bucketId, ref) {
        this.db.prepare(`
      INSERT OR IGNORE INTO time_bucket_entries (
        bucket_id, neuron_id, unit_id, belief_id, fact_id, event_id, project_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bucketId, ref.neuronId || null, ref.unitId || null, ref.beliefId || null, ref.factId || null, ref.eventId || null, ref.projectId || null, ref.createdAt);
        if (ref.neuronId) {
            const row = this.db.prepare(`
        SELECT label FROM time_buckets WHERE bucket_id = ?
      `).get(bucketId);
            this.upsertMembership(ref.neuronId, ref.projectId, 'time_bucket', bucketId, row?.label, ref.createdAt);
        }
    }
    upsertProjectBranch(input) {
        const existing = this.db.prepare(`
      SELECT * FROM project_branches WHERE project_id = ? AND branch_key = ?
    `).get(input.projectId, input.branchKey);
        const branchId = existing?.branch_id || input.branchId;
        const createdAt = existing?.created_at || input.createdAt;
        this.db.prepare(`
      INSERT OR REPLACE INTO project_branches (
        branch_id, project_id, branch_key, branch_kind, title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
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
    }
    linkBranches(parentBranchId, childBranchId, relationType, createdAt) {
        this.db.prepare(`
      INSERT OR IGNORE INTO branch_links (
        parent_branch_id, child_branch_id, relation_type, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(parentBranchId, childBranchId, relationType, createdAt);
    }
    attachToBranch(branchId, ref) {
        this.db.prepare(`
      INSERT OR IGNORE INTO branch_entries (
        branch_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(branchId, ref.neuronId || null, ref.unitId || null, ref.beliefId || null, ref.factId || null, ref.eventId || null, ref.createdAt);
        if (ref.neuronId) {
            const row = this.db.prepare(`
        SELECT project_id, branch_key, title FROM project_branches WHERE branch_id = ?
      `).get(branchId);
            this.upsertMembership(ref.neuronId, row?.project_id || undefined, 'project_branch', row?.branch_key || branchId, row?.title, ref.createdAt);
        }
    }
    upsertTaskBranch(input) {
        const existing = this.db.prepare(`
      SELECT * FROM task_branches WHERE task_key = ?
    `).get(input.taskKey);
        const taskId = existing?.task_id || input.taskId;
        const createdAt = existing?.created_at || input.createdAt;
        const status = input.status || 'derived';
        this.db.prepare(`
      INSERT OR REPLACE INTO task_branches (
        task_id, project_id, task_key, title, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, input.projectId || null, input.taskKey, input.title, status, createdAt, input.createdAt);
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
        this.db.prepare(`
      INSERT OR IGNORE INTO task_branch_entries (
        task_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, ref.neuronId || null, ref.unitId || null, ref.beliefId || null, ref.factId || null, ref.eventId || null, ref.createdAt);
        if (ref.neuronId) {
            const row = this.db.prepare(`
        SELECT project_id, task_key, title FROM task_branches WHERE task_id = ?
      `).get(taskId);
            this.upsertMembership(ref.neuronId, row?.project_id || undefined, 'task_branch', row?.task_key || taskId, row?.title, ref.createdAt);
        }
    }
    upsertEventCluster(input) {
        const existing = this.db.prepare(`
      SELECT * FROM event_clusters WHERE cluster_key = ?
    `).get(input.clusterKey);
        const clusterId = existing?.cluster_id || input.clusterId;
        const createdAt = existing?.created_at || input.createdAt;
        this.db.prepare(`
      INSERT OR REPLACE INTO event_clusters (
        cluster_id, project_id, cluster_key, cluster_type, title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(clusterId, input.projectId || null, input.clusterKey, input.clusterType, input.title, createdAt, input.createdAt);
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
        this.db.prepare(`
      INSERT OR IGNORE INTO event_cluster_entries (
        cluster_id, neuron_id, unit_id, belief_id, fact_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(clusterId, ref.neuronId || null, ref.unitId || null, ref.beliefId || null, ref.factId || null, ref.eventId || null, ref.createdAt);
        if (ref.neuronId) {
            const row = this.db.prepare(`
        SELECT project_id, cluster_key, title FROM event_clusters WHERE cluster_id = ?
      `).get(clusterId);
            this.upsertMembership(ref.neuronId, row?.project_id || undefined, 'event_cluster', row?.cluster_key || clusterId, row?.title, ref.createdAt);
        }
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
        const rows = projectId
            ? this.db.prepare(`SELECT * FROM task_branches WHERE project_id = ? ORDER BY updated_at DESC`).all(projectId)
            : this.db.prepare(`SELECT * FROM task_branches ORDER BY updated_at DESC`).all();
        return rows.map((row) => ({
            taskId: row.task_id,
            projectId: row.project_id || undefined,
            taskKey: row.task_key,
            title: row.title,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    listEventClusters(projectId) {
        const rows = projectId
            ? this.db.prepare(`SELECT * FROM event_clusters WHERE project_id = ? ORDER BY updated_at DESC`).all(projectId)
            : this.db.prepare(`SELECT * FROM event_clusters ORDER BY updated_at DESC`).all();
        return rows.map((row) => ({
            clusterId: row.cluster_id,
            projectId: row.project_id || undefined,
            clusterKey: row.cluster_key,
            clusterType: row.cluster_type,
            title: row.title,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    listNeuronIdsByProject(projectId) {
        const rows = this.db.prepare(`
      SELECT DISTINCT neuron_id
      FROM branch_entries be
      JOIN project_branches pb ON pb.branch_id = be.branch_id
      WHERE pb.project_id = ?
        AND neuron_id IS NOT NULL
      ORDER BY be.created_at DESC
    `).all(projectId);
        return rows.map((row) => row.neuron_id).filter((value) => Boolean(value));
    }
    listNeuronIdsByTemporalRange(start, end) {
        const rows = this.db.prepare(`
      SELECT DISTINCT neuron_id
      FROM time_bucket_entries
      WHERE created_at >= ?
        AND created_at <= ?
        AND neuron_id IS NOT NULL
      ORDER BY created_at DESC
    `).all(start, end);
        return rows.map((row) => row.neuron_id).filter((value) => Boolean(value));
    }
    listTimeBucketIdsByNeuronIds(neuronIds, projectId, limit = 80) {
        if (neuronIds.length === 0)
            return [];
        const scopedNeuronIds = Array.from(new Set(neuronIds.filter(Boolean))).slice(0, 200);
        if (scopedNeuronIds.length === 0)
            return [];
        const rowLimit = Math.max(1, Math.min(limit, 200));
        const placeholders = scopedNeuronIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT DISTINCT bucket_id
      FROM time_bucket_entries
      WHERE neuron_id IN (${placeholders})
        AND (? IS NULL OR project_id = ?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...scopedNeuronIds, projectId || null, projectId || null, rowLimit);
        return rows.map((row) => row.bucket_id);
    }
    collectCandidateNeuronIds(input) {
        const limit = input.limit ?? 200;
        const collected = new Set();
        const terms = (input.terms || []).map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 2);
        const baseRows = this.db.prepare(`
      SELECT neuron_id
      FROM topology_membership
      WHERE (? IS NULL OR project_id = ?)
        AND (? IS NULL OR created_at >= ?)
        AND (? IS NULL OR created_at <= ?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(input.projectId ?? null, input.projectId ?? null, input.startTime ?? null, input.startTime ?? null, input.endTime ?? null, input.endTime ?? null, limit * 2);
        for (const row of baseRows) {
            collected.add(row.neuron_id);
            if (collected.size >= limit)
                break;
        }
        for (const term of terms) {
            if (collected.size >= limit)
                break;
            const rows = this.db.prepare(`
        SELECT neuron_id
        FROM topology_membership
        WHERE (? IS NULL OR project_id = ?)
          AND (lower(title) LIKE ? OR lower(dimension_key) LIKE ?)
        ORDER BY created_at DESC
        LIMIT ?
      `).all(input.projectId ?? null, input.projectId ?? null, `%${term}%`, `%${term}%`, limit);
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
        if (input.projectId) {
            const rootRows = this.db.prepare(`
        SELECT branch_id
        FROM project_branches
        WHERE project_id = ?
      `).all(input.projectId);
            for (const row of rootRows) {
                branchIds.add(row.branch_id);
            }
        }
        for (const term of terms) {
            const branchRows = this.db.prepare(`
        SELECT branch_id
        FROM project_branches
        WHERE (? IS NULL OR project_id = ?)
          AND (lower(title) LIKE ? OR lower(branch_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(input.projectId || null, input.projectId || null, `%${term}%`, `%${term}%`, limit);
            for (const row of branchRows)
                branchIds.add(row.branch_id);
            const taskRows = this.db.prepare(`
        SELECT task_id
        FROM task_branches
        WHERE (? IS NULL OR project_id = ?)
          AND (lower(title) LIKE ? OR lower(task_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(input.projectId || null, input.projectId || null, `%${term}%`, `%${term}%`, limit);
            for (const row of taskRows)
                taskIds.add(row.task_id);
            const clusterRows = this.db.prepare(`
        SELECT cluster_id
        FROM event_clusters
        WHERE (? IS NULL OR project_id = ?)
          AND (lower(title) LIKE ? OR lower(cluster_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(input.projectId || null, input.projectId || null, `%${term}%`, `%${term}%`, limit);
            for (const row of clusterRows)
                clusterIds.add(row.cluster_id);
        }
        if (branchIds.size > 0 && siblingDepth > 0) {
            const frontier = Array.from(branchIds);
            const visited = new Set(frontier);
            for (let depth = 0; depth < siblingDepth; depth += 1) {
                const next = [];
                for (const branchId of frontier) {
                    const linked = this.db.prepare(`
            SELECT parent_branch_id, child_branch_id
            FROM branch_links
            WHERE parent_branch_id = ? OR child_branch_id = ?
          `).all(branchId, branchId);
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
          FROM branch_entries
          WHERE branch_id IN (${placeholders})
            AND neuron_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT ?
        `).all(...Array.from(branchIds), limit));
        }
        if (taskIds.size > 0) {
            const placeholders = Array.from(taskIds).map(() => '?').join(', ');
            addNeuronRows(this.db.prepare(`
          SELECT DISTINCT neuron_id
          FROM task_branch_entries
          WHERE task_id IN (${placeholders})
            AND neuron_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT ?
        `).all(...Array.from(taskIds), limit));
        }
        if (clusterIds.size > 0) {
            const placeholders = Array.from(clusterIds).map(() => '?').join(', ');
            addNeuronRows(this.db.prepare(`
          SELECT DISTINCT neuron_id
          FROM event_cluster_entries
          WHERE cluster_id IN (${placeholders})
            AND neuron_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT ?
        `).all(...Array.from(clusterIds), limit));
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
        const branchIds = new Set();
        const taskIds = new Set();
        const clusterIds = new Set();
        const neuronIds = new Set(input.neuronIds);
        const placeholders = input.neuronIds.map(() => '?').join(', ');
        const branchRows = this.db.prepare(`
      SELECT DISTINCT be.branch_id
      FROM branch_entries be
      JOIN project_branches pb ON pb.branch_id = be.branch_id
      WHERE be.neuron_id IN (${placeholders})
        AND (? IS NULL OR pb.project_id = ?)
      ORDER BY be.created_at DESC
      LIMIT ?
    `).all(...input.neuronIds, input.projectId || null, input.projectId || null, limit);
        for (const row of branchRows)
            branchIds.add(row.branch_id);
        const taskRows = this.db.prepare(`
      SELECT DISTINCT tbe.task_id
      FROM task_branch_entries tbe
      JOIN task_branches tb ON tb.task_id = tbe.task_id
      WHERE tbe.neuron_id IN (${placeholders})
        AND (? IS NULL OR tb.project_id = ?)
      ORDER BY tbe.created_at DESC
      LIMIT ?
    `).all(...input.neuronIds, input.projectId || null, input.projectId || null, limit);
        for (const row of taskRows)
            taskIds.add(row.task_id);
        const clusterRows = this.db.prepare(`
      SELECT DISTINCT ece.cluster_id
      FROM event_cluster_entries ece
      JOIN event_clusters ec ON ec.cluster_id = ece.cluster_id
      WHERE ece.neuron_id IN (${placeholders})
        AND (? IS NULL OR ec.project_id = ?)
      ORDER BY ece.created_at DESC
      LIMIT ?
    `).all(...input.neuronIds, input.projectId || null, input.projectId || null, limit);
        for (const row of clusterRows)
            clusterIds.add(row.cluster_id);
        if (branchIds.size > 0 && siblingDepth > 0) {
            const frontier = Array.from(branchIds);
            const visited = new Set(frontier);
            for (let depth = 0; depth < siblingDepth; depth += 1) {
                const next = [];
                for (const branchId of frontier) {
                    const linked = this.db.prepare(`
            SELECT parent_branch_id, child_branch_id
            FROM branch_links
            WHERE parent_branch_id = ? OR child_branch_id = ?
          `).all(branchId, branchId);
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
        FROM branch_entries
        WHERE branch_id IN (${placeholders2})
          AND neuron_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ?
      `).all(...Array.from(branchIds), limit);
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
        const limit = input.limit ?? 120;
        const bucketType = input.preferredBucketType ?? 'day';
        const rows = this.db.prepare(`
      SELECT tb.bucket_id, tb.label, tbe.neuron_id
      FROM time_bucket_entries tbe
      JOIN time_buckets tb ON tb.bucket_id = tbe.bucket_id
      WHERE tb.bucket_type = ?
        AND (? IS NULL OR tbe.created_at >= ?)
        AND (? IS NULL OR tbe.created_at <= ?)
      ORDER BY tb.bucket_start DESC, tbe.created_at DESC
      LIMIT ?
    `).all(bucketType, input.startTime ?? null, input.startTime ?? null, input.endTime ?? null, input.endTime ?? null, limit * 4);
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
    getTimeBucketEntryCount(bucketType, start) {
        const bucketId = `${bucketType}:${start}`;
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM time_bucket_entries WHERE bucket_id = ?
    `).get(bucketId);
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
    `).run(neuronId, projectId || null, dimensionType, dimensionKey, title || null, createdAt);
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
}
