import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { EncryptionProvider } from '../encryption/index.js';

export interface FactRecord {
  factId: string;
  neuronId: string;
  unitId?: string;
  subject: string;
  predicateFamily: string;
  predicateValue?: string;
  object?: string;
  entityId?: string;
  timeText?: string;
  validFrom: number;
  validTo?: number;
  certaintyLevel: 'certain' | 'probable' | 'possible' | 'denied';
  confidence: number;
  status: 'provisional' | 'verified' | 'superseded' | 'archived' | 'rejected' | 'provisional_enriched' | 'enriched_candidate';
  sourceText: string;
  metadata?: Record<string, unknown>;
}

export interface EventRecord {
  eventId: string;
  neuronId: string;
  unitId?: string;
  eventType: string;
  actor?: string;
  target?: string;
  payload?: Record<string, unknown>;
  timeText?: string;
  validFrom: number;
  validTo?: number;
  confidence: number;
  status: 'provisional' | 'verified' | 'archived';
}

export class FactStore {
  private db: Database;

  constructor(dbPath: string = ':memory:', private readonly encryptionProvider?: EncryptionProvider) {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
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

  insertFacts(facts: Array<Omit<FactRecord, 'factId'>>): FactRecord[] {
    const stmt = this.db.prepare(`
      INSERT INTO facts (
        fact_id, neuron_id, unit_id, subject, predicate_family, predicate_value, object_value,
        entity_id, time_text, valid_from, valid_to, certainty_level, confidence, status, source_text, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return facts.map((fact) => {
      const record: FactRecord = {
        factId: `fact-${randomUUID()}`,
        ...fact
      };
      stmt.run(
        record.factId,
        record.neuronId,
        record.unitId || null,
        record.subject,
        record.predicateFamily,
        record.predicateValue || null,
        record.object || null,
        record.entityId || null,
        record.timeText || null,
        record.validFrom,
        record.validTo || null,
        record.certaintyLevel,
        record.confidence,
        record.status,
        this.encodeText(record.sourceText),
        record.metadata ? JSON.stringify(record.metadata) : null
      );
      return record;
    });
  }

  insertEvents(events: Array<Omit<EventRecord, 'eventId'>>): EventRecord[] {
    const stmt = this.db.prepare(`
      INSERT INTO compiled_events (
        event_id, neuron_id, unit_id, event_type, actor, target, payload_json,
        time_text, valid_from, valid_to, confidence, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return events.map((event) => {
      const record: EventRecord = {
        eventId: `cevt-${randomUUID()}`,
        ...event
      };
      stmt.run(
        record.eventId,
        record.neuronId,
        record.unitId || null,
        record.eventType,
        record.actor || null,
        record.target || null,
        record.payload ? JSON.stringify(record.payload) : null,
        record.timeText || null,
        record.validFrom,
        record.validTo || null,
        record.confidence,
        record.status
      );
      return record;
    });
  }

  listFactsByNeuron(neuronId: string): FactRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM facts WHERE neuron_id = ? ORDER BY valid_from DESC, fact_id DESC
    `).all(neuronId) as any[];
    return rows.map((row) => this.mapFact(row));
  }

  getFactById(factId: string): FactRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM facts
      WHERE fact_id = ?
    `).get(factId) as any;

    return row ? this.mapFact(row) : null;
  }

  listFactsBySubjectPredicate(
    subject: string,
    predicateFamily: string,
    options?: {
      limit?: number;
      statuses?: FactRecord['status'][];
    }
  ): FactRecord[] {
    const statuses = options?.statuses || [];
    const params: Array<string | number> = [subject, predicateFamily];
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

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapFact(row));
  }

