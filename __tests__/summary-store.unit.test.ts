import { describe, expect, it } from 'bun:test';
import Database from 'bun:sqlite';
import { SummaryStore } from '../src/store/SummaryStore.js';

describe('SummaryStore', () => {
  it('inserts, gets, lists, searches, and supersedes summaries', () => {
    const db = new Database(':memory:');
    const store = new SummaryStore(db);
    const summary = store.insertSummary({
      projectId: 'p1',
      sessionId: 's1',
      scope: 'turn_window',
      windowStart: 1,
      windowEnd: 2,
      text: 'Atlas auth review blocked deployment.',
      confidence: 0.9,
      status: 'provisional',
      sourceNeuronIds: ['n1']
    });

    expect(store.getById(summary.summaryId)?.text).toContain('Atlas');
    expect(store.listByProject('p1')).toHaveLength(1);
    expect(store.listBySession('s1', 'p1')).toHaveLength(1);
    expect(store.findRelevant('Atlas auth', 'p1', 3)).toHaveLength(1);
    expect(store.markSuperseded(summary.summaryId, 'sum-next')?.status).toBe('superseded');
    expect(store.findRelevant('Atlas auth', 'p1', 3)).toHaveLength(0);
    db.close();
  });

  it('migrates legacy deep_write_summary facts idempotently and marks them superseded', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE facts (
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
    `);
    const stmt = db.prepare(`
      INSERT INTO facts (
        fact_id, neuron_id, subject, predicate_family, object_value, valid_from,
        certainty_level, confidence, status, source_text, metadata_json
      ) VALUES (?, ?, ?, 'deep_write_summary', ?, ?, 'possible', 0.8, 'provisional', ?, '{}')
    `);
    for (let i = 0; i < 5; i++) stmt.run(`f${i}`, `n${i}`, 'conversation', `summary ${i}`, i + 1, `summary ${i}`);

    const store = new SummaryStore(db);
    expect(store.migrateLegacyFactSummaries()).toBe(5);
    expect(store.migrateLegacyFactSummaries()).toBe(0);
    expect(store.findRelevant('summary', undefined, 10)).toHaveLength(5);
    const row = db.prepare(`SELECT COUNT(*) AS count FROM facts WHERE status = 'superseded'`).get() as { count: number };
    expect(row.count).toBe(5);
    db.close();
  });

  it('round-trips Unix epoch zero without replacing it with now or null', () => {
    const db = new Database(':memory:');
    const store = new SummaryStore(db);
    const saved = store.insertSummary({ projectId: '', scope: 'turn_window', text: 'epoch', confidence: 1, status: 'provisional', sourceNeuronIds: [], createdAt: 0, updatedAt: 0, windowStart: 0, windowEnd: 0 });
    expect(saved.createdAt).toBe(0);
    expect(store.getById(saved.summaryId)).toMatchObject({ createdAt: 0, updatedAt: 0, windowStart: 0, windowEnd: 0 });
    expect(store.listByProject('').map((summary) => summary.summaryId)).toEqual([saved.summaryId]);
    db.close();
  });
});
