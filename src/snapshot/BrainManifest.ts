/**
 * The manifest a whole-brain snapshot and a moving bundle share (#196, F19).
 *
 * A snapshot is the existing `.snap` DB copy plus this JSON manifest; a bundle embeds the same
 * manifest beside the DB bytes. The counts and the verification are the part a machine reads back,
 * so both formats are held to `docs/health-backup.md` by one contract test.
 */
import type Database from 'bun:sqlite';

export const SNAPSHOT_RETENTION = 7;
export const SNAPSHOT_FORMAT = 'cogmem.brain-snapshot' as const;
export const SNAPSHOT_MANIFEST_VERSION = 1;
export const BUNDLE_FORMAT = 'cogmem.brain-bundle' as const;
export const BUNDLE_FORMAT_VERSION = 1;

export const BRAIN_COUNT_FIELDS = ['events', 'episodes', 'frames', 'atlasDocuments', 'soulVersions'] as const;
export const BRAIN_CONFIG_FIELDS = ['vectorDimension', 'projectTimeZone', 'memoryProvider', 'reasoningProvider'] as const;
export const SNAPSHOT_VERIFICATION_CHECKS = ['checksum', 'opens', 'counts'] as const;

export interface BrainCounts {
  events: number;
  episodes: number;
  frames: number;
  atlasDocuments: number;
  soulVersions: number;
}

export interface BrainConfig {
  vectorDimension: number;
  projectTimeZone: string;
  memoryProvider: string;
  reasoningProvider: string;
}

export interface BrainSoulVersion {
  agentId: string;
  version: number;
}

export interface BrainVerification {
  ok: boolean;
  checkedAt: string;
  checks: Record<(typeof SNAPSHOT_VERIFICATION_CHECKS)[number], boolean>;
  detail?: string;
}

export interface BrainManifest {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_MANIFEST_VERSION;
  createdAt: string;
  coreVersion: string;
  snapshot: {
    file: string;
    byteLength: number;
    checksum: string;
  };
  counts: BrainCounts;
  soulVersions: BrainSoulVersion[];
  config: BrainConfig;
  verification: BrainVerification;
}

/** The five frozen counts. A missing table is 0: a brain that never used a face has none of it. */
export function readBrainCounts(db: Database): BrainCounts {
  const count = (table: string): number => {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: number } | undefined;
      return Number(row?.c ?? 0);
    } catch {
      return 0;
    }
  };
  return {
    events: count('memory_events'),
    episodes: count('memory_episodes'),
    frames: count('memory_frames'),
    atlasDocuments: count('memory_atlas_documents'),
    soulVersions: count('soul_versions'),
  };
}

/** The current version per agent, which is what a restore has to reproduce. */
export function readSoulVersions(db: Database): BrainSoulVersion[] {
  try {
    return (db.prepare(`
      SELECT agent_id, MAX(version) AS version
        FROM soul_versions
       GROUP BY agent_id
       ORDER BY agent_id
    `).all() as Array<{ agent_id: string; version: number }>)
      .map((row) => ({ agentId: row.agent_id, version: Number(row.version) }));
  } catch {
    return [];
  }
}
