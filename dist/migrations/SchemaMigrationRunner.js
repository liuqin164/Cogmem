export class SchemaMigrationRunner {
    db;
    migrations;
    options;
    constructor(db, migrations, options = {}) {
        this.db = db;
        this.migrations = migrations;
        this.options = options;
        // Construction is read-only. Schema bookkeeping is created only when a
        // non-dry run is explicitly requested.
    }
    plan() {
        const applied = this.appliedVersions();
        return [...this.migrations]
            .sort((a, b) => a.version.localeCompare(b.version))
            .filter((migration) => !applied.has(migration.version));
    }
    run(options = {}) {
        if (options.dryRun || this.options.readonly) {
            const pending = this.plan();
            return { pending: pending.map((item) => item.version), applied: [], currentVersion: this.currentVersion(), dryRun: true };
        }
        this.ensureMigrationTable();
        this.adoptLegacyVersion();
        const pending = this.plan();
        const applied = [];
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
    ensureMigrationTable() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    }
    currentVersion() {
        const legacyCurrent = this.legacyCurrentVersion();
        if (!this.schemaMigrationsTableExists()) {
            return legacyCurrent;
        }
        const row = this.db.prepare(`
      SELECT version FROM _schema_migrations ORDER BY version DESC LIMIT 1
    `).get();
        return [row?.version, legacyCurrent].filter((version) => Boolean(version)).sort((a, b) => b.localeCompare(a))[0];
    }
    appliedVersions() {
        const applied = new Set();
        const legacyVersion = this.legacySchemaVersion();
        for (const migration of this.migrations) {
            if (legacyVersion !== undefined && Number.parseInt(migration.version, 10) <= legacyVersion) {
                applied.add(migration.version);
            }
        }
        if (!this.schemaMigrationsTableExists()) {
            return applied;
        }
        for (const row of this.db.prepare(`SELECT version FROM _schema_migrations`).all()) {
            if (this.migrationSchemaSatisfied(row.version))
                applied.add(row.version);
        }
        return applied;
    }
    schemaMigrationsTableExists() {
        return Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_schema_migrations'
    `).get());
    }
    legacySchemaVersion() {
        const metaExists = this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_meta'
    `).get();
        if (!metaExists)
            return undefined;
        const row = this.db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get();
        const legacyVersion = Number.parseInt(row?.value || '', 10);
        return Number.isFinite(legacyVersion) ? legacyVersion : undefined;
    }
    legacyCurrentVersion() {
        const legacyVersion = this.legacySchemaVersion();
        if (legacyVersion === undefined)
            return undefined;
        return [...this.migrations]
            .filter((migration) => Number.parseInt(migration.version, 10) <= legacyVersion)
            .sort((a, b) => b.version.localeCompare(a.version))[0]?.version;
    }
    adoptLegacyVersion() {
        const legacyVersion = this.legacySchemaVersion();
        if (legacyVersion === undefined)
            return;
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
    migrationSchemaSatisfied(version) {
        if (version === '0029') {
            return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_episodes_one_active_scope'`).get());
        }
        if (version === '0030') {
            const eventTable = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`).get());
            const eventColumns = eventTable
                ? new Set(this.db.prepare(`PRAGMA table_info(memory_events)`).all().map((row) => row.name))
                : new Set();
            const positionIndex = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_episode_events_episode_position_unique'`).get());
            return (!eventTable || eventColumns.has('local_date_source')) && positionIndex;
        }
        return true;
    }
}
