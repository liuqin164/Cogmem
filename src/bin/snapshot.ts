#!/usr/bin/env bun
import { join } from 'node:path';

import { SnapshotImporter, createMemoryKernel, createMemoryKernelFromConfig } from '../public.js';
import { loadCogmemConfig, resolveCogmemConfigPath, type LoadedCogmemConfig } from '../config/CogmemConfig.js';
import { parseVectorDimensionValue } from '../config/VectorDimension.js';
import { config } from '../utils/Config.js';
import { printCliJson } from './CliJson.js';

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
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}

function stringArg(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalPositiveIntegerArg(args: Record<string, string | boolean>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  const diagnostics: Array<{ severity: 'warning' | 'error'; code: string; message: string }> = [];
  const parsed = parseVectorDimensionValue(value, `--${key}`, diagnostics);
  const error = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error || parsed === undefined) throw new Error(error?.message ?? `--${key} must be a positive integer.`);
  return parsed;
}

function loadConfig(args: Record<string, string | boolean>): LoadedCogmemConfig | undefined {
  const explicit = stringArg(args, 'config');
  if (explicit) return loadCogmemConfig({ configPath: explicit });
  const resolution = resolveCogmemConfigPath();
  return resolution.kind === 'toml' ? loadCogmemConfig({ configPath: resolution.path }) : undefined;
}

function configuredDbPath(args: Record<string, string | boolean>, loaded?: LoadedCogmemConfig): string {
  return stringArg(args, 'db') || loaded?.options.dbPath || requireString(args, 'db');
}

function defaultSnapshotPath(loaded: LoadedCogmemConfig): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(loaded.paths.snapshotsDir, `memory-${stamp}.snap`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const loaded = loadConfig(args);
  if (command === 'export') {
    const dbPath = configuredDbPath(args, loaded);
    const outputPath = stringArg(args, 'out') || (loaded ? defaultSnapshotPath(loaded) : requireString(args, 'out'));
    const kernel = loaded && !stringArg(args, 'db')
      ? createMemoryKernelFromConfig({ configPath: loaded.configPath })
      : createMemoryKernel({ dbPath });
    const meta = await kernel.exportSnapshot(outputPath);
    kernel.close();
    printCliJson('snapshot.export', meta);
    return;
  }
  if (command === 'import') {
    const snapshotPath = requireString(args, 'snap');
    const dbPath = configuredDbPath(args, loaded);
    const importer = new SnapshotImporter({
      // Use the dimension declared in config rather than instantiating a VectorStore
      // (which would try to load hnswlib-node and emit a noisy warning when unavailable).
      expectedEmbeddingDimension: optionalPositiveIntegerArg(args, 'dimension') ?? loaded?.options.vectorDimension ?? config.vector.dimension,
    });
    const result = await importer.import(snapshotPath, dbPath, {
      dryRun: args['dry-run'] === true,
      overwrite: args.overwrite === true,
    });
    printCliJson('snapshot.import', result);
    return;
  }
  throw new Error('Usage: snapshot.ts export [--config <config.toml>|--db <db>] [--out <snap>] | import --snap <snap> [--config <config.toml>|--db <db>] [--dry-run] [--overwrite]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
