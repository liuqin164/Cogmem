import Database from 'bun:sqlite';

import type { Migration } from '../types/Migration.js';

export interface SchemaMigrationRunOptions {
  dryRun?: boolean;
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
  ) {
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
    const applied = new Set((this.db.prepare(`SELECT version FROM _schema_migrations`).all() as Array<{ version: string }>).map((row) => row.version));
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
    const row = this.db.prepare(`
      SELECT version FROM _schema_migrations ORDER BY version DESC LIMIT 1
    `).get() as { version?: string } | null;
    return row?.version;
  }

  private adoptLegacyVersion(): void {
    const metaExists = this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_meta'
    `).get();
    if (!metaExists) return;
    const row = this.db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as { value?: string } | null;
    const legacyVersion = Number.parseInt(row?.value || '', 10);
    if (!Number.isFinite(legacyVersion)) return;
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
