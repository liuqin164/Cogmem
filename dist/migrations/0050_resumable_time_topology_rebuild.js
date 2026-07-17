export const migration_0050 = {
    version: '0050',
    description: 'add resumable staging for project time topology rebuilds',
    up(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS topology_time_rebuild_jobs (
        project_id TEXT PRIMARY KEY,
        generation TEXT NOT NULL UNIQUE,
        time_zone TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('building','ready','failed')),
        cursor_created_at INTEGER,
        cursor_neuron_id TEXT,
        neuron_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS topology_time_rebuild_buckets (
        generation TEXT NOT NULL,
        bucket_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        bucket_type TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        bucket_end INTEGER NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY(generation,bucket_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS topology_time_rebuild_entries (
        generation TEXT NOT NULL,
        bucket_id TEXT NOT NULL,
        neuron_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(generation,bucket_id,neuron_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS topology_time_rebuild_active_neurons (
        generation TEXT NOT NULL,
        neuron_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY(generation,neuron_id),
        FOREIGN KEY(generation) REFERENCES topology_time_rebuild_jobs(generation)
          ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_topology_time_rebuild_entries_neuron
        ON topology_time_rebuild_entries(generation,created_at,neuron_id);
      CREATE INDEX IF NOT EXISTS idx_topology_time_rebuild_active_neurons
        ON topology_time_rebuild_active_neurons(generation,created_at,neuron_id);
    `);
    },
    down() { },
};
