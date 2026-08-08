import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type {
  FileAssetIngestStatus,
  FileAssetParseStatus,
  FileAssetPrivacyLevel,
  FileAssetRecord
} from './types.js';

type FileAssetRow = {
  asset_id: string;
  project_id: string | null;
  file_path: string;
  original_name: string | null;
  mime_type: string | null;
  extension: string | null;
  size_bytes: number;
  content_hash: string;
  mtime_ms: number;
  ingest_status: FileAssetIngestStatus;
  parse_status: FileAssetParseStatus;
  privacy_level: FileAssetPrivacyLevel;
  created_at: number;
  updated_at: number;
  last_indexed_at: number | null;
  metadata_json: string | null;
};

export interface UpsertFileAssetInput {
  assetId?: string;
  projectId?: string;
  filePath: string;
  originalName?: string;
  mimeType?: string;
  extension?: string;
  sizeBytes: number;
  contentHash: string;
  mtimeMs: number;
  ingestStatus?: FileAssetIngestStatus;
  parseStatus?: FileAssetParseStatus;
  privacyLevel?: FileAssetPrivacyLevel;
  lastIndexedAt?: number;
  metadata?: Record<string, unknown>;
}

export class FileAssetStore {
  constructor(private readonly db: Database) {
    this.initSchema();
  }

  initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_assets (
        asset_id TEXT PRIMARY KEY,
        project_id TEXT,
        file_path TEXT NOT NULL,
        original_name TEXT,
        mime_type TEXT,
        extension TEXT,
        size_bytes INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL,
        ingest_status TEXT NOT NULL,
        parse_status TEXT NOT NULL,
        privacy_level TEXT NOT NULL DEFAULT 'local',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_indexed_at INTEGER,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_file_assets_project ON file_assets(project_id);
      CREATE INDEX IF NOT EXISTS idx_file_assets_path ON file_assets(file_path);
      CREATE INDEX IF NOT EXISTS idx_file_assets_hash ON file_assets(content_hash);
    `);
  }

  upsert(input: UpsertFileAssetInput): FileAssetRecord {
    const existing = this.findByPath(input.filePath, input.projectId);
    const now = Date.now();
    const record: FileAssetRecord = {
      assetId: existing?.assetId || input.assetId || `asset-${randomUUID()}`,
      projectId: input.projectId,
      filePath: input.filePath,
      originalName: input.originalName,
      mimeType: input.mimeType,
      extension: input.extension,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      mtimeMs: input.mtimeMs,
      ingestStatus: input.ingestStatus || 'tracked',
      parseStatus: input.parseStatus || 'not_started',
      privacyLevel: input.privacyLevel || existing?.privacyLevel || 'local',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastIndexedAt: input.lastIndexedAt ?? existing?.lastIndexedAt,
      metadata: input.metadata ?? existing?.metadata
    };
    this.db.prepare(`
      INSERT INTO file_assets (
        asset_id, project_id, file_path, original_name, mime_type, extension,
        size_bytes, content_hash, mtime_ms, ingest_status, parse_status,
        privacy_level, created_at, updated_at, last_indexed_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET
        project_id = excluded.project_id,
        file_path = excluded.file_path,
        original_name = excluded.original_name,
        mime_type = excluded.mime_type,
        extension = excluded.extension,
        size_bytes = excluded.size_bytes,
        content_hash = excluded.content_hash,
        mtime_ms = excluded.mtime_ms,
        ingest_status = excluded.ingest_status,
        parse_status = excluded.parse_status,
        privacy_level = excluded.privacy_level,
        updated_at = excluded.updated_at,
        last_indexed_at = excluded.last_indexed_at,
        metadata_json = excluded.metadata_json
    `).run(
      record.assetId,
      record.projectId ?? null,
      record.filePath,
      record.originalName || null,
      record.mimeType || null,
      record.extension || null,
      record.sizeBytes,
      record.contentHash,
      record.mtimeMs,
      record.ingestStatus,
      record.parseStatus,
      record.privacyLevel,
      record.createdAt,
      record.updatedAt,
      record.lastIndexedAt || null,
      record.metadata ? JSON.stringify(record.metadata) : null
    );
    return record;
  }

  markIndexed(assetId: string, parseStatus: FileAssetParseStatus = 'text_extracted'): FileAssetRecord | null {
    this.db.prepare(`
      UPDATE file_assets
      SET ingest_status = 'indexed',
          parse_status = ?,
          last_indexed_at = ?,
          updated_at = ?
      WHERE asset_id = ?
    `).run(parseStatus, Date.now(), Date.now(), assetId);
    return this.getById(assetId);
  }

  getById(assetId: string): FileAssetRecord | null {
    const row = this.db.prepare(`SELECT * FROM file_assets WHERE asset_id = ?`).get(assetId) as FileAssetRow | null;
    return row ? this.mapRow(row) : null;
  }

  findByPath(filePath: string, projectId?: string): FileAssetRecord | null {
    const row = projectId !== undefined
      ? this.db.prepare(`
          SELECT * FROM file_assets
          WHERE file_path = ? AND COALESCE(project_id,'') = ?
          ORDER BY updated_at DESC LIMIT 1
        `).get(filePath, projectId) as FileAssetRow | null
      : this.db.prepare(`
          SELECT * FROM file_assets
          WHERE file_path = ? AND project_id IS NULL
          ORDER BY updated_at DESC LIMIT 1
        `).get(filePath) as FileAssetRow | null;
    return row ? this.mapRow(row) : null;
  }

  listByQuery(input: { query?: string; projectId?: string; extension?: string; mimeType?: string; limit?: number }): FileAssetRecord[] {
    const params: Array<string | number> = [];
    let sql = `SELECT * FROM file_assets WHERE 1=1`;
    if (input.projectId !== undefined) {
      sql += ` AND COALESCE(project_id,'') = ?`;
      params.push(input.projectId);
    }
    if (input.extension) {
      sql += ` AND extension = ?`;
      params.push(input.extension.toLowerCase());
    }
    if (input.mimeType) {
      sql += ` AND mime_type = ?`;
      params.push(input.mimeType);
    }
    if (input.query?.trim()) {
      sql += ` AND (file_path LIKE ? OR original_name LIKE ?)`;
      const like = `%${input.query.trim()}%`;
      params.push(like, like);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(input.limit ?? 20);
    return (this.db.prepare(sql).all(...params) as FileAssetRow[]).map((row) => this.mapRow(row));
  }

  private mapRow(row: FileAssetRow): FileAssetRecord {
    return {
      assetId: row.asset_id,
      projectId: row.project_id ?? undefined,
      filePath: row.file_path,
      originalName: row.original_name || undefined,
      mimeType: row.mime_type || undefined,
      extension: row.extension || undefined,
      sizeBytes: row.size_bytes,
      contentHash: row.content_hash,
      mtimeMs: row.mtime_ms,
      ingestStatus: row.ingest_status,
      parseStatus: row.parse_status,
      privacyLevel: row.privacy_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastIndexedAt: row.last_indexed_at || undefined,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined
    };
  }
}
