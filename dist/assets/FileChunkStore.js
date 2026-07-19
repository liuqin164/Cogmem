export class FileChunkStore {
    db;
    constructor(db) {
        this.db = db;
        this.initSchema();
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_chunks (
        chunk_id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        neuron_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        block_start_index INTEGER NOT NULL,
        block_end_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        token_estimate INTEGER,
        text_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        metadata_json TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunks_neuron ON file_chunks(neuron_id);
      CREATE INDEX IF NOT EXISTS idx_file_chunks_asset ON file_chunks(asset_id, chunk_index);

      CREATE TABLE IF NOT EXISTS file_chunk_edges (
        source_chunk_id TEXT NOT NULL,
        target_chunk_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_chunk_id, target_chunk_id, edge_type)
      );
    `);
    }
    replaceChunks(assetId, chunks) {
        this.db.prepare(`DELETE FROM file_chunk_edges WHERE source_chunk_id IN (SELECT chunk_id FROM file_chunks WHERE asset_id = ?)`).run(assetId);
        this.db.prepare(`DELETE FROM file_chunk_edges WHERE target_chunk_id IN (SELECT chunk_id FROM file_chunks WHERE asset_id = ?)`).run(assetId);
        this.db.prepare(`DELETE FROM file_chunks WHERE asset_id = ?`).run(assetId);
        const now = Date.now();
        const stmt = this.db.prepare(`
      INSERT INTO file_chunks (
        chunk_id, asset_id, neuron_id, chunk_index, block_start_index, block_end_index,
        kind, token_estimate, text_hash, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const records = chunks.map((chunk) => {
            const record = {
                chunkId: chunk.chunkId,
                assetId,
                neuronId: chunk.neuronId,
                chunkIndex: chunk.chunkIndex,
                blockStartIndex: chunk.blockStartIndex,
                blockEndIndex: chunk.blockEndIndex,
                kind: chunk.kind,
                tokenEstimate: chunk.tokenEstimate,
                textHash: chunk.textHash,
                createdAt: now,
                metadata: chunk.metadata
            };
            stmt.run(record.chunkId, record.assetId, record.neuronId, record.chunkIndex, record.blockStartIndex, record.blockEndIndex, record.kind, record.tokenEstimate || null, record.textHash, record.createdAt, record.metadata ? JSON.stringify(record.metadata) : null);
            return record;
        });
        this.insertSequentialEdges(records);
        return records;
    }
    listByAsset(assetId) {
        return this.db.prepare(`
      SELECT * FROM file_chunks
      WHERE asset_id = ?
      ORDER BY chunk_index ASC
    `).all(assetId).map((row) => this.mapRow(row));
    }
    listContext(assetId, chunkIndex, radius = 1, projectId) {
        const start = Math.max(0, chunkIndex - Math.max(0, radius));
        const end = chunkIndex + Math.max(0, radius);
        return this.db.prepare(`
      SELECT fc.*, fa.file_path, fa.original_name, fa.mime_type, n.content,
        fb.page, fb.sheet_name, fb.row_start, fb.row_end, fb.line_start, fb.line_end,
        fb.start_ms, fb.end_ms
      FROM file_chunks fc
      JOIN file_assets fa ON fa.asset_id = fc.asset_id
      JOIN neurons n ON n.id = fc.neuron_id
      LEFT JOIN file_blocks fb ON fb.asset_id = fc.asset_id AND fb.block_index = fc.block_start_index
      WHERE fc.asset_id = ? AND fc.chunk_index BETWEEN ? AND ?
        AND (? IS NULL OR COALESCE(fa.project_id,'') = ?)
      ORDER BY fc.chunk_index ASC
    `).all(assetId, start, end, projectId === undefined ? null : projectId, projectId ?? '').map((row) => this.mapEvidenceRow(row));
    }
    listEvidenceByNeuronIds(neuronIds) {
        if (neuronIds.length === 0)
            return [];
        const placeholders = neuronIds.map(() => '?').join(', ');
        return this.db.prepare(`
      SELECT fc.*, fa.file_path, fa.original_name, fa.mime_type, n.content,
        fb.page, fb.sheet_name, fb.row_start, fb.row_end, fb.line_start, fb.line_end,
        fb.start_ms, fb.end_ms
      FROM file_chunks fc
      JOIN file_assets fa ON fa.asset_id = fc.asset_id
      JOIN neurons n ON n.id = fc.neuron_id
      LEFT JOIN file_blocks fb ON fb.asset_id = fc.asset_id AND fb.block_index = fc.block_start_index
      WHERE fc.neuron_id IN (${placeholders})
      ORDER BY fc.asset_id ASC, fc.chunk_index ASC
    `).all(...neuronIds).map((row) => this.mapEvidenceRow(row));
    }
    groupEvidenceByAsset(evidence) {
        const grouped = new Map();
        for (const item of evidence) {
            const existing = grouped.get(item.assetId) || {
                assetId: item.assetId,
                filePath: item.filePath,
                originalName: item.originalName,
                mimeType: item.mimeType,
                matchedChunks: []
            };
            existing.matchedChunks.push({
                neuronId: item.neuronId,
                chunkIndex: item.chunkIndex,
                text: item.text,
                kind: item.kind,
                page: item.page,
                sheetName: item.sheetName,
                rowStart: item.rowStart,
                rowEnd: item.rowEnd,
                lineStart: item.lineStart,
                lineEnd: item.lineEnd,
                startMs: item.startMs,
                endMs: item.endMs
            });
            grouped.set(item.assetId, existing);
        }
        return Array.from(grouped.values());
    }
    insertSequentialEdges(chunks) {
        if (chunks.length < 2)
            return;
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO file_chunk_edges (
        source_chunk_id, target_chunk_id, edge_type, weight, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
        const now = Date.now();
        for (let i = 0; i < chunks.length - 1; i += 1) {
            stmt.run(chunks[i].chunkId, chunks[i + 1].chunkId, 'next_chunk', 1, now);
            stmt.run(chunks[i + 1].chunkId, chunks[i].chunkId, 'previous_chunk', 1, now);
        }
    }
    mapRow(row) {
        return {
            chunkId: row.chunk_id,
            assetId: row.asset_id,
            neuronId: row.neuron_id,
            chunkIndex: row.chunk_index,
            blockStartIndex: row.block_start_index,
            blockEndIndex: row.block_end_index,
            kind: row.kind,
            tokenEstimate: row.token_estimate || undefined,
            textHash: row.text_hash,
            createdAt: row.created_at,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined
        };
    }
    mapEvidenceRow(row) {
        return {
            ...this.mapRow(row),
            text: row.content,
            filePath: row.file_path,
            originalName: row.original_name || undefined,
            mimeType: row.mime_type || undefined,
            page: row.page || undefined,
            sheetName: row.sheet_name || undefined,
            rowStart: row.row_start || undefined,
            rowEnd: row.row_end || undefined,
            lineStart: row.line_start || undefined,
            lineEnd: row.line_end || undefined,
            startMs: row.start_ms || undefined,
            endMs: row.end_ms || undefined
        };
    }
}
