import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SchemaMigrationRunner } from '../src/migrations/SchemaMigrationRunner.js';
import { migration_0015 } from '../src/migrations/0015_memory_governance.js';
import { migration_0049 } from '../src/migrations/0049_project_scoped_graph_identity.js';
import { migration_0046 } from '../src/migrations/0046_stable_migration_checksums.js';
import { migration_0052 } from '../src/migrations/0052_project_scoped_topology_identity.js';
import { migration_0053 } from '../src/migrations/0053_topology_privacy_and_recovery.js';
import { CANONICAL_MIGRATION_SOURCE_DIGESTS, FROZEN_MIGRATION_DEPENDENCY_DIGESTS, LEGACY_MIGRATION_RECEIPT_PROFILES, MIGRATION_DIGESTS } from '../src/migrations/MigrationDigestManifest.js';

describe('schema migration runner', () => {
  test('plans pending migrations without mutating during dry run', () => {
    const db = new Database(':memory:');
    const runner = new SchemaMigrationRunner(db, [migration_0015], { readonly: true });

    expect(runner.plan().map((item) => item.version)).toEqual(['0015']);
    expect(runner.run({ dryRun: true }).applied).toEqual([]);
    expect(runner.plan().map((item) => item.version)).toEqual(['0015']);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'`).get()).toBeNull();
    db.close();
  });

  test('readonly planning adopts legacy meta version without writing migration rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta (key, value) VALUES ('schema_version', '15');
    `);
    const runner = new SchemaMigrationRunner(db, [migration_0015], { readonly: true });

    expect(runner.plan()).toEqual([]);
    expect(runner.currentVersion()).toBe('0015');
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'`).get()).toBeNull();
    db.close();
  });

  test('applies migrations transactionally and remains idempotent', () => {
    const db = new Database(':memory:');
    const runner = new SchemaMigrationRunner(db, [migration_0015]);

    expect(runner.run().applied).toEqual(['0015']);
    expect(runner.run().applied).toEqual([]);
    expect(runner.currentVersion()).toBe('0015');
    const columns = db.prepare('PRAGMA table_info(memory_governance_operations)').all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'idempotency_key')).toBe(true);
    db.close();
  });

  test('accepts globally known receipts when this runner executes a kernel subset', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`).run('0001', 'initial schema', new Date(0).toISOString(), MIGRATION_DIGESTS['0001']);
    const runner = new SchemaMigrationRunner(db, [migration_0015], { readonly: true });
    expect(() => runner.run({ dryRun: true })).not.toThrow();
    db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`).run('9999', 'unknown', new Date(0).toISOString(), 'not-a-digest');
    expect(() => runner.run({ dryRun: true })).toThrow('migration_checksum_unknown:9999');
    db.close();
  });

  test('normalizes only a complete audited f71b20a receipt profile', () => {
    const profile = LEGACY_MIGRATION_RECEIPT_PROFILES.f71b20a_source!;
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    const insert = db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`);
    for (const [version, checksum] of Object.entries(profile)) insert.run(version, `legacy-${version}`, new Date(0).toISOString(), checksum);
    const runner = new SchemaMigrationRunner(db, [migration_0015]);
    expect(() => runner.run()).not.toThrow();
    const rows = db.prepare(`SELECT version,checksum FROM _schema_migrations`).all() as Array<{ version: string; checksum: string }>;
    expect(rows.every((row) => row.checksum === MIGRATION_DIGESTS[row.version])).toBe(true);
    db.close();

    const tampered = new Database(':memory:');
    tampered.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    const insertTampered = tampered.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`);
    for (const [version, checksum] of Object.entries(profile)) insertTampered.run(version, `legacy-${version}`, new Date(0).toISOString(), version === '0031' ? 'tampered' : checksum);
    expect(() => new SchemaMigrationRunner(tampered, [migration_0015], { readonly: true }).run({ dryRun: true })).toThrow('migration_checksum_mismatch:0001');
    tampered.close();
  });

  test('normalizes the complete pre-source-bound development receipt profile', () => {
    const profile = LEGACY_MIGRATION_RECEIPT_PROFILES.pre_source_bound_manifest_0048!;
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    const insert = db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`);
    for (const [version, checksum] of Object.entries(profile)) insert.run(version, `development-${version}`, new Date(0).toISOString(), checksum);
    expect(() => new SchemaMigrationRunner(db, [migration_0015]).run()).not.toThrow();
    const rows = db.prepare(`SELECT version,checksum FROM _schema_migrations`).all() as Array<{ version: string; checksum: string }>;
    expect(rows.every((row) => row.checksum === MIGRATION_DIGESTS[row.version])).toBe(true);
    db.close();
  });

  test('migration manifest is bound to normalized checked-in source content', () => {
    const directory = join(import.meta.dir, '..', 'src', 'migrations');
    const files = readdirSync(directory).filter((file) => /^\d{4}_.*\.ts$/u.test(file)).sort();
    const versions = files.map((file) => file.slice(0, 4));
    expect(Object.keys(MIGRATION_DIGESTS).sort()).toEqual(versions);
    for (const file of files) {
      const version = file.slice(0, 4);
      const sourceDigest = createHash('sha256').update(readFileSync(join(directory, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
      expect(CANONICAL_MIGRATION_SOURCE_DIGESTS[version]).toBe(sourceDigest);
      expect(MIGRATION_DIGESTS[version]).toBe(sourceDigest);
    }
  });

  test('historical 0049 identity dependencies remain frozen', () => {
    const root = join(import.meta.dir, '..', 'src');
    const digest = (path: string) => createHash('sha256').update(readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
    expect(digest('engine/CognitiveGraphIdentity.ts')).toBe(FROZEN_MIGRATION_DEPENDENCY_DIGESTS['0049:CognitiveGraphIdentity']);
    expect(digest('topology/TimeBucketIdentity.ts')).toBe(FROZEN_MIGRATION_DEPENDENCY_DIGESTS['0049:TimeBucketIdentity']);
  });

  test('0053 freezes cognitive identity inside the migration source', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'migrations', '0053_topology_privacy_and_recovery.ts'), 'utf8');
    expect(source).not.toContain(`from '../engine/CognitiveGraphIdentity.js'`);
    expect(source).toContain('function cognitiveNodeId(');
    expect(source).toContain('function cognitiveEdgeId(');
  });

  test('rejects missing checksums after checksum normalization', () => {
    for (const [version, checksum] of [['0001', null], ['0046', ''], ['0049', null], ['0050', '']] as const) {
      const db = new Database(':memory:');
      db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
      db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`).run('0046', 'checksum normalization', new Date(0).toISOString(), version === '0046' ? checksum : MIGRATION_DIGESTS['0046']);
      if (version !== '0046') db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`).run(version, `migration-${version}`, new Date(0).toISOString(), checksum);
      expect(() => new SchemaMigrationRunner(db, [migration_0015], { readonly: true }).run({ dryRun: true })).toThrow(`migration_checksum_missing:${version}`);
      db.close();
    }
  });

  test('permits legacy null receipts only before checksum normalization', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,NULL)`).run('0015', 'legacy pre-checksum receipt', new Date(0).toISOString());
    expect(() => new SchemaMigrationRunner(db, [migration_0015], { readonly: true }).run({ dryRun: true })).not.toThrow();
    db.close();
  });

  test('0046 normalizes early receipts even when a Kernel runner uses a migration subset', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,NULL)`).run('0001', 'legacy early receipt', new Date(0).toISOString());
    const result = new SchemaMigrationRunner(db, [migration_0046]).run();
    expect(result.applied).toEqual(['0046']);
    expect(db.prepare(`SELECT checksum FROM _schema_migrations WHERE version='0001'`).get()).toEqual({ checksum: MIGRATION_DIGESTS['0001'] });
    db.close();
  });

  test('rejects a self-signed description checksum outside a complete audited profile', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    const description = 'attacker-selected-description';
    const checksum = createHash('sha256').update(`0001\0${description}`).digest('hex');
    db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`).run('0001', description, new Date(0).toISOString(), checksum);
    expect(() => new SchemaMigrationRunner(db, [migration_0015], { readonly: true }).run({ dryRun: true })).toThrow('migration_checksum_mismatch:0001');
    db.close();
  });

  test('0049 splits shared topology and cognitive graph identities by project', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE time_buckets(bucket_id TEXT PRIMARY KEY,bucket_type TEXT,bucket_start INTEGER,bucket_end INTEGER,label TEXT);
      CREATE TABLE time_bucket_entries(bucket_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,project_id TEXT,created_at INTEGER);
      INSERT INTO time_buckets VALUES('day:100','day',100,200,'day');
      INSERT INTO time_bucket_entries VALUES('day:100','na',NULL,NULL,NULL,NULL,'a',100),('day:100','nb',NULL,NULL,NULL,NULL,'b',100);
      CREATE TABLE cognitive_nodes(node_id TEXT PRIMARY KEY,node_type TEXT,node_key TEXT,title TEXT,project_id TEXT,source_neuron_id TEXT,metadata_json TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE cognitive_edges(edge_id TEXT PRIMARY KEY,source_node_id TEXT,target_node_id TEXT,edge_type TEXT,weight REAL,project_id TEXT,metadata_json TEXT,created_at INTEGER);
      INSERT INTO cognitive_nodes VALUES
        ('shared','entity','same','Same','a',NULL,NULL,100,100),
        ('a-event','event','a-event','A event','a',NULL,NULL,100,100),
        ('b-event','event','b-event','B event','b',NULL,NULL,100,100),
        ('old-time','time_bucket','time_bucket:day:100','Day','a',NULL,NULL,100,100);
      INSERT INTO cognitive_edges VALUES
        ('ea','a-event','shared','mentions_entity',1,'a',NULL,100),
        ('eb','b-event','shared','mentions_entity',1,'b',NULL,100),
        ('et','a-event','old-time','occurred_in_time_bucket',1,'a',NULL,100);
    `);

    migration_0049.up(db);

    const shared = db.prepare(`SELECT project_id,node_id FROM cognitive_nodes WHERE node_type='entity' AND node_key='same' ORDER BY project_id`).all() as Array<{ project_id: string; node_id: string }>;
    expect(shared.map((row) => row.project_id)).toEqual(['a', 'b']);
    expect(new Set(shared.map((row) => row.node_id)).size).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM cognitive_edges WHERE edge_type='mentions_entity'`).get()).toEqual({ count: 2 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM cognitive_nodes WHERE node_type='time_bucket'`).get()).toEqual({ count: 0 });
    const buckets = db.prepare(`SELECT project_id,bucket_id FROM time_buckets ORDER BY project_id`).all() as Array<{ project_id: string; bucket_id: string }>;
    expect(buckets.map((row) => row.project_id)).toEqual(['a', 'b']);
    expect(new Set(buckets.map((row) => row.bucket_id)).size).toBe(2);
    db.close();
  });

  test('0052 scopes task and event cluster identity and deduplicates nullable entries', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT,task_key TEXT UNIQUE,title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE task_branch_entries(task_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
      CREATE TABLE event_clusters(cluster_id TEXT PRIMARY KEY,project_id TEXT,cluster_key TEXT UNIQUE,cluster_type TEXT,title TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE event_cluster_entries(cluster_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
      CREATE TABLE topology_membership(neuron_id TEXT,project_id TEXT,dimension_type TEXT,dimension_key TEXT,title TEXT,created_at INTEGER,UNIQUE(neuron_id,dimension_type,dimension_key));
      CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,content TEXT,created_at INTEGER,is_deleted INTEGER DEFAULT 0);
      INSERT INTO neurons VALUES('np','p','p',1,0),('nq','q','q',2,0);
      INSERT INTO task_branches VALUES('tp','p','p:same-task','Same task','active',1,1),('tq','q','q:same-task','Same task','active',2,2);
      INSERT INTO task_branch_entries VALUES('tp','np',NULL,NULL,NULL,NULL,1),('tp','np',NULL,NULL,NULL,NULL,2),('tq','nq',NULL,NULL,NULL,NULL,2);
      INSERT INTO event_clusters VALUES('cp','p','p:generic:same','generic','Same cluster',1,1),('cq','q','q:generic:same','generic','Same cluster',2,2);
      INSERT INTO event_cluster_entries VALUES('cp','np',NULL,NULL,NULL,NULL,1),('cp','np',NULL,NULL,NULL,NULL,2),('cq','nq',NULL,NULL,NULL,NULL,2);
    `);

    migration_0052.up(db);

    expect(db.prepare(`SELECT project_id,task_key FROM task_branches ORDER BY project_id`).all()).toEqual([
      { project_id: 'p', task_key: 'same-task' },
      { project_id: 'q', task_key: 'same-task' },
    ]);
    expect(db.prepare(`SELECT project_id,cluster_key FROM event_clusters ORDER BY project_id`).all()).toEqual([
      { project_id: 'p', cluster_key: 'generic:same' },
      { project_id: 'q', cluster_key: 'generic:same' },
    ]);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM task_branch_entries`).get()).toEqual({ count: 2 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM event_cluster_entries`).get()).toEqual({ count: 2 });
    expect(() => db.prepare(`INSERT INTO task_branches VALUES('duplicate','p','same-task','Duplicate','active',3,3)`).run()).toThrow();
    db.close();
  });

  test('0053 splits both historical write orders for projectless and literal global identities', () => {
    for (const parentScope of [null, 'global'] as const) {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,content TEXT,created_at INTEGER,is_deleted INTEGER DEFAULT 0);
        CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT,task_key TEXT UNIQUE,title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
        CREATE TABLE task_branch_entries(task_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
        CREATE TABLE event_clusters(cluster_id TEXT PRIMARY KEY,project_id TEXT,cluster_key TEXT UNIQUE,cluster_type TEXT,title TEXT,created_at INTEGER,updated_at INTEGER);
        CREATE TABLE event_cluster_entries(cluster_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
        CREATE TABLE topology_membership(neuron_id TEXT,project_id TEXT,dimension_type TEXT,dimension_key TEXT,title TEXT,created_at INTEGER,UNIQUE(neuron_id,dimension_type,dimension_key));
        CREATE TABLE cognitive_nodes(node_id TEXT PRIMARY KEY,node_type TEXT,node_key TEXT,title TEXT,project_id TEXT,source_neuron_id TEXT,metadata_json TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(project_id,node_type,node_key));
        CREATE TABLE cognitive_edges(edge_id TEXT PRIMARY KEY,source_node_id TEXT,target_node_id TEXT,edge_type TEXT,weight REAL,project_id TEXT,metadata_json TEXT,created_at INTEGER,UNIQUE(project_id,source_node_id,target_node_id,edge_type));
        INSERT INTO neurons VALUES('n-projectless',NULL,'projectless',1,0),('n-literal','global','literal global',2,0);
      `);
      db.prepare(`INSERT INTO task_branches VALUES('shared-task',?,'global:same-task','Same','active',1,2)`).run(parentScope);
      db.prepare(`INSERT INTO event_clusters VALUES('shared-cluster',?,'global:generic:same','generic','Same',1,2)`).run(parentScope);
      for (const [id, at] of [['n-projectless', 1], ['n-literal', 2]] as const) {
        db.prepare(`INSERT INTO task_branch_entries VALUES('shared-task',?,NULL,NULL,NULL,NULL,?)`).run(id, at);
        db.prepare(`INSERT INTO event_cluster_entries VALUES('shared-cluster',?,NULL,NULL,NULL,NULL,?)`).run(id, at);
      }

      migration_0052.up(db);
      migration_0053.up(db);

      expect(db.prepare(`SELECT project_id,task_key FROM task_branches ORDER BY project_id`).all()).toEqual([
        { project_id: '', task_key: 'same-task' }, { project_id: 'global', task_key: 'same-task' },
      ]);
      expect(db.prepare(`SELECT t.project_id,e.neuron_id FROM task_branch_entries e JOIN task_branches t ON t.task_id=e.task_id ORDER BY t.project_id`).all()).toEqual([
        { project_id: '', neuron_id: 'n-projectless' }, { project_id: 'global', neuron_id: 'n-literal' },
      ]);
      expect(db.prepare(`SELECT c.project_id,e.neuron_id FROM event_cluster_entries e JOIN event_clusters c ON c.cluster_id=e.cluster_id ORDER BY c.project_id`).all()).toEqual([
        { project_id: '', neuron_id: 'n-projectless' }, { project_id: 'global', neuron_id: 'n-literal' },
      ]);
      expect(db.prepare(`SELECT project_id,COUNT(*) AS count FROM topology_membership GROUP BY project_id ORDER BY project_id`).all()).toEqual([
        { project_id: '', count: 2 }, { project_id: 'global', count: 2 },
      ]);
      expect(db.prepare(`SELECT project_id,edge_type,COUNT(*) AS count FROM cognitive_edges GROUP BY project_id,edge_type ORDER BY project_id,edge_type`).all()).toEqual([
        { project_id: '', edge_type: 'belongs_to_event_cluster', count: 1 },
        { project_id: '', edge_type: 'belongs_to_task', count: 1 },
        { project_id: 'global', edge_type: 'belongs_to_event_cluster', count: 1 },
        { project_id: 'global', edge_type: 'belongs_to_task', count: 1 },
      ]);
      db.close();
    }
  });

  test('old and temporary 0052 receipts both upgrade through idempotent 0053', () => {
    for (const checksum of [
      'f1130413c964d2b6ec853dc43a1b5bb1d3a888b8942922befb9bcfd7880fc021',
      'e5739079601e1dc3627e2f06beeaed3f1413f01431a637add4018bc1acdaf6a3',
    ]) {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,content TEXT,created_at INTEGER,is_deleted INTEGER DEFAULT 0);
        CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',task_key TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(project_id,task_key));
        CREATE TABLE task_branch_entries(task_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
        CREATE UNIQUE INDEX idx_task_branch_entries_reference_unique ON task_branch_entries(task_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
        CREATE TABLE event_clusters(cluster_id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',cluster_key TEXT NOT NULL,cluster_type TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(project_id,cluster_key));
        CREATE TABLE event_cluster_entries(cluster_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
        CREATE UNIQUE INDEX idx_event_cluster_entries_reference_unique ON event_cluster_entries(cluster_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
        CREATE TABLE topology_membership(neuron_id TEXT,project_id TEXT,dimension_type TEXT,dimension_key TEXT,title TEXT,created_at INTEGER,UNIQUE(neuron_id,dimension_type,dimension_key));
        CREATE TABLE _schema_migrations(version TEXT PRIMARY KEY,description TEXT NOT NULL,applied_at TEXT NOT NULL,checksum TEXT);
      `);
      db.prepare(`INSERT INTO _schema_migrations VALUES('0052','temporary or stable','2026-01-01',?)`).run(checksum);
      const runner = new SchemaMigrationRunner(db, [migration_0052, migration_0053]);
      expect(runner.run().applied).toEqual(['0053']);
      expect(runner.run().applied).toEqual([]);
      expect(db.prepare(`SELECT checksum FROM _schema_migrations WHERE version='0052'`).get()).toEqual({ checksum });
      expect(db.prepare(`SELECT version FROM _schema_migrations ORDER BY version`).all()).toEqual([{ version: '0052' }, { version: '0053' }]);
      db.close();
    }
  });

  test('0053 quarantines deleted and cross-project provenance without reviving cognitive content', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,content TEXT,created_at INTEGER,is_deleted INTEGER DEFAULT 0);
      CREATE TABLE facts(fact_id TEXT PRIMARY KEY,neuron_id TEXT);
      CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT,task_key TEXT UNIQUE,title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE task_branch_entries(task_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
      CREATE TABLE event_clusters(cluster_id TEXT PRIMARY KEY,project_id TEXT,cluster_key TEXT UNIQUE,cluster_type TEXT,title TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE event_cluster_entries(cluster_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
      CREATE TABLE topology_membership(neuron_id TEXT,project_id TEXT,dimension_type TEXT,dimension_key TEXT,title TEXT,created_at INTEGER,UNIQUE(neuron_id,dimension_type,dimension_key));
      CREATE TABLE cognitive_nodes(node_id TEXT PRIMARY KEY,node_type TEXT,node_key TEXT,title TEXT,project_id TEXT,source_neuron_id TEXT,metadata_json TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(project_id,node_type,node_key));
      CREATE TABLE cognitive_edges(edge_id TEXT PRIMARY KEY,source_node_id TEXT,target_node_id TEXT,edge_type TEXT,weight REAL,project_id TEXT,metadata_json TEXT,created_at INTEGER,UNIQUE(project_id,source_node_id,target_node_id,edge_type));
      INSERT INTO neurons VALUES('live-a','a','live a',1,0),('live-b','b','live b',2,0),('deleted-a','a','DELETED_SECRET',3,1);
      INSERT INTO facts VALUES('fact-b','live-b');
      INSERT INTO task_branches VALUES('task','a','a:task','Task','active',1,1);
      INSERT INTO task_branch_entries VALUES('task','live-a',NULL,NULL,NULL,NULL,1),('task','live-a',NULL,NULL,'fact-b',NULL,2),('task','deleted-a',NULL,NULL,NULL,NULL,3);
      INSERT INTO cognitive_nodes VALUES('deleted-node','neuron','neuron:deleted-a','DELETED_SECRET','a','deleted-a','{}',3,3);
    `);

    migration_0053.up(db);

    expect(db.prepare(`SELECT neuron_id FROM task_branch_entries`).all()).toEqual([{ neuron_id: 'live-a' }]);
    expect(db.prepare(`SELECT reason FROM topology_identity_quarantine ORDER BY reason`).all()).toEqual([
      { reason: 'entry_project_scope_conflict' },
      { reason: 'entry_references_deleted_neuron' },
    ]);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM cognitive_nodes WHERE title LIKE '%DELETED_SECRET%' OR source_neuron_id='deleted-a'`).get()).toEqual({ count: 0 });
    db.close();
  });
});
