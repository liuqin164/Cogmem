import Database from 'bun:sqlite';
import { projectQueryValue, projectScope } from '../topology/ProjectScope.js';
export class TemporalAdjacencyStore {
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
      CREATE TABLE IF NOT EXISTS temporal_adjacency (
        project_id TEXT NOT NULL DEFAULT '',
        time_zone TEXT NOT NULL DEFAULT 'UTC',
        source_bucket_id TEXT NOT NULL,
        adjacent_bucket_id TEXT NOT NULL,
        bucket_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, time_zone, source_bucket_id, adjacent_bucket_id)
      );

      CREATE INDEX IF NOT EXISTS idx_temporal_adjacency_source
        ON temporal_adjacency(source_bucket_id, created_at DESC);
    `);
    }
    syncBuckets(buckets, createdAt) {
        const insert = this.db.prepare(`
      INSERT INTO temporal_adjacency (
        project_id, time_zone, source_bucket_id, adjacent_bucket_id, bucket_type, weight, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, time_zone, source_bucket_id, adjacent_bucket_id) DO UPDATE SET
        bucket_type=excluded.bucket_type, weight=excluded.weight, created_at=excluded.created_at
    `);
        this.db.transaction(() => {
            for (const bucket of buckets) {
                const { previous, next } = this.getAdjacentBucketIds(bucket);
                const projectScope = bucket.projectId ?? '';
                const timeZone = bucket.timeZone ?? 'UTC';
                this.db.prepare(`DELETE FROM temporal_adjacency WHERE project_id=? AND time_zone=? AND (source_bucket_id=? OR adjacent_bucket_id=?)`).run(projectScope, timeZone, bucket.bucketId, bucket.bucketId);
                if (previous && next) {
                    this.db.prepare(`DELETE FROM temporal_adjacency WHERE project_id=? AND time_zone=? AND ((source_bucket_id=? AND adjacent_bucket_id=?) OR (source_bucket_id=? AND adjacent_bucket_id=?))`)
                        .run(projectScope, timeZone, previous, next, next, previous);
                }
                for (const adjacentId of [previous, next].filter((id) => Boolean(id))) {
                    insert.run(projectScope, timeZone, bucket.bucketId, adjacentId, bucket.bucketType, 0.72, createdAt);
                    insert.run(projectScope, timeZone, adjacentId, bucket.bucketId, bucket.bucketType, 0.72, createdAt);
                }
            }
        })();
    }
    rebuildAll(createdAt) {
        const rows = this.db.prepare(`SELECT bucket_id,project_id,time_zone,bucket_type,bucket_start,bucket_end,label FROM time_buckets ORDER BY project_id,time_zone,bucket_type,bucket_start`).all();
        const insert = this.db.prepare(`INSERT INTO temporal_adjacency(project_id,time_zone,source_bucket_id,adjacent_bucket_id,bucket_type,weight,created_at) VALUES(?,?,?,?,?,?,?)`);
        this.db.transaction(() => {
            this.db.exec(`DELETE FROM temporal_adjacency;`);
            for (let index = 1; index < rows.length; index += 1) {
                const previous = rows[index - 1];
                const current = rows[index];
                if (previous.project_id !== current.project_id || previous.time_zone !== current.time_zone || previous.bucket_type !== current.bucket_type)
                    continue;
                insert.run(current.project_id, current.time_zone, previous.bucket_id, current.bucket_id, current.bucket_type, 0.72, createdAt);
                insert.run(current.project_id, current.time_zone, current.bucket_id, previous.bucket_id, current.bucket_type, 0.72, createdAt);
            }
        })();
    }
    rebuildProject(projectId, timeZone, createdAt) {
        const rows = this.db.prepare(`
      SELECT bucket_id,bucket_type,bucket_start
      FROM time_buckets
      WHERE project_id=? AND time_zone=?
      ORDER BY bucket_type,bucket_start
    `).all(projectId, timeZone);
        const insert = this.db.prepare(`INSERT INTO temporal_adjacency(project_id,time_zone,source_bucket_id,adjacent_bucket_id,bucket_type,weight,created_at) VALUES(?,?,?,?,?,?,?)`);
        this.db.prepare(`DELETE FROM temporal_adjacency WHERE project_id=?`).run(projectId);
        for (let index = 1; index < rows.length; index += 1) {
            const previous = rows[index - 1];
            const current = rows[index];
            if (previous.bucket_type !== current.bucket_type)
                continue;
            insert.run(projectId, timeZone, previous.bucket_id, current.bucket_id, current.bucket_type, 0.72, createdAt);
            insert.run(projectId, timeZone, current.bucket_id, previous.bucket_id, current.bucket_type, 0.72, createdAt);
        }
    }
    collectAdjacentNeuronIds(bucketIds, limit = 48, projectId) {
        if (bucketIds.length === 0 || !this.hasReadableProjection(projectId))
            return [];
        if (projectId !== undefined)
            return this.listNeuronIdsForBuckets(this.listAdjacentBucketIds(bucketIds, projectId), limit, projectId);
        const placeholders = bucketIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT DISTINCT tbe.neuron_id
      FROM temporal_adjacency ta
      JOIN time_bucket_entries tbe ON tbe.bucket_id = ta.adjacent_bucket_id
      WHERE ta.source_bucket_id IN (${placeholders})
        AND tbe.neuron_id IS NOT NULL
      ORDER BY ta.created_at DESC, tbe.created_at DESC
      LIMIT ?
    `).all(...bucketIds, limit);
        return rows.map((row) => row.neuron_id).filter((value) => Boolean(value));
    }
    collectContinuousTraversal(input) {
        if (!this.hasReadableProjection(input.projectId))
            return { bucketIds: [], labels: [], neuronIds: [] };
        const hopLimit = Math.max(1, input.hopLimit ?? 2);
        const limit = input.limit ?? 96;
        const seedBucketIds = this.filterBucketIdsForProject(input.bucketIds, input.projectId);
        if (seedBucketIds.length === 0) {
            return { bucketIds: [], labels: [], neuronIds: [] };
        }
        const visited = new Set(seedBucketIds);
        let frontier = [...seedBucketIds];
        for (let hop = 0; hop < hopLimit; hop += 1) {
            if (frontier.length === 0)
                break;
            const next = [];
            for (const adjacentBucketId of this.listAdjacentBucketIds(frontier, input.projectId)) {
                if (visited.has(adjacentBucketId))
                    continue;
                visited.add(adjacentBucketId);
                next.push(adjacentBucketId);
                if (visited.size >= limit)
                    break;
            }
            frontier = next;
        }
        const bucketList = Array.from(visited).slice(0, limit);
        const placeholders = bucketList.map(() => '?').join(', ');
        const labelRows = this.db.prepare(`
      SELECT bucket_id, label
      FROM time_buckets
      WHERE bucket_id IN (${placeholders})
      ORDER BY bucket_start DESC
    `).all(...bucketList);
        return {
            bucketIds: bucketList,
            labels: labelRows.map((row) => row.label),
            neuronIds: this.listNeuronIdsForBuckets(bucketList, limit, input.projectId)
        };
    }
    collectContinuousSurface(input) {
        if (!this.hasReadableProjection(input.projectId))
            return { bucketType: input.preferredBucketType ?? 'day', segments: [], bucketIds: [], labels: [], neuronIds: [] };
        const limit = input.limit ?? 32;
        const bucketType = input.preferredBucketType ?? 'day';
        const ordered = new Map();
        const upsertSegment = (segment) => {
            const existing = ordered.get(segment.bucketId);
            if (existing) {
                ordered.set(segment.bucketId, {
                    ...existing,
                    neuronIds: Array.from(new Set([...existing.neuronIds, ...segment.neuronIds])).slice(0, 24),
                    source: existing.source === 'seed' ? 'seed' : segment.source
                });
                return;
            }
            ordered.set(segment.bucketId, segment);
        };
        for (const segment of this.listWindowSegments({
            startTime: input.startTime,
            endTime: input.endTime,
            bucketType,
            projectId: input.projectId,
            limit
        })) {
            upsertSegment(segment);
        }
        const seedRows = this.listBucketSegments((input.bucketIds || []).slice(0, limit), 'seed', input.projectId);
        for (const segment of seedRows)
            upsertSegment(segment);
        if (ordered.size === 0 && (input.bucketIds || []).length > 0) {
            const traversal = this.collectContinuousTraversal({
                bucketIds: input.bucketIds || [],
                projectId: input.projectId,
                hopLimit: input.hopLimit,
                limit
            });
            for (const segment of this.listBucketSegments(traversal.bucketIds, 'adjacent', input.projectId)) {
                upsertSegment(segment);
            }
        }
        if (ordered.size === 0 && (input.startTime !== undefined || input.endTime !== undefined)) {
            for (const segment of this.listNearestSegments({
                startTime: input.startTime,
                endTime: input.endTime,
                bucketType,
                projectId: input.projectId,
                limit: Math.min(limit, 6)
            })) {
                upsertSegment(segment);
            }
        }
        const expandedBand = this.expandContinuousBand({
            segments: Array.from(ordered.values()),
            startTime: input.startTime,
            endTime: input.endTime,
            bucketType,
            projectId: input.projectId,
            limit
        });
        for (const segment of expandedBand)
            upsertSegment(segment);
        const segments = Array.from(ordered.values())
            .sort((a, b) => a.bucketStart - b.bucketStart)
            .slice(0, limit);
        return {
            bucketType,
            segments,
            bucketIds: segments.map((segment) => segment.bucketId),
            labels: segments.map((segment) => segment.label),
            neuronIds: Array.from(new Set(segments.flatMap((segment) => segment.neuronIds))).slice(0, limit * 4)
        };
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
    hasReadableProjection(projectId) {
        const scope = projectQueryValue(projectId);
        return !Boolean(scope === null
            ? this.db.prepare(`SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE s.project_id IS NULL OR s.status<>'clean' OR s.source_revision<>r.revision LIMIT 1`).get()
            : this.db.prepare(`SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE r.project_id=? AND (s.project_id IS NULL OR s.status<>'clean' OR s.source_revision<>r.revision) LIMIT 1`).get(scope));
    }
    getAdjacentBucketIds(bucket) {
        const projectScope = bucket.projectId ?? '';
        const timeZone = bucket.timeZone ?? 'UTC';
        const previous = this.db.prepare(`SELECT bucket_id FROM time_buckets WHERE project_id=? AND time_zone=? AND bucket_type=? AND bucket_start<? ORDER BY bucket_start DESC LIMIT 1`).get(projectScope, timeZone, bucket.bucketType, bucket.bucketStart);
        const next = this.db.prepare(`SELECT bucket_id FROM time_buckets WHERE project_id=? AND time_zone=? AND bucket_type=? AND bucket_start>? ORDER BY bucket_start ASC LIMIT 1`).get(projectScope, timeZone, bucket.bucketType, bucket.bucketStart);
        return { previous: previous?.bucket_id, next: next?.bucket_id };
    }
    listWindowSegments(input) {
        if (input.startTime === undefined && input.endTime === undefined)
            return [];
        const rows = this.db.prepare(`
      SELECT bucket_id, label, bucket_start, bucket_end
      FROM time_buckets
      WHERE bucket_type = ?
        AND (? IS NULL OR bucket_end > ?)
        AND (? IS NULL OR bucket_start < ?)
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM time_bucket_entries project_entry
          WHERE project_entry.bucket_id=time_buckets.bucket_id AND COALESCE(project_entry.project_id, '')=?
        ))
      ORDER BY bucket_start ASC
      LIMIT ?
    `).all(input.bucketType, input.startTime ?? null, input.startTime ?? null, input.endTime ?? null, input.endTime ?? null, projectQueryValue(input.projectId), projectQueryValue(input.projectId), input.limit);
        return rows.map((row) => ({
            bucketId: row.bucket_id,
            label: row.label,
            bucketStart: row.bucket_start,
            bucketEnd: row.bucket_end,
            neuronIds: this.listNeuronIdsForBucket(row.bucket_id, 24, input.projectId),
            source: 'window'
        }));
    }
    listNearestSegments(input) {
        const center = input.startTime !== undefined && input.endTime !== undefined
            ? Math.floor((input.startTime + input.endTime) / 2)
            : input.startTime ?? input.endTime;
        if (center === undefined)
            return [];
        const rows = this.db.prepare(`
      SELECT bucket_id, label, bucket_start, bucket_end
      FROM time_buckets
      WHERE bucket_type = ?
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM time_bucket_entries project_entry
          WHERE project_entry.bucket_id=time_buckets.bucket_id AND COALESCE(project_entry.project_id, '')=?
        ))
      ORDER BY ABS(bucket_start - ?) ASC
      LIMIT ?
    `).all(input.bucketType, projectQueryValue(input.projectId), projectQueryValue(input.projectId), center, input.limit);
        return rows.map((row) => ({
            bucketId: row.bucket_id,
            label: row.label,
            bucketStart: row.bucket_start,
            bucketEnd: row.bucket_end,
            neuronIds: this.listNeuronIdsForBucket(row.bucket_id, 24, input.projectId),
            source: 'nearest'
        }));
    }
    listBucketSegments(bucketIds, source, projectId) {
        if (bucketIds.length === 0)
            return [];
        const placeholders = bucketIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT bucket_id, label, bucket_start, bucket_end
      FROM time_buckets
      WHERE bucket_id IN (${placeholders})
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM time_bucket_entries project_entry
          WHERE project_entry.bucket_id=time_buckets.bucket_id AND COALESCE(project_entry.project_id, '')=?
        ))
    `).all(...bucketIds, projectQueryValue(projectId), projectQueryValue(projectId));
        return rows.map((row) => ({
            bucketId: row.bucket_id,
            label: row.label,
            bucketStart: row.bucket_start,
            bucketEnd: row.bucket_end,
            neuronIds: this.listNeuronIdsForBucket(row.bucket_id, 24, projectId),
            source
        }));
    }
    listNeuronIdsForBucket(bucketId, limit, projectId) {
        const rows = this.db.prepare(`
      SELECT DISTINCT neuron_id
      FROM time_bucket_entries
      WHERE bucket_id = ?
        AND neuron_id IS NOT NULL
        AND (? IS NULL OR COALESCE(project_id, '')=?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(bucketId, projectQueryValue(projectId), projectQueryValue(projectId), limit);
        return rows.map((row) => row.neuron_id).filter((value) => Boolean(value));
    }
    expandContinuousBand(input) {
        const sorted = input.segments.slice().sort((a, b) => a.bucketStart - b.bucketStart);
        const start = input.startTime ?? sorted[0]?.bucketStart;
        const end = input.endTime ?? sorted[sorted.length - 1]?.bucketEnd;
        if (start === undefined || end === undefined)
            return [];
        const existing = new Set(input.segments.map((segment) => segment.bucketId));
        const rows = this.db.prepare(`
      SELECT bucket_id, label, bucket_start, bucket_end
      FROM time_buckets
      WHERE bucket_type=? AND bucket_end>? AND bucket_start<?
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM time_bucket_entries project_entry
          WHERE project_entry.bucket_id=time_buckets.bucket_id AND COALESCE(project_entry.project_id, '')=?
        ))
      ORDER BY bucket_start ASC
      LIMIT ?
    `).all(input.bucketType, start, end, projectQueryValue(input.projectId), projectQueryValue(input.projectId), input.limit);
        return rows
            .filter((row) => !existing.has(row.bucket_id))
            .map((row) => ({
            bucketId: row.bucket_id,
            label: row.label,
            bucketStart: row.bucket_start,
            bucketEnd: row.bucket_end,
            neuronIds: this.listNeuronIdsForBucket(row.bucket_id, 24, input.projectId),
            source: 'band',
        }));
    }
    listAdjacentBucketIds(bucketIds, projectId) {
        if (bucketIds.length === 0)
            return [];
        if (projectId === undefined) {
            const placeholders = bucketIds.map(() => '?').join(', ');
            const rows = this.db.prepare(`
        SELECT adjacent_bucket_id
        FROM temporal_adjacency
        WHERE source_bucket_id IN (${placeholders})
        ORDER BY created_at DESC
      `).all(...bucketIds);
            return Array.from(new Set(rows.map((row) => row.adjacent_bucket_id)));
        }
        const current = this.db.prepare(`
      SELECT bucket_type,bucket_start
      FROM time_buckets
      WHERE bucket_id=?
        AND EXISTS (
          SELECT 1 FROM time_bucket_entries project_entry
          WHERE project_entry.bucket_id=time_buckets.bucket_id AND COALESCE(project_entry.project_id, '')=?
        )
    `);
        const previousBucket = this.db.prepare(`
      SELECT candidate.bucket_id
      FROM time_buckets candidate
      WHERE candidate.bucket_type=?
        AND candidate.bucket_start < ?
        AND EXISTS (
          SELECT 1 FROM time_bucket_entries project_entry
          WHERE project_entry.bucket_id=candidate.bucket_id AND COALESCE(project_entry.project_id, '')=?
        )
      ORDER BY candidate.bucket_start DESC
      LIMIT 1
    `);
        const nextBucket = this.db.prepare(`
      SELECT candidate.bucket_id
      FROM time_buckets candidate
      WHERE candidate.bucket_type=?
        AND candidate.bucket_start > ?
        AND EXISTS (
          SELECT 1 FROM time_bucket_entries project_entry
          WHERE project_entry.bucket_id=candidate.bucket_id AND COALESCE(project_entry.project_id, '')=?
        )
      ORDER BY candidate.bucket_start ASC
      LIMIT 1
    `);
        const result = new Set();
        for (const bucketId of bucketIds) {
            const row = current.get(bucketId, projectScope(projectId));
            if (!row)
                continue;
            const previous = previousBucket.get(row.bucket_type, row.bucket_start, projectScope(projectId))?.bucket_id;
            const next = nextBucket.get(row.bucket_type, row.bucket_start, projectScope(projectId))?.bucket_id;
            if (previous)
                result.add(previous);
            if (next)
                result.add(next);
        }
        return Array.from(result);
    }
    filterBucketIdsForProject(bucketIds, projectId) {
        if (bucketIds.length === 0 || projectId === undefined)
            return bucketIds;
        const placeholders = bucketIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT DISTINCT bucket_id
      FROM time_bucket_entries
      WHERE bucket_id IN (${placeholders}) AND COALESCE(project_id, '')=?
    `).all(...bucketIds, projectScope(projectId));
        return rows.map((row) => row.bucket_id);
    }
    listNeuronIdsForBuckets(bucketIds, limit, projectId) {
        if (bucketIds.length === 0)
            return [];
        const placeholders = bucketIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT DISTINCT neuron_id
      FROM time_bucket_entries
      WHERE bucket_id IN (${placeholders})
        AND neuron_id IS NOT NULL
        AND (? IS NULL OR COALESCE(project_id, '')=?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...bucketIds, projectQueryValue(projectId), projectQueryValue(projectId), limit);
        return rows.map((row) => row.neuron_id).filter((value) => Boolean(value));
    }
}
