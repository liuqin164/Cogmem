import Database from 'bun:sqlite';
import type { TimeBucketRecord } from '../types/index.js';

export interface TemporalSurfaceSegment {
  bucketId: string;
  label: string;
  bucketStart: number;
  bucketEnd: number;
  neuronIds: string[];
  source: 'seed' | 'window' | 'adjacent' | 'nearest' | 'band';
}

export class TemporalAdjacencyStore {
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
      CREATE TABLE IF NOT EXISTS temporal_adjacency (
        source_bucket_id TEXT NOT NULL,
        adjacent_bucket_id TEXT NOT NULL,
        bucket_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(source_bucket_id, adjacent_bucket_id)
      );

      CREATE INDEX IF NOT EXISTS idx_temporal_adjacency_source
        ON temporal_adjacency(source_bucket_id, created_at DESC);
    `);
  }

  syncBuckets(buckets: TimeBucketRecord[], createdAt: number): void {
    for (const bucket of buckets) {
      for (const adjacentId of this.getAdjacentBucketIds(bucket)) {
        this.db.prepare(`
          INSERT OR IGNORE INTO temporal_adjacency (
            source_bucket_id, adjacent_bucket_id, bucket_type, weight, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(bucket.bucketId, adjacentId, bucket.bucketType, 0.72, createdAt);
        this.db.prepare(`
          INSERT OR IGNORE INTO temporal_adjacency (
            source_bucket_id, adjacent_bucket_id, bucket_type, weight, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(adjacentId, bucket.bucketId, bucket.bucketType, 0.72, createdAt);
      }
    }
  }

  collectAdjacentNeuronIds(bucketIds: string[], limit: number = 48): string[] {
    if (bucketIds.length === 0) return [];
    const placeholders = bucketIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT DISTINCT tbe.neuron_id
      FROM temporal_adjacency ta
      JOIN time_bucket_entries tbe ON tbe.bucket_id = ta.adjacent_bucket_id
      WHERE ta.source_bucket_id IN (${placeholders})
        AND tbe.neuron_id IS NOT NULL
      ORDER BY ta.created_at DESC, tbe.created_at DESC
      LIMIT ?
    `).all(...bucketIds, limit) as Array<{ neuron_id: string | null }>;
    return rows.map((row) => row.neuron_id).filter((value): value is string => Boolean(value));
  }

  collectContinuousTraversal(input: {
    bucketIds: string[];
    hopLimit?: number;
    limit?: number;
  }): {
    bucketIds: string[];
    labels: string[];
    neuronIds: string[];
  } {
    const hopLimit = Math.max(1, input.hopLimit ?? 2);
    const limit = input.limit ?? 96;
    if (input.bucketIds.length === 0) {
      return { bucketIds: [], labels: [], neuronIds: [] };
    }

    const visited = new Set<string>(input.bucketIds);
    let frontier = [...input.bucketIds];

    for (let hop = 0; hop < hopLimit; hop += 1) {
      if (frontier.length === 0) break;
      const placeholders = frontier.map(() => '?').join(', ');
      const rows = this.db.prepare(`
        SELECT adjacent_bucket_id
        FROM temporal_adjacency
        WHERE source_bucket_id IN (${placeholders})
        ORDER BY created_at DESC
      `).all(...frontier) as Array<{ adjacent_bucket_id: string }>;

      const next: string[] = [];
      for (const row of rows) {
        if (visited.has(row.adjacent_bucket_id)) continue;
        visited.add(row.adjacent_bucket_id);
        next.push(row.adjacent_bucket_id);
        if (visited.size >= limit) break;
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
    `).all(...bucketList) as Array<{ bucket_id: string; label: string }>;
    const neuronRows = this.db.prepare(`
      SELECT DISTINCT neuron_id
      FROM time_bucket_entries
      WHERE bucket_id IN (${placeholders})
        AND neuron_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...bucketList, limit) as Array<{ neuron_id: string | null }>;

    return {
      bucketIds: bucketList,
      labels: labelRows.map((row) => row.label),
      neuronIds: neuronRows.map((row) => row.neuron_id).filter((value): value is string => Boolean(value))
    };
  }

  collectContinuousSurface(input: {
    bucketIds?: string[];
    startTime?: number;
    endTime?: number;
    preferredBucketType?: TimeBucketRecord['bucketType'];
    hopLimit?: number;
    limit?: number;
  }): {
    bucketType: TimeBucketRecord['bucketType'];
    segments: TemporalSurfaceSegment[];
    bucketIds: string[];
    labels: string[];
    neuronIds: string[];
  } {
    const limit = input.limit ?? 32;
    const bucketType = input.preferredBucketType ?? 'day';
    const ordered = new Map<string, TemporalSurfaceSegment>();

    const upsertSegment = (segment: TemporalSurfaceSegment): void => {
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
      limit
    })) {
      upsertSegment(segment);
    }

