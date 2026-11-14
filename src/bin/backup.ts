#!/usr/bin/env bun
import { join } from 'node:path';

import { createMemoryKernel, createMemoryKernelFromConfig } from '../public.js';
import { loadCogmemConfig, resolveCogmemConfigPath, type LoadedCogmemConfig } from '../config/CogmemConfig.js';
import { restoreBrainBundle } from '../snapshot/index.js';
import { printCliJson } from './CliJson.js';
import { assertCliArgs } from './CliArgs.js';
import { emitRefusalDocument } from './RefusalDocument.js';

const USAGE = 'Usage: cogmem backup snapshot [--config <config.toml>|--db <db>] | list [--config <config.toml>|--db <db>] | bundle [--config <config.toml>|--db <db>] [--out <bundle>] | restore --bundle <bundle> --db <db> [--overwrite] [--json]';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function requireString(args: Record<string, string | boolean>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required --${key}`);
  return value;
}

function stringArg(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function loadConfig(args: Record<string, string | boolean>): LoadedCogmemConfig | undefined {
  const explicit = stringArg(args, 'config');
  if (explicit) return loadCogmemConfig({ configPath: explicit });
  const resolution = resolveCogmemConfigPath();
  return resolution.kind === 'toml' ? loadCogmemConfig({ configPath: resolution.path }) : undefined;
}

function openKernel(args: Record<string, string | boolean>, loaded: LoadedCogmemConfig | undefined) {
  return loaded && !stringArg(args, 'db')
    ? createMemoryKernelFromConfig({ configPath: loaded.configPath })
    : createMemoryKernel({ dbPath: requireString(args, 'db') });
}

async function main(): Promise<void> {
  assertCliArgs(process.argv.slice(2), { usage: USAGE, extraFlags: ['bundle', 'config', 'db', 'json', 'out', 'overwrite'] });
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const loaded = loadConfig(args);

  if (command === 'restore') {
    const bundlePath = requireString(args, 'bundle');
    const targetDb = requireString(args, 'db');
    // Restore does not open a kernel: it stages the bundle, verifies its counts, then moves it into place.
    const result = restoreBrainBundle(bundlePath, targetDb, { overwrite: args.overwrite === true });
    printCliJson('backup.restore', result, { outExempt: true });
    return;
  }

  const kernel = openKernel(args, loaded);
  try {
    if (command === 'snapshot') {
      const manifest = await kernel.backup.snapshot();
      if (!manifest) throw new Error('No snapshots directory is configured; run with --config or set snapshotsDir in the config.');
      printCliJson('backup.snapshot', { snapshot: manifest.snapshot, verification: manifest.verification, counts: manifest.counts }, { outExempt: true });
      return;
    }
    if (command === 'list') {
      const manifests = kernel.backup.list();
      printCliJson('backup.list', { snapshots: manifests.map((manifest) => ({ ...manifest.snapshot, createdAt: manifest.createdAt, verification: manifest.verification })) }, { outExempt: true });
      return;
    }
    if (command === 'bundle') {
      const out = stringArg(args, 'out') ?? join(loaded?.paths.snapshotsDir ?? process.cwd(), `brain-${new Date().toISOString().replace(/[:.]/g, '-')}.bundle`);
      const result = await kernel.bundle.exportBundle(out);
      printCliJson('backup.bundle', { path: result.path, byteLength: result.byteLength, counts: result.manifest.counts }, { outExempt: true });
      return;
    }
  } finally {
    kernel.close();
  }
  throw new Error(USAGE);
}

main().catch((error) => {
  if (emitRefusalDocument(error, 'backup')) return;
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
