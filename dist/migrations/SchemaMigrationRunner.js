import { MIGRATION_DIGESTS } from './MigrationDigestManifest.js';
import { multidimensionalMemoryGraph374Issue, multidimensionalMemoryGraph374Satisfied, } from './0032_multidimensional_memory_graph_3_7_4.js';
import { installAtlasProjectionDirtyTriggersV3 } from './v3_7_4/FinalRuntimeGuards.js';
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
            .filter((migration) => !applied.has(migration.version)
            || (migration.version !== '0032' && !this.migrationSchemaSatisfied(migration.version)));
    }
    preflight() {
        this.assertSupportedReleaseSchema();
    }
    run(options = {}) {
        this.assertSupportedReleaseSchema();
        if (options.dryRun || this.options.readonly) {
            this.assertRecordedChecksums();
            const pending = this.plan();
            return { pending: pending.map((item) => item.version), applied: [], currentVersion: this.currentVersion(), dryRun: true };
        }
        this.ensureMigrationTable();
        this.adoptLegacyVersion();
        this.assertRecordedChecksums();
        this.repairRecordedRuntimeGuards();
        const pending = this.plan();
        const filename = this.db.filename;
        if (filename && filename !== ':memory:' && pending.some((migration) => migration.requiresBackup) && !this.options.backupVerified) {
            throw new Error('migration_backup_required');
        }
        const applied = [];
        const recorded = new Set(this.db.prepare(`SELECT version FROM _schema_migrations`).all().map((row) => row.version));
        const transaction = this.db.transaction(() => {
            for (const migration of pending) {
                migration.up(this.db);
                if (!this.migrationSchemaSatisfied(migration.version))
                    throw new Error(`migration_postcondition_failed:${migration.version}`);
                const appliedAt = new Date().toISOString();
                const checksum = this.migrationChecksum(migration);
                const hasChecksum = Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info('_schema_migrations') WHERE name='checksum'`).get());
                if (recorded.has(migration.version)) {
                    if (hasChecksum)
                        this.db.prepare(`UPDATE _schema_migrations SET description=?, applied_at=?, checksum=? WHERE version=?`).run(migration.description, appliedAt, checksum, migration.version);
                    else
                        this.db.prepare(`UPDATE _schema_migrations SET description=?, applied_at=? WHERE version=?`).run(migration.description, appliedAt, migration.version);
                }
                else if (hasChecksum) {
                    this.db.prepare(`INSERT INTO _schema_migrations (version, description, applied_at, checksum) VALUES (?, ?, ?, ?)`).run(migration.version, migration.description, appliedAt, checksum);
                }
                else {
                    this.db.prepare(`INSERT INTO _schema_migrations (version, description, applied_at) VALUES (?, ?, ?)`).run(migration.version, migration.description, appliedAt);
                }
                if (hasChecksum) {
                    this.backfillChecksums();
                }
                if (!this.migrationSchemaSatisfied(migration.version))
                    throw new Error(`migration_postcondition_failed:${migration.version}`);
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
    migrationChecksum(migration) {
        const digest = MIGRATION_DIGESTS[migration.version] ?? migration.checksum;
        if (!digest)
            throw new Error(`migration_digest_missing:${migration.version}`);
        return digest;
    }
    backfillChecksums() {
        const update = this.db.prepare(`UPDATE _schema_migrations SET checksum=? WHERE version=? AND (checksum IS NULL OR checksum='')`);
        for (const [version, checksum] of Object.entries(MIGRATION_DIGESTS))
            update.run(checksum, version);
    }
    assertRecordedChecksums() {
        if (!Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info('_schema_migrations') WHERE name='checksum'`).get()))
            return;
        const rows = this.recordedChecksums();
        for (const row of rows) {
            const digest = MIGRATION_DIGESTS[row.version];
            if (!digest)
                throw new Error(`migration_checksum_unknown:${row.version}`);
            if (!row.checksum)
                throw new Error(`migration_checksum_missing:${row.version}`);
            if (row.checksum !== digest)
                throw new Error(`migration_checksum_mismatch:${row.version}`);
        }
    }
    recordedChecksums() {
        return this.db.prepare(`SELECT version, description, checksum FROM _schema_migrations ORDER BY version`).all();
    }
    assertSupportedReleaseSchema() {
        const legacyVersion = this.legacySchemaVersion();
        const userTables = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all().map((row) => row.name);
        if (userTables.length === 0 || userTables.includes('_cogmem_bootstrap_state'))
            return;
        if (!this.schemaMigrationsTableExists()) {
            if (legacyVersion === 32)
                throw new Error('unsupported_development_schema:32');
            if (legacyVersion === 31
                && (this.migrationSchemaSatisfied('0031') || !this.migrations.some((migration) => migration.version === '0032')))
                return;
            throw new Error(legacyVersion === undefined
                ? 'unsupported_database_identity'
                : `unsupported_release_schema:${legacyVersion}`);
        }
        const rows = this.db.prepare(`SELECT version FROM _schema_migrations ORDER BY version`).all();
        const unsupported = rows.find((row) => row.version > '0032');
        if (unsupported)
            throw new Error(`unsupported_development_schema:${unsupported.version}`);
        const release0032 = rows.some((row) => row.version === '0032');
        if (release0032) {
            if (!this.hasColumns('_schema_migrations', ['checksum']))
                throw new Error('unsupported_development_schema:0032');
            const row = this.db.prepare(`SELECT checksum FROM _schema_migrations WHERE version='0032'`).get();
            if (row?.checksum !== MIGRATION_DIGESTS['0032'])
                throw new Error('unsupported_development_schema:0032');
            const issue = multidimensionalMemoryGraph374Issue(this.db);
            if (!issue)
                return;
            if (issue.startsWith('trigger_definition:trg_memory_atlas_dirty_')
                || issue.startsWith('trigger_missing:trg_memory_atlas_dirty_'))
                return;
            throw new Error(`final_schema_postcondition_failed:0032:${issue}`);
        }
        const latest = rows[rows.length - 1]?.version;
        if (latest !== '0031' || !this.migrationSchemaSatisfied('0031')) {
            throw new Error(latest ? `unsupported_release_schema:${latest}` : 'unsupported_database_identity');
        }
        if (legacyVersion !== undefined && legacyVersion !== 31) {
            throw new Error(legacyVersion > 31
                ? `unsupported_development_schema:${legacyVersion}`
                : `unsupported_release_schema:${legacyVersion}`);
        }
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
        for (const row of this.db.prepare(`SELECT version FROM _schema_migrations`).all()) {
            if (row.version === '0032' || this.migrationSchemaSatisfied(row.version))
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
        const hasChecksum = this.hasColumns('_schema_migrations', ['checksum']);
        const insert = this.db.prepare(hasChecksum
            ? `INSERT OR IGNORE INTO _schema_migrations (version,description,applied_at,checksum) VALUES (?,?,?,?)`
            : `INSERT OR IGNORE INTO _schema_migrations (version,description,applied_at) VALUES (?,?,?)`);
        for (const migration of this.migrations) {
            if (Number.parseInt(migration.version, 10) <= legacyVersion && this.migrationSchemaSatisfied(migration.version)) {
                const values = [migration.version, `adopted: ${migration.description}`, new Date(0).toISOString()];
                insert.run(...values, ...(hasChecksum ? [this.migrationChecksum(migration)] : []));
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
        if (version === '0031') {
            return Boolean(this.db.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_episode_integrity_markers'
      `).get()) && Boolean(this.db.prepare(`
        SELECT 1 FROM _episode_integrity_markers WHERE marker = 'episode_boundary_integrity_0031'
      `).get());
        }
        if (version === '0032') {
            return multidimensionalMemoryGraph374Satisfied(this.db);
        }
        return true;
    }
    repairRecordedRuntimeGuards() {
        if (!this.schemaMigrationsTableExists())
            return;
        const recorded = this.db.prepare(`SELECT 1 FROM _schema_migrations WHERE version='0032'`).get();
        if (!recorded)
            return;
        const issue = multidimensionalMemoryGraph374Issue(this.db);
        if (issue?.startsWith('trigger_definition:trg_memory_atlas_dirty_')
            || issue?.startsWith('trigger_missing:trg_memory_atlas_dirty_')) {
            installAtlasProjectionDirtyTriggersV3(this.db);
        }
    }
    tableExists(name) {
        return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
    }
    hasColumns(table, names) {
        if (!this.tableExists(table))
            return false;
        const columns = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
        return names.every((name) => columns.has(name));
    }
}
