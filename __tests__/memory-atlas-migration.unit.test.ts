import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { createMemoryKernel } from '../src/factory.js';
import { memoryEdgeId, memoryEntityId } from '../src/binding/MemoryBindingIdentity.js';
import { installMultidimensionalMemoryGraph374 } from '../src/migrations/0032_multidimensional_memory_graph_3_7_4.js';
import { MIGRATION_DIGESTS } from '../src/migrations/MigrationDigestManifest.js';

const migrateBin = join(import.meta.dir, '..', 'src', 'bin', 'migrate.ts');
const fixturePath = join(import.meta.dir, 'fixtures', 'migrations', 'main-3.7.3-schema31.sqlite.gz');

async function migrate(dbPath: string, args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn({
    cmd: ['bun', migrateBin, '--db', dbPath, ...args, '--json'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function materializeFixture(directory: string): string {
  const dbPath = join(directory, 'memory.db');
  writeFileSync(dbPath, gunzipSync(readFileSync(fixturePath)));
  return dbPath;
}

type CanonicalEvidence = Record<string, {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}>;

function canonicalEvidence(db: Database, baseline?: CanonicalEvidence): CanonicalEvidence {
  const tables = [
    'memory_events',
    'neurons',
    'memory_episodes',
    'memory_episode_events',
    'episode_cross_refs',
    'episode_ingest_keys',
    'memory_bindings',
    'memory_entities',
    'memory_edges',
    'memory_action_frames',
    'memory_action_frame_evidence',
    'entities',
    'entity_instances',
    'entity_aliases',
    'entity_attributes',
    'entity_mentions',
    'entity_relations',
    'memory_topics',
    'topic_nodes',
    'topic_aliases',
    'topic_relations',
    'topic_operations',
    'facts',
    'beliefs',
    'belief_evidence',
    'deep_write_summaries',
    'prospective_memories',
    'prospective_memory_transitions',
    'anchors',
    'import_source_anchors',
    'project_branches',
    'branch_links',
    'branch_entries',
    'task_branches',
    'task_branch_entries',
    'event_clusters',
    'event_cluster_entries',
    'topology_membership',
    'cognitive_nodes',
    'cognitive_edges',
  ];
  return Object.fromEntries(tables.map((table) => {
    const columns = baseline?.[table]?.columns
      ?? (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name);
    const select = columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(',');
    const rows = (db.prepare(`SELECT ${select} FROM "${table}"`).all() as Array<Record<string, unknown>>)
      .map((row) => columns.includes('project_id') && row.project_id == null
        ? { ...row, project_id: '' }
        : row);
    return [table, {
      columns,
      rows: rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    }];
  }));
}

function schema(db: Database): unknown {
  return (db.prepare(`
    SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND name<>'_schema_migrations'
    ORDER BY type,name
  `).all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>)
    .map((row) => ({
      ...row,
      sql: row.sql?.replace(/\s+/gu, ' ').trim().toLowerCase() ?? null,
    }));
}

test('real main 3.7.3 schema 31 upgrades atomically through the sole 0032 release migration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-main-373-'));
  const dbPath = materializeFixture(directory);
  const before = new Database(dbPath);
  const evidence = canonicalEvidence(before);
  const receiptCount = (before.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations`).get() as { count: number }).count;
  before.close();

  const dryRun = await migrate(dbPath, ['--dry-run']);
  expect({ exitCode: dryRun.exitCode, stderr: dryRun.stderr }).toEqual({ exitCode: 0, stderr: '' });
  expect(JSON.parse(dryRun.stdout).pending).toEqual(['0032']);
  const afterDryRun = new Database(dbPath);
  expect(afterDryRun.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations`).get()).toEqual({ count: receiptCount });
  afterDryRun.close();

  const applied = await migrate(dbPath, ['--yes']);
  expect({ exitCode: applied.exitCode, stderr: applied.stderr }).toEqual({ exitCode: 0, stderr: '' });
  const result = JSON.parse(applied.stdout);
  expect(result.applied).toEqual(['0032']);
  expect(existsSync(result.backupPath)).toBe(true);

  const upgraded = new Database(dbPath);
  expect(canonicalEvidence(upgraded, evidence)).toEqual(evidence);
  expect(upgraded.prepare(`SELECT MAX(version) AS version FROM _schema_migrations`).get()).toEqual({ version: '0032' });
  expect(upgraded.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations WHERE version>'0032'`).get()).toEqual({ count: 0 });
  expect(upgraded.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_scope_quarantine'`).get()).toBeNull();
  expect(upgraded.prepare(`PRAGMA integrity_check`).get()).toEqual({ integrity_check: 'ok' });
  expect(upgraded.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  upgraded.close();

  createMemoryKernel({ dbPath, projectTimeZone: 'Asia/Tokyo' }).close();
  const repeated = await migrate(dbPath, ['--yes']);
  expect(JSON.parse(repeated.stdout).applied).toEqual([]);
  rmSync(directory, { recursive: true, force: true });
});

