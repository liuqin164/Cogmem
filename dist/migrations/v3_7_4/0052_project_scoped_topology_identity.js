export const migration_0052 = {
    version: '0052',
    description: 'scope task and event cluster identities by project',
    up(db) {
        if (!tableExists(db, 'task_branches') || !tableExists(db, 'event_clusters'))
            return;
        db.exec(`
      CREATE TEMP TABLE task_identity_map AS
      WITH normalized AS (
        SELECT
          task_id AS old_id,
          COALESCE(project_id, '') AS project_id,
          CASE
            WHEN task_key LIKE (CASE WHEN COALESCE(project_id, '') = '' THEN 'global' ELSE project_id END) || ':%'
              THEN substr(task_key, length(CASE WHEN COALESCE(project_id, '') = '' THEN 'global' ELSE project_id END) + 2)
            ELSE task_key
          END AS normalized_key,
          created_at
        FROM task_branches
      )
      SELECT old_id, project_id, normalized_key,
        FIRST_VALUE(old_id) OVER (
          PARTITION BY project_id, normalized_key
          ORDER BY created_at ASC, old_id ASC
        ) AS new_id
      FROM normalized;

      CREATE TABLE task_branches_v0052 (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        task_key TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, task_key)
      );

      INSERT INTO task_branches_v0052(task_id,project_id,task_key,title,status,created_at,updated_at)
      SELECT map.new_id,map.project_id,map.normalized_key,source.title,source.status,source.created_at,source.updated_at
      FROM task_identity_map map
      JOIN task_branches source ON source.task_id=map.new_id
      WHERE map.old_id=map.new_id;

      CREATE TABLE task_branch_entries_v0052 (
        task_id TEXT NOT NULL,
        neuron_id TEXT,
        unit_id TEXT,
        belief_id TEXT,
        fact_id TEXT,
        event_id TEXT,
        created_at INTEGER NOT NULL
      );

      INSERT INTO task_branch_entries_v0052(task_id,neuron_id,unit_id,belief_id,fact_id,event_id,created_at)
      SELECT map.new_id,entry.neuron_id,entry.unit_id,entry.belief_id,entry.fact_id,entry.event_id,MIN(entry.created_at)
      FROM task_branch_entries entry
      JOIN task_identity_map map ON map.old_id=entry.task_id
      GROUP BY map.new_id,COALESCE(entry.neuron_id,''),COALESCE(entry.unit_id,''),COALESCE(entry.belief_id,''),COALESCE(entry.fact_id,''),COALESCE(entry.event_id,'');

      CREATE TEMP TABLE cluster_identity_map AS
      WITH normalized AS (
        SELECT
          cluster_id AS old_id,
          COALESCE(project_id, '') AS project_id,
          CASE
            WHEN cluster_key LIKE (CASE WHEN COALESCE(project_id, '') = '' THEN 'global' ELSE project_id END) || ':%'
              THEN substr(cluster_key, length(CASE WHEN COALESCE(project_id, '') = '' THEN 'global' ELSE project_id END) + 2)
            ELSE cluster_key
          END AS normalized_key,
          created_at
        FROM event_clusters
      )
      SELECT old_id, project_id, normalized_key,
        FIRST_VALUE(old_id) OVER (
          PARTITION BY project_id, normalized_key
          ORDER BY created_at ASC, old_id ASC
        ) AS new_id
      FROM normalized;

      CREATE TABLE event_clusters_v0052 (
        cluster_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        cluster_key TEXT NOT NULL,
        cluster_type TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, cluster_key)
      );

      INSERT INTO event_clusters_v0052(cluster_id,project_id,cluster_key,cluster_type,title,created_at,updated_at)
      SELECT map.new_id,map.project_id,map.normalized_key,source.cluster_type,source.title,source.created_at,source.updated_at
      FROM cluster_identity_map map
      JOIN event_clusters source ON source.cluster_id=map.new_id
      WHERE map.old_id=map.new_id;

      CREATE TABLE event_cluster_entries_v0052 (
        cluster_id TEXT NOT NULL,
        neuron_id TEXT,
        unit_id TEXT,
        belief_id TEXT,
        fact_id TEXT,
        event_id TEXT,
        created_at INTEGER NOT NULL
      );

      INSERT INTO event_cluster_entries_v0052(cluster_id,neuron_id,unit_id,belief_id,fact_id,event_id,created_at)
      SELECT map.new_id,entry.neuron_id,entry.unit_id,entry.belief_id,entry.fact_id,entry.event_id,MIN(entry.created_at)
      FROM event_cluster_entries entry
      JOIN cluster_identity_map map ON map.old_id=entry.cluster_id
      GROUP BY map.new_id,COALESCE(entry.neuron_id,''),COALESCE(entry.unit_id,''),COALESCE(entry.belief_id,''),COALESCE(entry.fact_id,''),COALESCE(entry.event_id,'');

      DROP TABLE task_branch_entries;
      DROP TABLE task_branches;
      ALTER TABLE task_branches_v0052 RENAME TO task_branches;
      ALTER TABLE task_branch_entries_v0052 RENAME TO task_branch_entries;

      DROP TABLE event_cluster_entries;
      DROP TABLE event_clusters;
      ALTER TABLE event_clusters_v0052 RENAME TO event_clusters;
      ALTER TABLE event_cluster_entries_v0052 RENAME TO event_cluster_entries;

      CREATE UNIQUE INDEX idx_task_branch_entries_reference_unique
        ON task_branch_entries(task_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
      CREATE UNIQUE INDEX idx_event_cluster_entries_reference_unique
        ON event_cluster_entries(cluster_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));

      DELETE FROM topology_membership WHERE dimension_type IN ('task_branch','event_cluster');
      INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at)
      SELECT entry.neuron_id,NULLIF(task.project_id,''),'task_branch',task.task_key,task.title,entry.created_at
      FROM task_branch_entries entry
      JOIN task_branches task ON task.task_id=entry.task_id
      WHERE entry.neuron_id IS NOT NULL;
      INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at)
      SELECT entry.neuron_id,NULLIF(cluster.project_id,''),'event_cluster',cluster.cluster_key,cluster.title,entry.created_at
      FROM event_cluster_entries entry
      JOIN event_clusters cluster ON cluster.cluster_id=entry.cluster_id
      WHERE entry.neuron_id IS NOT NULL;

      DROP TABLE task_identity_map;
      DROP TABLE cluster_identity_map;
    `);
    },
    down() { },
};
function tableExists(db, name) {
    return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}
