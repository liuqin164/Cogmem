/**
 * SQLite implementations of the domain ports.
 *
 * These adapters delegate to the existing stores. They exist to fix the
 * boundary, not to reimplement behavior: every method forwards to the code
 * that already ships, so the SQLite path stays the behavioral oracle a future
 * backend must match.
 */
import type { Database } from 'bun:sqlite';
import type { BrainRecall } from '../../recall/BrainRecall.js';
import type { MemoryGovernanceExecutor } from '../../governance/MemoryGovernanceExecutor.js';
import type { EpisodePort, GovernancePort, MemoryGraphPort, RawLedgerPort, RecallPort, SharedMemoryPort } from '../../ports/index.js';
export interface SqlitePortsOptions {
    db: Database;
    /** Required only if `recall` is used. */
    recall?: BrainRecall;
    /** Required only if `governance` is used. */
    governance?: MemoryGovernanceExecutor;
    /**
     * Shared region, when the caller wants one. 4.0 does not create it by
     * default: constructing a region makes its table exist, and no 4.0 entry
     * point offers sharing, so an unused table is storage nobody asked for.
     * See ADR-0005.
     */
    shared?: SharedMemoryPort;
}
export interface SqlitePorts {
    rawLedger: RawLedgerPort;
    episodes: EpisodePort;
    graph: MemoryGraphPort;
    recall: RecallPort | null;
    governance: GovernancePort | null;
    shared: SharedMemoryPort | null;
}
export declare function createSqlitePorts(options: SqlitePortsOptions): SqlitePorts;
//# sourceMappingURL=SqliteMemoryPorts.d.ts.map