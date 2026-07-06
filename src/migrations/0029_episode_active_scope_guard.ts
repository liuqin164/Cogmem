import type { Migration } from '../types/Migration.js';

export const migration_0029: Migration = {
  version: '0029',
  description: 'episode active scope uniqueness guard',
  up(db) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_episodes_one_active_scope
        ON memory_episodes(project_id, session_id, COALESCE(source_agent, ''), COALESCE(conversation_thread_id, ''))
        WHERE status IN ('open', 'soft_sealed');
    `);
  },
  down(db) {
    db.exec(`DROP INDEX IF EXISTS idx_memory_episodes_one_active_scope;`);
  },
};
