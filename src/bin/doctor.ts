#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { hostWorkspaceFor, loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { createMemoryKernelFromConfig } from '../factory.js';
import {
  defaultOpenClawAutoMemoryPluginDir,
  inspectOpenClawAutoMemoryPlugin,
  installOpenClawAutoMemoryPlugin,
  type OpenClawAutoMemoryPluginInspection,
} from '../host/openclaw/AutoMemoryPluginInstaller.js';
import { hostWiringFor, pendingHostIntegration } from '../host/HostWiring.js';
import { compactStorage } from '../storage/StorageCompactor.js';
import {
  buildGate,
  hasInstalledLauncher,
  installPathSteps,
  isOnPath,
  pathWarningSteps,
  postInstallSteps,
  resolveCliBinDir,
  resolveCogmemInvocation,
  type InstallGate,
  type InstallGateDiagnostic,
  type InstallStep,
} from '../install/InstallSteps.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

// In --json mode stdout carries one JSON document and nothing else. The gate
// already reports every warning as a diagnostic, so the human progress lines are
// suppressed rather than moved to stderr: two renderings, one set of facts.
function ok(message: string): void {
  if (json) return;
  console.log(`OK ${message}`);
}

function warn(code: string, message: string): void {
  if (json) return;
  console.log(`WARN ${code}: ${message}`);
}

function printWarnings(diagnostics: Array<{ severity: string; code: string; message: string }>): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'warning') warn(diagnostic.code, diagnostic.message);
  }
}

