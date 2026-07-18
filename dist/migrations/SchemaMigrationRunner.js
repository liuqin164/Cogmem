import { COMPATIBLE_MIGRATION_DIGESTS, LEGACY_MIGRATION_RECEIPT_PROFILES, MIGRATION_DIGESTS } from './MigrationDigestManifest.js';
import { topologyIntegritySatisfied } from './0054_topology_semantic_integrity.js';
import { topologyFinalizationSatisfied } from './0055_topology_scope_finalization.js';
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
            .filter((migration) => !applied.has(migration.version) || !this.migrationSchemaSatisfied(migration.version));
    }
    run(options = {}) {
        if (options.dryRun || this.options.readonly) {
            this.assertRecordedChecksums({ allowKnownLegacy: true });
            const pending = this.plan();
            return { pending: pending.map((item) => item.version), applied: [], currentVersion: this.currentVersion(), dryRun: true };
        }
        this.ensureMigrationTable();
        this.adoptLegacyVersion();
        this.repairKnownLegacyFunctionChecksums();
        this.assertRecordedChecksums();
        const pending = this.plan();
        const applied = [];
        const recorded = new Set(this.db.prepare(`SELECT version FROM _schema_migrations`).all().map((row) => row.version));
        const transaction = this.db.transaction(() => {
            if (pending.some((migration) => migration.version === '0052') && pending.some((migration) => migration.version === '0055') && this.tableExists('task_branches') && this.tableExists('task_branch_entries')) {
                this.db.exec(`DROP TABLE IF EXISTS temp._0055_task_identity_backup; DROP TABLE IF EXISTS temp._0055_task_entry_backup; CREATE TEMP TABLE _0055_task_identity_backup AS SELECT task_id,COALESCE(project_id,'') AS project_id,task_key,title,status,created_at,updated_at FROM task_branches; CREATE TEMP TABLE _0055_task_entry_backup AS SELECT * FROM task_branch_entries`);
            }
            if (pending.some((migration) => migration.version === '0054') && pending.some((migration) => migration.version === '0055') && this.tableExists('task_branches')) {
                this.db.exec(`DROP TABLE IF EXISTS temp._0055_task_metadata_backup; CREATE TEMP TABLE _0055_task_metadata_backup AS SELECT task_id,COALESCE(project_id,'') AS project_id,task_key,title,status FROM task_branches`);
            }
            for (const migration of pending) {
                migration.up(this.db);
                // 0046 repairs receipts created before checksum normalization. Its
                // pre-receipt state is intentionally allowed to contain legacy NULL
                // checksums; the post-receipt assertion below is the real gate.
                if (migration.version !== '0046' && !this.migrationSchemaSatisfied(migration.version))
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
                    if (migration.version === '0046')
                        this.rewriteChecksums();
                    else
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
    /** Convert only audited pre-manifest receipts before strict validation. */
    repairKnownLegacyFunctionChecksums() {
        if (!Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info('_schema_migrations') WHERE name='checksum'`).get()))
            return;
        const rows = this.recordedChecksums();
        const profile = this.matchingLegacyReceiptProfile(rows);
        if (!profile)
            return;
        const update = this.db.prepare(`UPDATE _schema_migrations SET checksum=? WHERE version=? AND checksum=?`);
        for (const row of rows) {
            const legacyChecksum = profile[row.version];
            if (legacyChecksum && legacyChecksum === row.checksum)
                update.run(MIGRATION_DIGESTS[row.version], row.version, legacyChecksum);
        }
    }
    backfillChecksums() {
        const update = this.db.prepare(`UPDATE _schema_migrations SET checksum=? WHERE version=? AND (checksum IS NULL OR checksum='')`);
        for (const [version, checksum] of Object.entries(MIGRATION_DIGESTS))
            update.run(checksum, version);
    }
    rewriteChecksums() {
        const update = this.db.prepare(`UPDATE _schema_migrations SET checksum=? WHERE version=? AND (checksum IS NULL OR checksum='')`);
        for (const [version, checksum] of Object.entries(MIGRATION_DIGESTS))
            update.run(checksum, version);
    }
    assertRecordedChecksums(options = {}) {
        if (!Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info('_schema_migrations') WHERE name='checksum'`).get()))
            return;
        const rows = this.recordedChecksums();
        const legacyProfile = options.allowKnownLegacy ? this.matchingLegacyReceiptProfile(rows) : undefined;
        const checksumNormalizationApplied = rows.some((row) => row.version >= '0046');
        for (const row of rows) {
            const digest = MIGRATION_DIGESTS[row.version];
            if (!digest)
                throw new Error(`migration_checksum_unknown:${row.version}`);
            if (!row.checksum) {
                if (!checksumNormalizationApplied && row.version < '0046')
                    continue;
                throw new Error(`migration_checksum_missing:${row.version}`);
            }
            const knownLegacy = legacyProfile?.[row.version] === row.checksum;
            const compatible = COMPATIBLE_MIGRATION_DIGESTS[row.version]?.includes(row.checksum);
            if (row.checksum !== digest && !compatible && !(options.allowKnownLegacy && knownLegacy)) {
                throw new Error(`migration_checksum_mismatch:${row.version}`);
            }
        }
    }
    recordedChecksums() {
        return this.db.prepare(`SELECT version, description, checksum FROM _schema_migrations ORDER BY version`).all();
    }
    matchingLegacyReceiptProfile(rows) {
        for (const profile of Object.values(LEGACY_MIGRATION_RECEIPT_PROFILES)) {
            const profileVersions = Object.keys(profile).sort();
            const expectedVersions = rows.some((row) => row.version < '0015')
                ? profileVersions
                : profileVersions.filter((version) => version >= '0015');
            const byVersion = new Map(rows.map((row) => [row.version, row]));
            if (expectedVersions.length === 0 || !expectedVersions.every((version) => byVersion.has(version)))
                continue;
            let matchedLegacy = false;
            let valid = true;
            for (const version of expectedVersions) {
                const row = byVersion.get(version);
                const manifest = MIGRATION_DIGESTS[row.version];
                if (!manifest) {
                    valid = false;
                    break;
                }
                if (row.checksum === manifest || row.checksum === profile[row.version]) {
                    matchedLegacy ||= row.checksum === profile[row.version];
                    continue;
                }
                valid = false;
                break;
            }
            if (valid) {
                const profileMax = profileVersions[profileVersions.length - 1];
                for (const row of rows) {
                    if (row.version > profileMax) {
                        if (row.checksum !== MIGRATION_DIGESTS[row.version])
                            valid = false;
                        continue;
                    }
                    if (!expectedVersions.includes(row.version))
                        valid = false;
                }
            }
            if (valid && matchedLegacy)
                return profile;
        }
        return undefined;
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
        if (version === '0031') {
            return Boolean(this.db.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_episode_integrity_markers'
      `).get()) && Boolean(this.db.prepare(`
        SELECT 1 FROM _episode_integrity_markers WHERE marker = 'episode_boundary_integrity_0031'
      `).get());
        }
        if (version === '0032')
            return this.hasColumns('memory_frames', ['frame_id', 'project_id', 'episode_id', 'source_fingerprint', 'status'])
                && this.hasColumns('memory_frame_nodes', ['frame_node_id', 'frame_id', 'dimension', 'label'])
                && this.hasColumns('memory_frame_relations', ['frame_relation_id', 'frame_id', 'source_frame_node_id', 'target_frame_node_id']);
        if (version === '0033')
            return this.hasColumns('memory_atlas_aliases', ['alias_id', 'project_id', 'node_id', 'normalized_alias', 'source_frame_id'])
                && this.hasColumns('memory_atlas_supports', ['support_id', 'project_id', 'node_id', 'source_type', 'source_frame_id']);
        if (version === '0034')
            return this.hasColumns('memory_atlas_projection_state', ['projection_version', 'processor_prompt_version', 'frame_schema_version', 'source_fingerprint', 'last_backfill_cursor']);
        if (version === '0035')
            return this.hasColumns('memory_frames', ['primary_language', 'temporal_references_json', 'state_transitions_json', 'publish_status']);
        if (version === '0036')
            return this.hasColumns('memory_frames', ['dream_job_lease_id', 'dream_lease_until', 'attempt_generation'])
                && this.hasColumns('memory_frame_reviews', ['review_id', 'frame_id', 'project_id', 'action', 'actor', 'reason'])
                && Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_dream_lease'`).get());
        if (version === '0037') {
            if (!this.hasColumns('memory_frames', ['revision_id', 'revision_number', 'supersedes_frame_id']))
                return false;
            const indexes = this.db.prepare(`PRAGMA index_list(memory_frames)`).all();
            return indexes.some((index) => {
                if (Number(index.unique) !== 1 || !index.name)
                    return false;
                const columns = this.db.prepare(`PRAGMA index_info(${index.name})`).all();
                return columns.map((column) => column.name).join('|') === 'episode_id|source_fingerprint|processor_prompt_version|revision_id';
            });
        }
        if (version === '0038')
            return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_revision_number'`).get());
        if (version === '0039')
            return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_one_active_episode'`).get())
                && Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_revision_number'`).get())
                && !Boolean(this.db.prepare(`SELECT 1 FROM memory_frames GROUP BY episode_id, source_fingerprint, processor_prompt_version, revision_number HAVING COUNT(*) > 1 LIMIT 1`).get());
        if (version === '0040')
            return this.hasColumns('memory_atlas_alias_supports', ['support_id', 'alias_id', 'project_id', 'node_id', 'source_frame_id', 'status'])
                && Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_atlas_alias_support_identity'`).get());
        if (version === '0041')
            return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_memory_frame_integrity_markers'`).get())
                && Boolean(this.db.prepare(`SELECT 1 FROM _memory_frame_integrity_markers WHERE marker='memory_frame_integrity_0041'`).get())
                && Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memory_frames_one_active_episode'`).get());
        if (version === '0042')
            return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_memory_frame_integrity_markers'`).get())
                && Boolean(this.db.prepare(`SELECT 1 FROM _memory_frame_integrity_markers WHERE marker='memory_frame_integrity_0042'`).get())
                && !Boolean(this.db.prepare(`SELECT 1 FROM memory_frames WHERE revision_number IS NULL OR revision_number<1`).get());
        if (version === '0043')
            return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_memory_frame_integrity_markers'`).get())
                && Boolean(this.db.prepare(`SELECT 1 FROM _memory_frame_integrity_markers WHERE marker='memory_frame_integrity_0043'`).get())
                && this.hasColumns('memory_atlas_alias_supports', ['alias_id', 'project_id', 'node_id', 'source_frame_id', 'status'])
                && !Boolean(this.db.prepare(`SELECT 1 FROM memory_atlas_alias_supports s LEFT JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.status='active' AND (f.frame_id IS NULL OR f.status<>'active') LIMIT 1`).get());
        if (version === '0044')
            return Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info('_schema_migrations') WHERE name='checksum'`).get());
        if (version === '0045')
            return this.hasColumns('memory_atlas_supports', ['payload_json', 'confidence', 'valid_from', 'valid_to', 'source_authority'])
                && this.hasColumns('memory_atlas_alias_supports', ['payload_json', 'confidence', 'source_authority'])
                && Boolean(this.db.prepare(`SELECT 1 FROM _memory_frame_integrity_markers WHERE marker='memory_frame_integrity_0045'`).get());
        if (version === '0046')
            return this.hasColumns('_schema_migrations', ['checksum'])
                && Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_memory_frame_integrity_markers'`).get())
                && Boolean(this.db.prepare(`SELECT 1 FROM _memory_frame_integrity_markers WHERE marker='memory_frame_integrity_0046'`).get())
                && !Boolean(this.db.prepare(`SELECT 1 FROM _schema_migrations WHERE version<>'0046' AND (checksum IS NULL OR checksum='')`).get());
        if (version === '0047')
            return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_memory_frame_integrity_markers'`).get())
                && Boolean(this.db.prepare(`SELECT 1 FROM _memory_frame_integrity_markers WHERE marker='memory_frame_integrity_0047'`).get())
                && !Boolean(this.db.prepare(`SELECT 1 FROM memory_atlas_alias_supports s LEFT JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.status='active' AND (f.frame_id IS NULL OR f.status<>'active') LIMIT 1`).get());
        if (version === '0048')
            return this.hasColumns('topology_projection_state', ['project_id', 'projection_version', 'status', 'time_zone', 'updated_at', 'error']);
        if (version === '0049')
            return this.hasColumns('time_buckets', ['bucket_id', 'project_id', 'time_zone', 'bucket_type', 'bucket_start', 'bucket_end'])
                && this.hasColumns('temporal_adjacency', ['project_id', 'time_zone', 'source_bucket_id', 'adjacent_bucket_id'])
                && this.hasColumns('cognitive_nodes', ['node_id', 'project_id', 'node_type', 'node_key'])
                && this.hasColumns('cognitive_edges', ['edge_id', 'project_id', 'source_node_id', 'target_node_id'])
                && this.hasUniqueIndex('time_buckets', ['project_id', 'time_zone', 'bucket_type', 'bucket_start', 'bucket_end'])
                && this.hasUniqueIndex('cognitive_nodes', ['project_id', 'node_type', 'node_key'])
                && this.hasUniqueIndex('cognitive_edges', ['project_id', 'source_node_id', 'target_node_id', 'edge_type'])
                && !Boolean(this.db.prepare(`SELECT 1 FROM time_bucket_entries e JOIN time_buckets b ON b.bucket_id=e.bucket_id WHERE COALESCE(e.project_id,'')<>b.project_id LIMIT 1`).get())
                && !Boolean(this.db.prepare(`SELECT 1 FROM cognitive_edges e LEFT JOIN cognitive_nodes s ON s.node_id=e.source_node_id LEFT JOIN cognitive_nodes t ON t.node_id=e.target_node_id WHERE s.node_id IS NULL OR t.node_id IS NULL OR s.project_id<>e.project_id OR t.project_id<>e.project_id LIMIT 1`).get());
        if (version === '0050')
            return this.hasColumns('topology_time_rebuild_jobs', ['project_id', 'generation', 'time_zone', 'status', 'cursor_created_at', 'cursor_neuron_id', 'neuron_count', 'updated_at', 'error'])
                && this.hasColumns('topology_time_rebuild_buckets', ['generation', 'bucket_id', 'project_id', 'time_zone', 'bucket_type', 'bucket_start', 'bucket_end', 'label'])
                && this.hasColumns('topology_time_rebuild_entries', ['generation', 'bucket_id', 'neuron_id', 'project_id', 'created_at'])
                && this.hasColumns('topology_time_rebuild_active_neurons', ['generation', 'neuron_id', 'project_id', 'created_at', 'title'])
                && Boolean(this.db.prepare(`SELECT 1 FROM pragma_index_list('topology_time_rebuild_entries') WHERE name='idx_topology_time_rebuild_entries_neuron'`).get())
                && Boolean(this.db.prepare(`SELECT 1 FROM pragma_index_list('topology_time_rebuild_active_neurons') WHERE name='idx_topology_time_rebuild_active_neurons'`).get());
        if (version === '0051')
            return this.hasColumns('topology_projection_state', ['source_revision'])
                && this.hasColumns('topology_time_rebuild_jobs', ['source_revision'])
                && this.hasColumns('topology_source_revisions', ['project_id', 'revision', 'updated_at'])
                && this.hasColumns('topology_time_rebuild_cognitive_nodes', ['generation', 'node_id', 'project_id'])
                && this.hasColumns('topology_time_rebuild_cognitive_edges', ['generation', 'edge_id', 'project_id'])
                && this.hasColumns('topology_time_rebuild_adjacency', ['generation', 'project_id', 'source_bucket_id', 'adjacent_bucket_id'])
                && Boolean(this.db.prepare(`SELECT 1 FROM pragma_index_list('time_bucket_entries') WHERE name='idx_time_bucket_entries_reference_unique'`).get())
                && !Boolean(this.db.prepare(`SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE s.project_id IS NULL LIMIT 1`).get())
                && !Boolean(this.tableExists('neurons') && this.db.prepare(`SELECT 1 FROM (SELECT COALESCE(project_id,'') AS project_id,COUNT(*) AS source_count FROM neurons WHERE is_deleted=0 GROUP BY COALESCE(project_id,'')) n LEFT JOIN topology_source_revisions r ON r.project_id=n.project_id LEFT JOIN topology_projection_state s ON s.project_id=n.project_id WHERE r.project_id IS NULL OR r.revision<n.source_count OR s.project_id IS NULL LIMIT 1`).get());
        if (version === '0052')
            return ((!this.tableExists('task_branches') && !this.tableExists('event_clusters'))
                || (this.hasUniqueIndex('task_branches', ['project_id', 'task_key'])
                    && this.hasUniqueIndex('event_clusters', ['project_id', 'cluster_key'])
                    && Boolean(this.db.prepare(`SELECT 1 FROM pragma_index_list('task_branch_entries') WHERE name='idx_task_branch_entries_reference_unique'`).get())
                    && Boolean(this.db.prepare(`SELECT 1 FROM pragma_index_list('event_cluster_entries') WHERE name='idx_event_cluster_entries_reference_unique'`).get())));
        if (version === '0053')
            return this.tableExists('topology_identity_quarantine')
                && this.tableExists('vector_write_outbox')
                && this.tableExists('migration_repair_receipts')
                && (!this.tableExists('topology_time_rebuild_jobs') || this.hasColumns('topology_time_rebuild_jobs', ['publish_token', 'publish_lease_until']))
                && (!this.tableExists('time_bucket_entries') || Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info('time_bucket_entries') WHERE name='project_id' AND "notnull"=1`).get()))
                && ((!this.tableExists('task_branches') && !this.tableExists('event_clusters'))
                    || (this.hasUniqueIndex('task_branches', ['project_id', 'task_key'])
                        && this.hasUniqueIndex('event_clusters', ['project_id', 'cluster_key'])
                        && Boolean(this.db.prepare(`SELECT 1 FROM pragma_index_list('task_branch_entries') WHERE name='idx_task_branch_entries_reference_unique'`).get())
                        && Boolean(this.db.prepare(`SELECT 1 FROM pragma_index_list('event_cluster_entries') WHERE name='idx_event_cluster_entries_reference_unique'`).get())));
        if (version === '0054')
            return this.hasColumns('topology_identity_quarantine', ['implicated_scopes_json'])
                && (!this.tableExists('branch_entries') || this.hasColumns('branch_entries', ['project_id']))
                && (!this.tableExists('task_branch_entries') || this.hasColumns('task_branch_entries', ['project_id']))
                && (!this.tableExists('event_cluster_entries') || this.hasColumns('event_cluster_entries', ['project_id']))
                && topologyIntegritySatisfied(this.db);
        if (version === '0055')
            return (!this.tableExists('branch_links') || this.hasColumns('branch_links', ['project_id']))
                && topologyFinalizationSatisfied(this.db);
        return true;
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
    hasUniqueIndex(table, names) {
        if (!this.tableExists(table))
            return false;
        const indexes = this.db.prepare(`PRAGMA index_list(${table})`).all();
        return indexes.some((index) => {
            if (!index.name || Number(index.unique) !== 1)
                return false;
            const columns = this.db.prepare(`PRAGMA index_info(${index.name})`).all();
            return columns.map((column) => column.name).join('|') === names.join('|');
        });
    }
}
