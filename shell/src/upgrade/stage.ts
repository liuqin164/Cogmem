/**
 * Stage a new tree beside the serving one: the "旁置" half.
 *
 * The staged tree is a *copy* under `<dataDir>/app/versions/<version>`, never the tree the operator
 * pointed at and never the one being served. That is what makes the switch cheap and the rollback
 * trivial: the old tree is still on disk, unmodified, so putting the service back on it is one argv
 * change, not a rebuild.
 *
 * Dependencies are symlinked, not copied: `node_modules` is hundreds of megabytes and a prototype
 * upgrade has no business duplicating it. The cost is stated rather than hidden — a staged tree is
 * only valid while its source tree's dependencies are (see `shell/UPGRADE.md`).
 */
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { looksLikeCogTree, readTreeVersion } from './paths.ts';
import { upgradeVersionsDir } from './records.ts';

/** Nothing that is regenerable, huge, or a data directory belongs in a staged tree. */
const EXCLUDED = new Set(['node_modules', '.git', 'dist', 'coverage', '.cogmem', '.cogmem-shell', '.tmp', '.cache']);

export interface StageUpgradeInput {
  source: string;
  dataDir: string;
  /** The tree being served; staging onto it would delete the running code. */
  currentTree: string;
  /** Stage here instead of `<dataDir>/app/versions/<version>`; tests use it. */
  targetDir?: string;
}

export interface StagedTree {
  tree: string;
  version: string;
  /** The dependency directories that were symlinked from the source, for the report's honesty. */
  linkedDeps: string[];
}

export class UpgradeStageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export function stageUpgradeTree(input: StageUpgradeInput): StagedTree {
  const source = resolve(input.source);
  if (!looksLikeCogTree(source)) {
    throw new UpgradeStageError('not_a_cog_tree', `${source} has no shell/src/cli.ts and src/public.ts`);
  }
  const version = readTreeVersion(source);
  const target = resolve(input.targetDir ?? join(upgradeVersionsDir(input.dataDir), version));
  if (target === resolve(source)) {
    throw new UpgradeStageError('source_is_target', `the staged tree would be its own source: ${target}`);
  }
  if (target === resolve(input.currentTree)) {
    throw new UpgradeStageError('target_is_serving_tree', `refusing to stage over the tree that is serving: ${target}`);
  }
  if (source === resolve(input.currentTree)) {
    // `/upgrade <the tree I am already running>` reads as a request to upgrade to itself; saying so is
    // kinder than staging a copy, snapshotting the brain and restarting on the same version.
    throw new UpgradeStageError('source_is_serving_tree', `the source tree is the one already serving: ${source}`);
  }
  if (!existsSync(join(source, 'node_modules')) && !existsSync(join(source, 'shell', 'node_modules'))) {
    // Without dependencies the staged tree cannot pass its own gate, and installing them here would
    // make an upgrade depend on the network. Name the fix instead.
    throw new UpgradeStageError(
      'source_tree_has_no_dependencies',
      `${source} has no node_modules; run \`bun install\` in it (and in its shell/) before upgrading from it`,
    );
  }

  // Idempotent: a re-stage replaces the previous attempt at the same version rather than failing.
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true, mode: 0o700 });
  cpSync(source, target, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const name = src.slice(source.length + 1).split('/')[0] ?? '';
      return name === '' || !EXCLUDED.has(name);
    },
  });

  const linkedDeps: string[] = [];
  for (const relative of ['node_modules', join('shell', 'node_modules')]) {
    const from = join(source, relative);
    if (!existsSync(from)) continue;
    const to = join(target, relative);
    rmSync(to, { recursive: true, force: true });
    symlinkSync(from, to);
    linkedDeps.push(relative);
  }
  return { tree: target, version, linkedDeps };
}
