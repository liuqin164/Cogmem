import Database from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { memoryEdgeId } from '../src/binding/MemoryBindingIdentity.js';
import { MIGRATION_DIGESTS } from '../src/migrations/MigrationDigestManifest.js';

const root = resolve(import.meta.dir, '..');
const fixture = join(root, '__tests__', 'fixtures', 'migrations', 'main-3.7.3-schema31.sqlite.gz');
const directory = mkdtempSync(join(tmpdir(), 'cogmem-packed-migration-'));
let tarball: string | undefined;

try {
  const npmEnv = {
    npm_config_cache: join(directory, 'npm-cache'),
    npm_config_dry_run: 'false',
  };
  const packed = await run(['npm', 'pack', '--json'], root, npmEnv);
  tarball = join(root, String((JSON.parse(packed) as Array<{ filename: string }>)[0]!.filename));
  const install = join(directory, 'install');
  mkdirSync(install);
  await run(['npm', 'install', '--prefix', install, tarball], root, npmEnv);
  const installedPackage = JSON.parse(readFileSync(join(install, 'node_modules', 'cogmem', 'package.json'), 'utf8')) as { version?: string };
  if (installedPackage.version !== '3.7.5') throw new Error('packed_package_version_mismatch');
  const typeSmoke = join(install, 'package-type-smoke.mts');
  writeFileSync(typeSmoke, `
    import type { MemoryEdgeRecord, MemoryGraphEdgeStatus } from 'cogmem';
    const status: MemoryGraphEdgeStatus = 'needs_confirmation';
    declare const edge: MemoryEdgeRecord;
    if (edge.status === 'needs_confirmation') void status;
  `);
  await run([
    'bun', join(root, 'node_modules', 'typescript', 'bin', 'tsc'), typeSmoke,
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'Node16', '--moduleResolution', 'Node16',
  ], install);

  const cliDb = materialize('cli.db');
  const kernelDb = materialize('kernel.db');
  seedIdentityFixture(cliDb);
  seedIdentityFixture(kernelDb);

  await run([
    'bun', join(install, 'node_modules', 'cogmem', 'dist', 'bin', 'migrate.js'),
    '--db', cliDb, '--yes', '--json',
  ], install);
  await run([
    'bun', '-e',
    `import {createMemoryKernel} from 'cogmem';
     const kernel=createMemoryKernel({dbPath:process.env.DB_PATH});
     kernel.memoryBindingStore.upsertEntity({
       entityId:'packed-entity',projectId:'project-a',canonicalName:'Packed Entity',entityType:'concept'
     });
     kernel.close();`,
  ], install, { DB_PATH: kernelDb });
  const schema32Receipt = migrationReceipt(kernelDb);
  await verifyMcp(install, kernelDb);
  await run([
    'bun', '-e',
    `import {createMemoryKernel} from 'cogmem';
     const kernel=createMemoryKernel({dbPath:process.env.DB_PATH});
     kernel.close();`,
  ], install, { DB_PATH: kernelDb });
  if (migrationReceipt(kernelDb) !== schema32Receipt) throw new Error('schema32_runtime_applied_unexpected_migration');
  await verifyPackedOpenClawPlugin(install);

  verify(cliDb);
  verify(kernelDb);
  console.log('packed 3.7.5 types, schema31 -> 0032, schema32 runtime, OpenClaw 0.7.2, and MCP verified');
} finally {
  if (tarball) rmSync(tarball, { force: true });
  rmSync(directory, { recursive: true, force: true });
}

function materialize(name: string): string {
  const path = join(directory, name);
  writeFileSync(path, gunzipSync(readFileSync(fixture)));
  return path;
}

function seedIdentityFixture(path: string): void {
  const db = new Database(path);
  const edgeId = memoryEdgeId({
    projectId: 'project-a',
    sourceType: 'entity',
    sourceId: 'packed-entity',
    relationType: 'belongs_to',
    targetType: 'topic',
    targetId: 'packed/topic',
  });
  db.exec(`
    INSERT INTO memory_entities(entity_id,project_id,canonical_name,entity_type,aliases_json,created_at,updated_at)
    VALUES('packed-entity','project-a','Packed Entity','concept','["Packed Alias"]',1,1);
    INSERT INTO memory_topics(topic_path,project_id,project_id_key,topic_type,created_at,updated_at)
    VALUES('packed/topic','project-a','project-a','semantic',1,1);
  `);
  db.prepare(`
    INSERT INTO memory_bindings(
      binding_id,event_id,project_id,entity_id,entity_name,entity_type,topic_path,binding_type,
      confidence,source,signal,claim_key,binding_action,related_event_ids_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'packed-binding', 'main-373-event-a', 'project-a', 'packed-entity', 'Packed Entity', 'concept',
    'packed/topic', 'entity', 1, 'explicit', 'packed', 'default', 'create_new_cluster', '[]', 1,
  );
  db.prepare(`
    INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,
      confidence,evidence_event_ids_json,status,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    edgeId, 'project-a', 'entity', 'packed-entity', 'belongs_to', 'topic', 'packed/topic',
    1, '["main-373-event-a"]', 'active', 1,
  );
  db.close();
}

