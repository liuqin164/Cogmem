import Database from 'bun:sqlite';

import type { Migration } from '../types/Migration.js';

export interface SchemaMigrationRunOptions {
  dryRun?: boolean;
}

export interface SchemaMigrationRunnerOptions {
  readonly?: boolean;
}

export interface SchemaMigrationResult {
  pending: string[];
  applied: string[];
  currentVersion?: string;
  dryRun: boolean;
}

export class SchemaMigrationRunner {
  constructor(
    private readonly db: Database,
    private readonly migrations: Migration[],
    private readonly options: SchemaMigrationRunnerOptions = {},
  ) {
    // Construction is read-only. Schema bookkeeping is created only when a
    // non-dry run is explicitly requested.
  }

  plan(): Migration[] {
    const applied = this.appliedVersions();
    return [...this.migrations]
      .sort((a, b) => a.version.localeCompare(b.version))
      .filter((migration) => !applied.has(migration.version));
  }

  run(options: SchemaMigrationRunOptions = {}): SchemaMigrationResult {
    if (options.dryRun || this.options.readonly) {
      const pending = this.plan();
      return { pending: pending.map((item) => item.version), applied: [], currentVersion: this.currentVersion(), dryRun: true };
    }
    this.ensureMigrationTable();
    this.adoptLegacyVersion();
    const pending = this.plan();
    const applied: string[] = [];
    const transaction = this.db.transaction(() => {
      for (const migration of pending) {
        migration.up(this.db);
        this.db.prepare(`
          INSERT INTO _schema_migrations (version, description, applied_at)
          VALUES (?, ?, ?)
        `).run(migration.version, migration.description, new Date().toISOString());
        applied.push(migration.version);
      }
    });
    transaction();
    return { pending: pending.map((item) => item.version), applied, currentVersion: this.currentVersion(), dryRun: false };
  }

  private ensureMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  currentVersion(): string | undefined {
    const legacyCurrent = this.legacyCurrentVersion();
    if (!this.schemaMigrationsTableExists()) {
      return legacyCurrent;
    }
    const row = this.db.prepare(`
      SELECT version FROM _schema_migrations ORDER BY version DESC LIMIT 1
    `).get() as { version?: string } | null;
    return [row?.version, legacyCurrent].filter((version): version is string => Boolean(version)).sort((a, b) => b.localeCompare(a))[0];
  }

  private appliedVersions(): Set<string> {
    const applied = new Set<string>();
    const legacyVersion = this.legacySchemaVersion();
    for (const migration of this.migrations) {
      // `_meta.schema_version` was written by older kernels without a durable
      // migration receipt. It is a hint only: adopting a high legacy version
      // must not hide a partially applied integrity migration.
      if (legacyVersion !== undefined
        && Number.parseInt(migration.version, 10) <= legacyVersion
        && this.migrationSchemaSatisfied(migration.version)) {
        applied.add(migration.version);
      }
    }
    if (!this.schemaMigrationsTableExists()) {
      return applied;
    }
    for (const row of this.db.prepare(`SELECT version FROM _schema_migrations`).all() as Array<{ version: string }>) {
      if (this.migrationSchemaSatisfied(row.version)) applied.add(row.version);
    }
    return applied;
  }

  private schemaMigrationsTableExists(): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_schema_migrations'
    `).get());
  }

  private legacySchemaVersion(): number | undefined {
    const metaExists = this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_meta'
    `).get();
    if (!metaExists) return undefined;
    const row = this.db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as { value?: string } | null;
    const legacyVersion = Number.parseInt(row?.value || '', 10);
    return Number.isFinite(legacyVersion) ? legacyVersion : undefined;
  }

  private legacyCurrentVersion(): string | undefined {
    const legacyVersion = this.legacySchemaVersion();
    if (legacyVersion === undefined) return undefined;
    return [...this.migrations]
      .filter((migration) => Number.parseInt(migration.version, 10) <= legacyVersion)
      .sort((a, b) => b.version.localeCompare(a.version))[0]?.version;
  }

  private adoptLegacyVersion(): void {
    const legacyVersion = this.legacySchemaVersion();
    if (legacyVersion === undefined) return;
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO _schema_migrations (version, description, applied_at)
      VALUES (?, ?, ?)
    `);
    for (const migration of this.migrations) {
      if (Number.parseInt(migration.version, 10) <= legacyVersion && this.migrationSchemaSatisfied(migration.version)) {
        insert.run(migration.version, `adopted: ${migration.description}`, new Date(0).toISOString());
      }
    }
  }

  private migrationSchemaSatisfied(version: string): boolean {
    if (version === '0029') {
      return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_episodes_one_active_scope'`).get());
    }
    if (version === '0030') {
      const eventTable = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`).get());
      const eventColumns = eventTable
        ? new Set((this.db.prepare(`PRAGMA table_info(memory_events)`).all() as Array<{ name: string }>).map((row) => row.name))
        : new Set<string>();
      const positionIndex = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_episode_events_episode_position_unique'`).get());
      return (!eventTable || eventColumns.has('local_date_source')) && positionIndex;
    }
    if (version === '0031') {
      return Boolean(this.db.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_episode_integrity_markers'
      `).get()) && Boolean(this.db.prepare(`
        SELECT 1 FROM _episode_integrity_markers WHERE marker = 'episode_boundary_integrity_0031'
      `).get());
    }
    if (version === '0032') return this.hasColumns('memory_frames', ['frame_id','project_id','episode_id','source_fingerprint','status'])
      && this.hasColumns('memory_frame_nodes', ['frame_node_id','frame_id','dimension','label'])
      && this.hasColumns('memory_frame_relations', ['frame_relation_id','frame_id','source_frame_node_id','target_frame_node_id']);
    if (version === '0033') return this.hasColumns('memory_atlas_aliases', ['alias_id','project_id','node_id','normalized_alias','source_frame_id'])
      && this.hasColumns('memory_atlas_supports', ['support_id','project_id','node_id','source_type','source_frame_id']);
    if (version === '0034') return this.hasColumns('memory_atlas_projection_state', ['projection_version', 'processor_prompt_version', 'frame_schema_version', 'source_fingerprint', 'last_backfill_cursor']);
    if (version === '0035') return this.hasColumns('memory_frames', ['primary_language', 'temporal_references_json', 'state_transitions_json', 'publish_status']);
    if (version === '0036') return this.hasColumns('memory_frames', ['dream_job_lease_id', 'dream_lease_until', 'attempt_generation'])
      && this.hasColumns('memory_frame_reviews', ['review_id', 'frame_id', 'project_id', 'action', 'actor', 'reason'])
      && Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_dream_lease'`).get());
    if (version === '0037') {
      if (!this.hasColumns('memory_frames', ['revision_id', 'revision_number', 'supersedes_frame_id'])) return false;
      const indexes = this.db.prepare(`PRAGMA index_list(memory_frames)`).all() as Array<{ name?: string; unique?: number }>;
      return indexes.some((index) => {
        if (Number(index.unique) !== 1 || !index.name) return false;
        const columns = this.db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name?: string }>;
        return columns.map((column) => column.name).join('|') === 'episode_id|source_fingerprint|processor_prompt_version|revision_id';
      });
    }
    if (version === '0038') return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_revision_number'`).get());
    if (version === '0039') return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_one_active_episode'`).get())
      && Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_revision_number'`).get());
    if (version === '0040') return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_atlas_alias_supports'`).get());
    return true;
  }

  private tableExists(name: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
  }

  private hasColumns(table: string, names: string[]): boolean {
    if (!this.tableExists(table)) return false;
    const columns = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
    return names.every((name) => columns.has(name));
  }
}
