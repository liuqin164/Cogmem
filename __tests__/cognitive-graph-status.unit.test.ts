import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { CognitiveGraphStore } from '../src/store/CognitiveGraphStore.js';

test('cognitive recall stops using facts, beliefs, events, and derived entities after deactivation', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE neurons(id TEXT PRIMARY KEY,content TEXT NOT NULL,project_id TEXT,is_deleted INTEGER NOT NULL DEFAULT 0,status TEXT,source_type TEXT,tags TEXT);
    CREATE TABLE facts(fact_id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE beliefs(id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE compiled_events(event_id TEXT PRIMARY KEY,status TEXT NOT NULL);
    INSERT INTO neurons VALUES('n','ordinary','a',0,'active','user_input','[]');
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

test('cognitive recall applies neuron governance before seeding and traversal', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE neurons(id TEXT PRIMARY KEY,content TEXT NOT NULL,project_id TEXT,is_deleted INTEGER NOT NULL DEFAULT 0,status TEXT,source_type TEXT,tags TEXT);`);
  const insert = db.prepare(`INSERT INTO neurons VALUES(?,?,?,?,?,?,?)`);
  insert.run('active', 'active memory', 'a', 0, 'active', 'user_input', '[]');
  insert.run('archived', 'archived sentinel', 'a', 0, 'archived', 'user_input', '[]');
  insert.run('llm', 'suspect llm sentinel', 'a', 0, 'suspect', 'llm_inference', '[]');
  insert.run('tool', 'suspect tool sentinel', 'a', 0, 'suspect', 'external_tool', '[]');
  insert.run('raw', 'suspect raw sentinel', 'a', 0, 'suspect', 'user_input', '["reliability:raw_utterance","role:user","record:raw_utterance"]');
  insert.run('target', 'target memory', 'a', 0, 'active', 'user_input', '[]');
  const store = new CognitiveGraphStore(db);
  const nodes = Object.fromEntries(['active', 'archived', 'llm', 'tool', 'raw', 'target'].map((id) => [id, store.upsertNode({
    nodeId: id, nodeType: 'neuron', nodeKey: `neuron:${id}`, title: `${id} sentinel`, projectId: 'a', sourceNeuronId: id, createdAt: 1,
  })]));
  store.linkNodes({ sourceNodeId: nodes.active.nodeId, targetNodeId: nodes.archived.nodeId, edgeType: 'references_fact', projectId: 'a', createdAt: 1 });
  store.linkNodes({ sourceNodeId: nodes.archived.nodeId, targetNodeId: nodes.target.nodeId, edgeType: 'references_fact', projectId: 'a', createdAt: 1 });
  expect(store.collectContext({ projectId: 'a', terms: ['archived', 'llm', 'tool'], excludeTemporal: true }).seedNodeIds).toEqual([]);
  expect(store.collectContext({ projectId: 'a', terms: ['raw'], excludeTemporal: true }).seedNodeIds).toEqual([nodes.raw.nodeId]);
  expect(store.collectContext({ projectId: 'a', seedNodeIds: [nodes.active.nodeId], hopLimit: 2, excludeTemporal: true }).traversedNodeIds)
    .not.toContain(nodes.target.nodeId);
  store.close();
});