function verify(path: string): void {
  const db = new Database(path);
  const receipt = db.prepare(`
    SELECT checksum FROM _schema_migrations WHERE version='0032'
  `).get() as { checksum?: string } | null;
  if (receipt?.checksum !== MIGRATION_DIGESTS['0032']) throw new Error('packed_migration_receipt_mismatch');
  const latest = db.prepare(`SELECT MAX(version) AS version FROM _schema_migrations`).get() as { version?: string } | null;
  if (latest?.version !== '0032') throw new Error('packed_latest_schema_mismatch');
  if ((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') {
    throw new Error('packed_migration_integrity_failed');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('packed_migration_foreign_key_failed');
  if ((db.prepare(`
    SELECT COUNT(*) AS count FROM memory_entities
    WHERE entity_id='packed-entity' AND project_id='project-a'
  `).get() as { count: number }).count !== 1) throw new Error('packed_migration_entity_identity_failed');
  if ((db.prepare(`SELECT COUNT(*) AS count FROM memory_edges`).get() as { count: number }).count < 1) {
    throw new Error('packed_migration_edge_identity_failed');
  }
  if ((db.prepare(`SELECT COUNT(*) AS count FROM project_branches`).get() as { count: number }).count < 1
    || (db.prepare(`SELECT COUNT(*) AS count FROM cognitive_nodes`).get() as { count: number }).count < 1) {
    throw new Error('packed_migration_topology_lost');
  }
  db.close();
}

function migrationReceipt(path: string): string {
  const db = new Database(path, { readonly: true });
  const receipt = JSON.stringify(db.prepare(`SELECT version,applied_at,checksum FROM _schema_migrations ORDER BY version`).all());
  db.close();
  return receipt;
}

async function verifyPackedOpenClawPlugin(install: string): Promise<void> {
  const workspace = join(directory, 'openclaw-workspace');
  const configPath = join(workspace, '.cogmem', 'config.toml');
  const openclawConfigPath = join(workspace, 'openclaw.json');
  mkdirSync(join(workspace, '.cogmem'), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(openclawConfigPath, '{}\n');
  const installerPath = join(install, 'node_modules', 'cogmem', 'dist', 'host', 'openclaw', 'AutoMemoryPluginInstaller.js');
  const installer = await import(pathToFileURL(installerPath).href) as {
    installOpenClawAutoMemoryPlugin(options: { workspaceRoot: string; configPath: string; openclawConfigPath: string; force: boolean }): { pluginDir: string };
  };
  const installed = installer.installOpenClawAutoMemoryPlugin({ workspaceRoot: workspace, configPath, openclawConfigPath, force: true });
  const pluginPackage = JSON.parse(readFileSync(join(installed.pluginDir, 'package.json'), 'utf8')) as { version?: string };
  const pluginManifest = JSON.parse(readFileSync(join(installed.pluginDir, 'openclaw.plugin.json'), 'utf8')) as { version?: string };
  if (pluginPackage.version !== '0.7.2' || pluginManifest.version !== '0.7.2') throw new Error('packed_openclaw_plugin_version_mismatch');
  const indexPath = join(installed.pluginDir, 'index.js');
  const index = readFileSync(indexPath, 'utf8');
  if (!index.includes(".replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/g, ' ')")
    || !index.includes(".replace(/\\s+/g, ' ')") || index.includes("new RegExp('[")) {
    throw new Error('packed_openclaw_serializer_source_mismatch');
  }
  const plugin = createRequire(import.meta.url)(indexPath) as {
    __testing?: { serializeUntrustedMemory?(input: unknown, limit: number): string };
  };
  const sanitized = plugin.__testing?.serializeUntrustedMemory?.('hello\u0000world\u001f!', 500);
  if (sanitized !== 'hello world !') throw new Error('packed_openclaw_serializer_runtime_failed');
}

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  const process = Bun.spawn({
    cmd: command,
    cwd,
    env: { ...Bun.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(' ')} failed:\n${stderr || stdout}`);
  return stdout;
}

async function verifyMcp(install: string, dbPath: string): Promise<void> {
  const input = [
    JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'packed-test', version: '1' } },
    }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    '',
  ].join('\n');
  const process = Bun.spawn({
    cmd: ['bun', join(install, 'node_modules', 'cogmem', 'dist', 'bin', 'mcp.js'), '--db', dbPath],
    cwd: install,
    stdin: new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0 || stderr || !stdout.includes('"name":"cogmem_recall"')) {
    throw new Error(`packed MCP startup failed:\n${stderr || stdout}`);
  }
}
