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
 * Shared region. Publishing is idempotent on `itemHash`; retraction is soft, so
 * a subscriber's earlier reasoning stays explainable.
 */
export interface SharedMemoryPort {
  publish(items: SharedItem[]): Promise<number>;
  retract(retraction: SharedRetraction): Promise<void>;
  subscribe(collections: string[], options?: { limit?: number }): Promise<SharedItem[]>;
  explain(itemHash: string): Promise<{ item: SharedItem; retractedAt: number | null } | null>;
}