    const seedRows = this.listBucketSegments((input.bucketIds || []).slice(0, limit), 'seed');
    for (const segment of seedRows) upsertSegment(segment);

    if (ordered.size === 0 && (input.bucketIds || []).length > 0) {
      const traversal = this.collectContinuousTraversal({
        bucketIds: input.bucketIds || [],
        hopLimit: input.hopLimit,
        limit
      });
      for (const segment of this.listBucketSegments(traversal.bucketIds, 'adjacent')) {
        upsertSegment(segment);
      }
    }

    if (ordered.size === 0 && (input.startTime || input.endTime)) {
      for (const segment of this.listNearestSegments({
        startTime: input.startTime,
        endTime: input.endTime,
        bucketType,
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
      limit
    });
    for (const segment of expandedBand) upsertSegment(segment);

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

  close(): void {
    if (this.ownsDb) this.db.close();
  }

  private getAdjacentBucketIds(bucket: TimeBucketRecord): string[] {
    const previous = this.db.prepare(`SELECT bucket_id FROM time_buckets WHERE bucket_type=? AND bucket_start<? ORDER BY bucket_start DESC LIMIT 1`).get(bucket.bucketType, bucket.bucketStart) as { bucket_id?: string } | null;
    const next = this.db.prepare(`SELECT bucket_id FROM time_buckets WHERE bucket_type=? AND bucket_start>? ORDER BY bucket_start ASC LIMIT 1`).get(bucket.bucketType, bucket.bucketStart) as { bucket_id?: string } | null;
    return [previous?.bucket_id, next?.bucket_id].filter((id): id is string => Boolean(id));
  }

  private listWindowSegments(input: {
    startTime?: number;
    endTime?: number;
    bucketType: TimeBucketRecord['bucketType'];
    limit: number;
  }): TemporalSurfaceSegment[] {
    if (!input.startTime && !input.endTime) return [];

    const rows = this.db.prepare(`
      SELECT bucket_id, label, bucket_start, bucket_end
      FROM time_buckets
      WHERE bucket_type = ?
        AND (? IS NULL OR bucket_end >= ?)
        AND (? IS NULL OR bucket_start <= ?)
      ORDER BY bucket_start ASC
      LIMIT ?
    `).all(
      input.bucketType,
      input.startTime ?? null,
      input.startTime ?? null,
      input.endTime ?? null,
      input.endTime ?? null,
      input.limit
    ) as Array<{ bucket_id: string; label: string; bucket_start: number; bucket_end: number }>;

    return rows.map((row) => ({
      bucketId: row.bucket_id,
      label: row.label,
      bucketStart: row.bucket_start,
      bucketEnd: row.bucket_end,
      neuronIds: this.listNeuronIdsForBucket(row.bucket_id, 24),
      source: 'window' as const
    }));
  }

  private listNearestSegments(input: {
    startTime?: number;
    endTime?: number;
    bucketType: TimeBucketRecord['bucketType'];
    limit: number;
  }): TemporalSurfaceSegment[] {
    const center = input.startTime && input.endTime
      ? Math.floor((input.startTime + input.endTime) / 2)
      : input.startTime || input.endTime;
    if (!center) return [];

    const rows = this.db.prepare(`
      SELECT bucket_id, label, bucket_start, bucket_end
      FROM time_buckets
      WHERE bucket_type = ?
      ORDER BY ABS(bucket_start - ?) ASC
      LIMIT ?
    `).all(input.bucketType, center, input.limit) as Array<{ bucket_id: string; label: string; bucket_start: number; bucket_end: number }>;

    return rows.map((row) => ({
      bucketId: row.bucket_id,
      label: row.label,
      bucketStart: row.bucket_start,
      bucketEnd: row.bucket_end,
      neuronIds: this.listNeuronIdsForBucket(row.bucket_id, 24),
      source: 'nearest' as const
    }));
  }

  private listBucketSegments(bucketIds: string[], source: TemporalSurfaceSegment['source']): TemporalSurfaceSegment[] {
    if (bucketIds.length === 0) return [];
    const placeholders = bucketIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT bucket_id, label, bucket_start, bucket_end
      FROM time_buckets
      WHERE bucket_id IN (${placeholders})
    `).all(...bucketIds) as Array<{ bucket_id: string; label: string; bucket_start: number; bucket_end: number }>;

    return rows.map((row) => ({
      bucketId: row.bucket_id,
      label: row.label,
      bucketStart: row.bucket_start,
      bucketEnd: row.bucket_end,
      neuronIds: this.listNeuronIdsForBucket(row.bucket_id, 24),
      source
    }));
  }

  private listNeuronIdsForBucket(bucketId: string, limit: number): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT neuron_id
      FROM time_bucket_entries
      WHERE bucket_id = ?
        AND neuron_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
    `).all(bucketId, limit) as Array<{ neuron_id: string | null }>;
    return rows.map((row) => row.neuron_id).filter((value): value is string => Boolean(value));
  }

  private expandContinuousBand(input: {
    segments: TemporalSurfaceSegment[];
    startTime?: number;
    endTime?: number;
    bucketType: TimeBucketRecord['bucketType'];
    limit: number;
  }): TemporalSurfaceSegment[] {
    const step = this.getBucketStepMs(input.bucketType);
    if (!step) return [];

    const byStart = new Map<number, TemporalSurfaceSegment>();
    for (const segment of input.segments) byStart.set(segment.bucketStart, segment);

    let start = input.startTime;
    let end = input.endTime;
    if (start === undefined || end === undefined) {
      const sorted = input.segments.slice().sort((a, b) => a.bucketStart - b.bucketStart);
      if (sorted.length === 0) return [];
      start = sorted[0].bucketStart;
      end = sorted[sorted.length - 1].bucketStart;
    }

    const normalizedStart = this.normalizeBucketStart(start!, step);
    const normalizedEnd = this.normalizeBucketStart(end!, step);
    const segments: TemporalSurfaceSegment[] = [];

    for (let cursor = normalizedStart; cursor <= normalizedEnd && segments.length < input.limit; cursor += step) {
      if (byStart.has(cursor)) continue;
      const bucketId = `${input.bucketType}:${cursor}`;
      segments.push({
        bucketId,
        label: new Date(cursor).toISOString().slice(0, 10),
        bucketStart: cursor,
        bucketEnd: cursor + step,
        neuronIds: [],
        source: 'band'
      });
    }

    return segments;
  }

  private getBucketStepMs(bucketType: TimeBucketRecord['bucketType']): number {
    switch (bucketType) {
      case 'day':
        return 86400000;
      case 'week':
        return 7 * 86400000;
      case 'month':
        return 30 * 86400000;
      default:
        return 0;
    }
  }

  private normalizeBucketStart(ts: number, step: number): number {
    return Math.floor(ts / step) * step;
  }
}
