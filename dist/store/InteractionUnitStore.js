import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
export const BINDING_PRIORITY = {
    entity: 3,
    action: 2,
    question: 1
};
export class InteractionUnitStore {
    db;
    ownsDb;
    constructor(dbOrPath = ':memory:') {
        if (typeof dbOrPath === 'string') {
            this.db = new Database(dbOrPath);
            this.ownsDb = true;
        }
        else {
            this.db = dbOrPath;
            this.ownsDb = false;
        }
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS interaction_units (
        unit_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        message_neuron_ids_json TEXT NOT NULL,
        semantic_text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_bindings (
        pending_id TEXT PRIMARY KEY,
        binding_type TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        reference_text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pending_bindings_status_time
        ON pending_bindings(status, updated_at DESC);
    `);
    }
    createUnit(input) {
        const createdAt = input.createdAt ?? Date.now();
        const record = {
            unitId: `unit-${randomUUID()}`,
            type: input.type,
            messageNeuronIds: input.messageNeuronIds,
            semanticText: input.semanticText,
            status: input.status ?? 'resolved',
            createdAt,
            updatedAt: createdAt
        };
        this.db.prepare(`
      INSERT INTO interaction_units (
        unit_id, type, message_neuron_ids_json, semantic_text, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.unitId, record.type, JSON.stringify(record.messageNeuronIds), record.semanticText, record.status, record.createdAt, record.updatedAt);
        return record;
    }
    registerPending(input) {
        const createdAt = input.createdAt ?? Date.now();
        const record = {
            pendingId: `pending-${randomUUID()}`,
            bindingType: input.bindingType,
            unitId: input.unitId,
            referenceText: input.referenceText,
            status: 'pending',
            createdAt,
            updatedAt: createdAt
        };
        this.db.prepare(`
      INSERT INTO pending_bindings (
        pending_id, binding_type, unit_id, reference_text, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.pendingId, record.bindingType, record.unitId, record.referenceText, record.status, record.createdAt, record.updatedAt);
        return record;
    }
    getLatestPending(bindingTypes = ['action', 'entity', 'question'], maxAgeMs = 10 * 60 * 1000, now = Date.now()) {
        const safeTypes = bindingTypes.length ? bindingTypes : ['action', 'entity', 'question'];
        const placeholders = safeTypes.map(() => '?').join(', ');
        const row = this.db.prepare(`
      SELECT *
      FROM pending_bindings
      WHERE status = 'pending'
        AND binding_type IN (${placeholders})
        AND created_at >= ?
      ORDER BY CASE binding_type
        WHEN 'entity' THEN ${BINDING_PRIORITY.entity}
        WHEN 'action' THEN ${BINDING_PRIORITY.action}
        ELSE ${BINDING_PRIORITY.question}
      END DESC,
      updated_at DESC,
      created_at DESC
      LIMIT 1
    `).get(...safeTypes, now - maxAgeMs);
        return row ? this.mapPending(row) : null;
    }
    getUnit(unitId) {
        const row = this.db.prepare(`
      SELECT * FROM interaction_units WHERE unit_id = ?
    `).get(unitId);
        return row ? this.mapUnit(row) : null;
    }
    listUnitsByNeuronIds(neuronIds) {
        if (neuronIds.length === 0)
            return [];
        const rows = this.db.prepare(`
      SELECT *
      FROM interaction_units
      ORDER BY updated_at DESC, created_at DESC
    `).all();
        const neuronIdSet = new Set(neuronIds);
        return rows
            .map((row) => this.mapUnit(row))
            .filter((unit) => unit.messageNeuronIds.some((neuronId) => neuronIdSet.has(neuronId)));
    }
    resolvePendingWithReply(input) {
        const pending = this.db.prepare(`
      SELECT * FROM pending_bindings WHERE pending_id = ?
    `).get(input.pendingId);
        if (!pending)
            return null;
        const unit = this.getUnit(pending.unit_id);
        if (!unit)
            return null;
        const resolvedAt = input.resolvedAt ?? Date.now();
        const mergedIds = Array.from(new Set([...unit.messageNeuronIds, input.replyNeuronId]));
        this.db.prepare(`
      UPDATE interaction_units
      SET type = 'bound_reply',
          message_neuron_ids_json = ?,
          semantic_text = ?,
          status = 'resolved',
          updated_at = ?
      WHERE unit_id = ?
    `).run(JSON.stringify(mergedIds), input.semanticText, resolvedAt, unit.unitId);
        this.db.prepare(`
      UPDATE pending_bindings
      SET status = 'resolved', updated_at = ?
      WHERE pending_id = ?
    `).run(resolvedAt, input.pendingId);
        return this.getUnit(unit.unitId);
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
    mapUnit(row) {
        return {
            unitId: row.unit_id,
            type: row.type,
            messageNeuronIds: JSON.parse(row.message_neuron_ids_json),
            semanticText: row.semantic_text,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    mapPending(row) {
        return {
            pendingId: row.pending_id,
            bindingType: row.binding_type,
            unitId: row.unit_id,
            referenceText: row.reference_text,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}
