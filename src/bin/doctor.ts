#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { createMemoryKernelFromConfig } from '../factory.js';
import {
  defaultOpenClawAutoMemoryPluginDir,
  inspectOpenClawAutoMemoryPlugin,
  installOpenClawAutoMemoryPlugin,
} from '../host/openclaw/AutoMemoryPluginInstaller.js';
import { compactStorage } from '../storage/StorageCompactor.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function ok(message: string): void {
  console.log(`OK ${message}`);
}

function warn(code: string, message: string): void {
  console.log(`WARN ${code}: ${message}`);
}

function printWarnings(diagnostics: Array<{ severity: string; code: string; message: string }>): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'warning') warn(diagnostic.code, diagnostic.message);
  }
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

const configPath = readArg('--config');
const envPath = readArg('--env-path');
const fix = hasFlag('--fix');
const agent = readArg('--agent');
const workspace = readArg('--workspace');
const openclawConfigPath = readArg('--openclaw-config');
const pluginDir = readArg('--plugin-dir');
const bunPath = readArg('--bun');
const storage = hasFlag('--storage');
const pluginOnly = hasFlag('--plugin-only');
const json = hasFlag('--json');

if (envPath) {
  fail('--env-path is no longer supported. Use cogmem-init to create .cogmem/config.toml, then run cogmem-doctor --config <config.toml>.');
} else {
  const resolution = resolveCogmemConfigPath({ configPath });
  if (resolution.kind === 'missing') fail(`missing config file: ${resolution.path}`);
  const loaded = loadCogmemConfig({ configPath: resolution.path });
  const error = loaded.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error) fail(`${error.code}: ${error.message}`);
  if (pluginOnly) {
    if (agent && agent !== 'openclaw') fail('doctor --plugin-only currently supports --agent openclaw.');
    const workspaceRoot = workspace || loaded.integrations.openclaw.workspaceDir || process.cwd();
    let fixed = undefined as ReturnType<typeof installOpenClawAutoMemoryPlugin> | undefined;
    if (fix) {
      fixed = installOpenClawAutoMemoryPlugin({
        workspaceRoot,
        configPath: resolution.path,
        openclawConfigPath,
        pluginDir,
        bunPath,
        force: true,
      });
    }
    const inspection = inspectOpenClawAutoMemoryPlugin({
      workspaceRoot,
      pluginDir: pluginDir || defaultOpenClawAutoMemoryPluginDir(workspaceRoot),
    });
    const audit = readLatestOpenClawAudit(workspaceRoot);
    if (json) {
      console.log(JSON.stringify({
        schemaVersion: 'cogmem.cli.v1',
        command: 'doctor',
        pluginOnly: true,
        configPath: resolution.path,
        openclaw: { plugin: inspection, fixed, audit },
      }));
    } else {
      printWarnings(loaded.diagnostics);
      ok('configuration parsed');
      ok(`openclaw plugin ${inspection.current ? 'current' : 'stale'} at ${inspection.pluginDir}`);
      if (!inspection.current) warn('openclaw_plugin_stale', 'Run cogmem doctor --fix --agent openclaw --plugin-only --workspace <workspace>.');
      if (fixed) ok(`openclaw auto memory integration fixed at ${fixed.pluginDir}`);
      if (audit.lastBeforePromptBuild) ok(`last before_prompt_build action=${audit.lastBeforePromptBuild.action || 'unknown'} reason=${audit.lastBeforePromptBuild.reason || ''}`);
    }
    process.exit(0);
  }
  printWarnings(loaded.diagnostics);
  ok('configuration parsed');
  ok(`cogmem home ${loaded.homeDir}`);
  const kernel = createMemoryKernelFromConfig({ configPath: resolution.path });
  const health = kernel.getHealthStatus();
  if (health.package !== 'cogmem') fail('unexpected package identity');
  ok(`kernel ready at ${health.dbPath}`);
  kernel.close();
  if (storage) {
    const storageStats = compactStorage({
      dbPath: health.dbPath,
      dryRun: true,
      dimension: loaded.options.vectorDimension,
    });
    ok([
      `storage raw_events=${storageStats.rawEventsBefore}`,
      `vectors=${storageStats.vectorCountBefore}`,
      `vector_bytes=${storageStats.vectorBytesBefore}`,
      `eligible_vector_bytes=${storageStats.eligibleVectorBytes}`,
      `vector_bytes_per_raw_event=${storageStats.vectorBytesPerRawEventBefore.toFixed(2)}`,
    ].join(' '));
    if (storageStats.rawEventsBefore > 0 && storageStats.vectorBytesPerRawEventBefore >= 8192) {
      warn('vector_storage_growth', 'Vector bytes per raw event are high; consider selective_compile/raw_then_dream and cogmem compact --dry-run.');
    }
  }
  if (fix) {
    if (agent !== 'openclaw') {
      fail('doctor --fix currently requires --agent openclaw.');
    }
    const result = installOpenClawAutoMemoryPlugin({
      workspaceRoot: workspace || loaded.integrations.openclaw.workspaceDir || process.cwd(),
      configPath: resolution.path,
      openclawConfigPath,
      pluginDir,
      bunPath,
      force: true,
    });
    ok(`openclaw auto memory integration fixed at ${result.pluginDir}`);
    ok(`openclaw config patched at ${result.openclawConfigPath}`);
  }
  if (agent === 'openclaw' || workspace) {
    const workspaceRoot = workspace || loaded.integrations.openclaw.workspaceDir || process.cwd();
    const inspection = inspectOpenClawAutoMemoryPlugin({
      workspaceRoot,
      pluginDir: pluginDir || defaultOpenClawAutoMemoryPluginDir(workspaceRoot),
    });
    if (inspection.installed) {
      ok(`openclaw plugin ${inspection.current ? 'current' : 'stale'} at ${inspection.pluginDir}`);
      if (!inspection.current) warn('openclaw_plugin_stale', 'Run cogmem connect openclaw --workspace <workspace> --auto --force or cogmem doctor --fix --agent openclaw --plugin-only.');
    }
    const audit = readLatestOpenClawAudit(workspaceRoot);
    if (audit.lastBeforePromptBuild) {
      ok(`last before_prompt_build action=${audit.lastBeforePromptBuild.action || 'unknown'} reason=${audit.lastBeforePromptBuild.reason || ''}`);
    }
  }
}

function readLatestOpenClawAudit(workspaceRoot: string): { lastBeforePromptBuild?: Record<string, unknown> } {
  const logPath = join(workspaceRoot, '.cogmem', 'logs', 'openclaw-auto-memory.jsonl');
  if (!existsSync(logPath)) return {};
  const lines = readFileSync(logPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).slice(-200);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const record = JSON.parse(lines[index]) as Record<string, unknown>;
      if (record.hook === 'before_prompt_build') return { lastBeforePromptBuild: record };
    } catch {
      // Ignore malformed audit rows.
    }
  }
  return {};
}
