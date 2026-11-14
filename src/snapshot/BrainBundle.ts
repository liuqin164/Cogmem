/**
 * The machine-restorable moving bundle (#196, F19).
 *
 * A bundle is the same `VACUUM INTO` DB copy and sha256 the nightly snapshot uses, with its manifest
 * embedded in front of the bytes. It is deliberately not F9's Markdown archive: that one is for a
 * person to read, this one is for a machine to restore. The contract is `docs/health-backup.md`.
 */
import { createHash } from 'node:crypto';
import Database from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { SnapshotExporter } from './SnapshotExporter.js';
import { readSnapshotFile } from './SnapshotImporter.js';
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  readBrainCounts,
  readSoulVersions,
  type BrainConfig,
  type BrainCounts,
  type BrainSoulVersion,
} from './BrainManifest.js';

export interface BrainBundleManifest {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_FORMAT_VERSION;
  createdAt: string;
  coreVersion: string;
  db: {
    byteLength: number;
    checksum: string;
  };
  counts: BrainCounts;
  soulVersions: BrainSoulVersion[];
  config: BrainConfig;
}

export interface BrainBundleOptions {
  dbPath: string;
  embeddingDimension: number;
  coreVersion: string;
  config: BrainConfig;
  now?: () => number;
}

export type BrainBundleErrorCode =
  | 'invalid_bundle'
  | 'bundle_checksum_mismatch'
  | 'bundle_counts_mismatch'
  | 'bundle_target_exists';

export class BrainBundleError extends Error {
  constructor(readonly code: BrainBundleErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BrainBundleError';
  }
}

export interface BrainBundleExportResult {
  manifest: BrainBundleManifest;
  path: string;
  byteLength: number;
}

export interface BrainBundleRestoreResult {
  manifest: BrainBundleManifest;
  targetPath: string;
  counts: BrainCounts;
  soulVersions: BrainSoulVersion[];
}

export class BrainBundle {
  private readonly now: () => number;

  constructor(private readonly options: BrainBundleOptions) {
    this.now = options.now ?? Date.now;
  }

  async exportBundle(outputPath: string): Promise<BrainBundleExportResult> {
    if (this.options.dbPath === ':memory:' || this.options.dbPath.startsWith('file:')) {
      throw new BrainBundleError('invalid_bundle', 'a bundle needs a file-backed database');
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    const tempPath = join(dirname(outputPath), `.bundle-${Date.now()}-${Math.random().toString(36).slice(2)}.snap`);
    try {
      const meta = await new SnapshotExporter({
        embeddingDimension: this.options.embeddingDimension,
        coreVersion: this.options.coreVersion,
      }).export(this.options.dbPath, tempPath);
      const { dbBytes } = readSnapshotFile(tempPath);
      const counts = this.readCounts();
      const manifest: BrainBundleManifest = {
        format: BUNDLE_FORMAT,
        version: BUNDLE_FORMAT_VERSION,
        createdAt: new Date(this.now()).toISOString(),
        coreVersion: this.options.coreVersion,
        db: { byteLength: dbBytes.byteLength, checksum: meta.header.checksum },
        counts,
        soulVersions: this.readSoulVersions(),
        config: this.options.config,
      };
      const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(manifestBytes.length, 0);
      const bundleBytes = Buffer.concat([prefix, manifestBytes, dbBytes]);
      writeFileSync(outputPath, bundleBytes);
      return { manifest, path: outputPath, byteLength: bundleBytes.byteLength };
    } finally {
      rmSync(tempPath, { force: true });
    }
  }

  restoreBundle(
    bundlePath: string,
    targetDbPath: string,
    options: { overwrite?: boolean } = {},
  ): BrainBundleRestoreResult {
    return restoreBrainBundle(bundlePath, targetDbPath, options);
  }

  private readCounts(): BrainCounts {
    const db = new Database(this.options.dbPath, { readonly: true });
    try {
      return readBrainCounts(db);
    } finally {
      db.close();
    }
  }

  private readSoulVersions(): BrainSoulVersion[] {
    const db = new Database(this.options.dbPath, { readonly: true });
    try {
      return readSoulVersions(db);
    } finally {
      db.close();
    }
  }
}

/**
 * Restore a bundle without an instance: it needs no source database or config, only the file.
 * `BrainBundle.restoreBundle` delegates here so the CLI can restore into a clean directory.
 */
export function restoreBrainBundle(
  bundlePath: string,
  targetDbPath: string,
  options: { overwrite?: boolean } = {},
): BrainBundleRestoreResult {
  const bytes = readFileSync(bundlePath);
  if (bytes.byteLength < 5) throw new BrainBundleError('invalid_bundle', 'truncated');
  const manifestLength = bytes.readUInt32LE(0);
  const manifestEnd = 4 + manifestLength;
  if (manifestEnd > bytes.byteLength) throw new BrainBundleError('invalid_bundle', 'truncated manifest');
  let manifest: BrainBundleManifest;
  try {
    manifest = JSON.parse(bytes.subarray(4, manifestEnd).toString('utf8')) as BrainBundleManifest;
  } catch {
    throw new BrainBundleError('invalid_bundle', 'manifest is not JSON');
  }
  if (manifest.format !== BUNDLE_FORMAT || manifest.version !== BUNDLE_FORMAT_VERSION) {
    throw new BrainBundleError('invalid_bundle', `unsupported format ${String(manifest.format)} v${String(manifest.version)}`);
  }
  const dbBytes = bytes.subarray(manifestEnd);
  const checksum = createHash('sha256').update(dbBytes).digest('hex');
  if (checksum !== manifest.db.checksum || dbBytes.byteLength !== manifest.db.byteLength) {
    throw new BrainBundleError('bundle_checksum_mismatch', 'the DB bytes do not match the manifest');
  }
  if (existsSync(targetDbPath) && options.overwrite !== true) {
    throw new BrainBundleError('bundle_target_exists', targetDbPath);
  }
  // Restore into a temporary file first: a bundle whose counts disagree must not leave a
  // half-written brain at the operator's target, and an overwrite must not destroy the old one
  // before the new one is known to be complete.
  mkdirSync(dirname(targetDbPath), { recursive: true });
  const stagedPath = join(dirname(targetDbPath), `.restore-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  try {
    writeFileSync(stagedPath, dbBytes);
    const db = new Database(stagedPath, { readonly: true });
    let counts: BrainCounts;
    let soulVersions: BrainSoulVersion[];
    try {
      counts = readBrainCounts(db);
      soulVersions = readSoulVersions(db);
    } finally {
      db.close();
    }
    const countMismatch = (Object.keys(manifest.counts) as Array<keyof BrainCounts>)
      .filter((field) => counts[field] !== manifest.counts[field]);
    if (countMismatch.length > 0) {
      throw new BrainBundleError('bundle_counts_mismatch', `counts differ: ${countMismatch.join(', ')}`);
    }
    renameSync(stagedPath, targetDbPath);
    return { manifest, targetPath: targetDbPath, counts, soulVersions };
  } finally {
    rmSync(stagedPath, { force: true });
  }
}
