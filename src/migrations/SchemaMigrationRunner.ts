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
    if (this.options.readonly) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    this.adoptLegacyVersion();
  }

  plan(): Migration[] {
    const applied = this.appliedVersions();
    return [...this.migrations]
      .sort((a, b) => a.version.localeCompare(b.version))
      .filter((migration) => !applied.has(migration.version));
  }

  run(options: SchemaMigrationRunOptions = {}): SchemaMigrationResult {
    const pending = this.plan();
    if (options.dryRun) {
      return { pending: pending.map((item) => item.version), applied: [], currentVersion: this.currentVersion(), dryRun: true };
    }
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
      if (legacyVersion !== undefined && Number.parseInt(migration.version, 10) <= legacyVersion) {
        applied.add(migration.version);
      }
    }
    if (!this.schemaMigrationsTableExists()) {
      return applied;
    }
    for (const row of this.db.prepare(`SELECT version FROM _schema_migrations`).all() as Array<{ version: string }>) {
      applied.add(row.version);
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
      if (Number.parseInt(migration.version, 10) <= legacyVersion) {
        insert.run(migration.version, `adopted: ${migration.description}`, new Date(0).toISOString());
      }
    }
  }
}