  listFactsByNeuronIds(neuronIds: string[], limit: number = 50): FactRecord[] {
    if (neuronIds.length === 0) return [];

    const placeholders = neuronIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT *
      FROM facts
      WHERE neuron_id IN (${placeholders}) AND status IN ('provisional', 'provisional_enriched', 'verified')
      ORDER BY valid_from DESC, fact_id DESC
      LIMIT ?
    `).all(...neuronIds, limit) as any[];

    return rows.map((row) => this.mapFact(row));
  }

  listFactsByEntityIds(
    entityIds: string[],
    options?: {
      predicateFamilies?: string[];
      limit?: number;
    }
  ): FactRecord[] {
    if (entityIds.length === 0) return [];

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

    return (rows as any[]).map((row) => this.mapFact(row));
  }

  listNeuronIdsByEntityIds(entityIds: string[], limit: number = 50): string[] {
    if (entityIds.length === 0) return [];

    const placeholders = entityIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT DISTINCT neuron_id
      FROM facts
      WHERE entity_id IN (${placeholders}) AND status IN ('provisional', 'provisional_enriched', 'verified')
      ORDER BY valid_from DESC
      LIMIT ?
    `).all(...entityIds, limit) as Array<{ neuron_id: string }>;

    return rows.map((row) => row.neuron_id);
  }

  listEventsByNeuronIds(neuronIds: string[], limit: number = 50): EventRecord[] {
    if (neuronIds.length === 0) return [];

    const placeholders = neuronIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT *
      FROM compiled_events
      WHERE neuron_id IN (${placeholders})
      ORDER BY valid_from DESC, event_id DESC
      LIMIT ?
    `).all(...neuronIds, limit) as any[];

    return rows.map((row) => this.mapEvent(row));
  }

  listEventsByUnitId(unitId: string): EventRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM compiled_events
      WHERE unit_id = ?
      ORDER BY valid_from DESC, event_id DESC
    `).all(unitId) as any[];

    return rows.map((row) => this.mapEvent(row));
  }

  listEventsByUnitIds(unitIds: string[], limit: number = 50): EventRecord[] {
    if (unitIds.length === 0) return [];

    const placeholders = unitIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT *
      FROM compiled_events
      WHERE unit_id IN (${placeholders})
      ORDER BY valid_from DESC, event_id DESC
      LIMIT ?
    `).all(...unitIds, limit) as any[];

    return rows.map((row) => this.mapEvent(row));
  }

  listFactsByTimeRange(
    startTime: number,
    endTime: number,
    options?: {
      statuses?: FactRecord['status'][];
      limit?: number;
    }
  ): FactRecord[] {
    const statuses = options?.statuses || [];
    const params: Array<string | number> = [startTime, endTime];
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
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapFact(row));
  }

  listEventsByTimeRange(
    startTime: number,
    endTime: number,
    options?: {
      statuses?: EventRecord['status'][];
      limit?: number;
    }
  ): EventRecord[] {
    const statuses = options?.statuses || [];
    const params: Array<string | number> = [startTime, endTime];
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
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapEvent(row));
  }

  updateFactStatus(
    factId: string,
    status: FactRecord['status'],
    confidence?: number,
    metadata?: Record<string, unknown>
  ): void {
    const existing = this.db.prepare(`
      SELECT metadata_json
      FROM facts
      WHERE fact_id = ?
    `).get(factId) as any;
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

  bindFactEntity(
    factId: string,
    entityId: string,
    confidence?: number,
    metadata?: Record<string, unknown>
  ): void {
    const existing = this.db.prepare(`
      SELECT metadata_json
      FROM facts
      WHERE fact_id = ?
    `).get(factId) as any;
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

  updateFactMetadata(factId: string, metadata: Record<string, unknown>): void {
    const existing = this.db.prepare(`
      SELECT metadata_json
      FROM facts
      WHERE fact_id = ?
    `).get(factId) as any;

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

  getDatabase(): Database {
    return this.db;
  }

  updateEventStatus(eventId: string, status: EventRecord['status'], confidence?: number): void {
    this.db.prepare(`
      UPDATE compiled_events
      SET status = ?,
          confidence = COALESCE(?, confidence),
          valid_to = CASE WHEN ? = 'archived' THEN COALESCE(valid_to, ?) ELSE valid_to END
      WHERE event_id = ?
    `).run(status, confidence ?? null, status, Date.now(), eventId);
  }

  close(): void {
    this.db.close();
  }

  private mapFact(row: any): FactRecord {
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

  private mapEvent(row: any): EventRecord {
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

  private encodeText(value: string): string {
    return this.encryptionProvider?.encrypt(value) ?? value;
  }

  private decodeText(value: string): string {
    return this.encryptionProvider?.decrypt(value) ?? value;
  }
}
