import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SchemaMigrationRunner } from '../src/migrations/SchemaMigrationRunner.js';
import { migration_0015 } from '../src/migrations/0015_memory_governance.js';
import { migration_0049 } from '../src/migrations/0049_project_scoped_graph_identity.js';
import { migration_0046 } from '../src/migrations/0046_stable_migration_checksums.js';
import { migration_0052 } from '../src/migrations/0052_project_scoped_topology_identity.js';
import { migration_0053 } from '../src/migrations/0053_topology_privacy_and_recovery.js';
import { migration_0054, topologyIntegritySatisfied } from '../src/migrations/0054_topology_semantic_integrity.js';
import { migration_0055, topologyFinalizationSatisfied } from '../src/migrations/0055_topology_scope_finalization.js';
import { migration_0056 } from '../src/migrations/0056_project_isolation_finalization.js';
import { migration_0057, projectIsolationCompensationSatisfied } from '../src/migrations/0057_project_isolation_compensation.js';
import { migration_0059, projectExecutionAndProvenanceGuardsSatisfied } from '../src/migrations/0059_project_execution_and_provenance_guards.js';
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

  test('rejects the destructive temporary 0057 receipt with an explicit recovery path', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);`);
    db.prepare(`INSERT INTO _schema_migrations VALUES (?,?,?,?)`).run(
      '0057',
      'destructive development migration',
      new Date(0).toISOString(),
      '8dbcc0843afc4dbafe63d4e82585323db52d69d1a34fc4611aa8c14c263171d9',
    );
    expect(() => new SchemaMigrationRunner(db, [migration_0059], { readonly: true }).run({ dryRun: true }))
      .toThrow('migration_recovery_required:0057:restore_pre_0057_backup');
    db.close();
  });

  test('0059 quarantines unscoped policy rows and preserves deleted-context privacy scope', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE policy_executions(
        execution_id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE,policy TEXT,action TEXT,status TEXT,
        attempt_count INTEGER,detail TEXT,created_at INTEGER,updated_at INTEGER
      );
      INSERT INTO policy_executions VALUES('old','same','p','allow','executed',1,'OLD_SECRET',1,1);
      CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,is_deleted INTEGER);
      INSERT INTO neurons VALUES('deleted-a','a',1);
      CREATE TABLE pending_entity_resolution_quarantine(
        pending_id TEXT PRIMARY KEY,record_json TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL
      );
      INSERT INTO pending_entity_resolution_quarantine VALUES
        ('known','{"pending_id":"known","context_neuron_id":"deleted-a","reference_text":"KNOWN_SECRET"}','pending_context_unproven',1),
        ('unknown','{"pending_id":"unknown","reference_text":"UNKNOWN_SECRET"}','pending_context_unproven',1);
    `);

    migration_0059.up(db);

    expect(projectExecutionAndProvenanceGuardsSatisfied(db)).toBe(true);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM policy_executions`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT execution_id,reason FROM policy_execution_quarantine`).get()).toEqual({
      execution_id: 'old', reason: 'project_scope_unproven',
    });
    expect(db.prepare(`SELECT project_scope,implicated_scopes_json,context_neuron_id,scope_resolved
      FROM pending_entity_resolution_quarantine WHERE pending_id='known'`).get()).toEqual({
      project_scope: 'a', implicated_scopes_json: '["a"]', context_neuron_id: 'deleted-a', scope_resolved: 1,
    });
    const unknown = db.prepare(`SELECT record_json,scope_resolved FROM pending_entity_resolution_quarantine WHERE pending_id='unknown'`).get() as {
      record_json: string; scope_resolved: number;
    };
    expect(unknown.scope_resolved).toBe(0);
    expect(unknown.record_json).not.toContain('UNKNOWN_SECRET');
    db.close();
  });

  test('0059 removes unresolved projections and enforces synapse scope at the database boundary', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,is_deleted INTEGER);
      INSERT INTO neurons VALUES('a','a',0),('b','b',0);
      CREATE TABLE synapses(
        source_id TEXT,target_id TEXT,project_id TEXT NOT NULL DEFAULT '',type TEXT,weight REAL,
        created_at INTEGER,updated_at INTEGER,PRIMARY KEY(source_id,target_id,type)
      );
      INSERT INTO synapses VALUES('a','b','a','related',1,1,1);
      CREATE TABLE task_identity_restoration_manifest(
        task_id TEXT PRIMARY KEY,project_id TEXT,task_key TEXT,title TEXT,status TEXT,source TEXT,
        recorded_at INTEGER,recovery_status TEXT
      );
      INSERT INTO task_identity_restoration_manifest VALUES('task','a','secret-task','Secret','active','unknown',1,'unresolved');
      CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT,task_key TEXT,title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
      INSERT INTO task_branches VALUES('task','a','secret-task','Secret','active',1,1);
      CREATE TABLE task_branch_entries(task_id TEXT,project_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
      INSERT INTO task_branch_entries VALUES('task','a','a',NULL,NULL,NULL,NULL,1);
      CREATE TABLE topology_membership(neuron_id TEXT,project_id TEXT,dimension_type TEXT,dimension_key TEXT,title TEXT,created_at INTEGER);
      INSERT INTO topology_membership VALUES('a','a','task_branch','secret-task','Secret',1);
      CREATE TABLE cognitive_nodes(
        node_id TEXT PRIMARY KEY,node_type TEXT,node_key TEXT,title TEXT,project_id TEXT,source_neuron_id TEXT,
        metadata_json TEXT,created_at INTEGER,updated_at INTEGER
      );
      CREATE TABLE cognitive_edges(
        edge_id TEXT PRIMARY KEY,source_node_id TEXT,target_node_id TEXT,edge_type TEXT,weight REAL,
        project_id TEXT,metadata_json TEXT,created_at INTEGER
      );
      INSERT INTO cognitive_nodes VALUES('task-node','task_branch','secret-task','Secret','a',NULL,'{}',1,1);
    `);

    migration_0059.up(db);

    expect(projectExecutionAndProvenanceGuardsSatisfied(db)).toBe(true);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM task_branches`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM task_branch_entries`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM topology_membership`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM cognitive_nodes`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM synapses`).get()).toEqual({ count: 0 });
    expect(() => db.prepare(`INSERT INTO synapses VALUES('a','b','a','related',1,1,1)`).run())
      .toThrow('project_scope_mismatch');
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

  test('0054 restores canonical cluster keys and quarantines every dangling or conflicting provenance', () => {
    for (const projectId of ['generic', 'issue', 'project', 'fact', 'approval', 'rejection']) {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,content TEXT,created_at INTEGER,is_deleted INTEGER DEFAULT 0);
        CREATE TABLE facts(fact_id TEXT PRIMARY KEY,neuron_id TEXT);
        CREATE TABLE compiled_events(event_id TEXT PRIMARY KEY,neuron_id TEXT);
        CREATE TABLE memory_events(event_id TEXT PRIMARY KEY,project_id TEXT);
        CREATE TABLE interaction_units(unit_id TEXT PRIMARY KEY,message_neuron_ids_json TEXT);
        CREATE TABLE beliefs(id TEXT PRIMARY KEY,project_id TEXT,source_neuron_id TEXT);
        CREATE TABLE belief_evidence(belief_id TEXT,neuron_id TEXT,event_id TEXT);
        CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,task_key TEXT,title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(project_id,task_key));
        CREATE TABLE task_branch_entries(task_id TEXT,project_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
        CREATE UNIQUE INDEX idx_task_branch_entries_reference_unique ON task_branch_entries(task_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
        CREATE TABLE event_clusters(cluster_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,cluster_key TEXT,cluster_type TEXT,title TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(project_id,cluster_key));
        CREATE TABLE event_cluster_entries(cluster_id TEXT,project_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
        CREATE UNIQUE INDEX idx_event_cluster_entries_reference_unique ON event_cluster_entries(cluster_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
        CREATE TABLE branch_entries(branch_id TEXT,project_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
        CREATE TABLE topology_identity_quarantine(quarantine_id TEXT PRIMARY KEY,identity_type TEXT,old_parent_id TEXT,project_scope TEXT,entry_json TEXT,reason TEXT,created_at INTEGER);
        CREATE TABLE topology_membership(neuron_id TEXT,project_id TEXT,dimension_type TEXT,dimension_key TEXT,title TEXT,created_at INTEGER,UNIQUE(neuron_id,dimension_type,dimension_key));
        CREATE TABLE cognitive_nodes(node_id TEXT PRIMARY KEY,node_type TEXT,node_key TEXT,title TEXT,project_id TEXT,source_neuron_id TEXT,metadata_json TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(project_id,node_type,node_key));
        CREATE TABLE cognitive_edges(edge_id TEXT PRIMARY KEY,source_node_id TEXT,target_node_id TEXT,edge_type TEXT,weight REAL,project_id TEXT,metadata_json TEXT,created_at INTEGER,UNIQUE(project_id,source_node_id,target_node_id,edge_type));
      `);
      db.prepare(`INSERT INTO neurons VALUES(?,?,?,?,0),(?,?,?,?,0)`).run('a', projectId, `${projectId} own title`, 1, 'b', 'other', 'OTHER_PRIVATE_TITLE', 2);
      db.prepare(`INSERT INTO event_clusters VALUES('cluster',?,?,?,'LEAKED_TITLE',1,1)`).run(projectId, 'cogmem', projectId);
      db.prepare(`INSERT INTO event_cluster_entries VALUES('cluster',?,'a',NULL,NULL,NULL,NULL,1)`).run(projectId);
      db.prepare(`INSERT INTO task_branches VALUES('task',?,'task','LEAKED_TITLE','active',1,1)`).run(projectId);
      db.prepare(`INSERT INTO task_branch_entries VALUES('task',?,'a',NULL,NULL,NULL,NULL,1),('task',?,'a',NULL,NULL,'missing-fact',NULL,2)`).run(projectId, projectId);
      db.prepare(`INSERT INTO beliefs VALUES('belief',?,'a')`).run(projectId);
      db.exec(`INSERT INTO belief_evidence VALUES('belief','b',NULL); INSERT INTO task_branch_entries VALUES('task','',NULL,NULL,'belief',NULL,NULL,3)`);

      migration_0054.up(db);
      expect(db.prepare(`SELECT cluster_key,title FROM event_clusters`).get()).toEqual({ cluster_key: `${projectId}:cogmem`, title: `${projectId} own title` });
      expect(db.prepare(`SELECT title,status FROM task_branches`).get()).toEqual({ title: `${projectId} own title`, status: 'derived' });
      expect(db.prepare(`SELECT reason FROM topology_identity_quarantine ORDER BY reason`).all()).toEqual([
        { reason: 'entry_project_scope_conflict' }, { reason: 'entry_reference_dangling' },
      ]);
      expect(topologyIntegritySatisfied(db)).toBe(true);
      migration_0054.up(db);
      expect(topologyIntegritySatisfied(db)).toBe(true);
      db.close();
    }
  });

  test('0055 restores pre-0052 task identity without rewriting clean metadata', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,content TEXT,created_at INTEGER,is_deleted INTEGER DEFAULT 0);
      CREATE TABLE facts(fact_id TEXT PRIMARY KEY,neuron_id TEXT,predicate_family TEXT,object_value TEXT);
      CREATE TABLE compiled_events(event_id TEXT PRIMARY KEY,neuron_id TEXT);
      CREATE TABLE memory_events(event_id TEXT PRIMARY KEY,project_id TEXT,parent_event_id TEXT,prev_event_id TEXT,next_event_id TEXT);
      CREATE TABLE interaction_units(unit_id TEXT PRIMARY KEY,type TEXT,semantic_text TEXT,message_neuron_ids_json TEXT);
      CREATE TABLE beliefs(id TEXT PRIMARY KEY,project_id TEXT,source_neuron_id TEXT,predicate TEXT);
      CREATE TABLE belief_evidence(belief_id TEXT,neuron_id TEXT,event_id TEXT);
      CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT,task_key TEXT UNIQUE,title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE task_branch_entries(task_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
      CREATE TABLE event_clusters(cluster_id TEXT PRIMARY KEY,project_id TEXT,cluster_key TEXT UNIQUE,cluster_type TEXT,title TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE event_cluster_entries(cluster_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
      CREATE TABLE project_branches(branch_id TEXT PRIMARY KEY,project_id TEXT,branch_key TEXT,title TEXT);
      CREATE TABLE branch_entries(branch_id TEXT,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER);
      CREATE TABLE branch_links(parent_branch_id TEXT,child_branch_id TEXT,relation_type TEXT,created_at INTEGER,UNIQUE(parent_branch_id,child_branch_id,relation_type));
      CREATE TABLE topology_membership(neuron_id TEXT,project_id TEXT,dimension_type TEXT,dimension_key TEXT,title TEXT,created_at INTEGER,UNIQUE(neuron_id,dimension_type,dimension_key));
      CREATE TABLE cognitive_nodes(node_id TEXT PRIMARY KEY,node_type TEXT,node_key TEXT,title TEXT,project_id TEXT,source_neuron_id TEXT,metadata_json TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(project_id,node_type,node_key));
      CREATE TABLE cognitive_edges(edge_id TEXT PRIMARY KEY,source_node_id TEXT,target_node_id TEXT,edge_type TEXT,weight REAL,project_id TEXT,metadata_json TEXT,created_at INTEGER,UNIQUE(project_id,source_node_id,target_node_id,edge_type));
      INSERT INTO neurons VALUES('n','issue','issue printer',1,0);
      INSERT INTO facts VALUES('f','n','has_issue','printer');
      INSERT INTO task_branches VALUES('prefixed','issue','issue:printer','CUSTOM_PREFIXED','active',1,1),('plain','issue','printer','CUSTOM_PLAIN','completed',2,2);
      INSERT INTO task_branch_entries VALUES('prefixed','n',NULL,NULL,'f',NULL,1),('plain','n',NULL,NULL,NULL,NULL,2);
    `);
    const runner = new SchemaMigrationRunner(db, [migration_0052, migration_0053, migration_0054, migration_0055]);
    expect(runner.run().applied).toEqual(['0052','0053','0054','0055']);
    expect(db.prepare(`SELECT task_key,title,status FROM task_branches ORDER BY task_key`).all()).toEqual([
      { task_key: 'issue:printer', title: 'CUSTOM_PREFIXED', status: 'active' },
      { task_key: 'printer', title: 'CUSTOM_PLAIN', status: 'completed' },
    ]);
    expect(topologyFinalizationSatisfied(db)).toBe(true);
    expect(runner.run().applied).toEqual([]);
    db.close();
  });

  test('0056 persists a recovery manifest when reopening an already-closed 0055 database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-0056-reopen-'));
    const path = join(dir, 'memory.db');
    const before = new Database(path);
    before.exec(`CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT,task_key TEXT,title TEXT,status TEXT); INSERT INTO task_branches VALUES('damaged','a','derived','derived','derived')`);
    before.close();
    const db = new Database(path);
    migration_0056.up(db);
    expect(db.prepare(`SELECT task_key,title,status,source FROM task_identity_restoration_manifest WHERE task_id='damaged'`).get()).toEqual({
      task_key: 'derived', title: 'derived', status: 'derived', source: 'persisted_0055_state',
    });
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('0057 compensates a closed 0056 database without certifying persisted task state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-0057-reopen-'));
    const path = join(dir, 'memory.db');
    const before = new Database(path);
    before.exec(`
      CREATE TABLE task_branches(task_id TEXT PRIMARY KEY,project_id TEXT,task_key TEXT,title TEXT,status TEXT);
      INSERT INTO task_branches VALUES('damaged','a','derived','derived','derived');
      CREATE TABLE neurons(id TEXT PRIMARY KEY,project_id TEXT,is_deleted INTEGER NOT NULL DEFAULT 0);
      INSERT INTO neurons VALUES('n-a','a',0);
      CREATE TABLE ingestion_source_cursors(source_id TEXT PRIMARY KEY,source_path TEXT NOT NULL,source_type TEXT NOT NULL,project_id TEXT,enabled INTEGER NOT NULL,last_processed_at INTEGER,last_seen_hash TEXT,last_seen_mtime INTEGER,content_window_start INTEGER,content_window_end INTEGER,updated_at INTEGER NOT NULL);
      INSERT INTO ingestion_source_cursors VALUES('same','/a','conversation_markdown','a',1,1,'h',1,0,1,1);
      CREATE TABLE ingestion_processed_records(record_hash TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_path TEXT NOT NULL,source_type TEXT NOT NULL,content_hash TEXT NOT NULL,content_window_start INTEGER NOT NULL,content_window_end INTEGER NOT NULL,processed_at INTEGER NOT NULL,neuron_id TEXT);
      INSERT INTO ingestion_processed_records VALUES('hash','same','/a','conversation_markdown','h',0,1,1,'n-a');
      CREATE TABLE memory_entities(entity_id TEXT PRIMARY KEY,project_id TEXT,canonical_name TEXT NOT NULL,entity_type TEXT NOT NULL,aliases_json TEXT NOT NULL,stable_path TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      INSERT INTO memory_entities VALUES('entity-a','a','Printer','device','["Office Printer"]','PROJECT/a/printer',1,1);
    `);
    migration_0056.up(before);
    before.exec(`CREATE TABLE _schema_migrations(version TEXT PRIMARY KEY,description TEXT NOT NULL,applied_at TEXT NOT NULL,checksum TEXT)`);
    before.prepare(`INSERT INTO _schema_migrations VALUES('0056','legacy 0056',?,?)`)
      .run(new Date(0).toISOString(), '829f09b056bf7384a65908e8dd066691e0ec1538324d37e6aed344a03b0253eb');
    before.close();

    const after = new Database(path);
    expect(new SchemaMigrationRunner(after, [migration_0056, migration_0057]).run().applied).toEqual(['0057']);
    expect(after.prepare(`SELECT recovery_status FROM task_identity_restoration_manifest WHERE task_id='damaged'`).get()).toEqual({ recovery_status: 'unresolved' });
    expect(after.prepare(`SELECT reason FROM task_identity_recovery_quarantine WHERE task_id='damaged'`).get()).toEqual({ reason: 'original_task_identity_unproven' });
    expect(after.prepare(`SELECT project_scope,source_id FROM ingestion_source_cursors`).get()).toEqual({ project_scope: 'a', source_id: 'same' });
    expect(after.prepare(`SELECT project_scope,source_id,record_hash FROM ingestion_processed_records`).get()).toEqual({ project_scope: 'a', source_id: 'same', record_hash: 'hash' });
    expect(after.prepare(`SELECT aliases_json,stable_path FROM memory_entities`).get()).toEqual({
      aliases_json: '["Office Printer"]', stable_path: 'PROJECT/a/printer',
    });
    expect(projectIsolationCompensationSatisfied(after)).toBe(true);
    after.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('0056 scopes supported entity data, rebuilds conflicts, and quarantines ambiguous aliases', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE topology_identity_quarantine(quarantine_id TEXT PRIMARY KEY,identity_type TEXT,old_parent_id TEXT,project_scope TEXT,entry_json TEXT,reason TEXT,created_at INTEGER,implicated_scopes_json TEXT);
      CREATE TABLE entity_instances(instance_id TEXT PRIMARY KEY,canonical_entity_id TEXT,canonical_name TEXT,type TEXT,status TEXT,aliases_json TEXT,metadata_json TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE entity_mentions(mention_id TEXT PRIMARY KEY,entity_id TEXT,project_id TEXT,neuron_id TEXT,created_at INTEGER);
      CREATE TABLE entity_aliases(alias_id TEXT PRIMARY KEY,entity_id TEXT,alias_text TEXT,normalized_alias TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE entity_relations(relation_id TEXT PRIMARY KEY,source_entity_id TEXT,target_entity_id TEXT,relation_type TEXT,source_neuron_id TEXT,created_at INTEGER);
      CREATE TABLE entity_alias_conflicts(conflict_id TEXT PRIMARY KEY);
      INSERT INTO entity_instances VALUES
        ('ea','ca','alpha','device','active','[]','{}',1,1),
        ('eb','cb','beta','device','active','[]','{}',1,1),
        ('shared','cs','shared','device','active','["private"]','{}',1,1);
      INSERT INTO entity_mentions VALUES
        ('ma','ea','a',NULL,1),('mb','eb','a',NULL,1),
        ('ms1','shared','a',NULL,1),('ms2','shared','b',NULL,1);
      INSERT INTO entity_aliases VALUES
        ('aa','ea','printer','printer',1,2),('ab','eb','printer','printer',1,2),
        ('ambiguous','shared','private','private',1,2);
      INSERT INTO entity_relations VALUES('ra','ea','eb','related_to',NULL,1);
    `);
    migration_0056.up(db);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM entity_aliases WHERE project_id='a'`).get()).toEqual({ count: 2 });
    expect(db.prepare(`SELECT entity_ids_json FROM entity_alias_conflicts WHERE project_id='a' AND normalized_alias='printer'`).get()).toBeDefined();
    expect(db.prepare(`SELECT reason FROM topology_identity_quarantine WHERE old_parent_id='ambiguous'`).get()).toEqual({ reason: 'entity_alias_scope_ambiguous' });
    expect(db.prepare(`SELECT project_id FROM entity_relations WHERE relation_type='related_to'`).get()).toEqual({ project_id: 'a' });
    db.close();
  });
});
