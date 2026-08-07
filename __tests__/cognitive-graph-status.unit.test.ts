import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { CognitiveGraphStore } from '../src/store/CognitiveGraphStore.js';

test('cognitive recall stops using facts, beliefs, events, and derived entities after deactivation', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,is_deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE facts(fact_id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE beliefs(id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE compiled_events(event_id TEXT PRIMARY KEY,status TEXT NOT NULL);
    INSERT INTO neurons VALUES('n','a',0);
    INSERT INTO facts VALUES('f','verified');
    INSERT INTO beliefs VALUES('b','active');
    INSERT INTO compiled_events VALUES('e','verified');
  `);
  const store = new CognitiveGraphStore(db);
  const nodes = [
    store.upsertNode({ nodeId: 'f', nodeType: 'fact', nodeKey: 'fact:f', title: 'stale fact', projectId: 'a', sourceNeuronId: 'n', metadata: { status: 'verified' }, createdAt: 1 }),
    store.upsertNode({ nodeId: 'b', nodeType: 'belief', nodeKey: 'belief:b', title: 'stale belief', projectId: 'a', sourceNeuronId: 'n', metadata: { status: 'active' }, createdAt: 1 }),
    store.upsertNode({ nodeId: 'e', nodeType: 'compiled_event', nodeKey: 'compiled_event:e', title: 'stale event', projectId: 'a', sourceNeuronId: 'n', metadata: { status: 'verified' }, createdAt: 1 }),
    store.upsertNode({ nodeId: 'entity', nodeType: 'entity', nodeKey: 'entity:x', title: 'stale entity', projectId: 'a', sourceNeuronId: 'n', metadata: { sourceFactId: 'f' }, createdAt: 1 }),
  ];
  expect(store.collectContext({ projectId: 'a', terms: ['stale'], limit: 20, excludeTemporal: true }).seedNodeIds).toHaveLength(4);

  db.exec(`UPDATE facts SET status='superseded'; UPDATE beliefs SET status='revoked'; UPDATE compiled_events SET status='archived'`);
  expect(store.collectContext({ projectId: 'a', terms: ['stale'], limit: 20, excludeTemporal: true }).seedNodeIds).toEqual([]);
  for (const node of nodes) expect(store.findNode('a', node.nodeType, node.nodeKey)).toBeNull();
  store.close();
});
