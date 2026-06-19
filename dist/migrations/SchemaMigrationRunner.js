export class SchemaMigrationRunner {
    db;
    migrations;
    constructor(db, migrations) {
        this.db = db;
        this.migrations = migrations;
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
        this.adoptLegacyVersion();
    }
    plan() {
        const applied = new Set(this.db.prepare(`SELECT version FROM _schema_migrations`).all().map((row) => row.version));
        return [...this.migrations]
            .sort((a, b) => a.version.localeCompare(b.version))
            .filter((migration) => !applied.has(migration.version));
    }
    run(options = {}) {
        const pending = this.plan();
        if (options.dryRun) {
            return { pending: pending.map((item) => item.version), applied: [], currentVersion: this.currentVersion(), dryRun: true };
        }
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
    currentVersion() {
        const row = this.db.prepare(`
      SELECT version FROM _schema_migrations ORDER BY version DESC LIMIT 1
    `).get();
        return row?.version;
    }
    adoptLegacyVersion() {
        const metaExists = this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_meta'
    `).get();
        if (!metaExists)
            return;
        const row = this.db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get();
        const legacyVersion = Number.parseInt(row?.value || '', 10);
        if (!Number.isFinite(legacyVersion))
            return;
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