function fail(message: string, code = 'doctor_failed'): never {
  if (json) {
    emitGate(buildGate('fail', [{ code, message }], []));
    process.exit(1);
  }
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function printSteps(steps: InstallStep[]): void {
  if (steps.length === 0) {
    // Convergence, said out loud: nothing is outstanding, so there is nothing to
    // recommend. Silence here reads as "the gate forgot to tell me".
    console.log('');
    console.log('Next steps: none — nothing is outstanding.');
    return;
  }
  console.log('');
  console.log('Next steps:');
  for (const step of steps) {
    console.log(`  [${step.actor}] ${step.command}`);
    console.log(`      ${step.when} — ${step.purpose}`);
  }
}

function emitGate(gate: InstallGate, payload: Record<string, unknown> = {}): void {
  if (json) {
    console.log(JSON.stringify({
      schemaVersion: 'cogmem.cli.v1',
      command: 'doctor',
      ...payload,
      installGate: {
        level: gate.level,
        exitCode: gate.exitCode,
        summary: gate.summary,
        diagnostics: gate.diagnostics,
      },
      nextSteps: gate.nextSteps,
    }, null, 2));
  } else {
    console.log('');
    console.log(`Install gate: ${gate.level.toUpperCase()} — ${gate.summary}`);
    printSteps(gate.nextSteps);
  }
  process.exit(gate.exitCode);
}

const configPath = readArg('--config');
const envPath = readArg('--env-path');
const fix = hasFlag('--fix');
const agent = readArg('--agent');
// Resolved, not used verbatim: `integrationScope` hashes this path, so
// `--workspace .` and the absolute path `connect` resolved were two different
// plugin ids *and* two different memory scopes (ADR-0010).
const workspaceArg = readArg('--workspace');
const workspace = workspaceArg ? resolve(workspaceArg) : undefined;
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
  // The PATH question is asked before the branch, not inside it: a fresh
  // one-line install is in the not-installed state first, and "the CLI is off
  // PATH" is exactly as true there — the `export` line has to reach the reader of
  // that state too, not only the one after setup (ADR-0010, #78).
  const binDir = resolveCliBinDir(process.argv[1], process.env);
  const cliOffPath = hasInstalledLauncher(binDir) && !isOnPath(binDir, process.env);
  const pathSteps: InstallStep[] = cliOffPath ? pathWarningSteps(binDir) : [];

  // A named config that is not on disk yet is the same state as no config:
  // the install exists, the setup does not.
  if (resolution.kind === 'missing' || !existsSync(resolution.path)) {
    // No config is the state every fresh install is in. It is not a failure:
    // it is the gate saying "now configure it", with the command that does it.
    const bin = resolveCogmemInvocation();
    if (!json) {
      console.log(`cogmem is installed but not configured yet (looked for ${resolution.path}).`);
    }
    emitGate(
      buildGate(
        'not_installed',
        [{ code: 'missing_config', message: `no cogmem config at ${resolution.path}` }],
        [...pathSteps, ...installPathSteps(bin)],
      ),
      { configPath: null, resolvedConfigPath: resolution.path },
    );
  }

  const loaded = loadCogmemConfig({ configPath: resolution.path });
  const error = loaded.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error) fail(`${error.code}: ${error.message}`, error.code);

  // One Workspace for this config: the directory that contains `.cogmem/`
  // (ADR-0010). `--workspace` is the operator's override; otherwise it is the
  // host's own workspace, which is the Workspace unless the config moved it for
  // this host — resolved by the config layer, and by `connect` and `update`
  // through the same function, because the plugin id is a hash of this path.
  const workspaceRoot = workspace || hostWorkspaceFor(loaded, 'openclaw');

  if (pluginOnly) {
    if (agent && agent !== 'openclaw') fail('doctor --plugin-only currently supports --agent openclaw.');
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
      if (!inspection.current) warn('openclaw_plugin_stale', `Run ${resolveCogmemInvocation()} doctor --fix --agent openclaw --plugin-only --workspace ${workspaceRoot}.`);
      if (fixed) ok(`openclaw auto memory integration fixed at ${fixed.pluginDir}`);
      if (audit.lastBeforePromptBuild) ok(`last before_prompt_build action=${audit.lastBeforePromptBuild.action || 'unknown'} reason=${audit.lastBeforePromptBuild.reason || ''}`);
    }
    process.exit(0);
  }

  const gateDiagnostics: InstallGateDiagnostic[] = [];
  for (const diagnostic of loaded.diagnostics) {
    if (diagnostic.severity === 'warning') {
      gateDiagnostics.push({ code: diagnostic.code, message: diagnostic.message });
    }
  }

  printWarnings(loaded.diagnostics);
  ok('configuration parsed');
  ok(`cogmem home ${loaded.homeDir}`);

  let kernelDbPath: string | undefined;
  try {
    const kernel = createMemoryKernelFromConfig({ configPath: resolution.path });
    const health = kernel.getHealthStatus();
    if (health.package !== 'cogmem') fail('unexpected package identity');
    kernelDbPath = health.dbPath;
    kernel.close();
    ok(`kernel ready at ${health.dbPath}`);
  } catch (kernelError) {
    fail(kernelError instanceof Error ? kernelError.message : String(kernelError));
  }

  if (storage) {
    const storageStats = compactStorage({
      dbPath: kernelDbPath!,
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
      workspaceRoot,
      configPath: resolution.path,
      openclawConfigPath,
      pluginDir,
      bunPath,
      force: true,
    });
    ok(`openclaw auto memory integration fixed at ${result.pluginDir}`);
    ok(`openclaw config patched at ${result.openclawConfigPath}`);
  }

  // Inspected always, because the gate's answer depends on it: a Host whose
  // integration is on disk must not be recommended again (#81). What is *reported*
  // still depends on the Host being configured, so an unconfigured machine is not
  // told about a plugin it never asked for.
  const plugin = inspectOpenClawAutoMemoryPlugin({
    workspaceRoot,
    pluginDir: pluginDir || defaultOpenClawAutoMemoryPluginDir(workspaceRoot),
  });
  if (agent === 'openclaw' || workspace || loaded.integrations.openclaw.enabled) {
    const inspection = plugin;
    if (inspection.installed) {
      ok(`openclaw plugin ${inspection.current ? 'current' : 'stale'} at ${inspection.pluginDir}`);
      if (!inspection.current) {
        warn('openclaw_plugin_stale', `Run ${resolveCogmemInvocation()} connect openclaw --workspace ${workspaceRoot} --auto --force, or ${resolveCogmemInvocation()} doctor --fix --agent openclaw --plugin-only --workspace ${workspaceRoot}.`);
        gateDiagnostics.push({
          code: 'openclaw_plugin_stale',
          message: 'the OpenClaw plugin files are older than the installed package',
        });
      }
    }
    const audit = readLatestOpenClawAudit(workspaceRoot);
    if (audit.lastBeforePromptBuild) {
      ok(`last before_prompt_build action=${audit.lastBeforePromptBuild.action || 'unknown'} reason=${audit.lastBeforePromptBuild.reason || ''}`);
    }
  }

  // A rule_only config works; it just does not do semantic recall. That is a
  // degraded install, not a broken one, so it is a WARN and still exits 0.
  const memoryRole = loaded.modelRegistry.getRoleConfig('memory');
  if (memoryRole.provider === 'rule_only') {
    gateDiagnostics.push({
      code: 'rule_only',
      message: 'memory and reasoning run rule_only; semantic recall and Dream curation stay off until a model provider is configured',
    });
  }

  // A CLI nobody can invoke is not a success, even though the install worked.
  if (cliOffPath) {
    warn('cli_not_on_path', `${binDir} is not on PATH. Run: export PATH="${binDir}:$PATH"`);
    gateDiagnostics.push({
      code: 'cli_not_on_path',
      message: `the cogmem CLI at ${binDir} is not reachable as cogmem`,
    });
  }

  const level = gateDiagnostics.length > 0 ? 'warn' : 'ok';
  // Only the Host that is still outstanding, named: recommending a finished step is
  // what made the gate never converge, and recommending OpenClaw in a Hermes-only
  // Workspace is what made it name the wrong Host (#81).
  const connectHost = pendingHostIntegration(hostWiringFor(loaded, process.env));
  emitGate(
    buildGate(level, gateDiagnostics, [...pathSteps, ...postInstallSteps(resolveCogmemInvocation(), workspaceRoot, connectHost)]),
    {
      configPath: resolution.path,
      workspaceRoot,
      // `workspaceDir` leaves the output: there is one Workspace per config, and
      // it is named `workspaceRoot` (ADR-0010). A second spelling of it was how
      // two commands came to disagree about where they were.
      integrations: {
        openclaw: { enabled: loaded.integrations.openclaw.enabled },
        hermes: { enabled: loaded.integrations.hermes.enabled },
      },
      dbPath: kernelDbPath,
      nextConnectHost: connectHost,
      openclaw: { plugin },
    },
  );
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
