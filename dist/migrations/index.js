import { migration_0001 } from './0001_init.js';
import { migration_0002 } from './0002_v06_platform.js';
import { migration_0003 } from './0003_v07_dialogues.js';
import { migration_0004 } from './0004_v09_self_improvement.js';
import { migration_0005 } from './0005_dialogue_buffer.js';
import { migration_0006 } from './0006_deep_write_memory.js';
import { migration_0007 } from './0007_deep_write_summaries.js';
import { migration_0009 } from './0009_memory_importance.js';
import { migration_0010 } from './0010_skill_neurons.js';
import { migration_0011 } from './0011_topic_path.js';
import { migration_0012 } from './0012_governance_security.js';
import { migration_0015 } from './0015_memory_governance.js';
import { migration_0016 } from './0016_entity_governance.js';
import { migration_0017 } from './0017_belief_graph.js';
import { migration_0018 } from './0018_temporal_memory.js';
import { migration_0019 } from './0019_context_cortex.js';
import { migration_0020 } from './0020_prospective_memory.js';
import { migration_0021 } from './0021_strategy_cortex.js';
import { migration_0022 } from './0022_episode_dream_engine.js';
/**
 * Ordered list of all schema migrations.
 * Add new migrations here in ascending version order.
 * MigrationRunner.up() applies only the pending ones.
 */
export const ALL_MIGRATIONS = [
    migration_0001,
    migration_0002,
    migration_0003,
    migration_0004,
    migration_0005,
    migration_0006,
    migration_0007,
    migration_0009,
    migration_0010,
    migration_0011,
    migration_0012,
    migration_0015,
    migration_0016,
    migration_0017,
    migration_0018,
    migration_0019,
    migration_0020,
    migration_0021,
    migration_0022,
];
export { migration_0001, migration_0002, migration_0003, migration_0004, migration_0005, migration_0006, migration_0007, migration_0009, migration_0010, migration_0011, migration_0012, migration_0015, migration_0016, migration_0017, migration_0018, migration_0019, migration_0020, migration_0021, migration_0022 };
export { SchemaMigrationRunner } from './SchemaMigrationRunner.js';
