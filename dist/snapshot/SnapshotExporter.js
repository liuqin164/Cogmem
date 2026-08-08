import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
export class SnapshotExporter {
    options;
    constructor(options) {
        this.options = options;
    }
    async export(dbPath, outputPath) {
        if (dbPath === ':memory:') {
            throw new Error('MemorySnapshot export requires a file-backed sqlite database');
        }
        mkdirSync(dirname(outputPath), { recursive: true });
        const tempPath = join(dirname(outputPath), `.snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
        // Open a secondary read connection.  VACUUM INTO is used (not wal_checkpoint +
        // copyFileSync) because it atomically materialises the full committed database
        // state — including any WAL frames that the main MemoryKernel connection may
        // still hold a read lock on — into a single, clean, WAL-free copy.
        // wal_checkpoint(TRUNCATE) on a secondary connection would silently skip frames
        // that are still referenced by the primary connection's read snapshot.
        const db = new Database(dbPath, { readonly: true });
        try {
            db.exec(`VACUUM INTO '${tempPath.replace(/'/g, "''")}'`);
            this.removeForgottenRows(tempPath);
            const dbBytes = readFileSync(tempPath);
            const checksum = createHash('sha256').update(dbBytes).digest('hex');
            const header = {
                version: 1,
                schemaVersion: this.readSchemaVersion(db),
                embeddingDimension: this.options.embeddingDimension,
                neuronCount: this.readNeuronCount(db),
                createdAt: new Date().toISOString(),
                coreVersion: this.options.coreVersion ?? '2.7.1',
                checksum,
            };
            const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
            const prefix = Buffer.alloc(4);
            prefix.writeUInt32LE(headerBytes.length, 0);
            const snapshotBytes = Buffer.concat([prefix, headerBytes, dbBytes]);
            writeFileSync(outputPath, snapshotBytes);
            return {
                header,
                snapshotPath: outputPath,
                byteLength: snapshotBytes.byteLength,
            };
        }
        finally {
            db.close();
            rmSync(tempPath, { force: true });
        }
    }
    removeForgottenRows(dbPath) {
        const snapshotDb = new Database(dbPath);
        try {
            snapshotDb.exec(`PRAGMA secure_delete = ON`);
            snapshotDb.transaction(() => {
                snapshotDb.exec(`CREATE TEMP TABLE forgotten_snapshot_neurons AS SELECT id FROM neurons WHERE is_deleted <> 0`);
                snapshotDb.exec(`DELETE FROM neurons_fts WHERE id IN (SELECT id FROM forgotten_snapshot_neurons)`);
                snapshotDb.exec(`DELETE FROM synapses WHERE source_id IN (SELECT id FROM forgotten_snapshot_neurons) OR target_id IN (SELECT id FROM forgotten_snapshot_neurons)`);
                snapshotDb.exec(`DELETE FROM neurons WHERE id IN (SELECT id FROM forgotten_snapshot_neurons)`);
                snapshotDb.exec(`DROP TABLE forgotten_snapshot_neurons`);
            })();
            snapshotDb.exec(`VACUUM`);
        }
        catch (error) {
            if (!(error instanceof Error) || !/no such table: neurons/i.test(error.message))
                throw error;
        }
        finally {
            snapshotDb.close();
        }
    }
    readSchemaVersion(db) {
        try {
            const row = db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get();
            return Number(row?.value ?? 0);
        }
        catch {
            return 0;
        }
    }
    readNeuronCount(db) {
        try {
            const row = db.prepare(`SELECT COUNT(*) AS count FROM neurons WHERE is_deleted = 0`).get();
            return Number(row?.count ?? 0);
        }
        catch {
            return 0;
        }
    }
}