test('fresh and main-schema-31 upgrade paths produce the same runtime schema', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-schema-equivalence-'));
  const upgradedPath = materializeFixture(directory);
  const freshPath = join(directory, 'fresh.db');

  const applied = await migrate(upgradedPath, ['--yes']);
  expect(applied.exitCode).toBe(0);
  createMemoryKernel({ dbPath: upgradedPath, projectTimeZone: 'Asia/Tokyo' }).close();
  createMemoryKernel({ dbPath: freshPath, projectTimeZone: 'Asia/Tokyo' }).close();

  const upgraded = new Database(upgradedPath);
  const fresh = new Database(freshPath);
  expect(schema(upgraded)).toEqual(schema(fresh));
  expect(fresh.prepare(`
    SELECT version,checksum FROM _schema_migrations WHERE version='0032'
  `).get()).toEqual({ version: '0032', checksum: MIGRATION_DIGESTS['0032'] });
  upgraded.close();
  fresh.close();
  rmSync(directory, { recursive: true, force: true });
});

test('schema31 entity, edge, and non-temporal topology identities survive upgrade and repeated install', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-schema31-identities-'));
  const dbPath = materializeFixture(directory);
  const db = new Database(dbPath);
  const entityId = 'entity-schema31-project-a';
  const edgeId = memoryEdgeId({
    projectId: 'project-a',
    sourceType: 'entity',
    sourceId: entityId,
    relationType: 'belongs_to',
    targetType: 'topic',
    targetId: 'schema31/topic',
  });
  db.prepare(`
    INSERT INTO memory_entities(entity_id,project_id,canonical_name,entity_type,aliases_json,stable_path,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(entityId, 'project-a', 'Schema Entity', 'concept', '["Schema Alias"]', null, 1, 1);
  db.prepare(`
    INSERT INTO entities(entity_id,canonical_name,type,aliases_json,status,metadata_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).run('canonical-schema31', 'Schema Entity', 'concept', '["Schema Alias"]', 'active', '{}', 1, 1);
  db.prepare(`
    INSERT INTO entity_instances(
      instance_id,canonical_entity_id,canonical_name,type,aliases_json,status,metadata_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `).run(
    entityId, 'canonical-schema31', 'Schema Entity', 'concept', '["Schema Alias"]',
    'active', '{"projectId":"project-a"}', 1, 1,
  );
  db.prepare(`
    INSERT INTO memory_topics(topic_path,project_id,project_id_key,parent_path,topic_type,summary,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).run('schema31/topic', 'project-a', 'project-a', null, 'semantic', null, 1, 1);
  db.prepare(`
    INSERT INTO memory_bindings(
      binding_id,event_id,project_id,entity_id,entity_name,entity_type,topic_path,binding_type,
      confidence,source,signal,claim_key,binding_action,related_event_ids_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'binding-schema31-a', 'main-373-event-a', 'project-a', entityId, 'Schema Entity', 'concept',
    'schema31/topic', 'entity', 1, 'explicit', 'schema31', 'default', 'create_new_cluster', '[]', 1,
  );
  db.prepare(`
    INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,
      evidence_event_ids_json,status,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    edgeId, 'project-a', 'entity', entityId, 'belongs_to', 'topic', 'schema31/topic',
    1, '["main-373-event-a"]', 'active', 1,
  );
  db.prepare(`
    INSERT INTO memory_action_frames(
      action_id,project_id,frame_type,action,actor,target_entity_id,target_label,occurred_at,
      confidence,source_authority,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run('action-schema31', 'project-a', 'update', 'update', 'user', entityId, 'Schema Entity', 1, 1, 'raw_evidence', 1, 1);
  db.prepare(`
    INSERT INTO memory_action_frame_evidence(action_id,event_id,project_id,created_at)
    VALUES(?,?,?,?)
  `).run('action-schema31', 'main-373-event-a', 'project-a', 1);
  db.exec(`
    CREATE VIEW custom_schema31_entities AS SELECT entity_id FROM memory_entities;
    CREATE INDEX custom_schema31_entity_name ON memory_entities(canonical_name);
    CREATE TRIGGER custom_schema31_entity_audit AFTER UPDATE ON memory_entities BEGIN SELECT 1; END;
  `);
  const topologyBefore = canonicalEvidence(db);
  db.close();

  expect((await migrate(dbPath, ['--yes'])).exitCode).toBe(0);
  const upgraded = new Database(dbPath);
  expect(upgraded.prepare(`SELECT entity_id FROM memory_entities WHERE project_id='project-a'`).all())
    .toEqual([{ entity_id: entityId }]);
  expect(upgraded.prepare(`SELECT edge_id FROM memory_edges`).all()).toEqual([{ edge_id: edgeId }]);
  expect(upgraded.prepare(`SELECT COUNT(*) AS count FROM memory_action_frames`).get()).toEqual({ count: 0 });
  expect(upgraded.prepare(`
    SELECT name FROM sqlite_master
    WHERE name IN ('custom_schema31_entities','custom_schema31_entity_name','custom_schema31_entity_audit')
    ORDER BY name
  `).all()).toEqual([
    { name: 'custom_schema31_entities' },
    { name: 'custom_schema31_entity_audit' },
    { name: 'custom_schema31_entity_name' },
  ]);
  for (const table of [
    'project_branches', 'branch_links', 'branch_entries', 'task_branches',
    'task_branch_entries', 'event_clusters', 'event_cluster_entries',
    'topology_membership', 'cognitive_nodes', 'cognitive_edges',
  ]) {
    const before = topologyBefore[table]!;
    const columns = before.columns.map((column) => `"${column}"`).join(',');
    const rows = (upgraded.prepare(`SELECT ${columns} FROM "${table}"`).all() as Array<Record<string, unknown>>)
      .map((row) => before.columns.includes('project_id') && row.project_id == null
        ? { ...row, project_id: '' }
        : row);
    expect(rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(before.rows);
  }
  installMultidimensionalMemoryGraph374(upgraded);
  expect(upgraded.prepare(`SELECT entity_id FROM memory_entities WHERE project_id='project-a'`).all())
    .toEqual([{ entity_id: entityId }]);
  expect(upgraded.prepare(`SELECT edge_id FROM memory_edges`).all()).toEqual([{ edge_id: edgeId }]);
  upgraded.close();

  const kernel = createMemoryKernel({ dbPath, projectTimeZone: 'Asia/Tokyo' });
  const runtimeEntity = kernel.entityStore.findByCanonicalName('Schema Entity', 'concept', 'project-a');
  expect(runtimeEntity?.entityId).toBe(entityId);
  kernel.memoryBindingStore.upsertEntity({
    entityId: runtimeEntity!.entityId,
    projectId: 'project-a',
    canonicalName: 'Schema Entity',
    entityType: 'concept',
  });
  kernel.close();
  const finalDb = new Database(dbPath);
  expect(finalDb.prepare(`SELECT COUNT(*) AS count FROM memory_entities WHERE project_id='project-a'`).get())
    .toEqual({ count: 1 });
  finalDb.close();
  rmSync(directory, { recursive: true, force: true });
});

test('schema31 shared memory entity keeps its owner ID and uses the runtime ID for secondary scopes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-schema31-shared-entity-'));
  const dbPath = materializeFixture(directory);
  const db = new Database(dbPath);
  const entityId = 'entity-schema31-shared';
  db.prepare(`
    INSERT INTO memory_entities(entity_id,project_id,canonical_name,entity_type,aliases_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(entityId, 'project-a', 'Shared Entity', 'concept', '["Shared"]', 1, 1);
  for (const [projectId, eventId] of [['project-a', 'main-373-event-a'], ['project-b', 'main-373-event-b']] as const) {
    db.prepare(`
      INSERT INTO memory_topics(topic_path,project_id,project_id_key,topic_type,created_at,updated_at)
      VALUES(?,?,?,?,?,?)
    `).run(`shared/${projectId}`, projectId, projectId, 'semantic', 1, 1);
    db.prepare(`
      INSERT INTO memory_bindings(
        binding_id,event_id,project_id,entity_id,entity_name,entity_type,topic_path,binding_type,
        confidence,source,signal,claim_key,binding_action,related_event_ids_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      `binding-${projectId}`, eventId, projectId, entityId, 'Shared Entity', 'concept',
      `shared/${projectId}`, 'entity', 1, 'explicit', 'shared', 'default', 'create_new_cluster', '[]', 1,
    );
  }
  db.prepare(`
    INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,
      confidence,evidence_event_ids_json,status,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'legacy-project-b-edge', 'project-b', 'entity', entityId, 'belongs_to', 'topic',
    'shared/project-b', 1, '["main-373-event-b"]', 'active', 1,
  );
  db.close();

  expect((await migrate(dbPath, ['--yes'])).exitCode).toBe(0);
  const secondaryId = memoryEntityId('project-b', 'concept', entityId);
  const upgraded = new Database(dbPath);
  expect(upgraded.prepare(`SELECT entity_id,COALESCE(project_id,'') AS project_id FROM memory_entities ORDER BY project_id`).all())
    .toEqual([
      { entity_id: entityId, project_id: 'project-a' },
      { entity_id: secondaryId, project_id: 'project-b' },
    ]);
  expect(upgraded.prepare(`SELECT entity_id FROM memory_bindings WHERE project_id='project-b'`).get())
    .toEqual({ entity_id: secondaryId });
  expect(upgraded.prepare(`
    SELECT edge_id,source_id FROM memory_edges WHERE project_id='project-b'
  `).get()).toEqual({
    edge_id: memoryEdgeId({
      projectId: 'project-b',
      sourceType: 'entity',
      sourceId: secondaryId,
      relationType: 'belongs_to',
      targetType: 'topic',
      targetId: 'shared/project-b',
    }),
    source_id: secondaryId,
  });
  upgraded.close();
  rmSync(directory, { recursive: true, force: true });
});

test('development schema receipts fail fast without creating a migration backup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-development-schema-'));
  const dbPath = materializeFixture(directory);
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO _schema_migrations(version,description,applied_at) VALUES(?,?,?)`)
    .run('0033', 'unreleased development schema', new Date(0).toISOString());
  db.close();

  const result = await migrate(dbPath, ['--yes', '--backup']);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('unsupported_development_schema:0033');
  expect(readdirSync(directory).filter((name) => name.includes('pre-migrate') || name.endsWith('.bak'))).toEqual([]);
  rmSync(directory, { recursive: true, force: true });
});

test('unchecksummed 0032 receipts and meta-only schema 32 databases are rejected', async () => {
  for (const kind of ['receipt', 'meta'] as const) {
    const directory = mkdtempSync(join(tmpdir(), `cogmem-untrusted-0032-${kind}-`));
    const dbPath = materializeFixture(directory);
    const db = new Database(dbPath);
    if (kind === 'receipt') {
      db.prepare(`INSERT INTO _schema_migrations(version,description,applied_at) VALUES(?,?,?)`)
        .run('0032', 'unreleased development schema', new Date(0).toISOString());
    } else {
      db.prepare(`UPDATE _meta SET value='32' WHERE key='schema_version'`).run();
    }
    db.close();

    const result = await migrate(dbPath, ['--yes']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(kind === 'receipt'
      ? 'unsupported_development_schema:0032'
      : 'unsupported_development_schema:32');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a formal 0032 receipt cannot hide damaged tables, indexes, triggers, or CHECK constraints', async () => {
  const tamperCases: Array<{ name: string; apply(db: Database): void }> = [
    {
      name: 'table',
      apply: (db) => db.exec(`DROP TABLE runtime_scope_discard_receipts`),
    },
    {
      name: 'index',
      apply: (db) => db.exec(`
        DROP INDEX idx_memory_events_stream;
        CREATE INDEX idx_memory_events_stream ON memory_events(event_type);
      `),
    },
    {
      name: 'trigger',
      apply: (db) => db.exec(`
        DROP TRIGGER synapses_scope_insert;
        CREATE TRIGGER synapses_scope_insert BEFORE INSERT ON synapses BEGIN SELECT 1; END;
      `),
    },
    {
      name: 'check',
      apply: (db) => {
        const row = db.prepare(`
          SELECT sql FROM sqlite_master WHERE type='table' AND name='policy_execution_read_model'
        `).get() as { sql: string };
        const altered = row.sql.replace(
          `status TEXT NOT NULL CHECK(status IN ('in_progress','executed','skipped','failed'))`,
          'status TEXT NOT NULL',
        );
        expect(altered).not.toBe(row.sql);
        db.exec(`DROP TABLE policy_execution_read_model`);
        db.exec(altered);
      },
    },
  ];

  for (const tamper of tamperCases) {
    const directory = mkdtempSync(join(tmpdir(), `cogmem-tampered-${tamper.name}-`));
    const dbPath = materializeFixture(directory);
    expect((await migrate(dbPath, ['--yes'])).exitCode).toBe(0);
    const db = new Database(dbPath);
    tamper.apply(db);
    db.close();

    const result = await migrate(dbPath, ['--yes']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('final_schema_postcondition_failed:0032');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unrelated SQLite database is rejected without mutation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-unrelated-db-'));
  const dbPath = join(directory, 'unrelated.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE unrelated_data(id TEXT PRIMARY KEY,value TEXT); INSERT INTO unrelated_data VALUES('a','unchanged')`);
  db.close();

  const result = await migrate(dbPath, ['--yes']);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('unsupported_database_identity');
  expect(() => createMemoryKernel({ dbPath })).toThrow('unsupported_database_identity');
  const inspected = new Database(dbPath);
  expect(inspected.prepare(`SELECT * FROM unrelated_data`).all()).toEqual([{ id: 'a', value: 'unchanged' }]);
  expect(inspected.prepare(`SELECT 1 FROM sqlite_master WHERE name='_schema_migrations'`).get()).toBeNull();
  inspected.close();
  rmSync(directory, { recursive: true, force: true });
});

test('a crashed fresh bootstrap resumes through the formal migration before stores open', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-bootstrap-recovery-'));
  const dbPath = join(directory, 'memory.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE _cogmem_bootstrap_state(singleton INTEGER PRIMARY KEY,started_at INTEGER NOT NULL);
    INSERT INTO _cogmem_bootstrap_state VALUES(1,1);
    CREATE TABLE memory_frames(frame_id TEXT PRIMARY KEY);
  `);
  db.close();

  createMemoryKernel({ dbPath }).close();
  const recovered = new Database(dbPath);
  expect(recovered.prepare(`SELECT 1 FROM sqlite_master WHERE name='_cogmem_bootstrap_state'`).get()).toBeNull();
  expect(recovered.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations WHERE version='0032'`).get())
    .toEqual({ count: 1 });
  expect(recovered.prepare(`PRAGMA integrity_check`).get()).toEqual({ integrity_check: 'ok' });
  recovered.close();
  rmSync(directory, { recursive: true, force: true });
});
