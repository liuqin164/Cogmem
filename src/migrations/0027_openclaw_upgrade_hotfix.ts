import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0027: Migration = {
  version: '0027',
  description: 'mark Atlas projections dirty after 3.6.0 upgrade hotfix',
  up(db: Database): void {
    db.exec(`
      UPDATE memory_atlas_projection_state
      SET status='dirty',
          last_error=NULL,
          metadata_json='{"migration":"0027","reason":"3.6.0_may_have_marked_action_time_projection_clean_too_early"}'
      WHERE projection_name='memory_atlas.v1'
        AND status='clean'
        AND (
          metadata_json IS NULL
          OR json_extract(metadata_json, '$.migration') IN ('0025','0026')
        );
    `);
  },
  down(): void {
    // Projection freshness is rebuildable state; do not re-mark it clean on downgrade.
  },
};
