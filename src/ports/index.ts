/**
 * Ports for the shared memory region.
 *
 * The region is 4.1 work and 4.0 exposes none of it (ADR-0005): the port and its
 * SQLite adapter stay in the tree so the shape is reviewable, reachable from
 * neither the MCP surface nor a package entry point.
 *
 * The raw-ledger, episode, graph, recall and governance ports that used to live
 * here were removed on 2026-10-31: nothing in the kernel called them, they were
 * not on the published surface, and the only user was the adapter's own test.
 * A port with no consumer is a second access path to maintain for no one.
 */

export interface SharedItem {
  itemHash: string;
  sourceHost: string;
  sourceItem: string;
  collection: string;
  payload: Record<string, unknown>;
  publishedAt: number;
}

export interface SharedRetraction {
  itemHash: string;
  retractedAt: number;
  retractedBy: string;
}

/**
 * A shared collection and who may read it. The owner is the host that first published into the
 * collection; the readers list is retained from the per-reader ACL that 4.1 replaced (#146) and is no longer
 * consulted — reading is open to any connected agent while sharing is enabled
 * alone — which is what "sharing is off by default" means at the storage layer.
 */
export interface SharedCollection {
  collection: string;
  ownerHost: string;
  readers: string[];
  createdAt: number;
  itemCount: number;
}

/**
 * Shared region. Publishing is idempotent on `itemHash`; retraction is soft, so
 * a subscriber's earlier reasoning stays explainable.
 *
 * Reading takes the reader's identity and filters unauthorized collections out in SQL: every surface
 * routes through `subscribe`, so this is the one place the check can live. A `subscribe` with no reader
 * returns nothing rather than everything — a missing identity must fail closed.
 */
export interface SharedMemoryPort {
  publish(items: SharedItem[]): Promise<number>;
  retract(retraction: SharedRetraction): Promise<void>;
  subscribe(collections: string[], options: { readerHost?: string; limit?: number }): Promise<SharedItem[]>;
  /** The same read, for a synchronous caller (recall); both go through one implementation. */
  subscribeSync?(collections: string[], options?: { readerHost?: string; limit?: number }): SharedItem[];
  explain(itemHash: string): Promise<{ item: SharedItem; retractedAt: number | null } | null>;
  grantReader(collection: string, readerHost: string, actorHost: string): Promise<void>;
  revokeReader(collection: string, readerHost: string, actorHost: string): Promise<void>;
  listCollections(): Promise<SharedCollection[]>;
  /** The same listing, for a synchronous caller (recall). */
  listCollectionsSync?(): SharedCollection[];
}
