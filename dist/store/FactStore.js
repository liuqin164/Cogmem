import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
export class FactStore {
    encryptionProvider;
    db;
    constructor(dbPath = ':memory:', encryptionProvider) {
        this.encryptionProvider = encryptionProvider;
        this.db = new Database(dbPath);
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        fact_id TEXT PRIMARY KEY,
        neuron_id TEXT NOT NULL,
        unit_id TEXT,
        subject TEXT NOT NULL,
        predicate_family TEXT NOT NULL,
        predicate_value TEXT,
        object_value TEXT,
        entity_id TEXT,
        time_text TEXT,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        certainty_level TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        source_text TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate
        ON facts(subject, predicate_family, valid_from DESC);

      CREATE INDEX IF NOT EXISTS idx_facts_entity_id
        ON facts(entity_id, valid_from DESC);

      CREATE TABLE IF NOT EXISTS compiled_events (
        event_id TEXT PRIMARY KEY,
        neuron_id TEXT NOT NULL,
        unit_id TEXT,
        event_type TEXT NOT NULL,
        actor TEXT,
        target TEXT,
        payload_json TEXT,
        time_text TEXT,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        confidence REAL NOT NULL,
        status TEXT NOT NULL
      );
    `);
    }
    insertFacts(facts) {
        const stmt = this.db.prepare(`
      INSERT INTO facts (
        fact_id, neuron_id, unit_id, subject, predicate_family, predicate_value, object_value,
        entity_id, time_text, valid_from, valid_to, certainty_level, confidence, status, source_text, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        return facts.map((fact) => {
            const record = {
                factId: `fact-${randomUUID()}`,
                ...fact
            };
            stmt.run(record.factId, record.neuronId, record.unitId || null, record.subject, record.predicateFamily, record.predicateValue || null, record.object || null, record.entityId || null, record.timeText || null, record.validFrom, record.validTo || null, record.certaintyLevel, record.confidence, record.status, this.encodeText(record.sourceText), record.metadata ? JSON.stringify(record.metadata) : null);
            return record;
        });
    }
    insertEvents(events) {
        const stmt = this.db.prepare(`
      INSERT INTO compiled_events (
        event_id, neuron_id, unit_id, event_type, actor, target, payload_json,
        time_text, valid_from, valid_to, confidence, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        return events.map((event) => {
            const record = {
                eventId: `cevt-${randomUUID()}`,
                ...event
            };
            stmt.run(record.eventId, record.neuronId, record.unitId || null, record.eventType, record.actor || null, record.target || null, record.payload ? JSON.stringify(record.payload) : null, record.timeText || null, record.validFrom, record.validTo || null, record.confidence, record.status);
            return record;
        });
    }
    listFactsByNeuron(neuronId) {
        const rows = this.db.prepare(`
      SELECT * FROM facts WHERE neuron_id = ? ORDER BY valid_from DESC, fact_id DESC
    `).all(neuronId);
        return rows.map((row) => this.mapFact(row));
    }
    getFactById(factId) {
        const row = this.db.prepare(`
      SELECT *
      FROM facts
      WHERE fact_id = ?
    `).get(factId);
        return row ? this.mapFact(row) : null;
    }
    listFactsBySubjectPredicate(subject, predicateFamily, options) {
        const statuses = options?.statuses || [];
        const params = [subject, predicateFamily];
        let sql = `
      SELECT *
      FROM facts
      WHERE subject = ?
        AND predicate_family = ?
    `;
        if (statuses.length > 0) {
            sql += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
            params.push(...statuses);
        }
        sql += ` ORDER BY valid_from DESC, fact_id DESC LIMIT ?`;
        params.push(options?.limit ?? 100);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => this.mapFact(row));
    }
    listFactsByNeuronIds(neuronIds, limit = 50) {
        if (neuronIds.length === 0)
            return [];
        const placeholders = neuronIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT *
      FROM facts
      WHERE neuron_id IN (${placeholders}) AND status IN ('provisional', 'provisional_enriched', 'verified')
      ORDER BY valid_from DESC, fact_id DESC
      LIMIT ?
    `).all(...neuronIds, limit);
        return rows.map((row) => this.mapFact(row));
    }
    listFactsByEntityIds(entityIds, options) {
        if (entityIds.length === 0)
            return [];
        const limit = options?.limit ?? 50;
        const entityPlaceholders = entityIds.map(() => '?').join(', ');
        const predicateFamilies = options?.predicateFamilies || [];
        const rows = predicateFamilies.length > 0
            ? this.db.prepare(`
          SELECT *
          FROM facts
          WHERE entity_id IN (${entityPlaceholders})
            AND status IN ('provisional', 'provisional_enriched', 'verified')
            AND predicate_family IN (${predicateFamilies.map(() => '?').join(', ')})
          ORDER BY valid_from DESC, fact_id DESC
          LIMIT ?
        `).all(...entityIds, ...predicateFamilies, limit)
            : this.db.prepare(`
      SELECT *
      FROM facts
      WHERE entity_id IN (${entityPlaceholders}) AND status IN ('provisional', 'provisional_enriched', 'verified')
          ORDER BY valid_from DESC, fact_id DESC
          LIMIT ?
        `).all(...entityIds, limit);
        return rows.map((row) => this.mapFact(row));
    }
    listNeuronIdsByEntityIds(entityIds, limit = 50) {
        if (entityIds.length === 0)
            return [];
        const placeholders = entityIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT DISTINCT neuron_id
      FROM facts
      WHERE entity_id IN (${placeholders}) AND status IN ('provisional', 'provisional_enriched', 'verified')
      ORDER BY valid_from DESC
      LIMIT ?
    `).all(...entityIds, limit);
        return rows.map((row) => row.neuron_id);
    }
    listEventsByNeuronIds(neuronIds, limit = 50) {
        if (neuronIds.length === 0)
            return [];
        const placeholders = neuronIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT *
      FROM compiled_events
      WHERE neuron_id IN (${placeholders})
      ORDER BY valid_from DESC, event_id DESC
      LIMIT ?
    `).all(...neuronIds, limit);
        return rows.map((row) => this.mapEvent(row));
    }
    listEventsByUnitId(unitId) {
        const rows = this.db.prepare(`
      SELECT *
      FROM compiled_events
      WHERE unit_id = ?
      ORDER BY valid_from DESC, event_id DESC
    `).all(unitId);
        return rows.map((row) => this.mapEvent(row));
    }
    listEventsByUnitIds(unitIds, limit = 50) {
        if (unitIds.length === 0)
            return [];
        const placeholders = unitIds.map(() => '?').join(', ');
        const rows = this.db.prepare(`
      SELECT *
      FROM compiled_events
      WHERE unit_id IN (${placeholders})
      ORDER BY valid_from DESC, event_id DESC
      LIMIT ?
    `).all(...unitIds, limit);
        return rows.map((row) => this.mapEvent(row));
    }
    listFactsByTimeRange(startTime, endTime, options) {
        const statuses = options?.statuses || [];
        const params = [startTime, endTime];
        let sql = `
      SELECT *
      FROM facts
      WHERE valid_from >= ?
        AND valid_from < ?
    `;
        if (statuses.length > 0) {
            sql += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
            params.push(...statuses);
        }
        sql += ` ORDER BY valid_from DESC, fact_id DESC LIMIT ?`;
        params.push(options?.limit ?? 500);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => this.mapFact(row));
    }
    listEventsByTimeRange(startTime, endTime, options) {
        const statuses = options?.statuses || [];
        const params = [startTime, endTime];
        let sql = `
      SELECT *
      FROM compiled_events
      WHERE valid_from >= ?
        AND valid_from < ?
    `;
        if (statuses.length > 0) {
            sql += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
            params.push(...statuses);
        }
        sql += ` ORDER BY valid_from DESC, event_id DESC LIMIT ?`;
        params.push(options?.limit ?? 500);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => this.mapEvent(row));
    }
    updateFactStatus(factId, status, confidence, metadata) {
        const existing = this.db.prepare(`
      SELECT metadata_json
      FROM facts
      WHERE fact_id = ?
    `).get(factId);
        const mergedMetadata = metadata
            ? JSON.stringify({
                ...(existing?.metadata_json ? JSON.parse(existing.metadata_json) : {}),
                ...metadata
            })
            : existing?.metadata_json || null;
        this.db.prepare(`
      UPDATE facts
      SET status = ?,
          confidence = COALESCE(?, confidence),
          metadata_json = ?,
          valid_to = CASE
            WHEN ? IN ('archived', 'rejected', 'superseded') THEN COALESCE(valid_to, ?)
            ELSE valid_to
          END
      WHERE fact_id = ?
    `).run(status, confidence ?? null, mergedMetadata, status, Date.now(), factId);
    }
    bindFactEntity(factId, entityId, confidence, metadata) {
        const existing = this.db.prepare(`
      SELECT metadata_json
      FROM facts
      WHERE fact_id = ?
    `).get(factId);
        const mergedMetadata = metadata
            ? JSON.stringify({
                ...(existing?.metadata_json ? JSON.parse(existing.metadata_json) : {}),
                ...metadata
            })
            : existing?.metadata_json || null;
        this.db.prepare(`
      UPDATE facts
      SET entity_id = ?,
          confidence = COALESCE(?, confidence),
          metadata_json = ?
      WHERE fact_id = ?
    `).run(entityId, confidence ?? null, mergedMetadata, factId);
    }
    updateFactMetadata(factId, metadata) {
        const existing = this.db.prepare(`
      SELECT metadata_json
      FROM facts
      WHERE fact_id = ?
    `).get(factId);
        const mergedMetadata = JSON.stringify({
            ...(existing?.metadata_json ? JSON.parse(existing.metadata_json) : {}),
            ...metadata
        });
        this.db.prepare(`
      UPDATE facts
      SET metadata_json = ?
      WHERE fact_id = ?
    `).run(mergedMetadata, factId);
    }
    getDatabase() {
        return this.db;
    }
    updateEventStatus(eventId, status, confidence) {
        this.db.prepare(`
      UPDATE compiled_events
      SET status = ?,
          confidence = COALESCE(?, confidence),
          valid_to = CASE WHEN ? = 'archived' THEN COALESCE(valid_to, ?) ELSE valid_to END
      WHERE event_id = ?
    `).run(status, confidence ?? null, status, Date.now(), eventId);
    }
    close() {
        this.db.close();
    }
    mapFact(row) {
        return {
            factId: row.fact_id,
            neuronId: row.neuron_id,
            unitId: row.unit_id || undefined,
            subject: row.subject,
            predicateFamily: row.predicate_family,
            predicateValue: row.predicate_value || undefined,
            object: row.object_value || undefined,
            entityId: row.entity_id || undefined,
            timeText: row.time_text || undefined,
            validFrom: row.valid_from,
            validTo: row.valid_to || undefined,
            certaintyLevel: row.certainty_level,
            confidence: row.confidence,
            status: row.status,
            sourceText: this.decodeText(row.source_text),
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined
        };
    }
    mapEvent(row) {
        return {
            eventId: row.event_id,
            neuronId: row.neuron_id,
            unitId: row.unit_id || undefined,
            eventType: row.event_type,
            actor: row.actor || undefined,
            target: row.target || undefined,
            payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
            timeText: row.time_text || undefined,
            validFrom: row.valid_from,
            validTo: row.valid_to || undefined,
            confidence: row.confidence,
            status: row.status
        };
    }
    encodeText(value) {
        return this.encryptionProvider?.encrypt(value) ?? value;
    }
    decodeText(value) {
        return this.encryptionProvider?.decrypt(value) ?? value;
    }
}
