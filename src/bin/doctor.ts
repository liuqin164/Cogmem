#!/usr/bin/env bun
import Database from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

import { printJsonDocument } from './CliJson.js';
import { dirname, join, resolve } from 'node:path';

import { hostWorkspaceFor, loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { NeuronEmbeddingStore } from '../embedding/NeuronEmbeddingStore.js';
import { createMemoryKernelFromConfig } from '../factory.js';
import type { SharedCollection } from '../ports/index.js';
import {
  defaultOpenClawAutoMemoryPluginDir,
  inspectOpenClawAutoMemoryPlugin,
  installOpenClawAutoMemoryPlugin,
  type OpenClawAutoMemoryPluginInspection,
} from '../host/openclaw/AutoMemoryPluginInstaller.js';
import { compactStorage } from '../storage/StorageCompactor.js';
import { RECALL_TRACE_MAX_ROWS } from '../observability/RecallDecisionTrace.js';
import {
  buildGate,
  defaultHermesConfigPath,
  defaultPiConfigPath,
  hasInstalledLauncher,
  hermesIntegrationEstablished,
  piIntegrationEstablished,
  installPathSteps,
  pendingHostIntegrations,
  isOnPath,
  pathWarningSteps,
  postInstallSteps,
  resolveCliBinDir,
  cogmemLauncherPath,
  hasCogmemLauncher,
  readCogmemLauncherTarget,
  resolveCogmemInstallation,
  resolveCogmemInvocation,
  type InstallGate,
  type InstallGateDiagnostic,
  type InstallStep,
} from '../install/InstallSteps.js';
import { assertCliArgs } from './CliArgs.js';
import { readLastUpdateTrace } from '../install/AutoUpgrade.js';
import { readResidentSessions, resolveResidentSessionDir, systemctlCommand, type ResidentSession } from '../install/ResidentSession.js';
import { checkForUpdate, loadUpdateSettings, refreshUpdateCache, type UpdateStatus } from '../install/VersionCheck.js';
import { CORE_VERSION } from '../version.js';
import { REFUSAL_NEXT_STEPS, refusalReasonOf } from './RefusalDocument.js';
const DOCTOR_FLAGS = ['agent', 'auto', 'bun', 'config', 'dry-run', 'env-path', 'fix', 'force', 'hermes-config', 'json', 'openclaw-config', 'out', 'plugin-dir', 'plugin-only', 'storage', 'workspace'] as const;
const USAGE = [
  'Usage: cogmem doctor [--config <config.toml>] [--workspace <dir>] [--json]',
  '  --storage                 report vector/raw storage and re-embedding progress',
  '  --plugin-only             inspect the OpenClaw plugin, its audit log, and the remember',
  '                            queue without opening the kernel (--agent openclaw)',
  '  --fix --agent openclaw    repair the OpenClaw auto-memory wiring',
  '  --out <path>              write the same JSON the command prints to a file',
].join('\n');
assertCliArgs(process.argv.slice(2), { usage: USAGE, extraFlags: [...DOCTOR_FLAGS] });

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
    // Mapped, not re-worded: the ids, actions and commands come from the one refusal definition the
    // JSON contract uses, and the gate's own step fields are derived from it.
    // The gate renders each step as an actor/command/when/purpose row; the contract keeps four fields,
    // so the wording that has no field of its own comes from `action`.
    const gateSteps = REFUSAL_NEXT_STEPS[
      refusalReasonOf(new Error(message)) ?? 'unsupported_database_identity'
    ].map((step) => ({
      id: step.id,
      actor: 'operator',
      command: step.command ?? '',
      when: step.action,
      purpose: step.action,
      safeForAutomation: step.safeForAutomation,
    }));
    // The gate's step type carries a closed id union; the refusal ids are contract-fixed, and the
    // rendered shape is what the guard asserts.
    emitGate(buildGate('fail', [{ code, message }], gateSteps as unknown as Parameters<typeof buildGate>[2]));
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
  // Counts only, and only marked events: the scope note travels with the number in both outputs, and
  // an early failure path that never resolved a database simply omits the field.
  const secretScope = 'only events carrying the write-path mark (written since this landed); existing databases are not re-scanned';
  const secretPayload = secretMarkedEvents === undefined
    ? {}
    : {
      secretFindings: {
        markedEvents: secretMarkedEvents,
        // Split, because the two are different facts: a redacted tool result no longer holds the
        // value, while a marked conversation turn still does and is withheld at recall instead.
        redactedOnWrite: secretRedactedEvents ?? 0,
        markedOnly: markedOnlyCount(secretMarkedEvents, secretRedactedEvents),
        scope: secretScope,
      },
    };
  // The switch and the collections travel together: "off" and "on with nobody granted anything" are
  // different states an operator has to be able to tell apart.
  const sharedPayload = sharedCollections === undefined
    ? {}
    : { shared: { enabled: sharedEnabledFlag === true, collections: sharedCollections } };
  if (json) {
    printJsonDocument(JSON.stringify({
      schemaVersion: 'cogmem.cli.v1',
      command: 'doctor',
      ...payload,
      ...secretPayload,
      ...sharedPayload,
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
    if (secretMarkedEvents !== undefined) {
      console.log(`Secret-marked events: ${secretMarkedEvents} — redacted on write ${secretRedactedEvents ?? 0}, marked only ${markedOnlyCount(secretMarkedEvents, secretRedactedEvents)} (${secretScope})`);
    }
    if (sharedCollections !== undefined) {
      console.log(sharedCollections.length === 0
        ? `Shared collections: none — sharing is ${sharedEnabledFlag === true ? 'enabled' : 'off'}`
        : `Shared collections: ${sharedCollections.map((c) => `${c.collection} (owner ${c.ownerHost}, readable by every agent that can connect, ${c.itemCount} item(s))`).join('; ')}`);
    }
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
// The reader's counterpart to `connect hermes --hermes-config`: without it the gate
// cannot see an integration written somewhere other than the default, and would
// recommend the step it just did.
const hermesConfigPath = readArg('--hermes-config');
const bunPath = readArg('--bun');
/**
 * Marked-event summary, filled once in the main flow and reported by `emitGate`.
 *
 * Scope, stated because it matters when reading the number: only events that carry the mark are
 * counted — those written after write-path secret detection landed. Existing databases are not
 * re-scanned, so an old ledger reports 0 here without meaning it holds no secrets.
 */
let secretMarkedEvents: number | undefined;
/** Undefined when the shared region was never used, so the field is omitted rather than zeroed. */
let sharedCollections: Array<Omit<SharedCollection, 'readers'>> | undefined;
/** The `[shared] enabled` switch, carried the same way the counts are: filled after the config loads. */
let sharedEnabledFlag: boolean | undefined;
/** Of the marked events: those whose tool result was redacted on the way in, and those only marked. */
let secretRedactedEvents: number | undefined;
/**
 * The three versions that can disagree after an upgrade (#150): what is installed on
 * disk, what the registry offers, and what the resident process is still serving.
 * Filled once the config resolves and reported by `emitGate`.
 */
let versionReport: Record<string, unknown> | undefined;

/**
 * The update status `doctor` reports.
 *
 * A stale cache is refreshed once, with a deliberately short deadline: `doctor` is
 * where an operator asks "is there a newer one", and a check that has never run
 * would answer "unknown" forever. It is not on a hot path, and it is skipped
 * entirely when the check is switched off.
 */
async function resolveDoctorUpdateStatus(configPath: string): Promise<UpdateStatus> {
  const settings = loadUpdateSettings({ configPath });
  const status = checkForUpdate({ configPath });
  if (!status.enabled || !status.stale) return status;
  await refreshUpdateCache({ configPath, timeoutMs: 1500 });
  return checkForUpdate({ configPath });
}

/** The next command that converges one serving process with what is on disk. */
function restartHint(session: ResidentSession): string {
  if (session.systemdUnit) return `Run \`${systemctlCommand(session, 'restart', session.systemdUnit).join(' ')}\` to take effect.`;
  if (session.transport === 'stdio') return 'Restart the host session that spawned it to take effect.';
  return 'Restart the resident process to take effect.';
}

/**
 * Read the disk, registry and serving versions and report them as one block.
 *
 * The skew is the point: a resident process keeps the code it started with, so a
 * staged upgrade *should* leave the two disagreeing. Reporting one number would let
 * an operator read "4.2.0 is installed" while the service still answers as 4.1.0.
 */
async function collectVersionReport(
  configPath: string,
  workspaceRoot: string,
  homeDir: string,
  gateDiagnostics: InstallGateDiagnostic[],
): Promise<void> {
  const diskVersion = CORE_VERSION;
  const updateStatus = await resolveDoctorUpdateStatus(configPath);
  // Every process currently serving, not one: a resident HTTP service and each
  // host's stdio session are separate processes and can be on separate versions.
  const sessions = readResidentSessions(resolveResidentSessionDir({ configPath, workspaceRoot }));
  const skewed = sessions.filter(({ session }) => session.version !== diskVersion);
  const lastUpdate = readLastUpdateTrace(homeDir);

  if (updateStatus.enabled) {
    ok(updateStatus.latestVersion
      ? `version ${diskVersion} (latest ${updateStatus.latestVersion}${updateStatus.updateAvailable ? ' — update available' : ''})`
      : `version ${diskVersion} (latest unknown; the version check has not completed yet)`);
  } else {
    ok(`version ${diskVersion} (version check off)`);
  }
  if (sessions.length === 0) {
    ok('resident process: none serving right now');
  }
  for (const { session } of sessions) {
    const where = [
      session.transport,
      session.systemdUnit,
      session.hostId ? `host ${session.hostId}` : undefined,
    ].filter(Boolean).join(', ');
    ok(`resident process ${session.version} (pid ${session.pid}${where ? `, ${where}` : ''})`);
  }
  for (const { session } of skewed) {
    warn('version_skew', `the resident process is still serving ${session.version} (pid ${session.pid}); the disk is at ${diskVersion}. ${restartHint(session)}`);
  }
  if (skewed.length > 0) {
    gateDiagnostics.push({
      code: 'version_skew',
      message: `${skewed.map(({ session }) => `pid ${session.pid}`).join(', ')} still serving ${skewed[0]!.session.version} while the package on disk is ${diskVersion}; restart to converge`,
    });
  }

  versionReport = {
    disk: diskVersion,
    checkEnabled: updateStatus.enabled,
    latest: updateStatus.latestVersion ?? null,
    updateAvailable: updateStatus.updateAvailable,
    checkedAt: updateStatus.checkedAt ?? null,
    serving: sessions.map(({ session }) => ({
      pid: session.pid,
      version: session.version,
      transport: session.transport,
      hostId: session.hostId ?? null,
      url: session.url ?? null,
      systemdUnit: session.systemdUnit ?? null,
      startedAt: session.startedAt,
    })),
    skew: skewed.length > 0,
    restartRequired: skewed.length > 0,
    lastUpdate: lastUpdate ?? null,
  };
}

/** The marked events that were not redacted on the way in — computed where both counts are known. */
function markedOnlyCount(marked: number, redacted: number | undefined): number {
  return Math.max(0, marked - (redacted ?? 0));
}

/**
 * How many ledger events carry a write-path secret mark.
 *
 * The database path comes from the kernel's own health status: reading it out of the config was the
 * first attempt and produced an empty path, so the count never ran. Read-only query, no new storage.
 */
/**
 * Collections someone chose to share. Read-only; undefined means "never used".
 *
 * The `readers` list is deliberately not read or printed (#146, #172). Reading is open to every agent that can
 * connect, and no surface can change that list, so printing it would advertise a per-reader ACL that is not in
 * effect. The registry keeps the data and `listCollections` still returns it — this is a display decision, not a
 * storage one.
 */
function readSharedCollections(configPath: string): Array<Omit<SharedCollection, 'readers'>> | undefined {
  let kernel: ReturnType<typeof createMemoryKernelFromConfig> | undefined;
  try {
    kernel = createMemoryKernelFromConfig({ configPath });
    const dbPath = kernel.getHealthStatus().dbPath;
    if (!dbPath || !existsSync(dbPath)) return undefined;
    const db = new Database(dbPath, { readonly: true });
    try {
      // No rows here means no collection was ever published; a database that predates the registry
      // throws on the missing tables and is reported as never used rather than as an error.
      const rows = db.prepare(`
        SELECT c.collection, c.owner_host, c.created_at,
               (SELECT COUNT(*) FROM shared_items s
                 WHERE s.collection = c.collection AND s.retracted_at IS NULL) AS items
          FROM shared_collections c
         ORDER BY c.collection
      `).all() as Array<{ collection: string; owner_host: string; created_at: number; items: number }>;
      return rows.map((row) => ({
        collection: row.collection,
        ownerHost: row.owner_host,
        createdAt: row.created_at,
        itemCount: row.items,
      }));
    } finally {
      db.close();
    }
  } catch (error) {
    // A database that predates the registry has no tables to read: that is "sharing has never been
    // used here", which the operator needs to see, not an error that hides the switch.
    if (error instanceof Error && /no such table/i.test(error.message)) return [];
    return undefined;
  } finally {
    try { kernel?.close(); } catch { /* the report is already built */ }
  }
}

/**
 * How many recall decisions are stored, against the cap that keeps them bounded (#187).
 *
 * Read-only. A database where nothing has recalled reports zero rows — the table does not exist yet,
 * which is a real answer rather than an error. Any other failure is reported as nothing at all, the
 * way the shared-collection reader does: an unreadable table must not be printed as "nothing has
 * recalled here".
 */
function readRecallTraceRetention(dbPath: string): { rows: number; maxRows: number } | undefined {
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db.prepare(`SELECT COUNT(*) AS c FROM trace_events`).get() as { c?: number } | undefined;
    return { rows: Number(row?.c ?? 0), maxRows: RECALL_TRACE_MAX_ROWS };
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return { rows: 0, maxRows: RECALL_TRACE_MAX_ROWS };
    return undefined;
  } finally {
    try { db?.close(); } catch { /* the report is already built */ }
  }
}

function countMarkedSecretEvents(configPath: string): number | undefined {
  let kernel: ReturnType<typeof createMemoryKernelFromConfig> | undefined;
  try {
    kernel = createMemoryKernelFromConfig({ configPath });
    const dbPath = kernel.getHealthStatus().dbPath;
    if (!dbPath || !existsSync(dbPath)) return undefined;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS marked,
               SUM(CASE WHEN json_extract(payload_json, '$.metadata.redaction.count') > 0 THEN 1 ELSE 0 END) AS redacted
          FROM memory_events
         WHERE json_extract(payload_json, '$.metadata.secretFindings.total') > 0
            OR json_extract(payload_json, '$.metadata.secretFindingsAssistant.total') > 0
      `).get() as { marked?: number; redacted?: number } | undefined;
      secretRedactedEvents = Number(row?.redacted ?? 0);
      return Number(row?.marked ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  } finally {
    kernel?.close();
  }
}

const storage = hasFlag('--storage');
const pluginOnly = hasFlag('--plugin-only');
const json = hasFlag('--json');

if (envPath) {
  fail('--env-path is no longer supported. Use cogmem init to create .cogmem/config.toml, then run cogmem doctor --config <config.toml>.');
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
  // Filled once, after the config resolved and before any gate is emitted past this point.
  secretMarkedEvents = countMarkedSecretEvents(resolution.path);
  sharedCollections = readSharedCollections(resolution.path);
  sharedEnabledFlag = loaded.sharedEnabled === true;
  // The vocabulary a project is compiling with, and whether a broken one fell back to the default (#132).
  const taxonomyStatus = loaded.taxonomyStatus;
  if (taxonomyStatus && taxonomyStatus.source === 'invalid-fell-back') {
    warn('taxonomy_fell_back', `taxonomy config is invalid, using the default: ${taxonomyStatus.reasons.join(', ')}`);
  } else {
    ok(`taxonomy: ${taxonomyStatus && taxonomyStatus.source ? taxonomyStatus.source : 'default'}${taxonomyStatus && taxonomyStatus.reasons.length ? ` (${taxonomyStatus.reasons.join(', ')})` : ''}`);
  }
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
      printJsonDocument(JSON.stringify({
        schemaVersion: 'cogmem.cli.v1',
        command: 'doctor',
        pluginOnly: true,
        configPath: resolution.path,
        openclaw: { plugin: inspection, fixed, audit, queue: inspectOpenClawRememberQueue(workspaceRoot) },
      }));
    } else {
      printWarnings(loaded.diagnostics);
      ok('configuration parsed');
      ok(`openclaw plugin ${inspection.current ? 'current' : 'stale'} at ${inspection.pluginDir}`);
      if (!inspection.current) warn('openclaw_plugin_stale', `Run ${resolveCogmemInvocation()} doctor --fix --agent openclaw --plugin-only --workspace ${workspaceRoot}.`);
      if (fixed) ok(`openclaw auto memory integration fixed at ${fixed.pluginDir}`);
      if (audit.lastBeforePromptBuild) ok(`last before_prompt_build action=${audit.lastBeforePromptBuild.action || 'unknown'} reason=${audit.lastBeforePromptBuild.reason || ''}`);
      const queue = inspectOpenClawRememberQueue(workspaceRoot);
      ok(`queue pending=${queue.pendingLines} dead=${queue.deadLines} processing=${Array.isArray(queue.processingFiles) ? queue.processingFiles.length : 0}`);
    }
    process.exit(0);
  }

  const gateDiagnostics: InstallGateDiagnostic[] = [];
  for (const diagnostic of loaded.diagnostics) {
    if (diagnostic.severity === 'warning') {
      gateDiagnostics.push({ code: diagnostic.code, message: diagnostic.message });
    }
  }

  // The managed launcher is what keeps a host configuration valid across an upgrade, a
  // moved checkout and a changed npm prefix (#114). Its absence is not a failure —
  // `connect` and `init` write it — but a launcher that points at nothing is, because
  // every host configured after this one is calling a file that cannot run the CLI.
  const launcherInvocation = resolveCogmemInstallation(process.env) ?? 'cogmem';
  const launcherFinding = hasCogmemLauncher() && !readCogmemLauncherTarget()
    ? {
      code: 'launcher_target_missing',
      message: `The managed launcher ${cogmemLauncherPath()} has no installation to run. Run ${launcherInvocation} cleanup to remove it (the state an uninstall leaves), or ${launcherInvocation} connect --auto --workspace ${workspaceRoot} to point it at an installation.`,
    }
    : !hasCogmemLauncher() && resolveCogmemInstallation(process.env)
      ? {
        code: 'launcher_missing',
        message: `No managed launcher at ${cogmemLauncherPath()}: a host configuration written from here names this installation's own path, and stops working when that path changes. Run ${launcherInvocation} connect --auto --workspace ${workspaceRoot} to create one.`,
      }
      : undefined;
  if (launcherFinding) {
    warn(launcherFinding.code, launcherFinding.message);
    gateDiagnostics.push(launcherFinding);
  }

  printWarnings(loaded.diagnostics);
  ok('configuration parsed');
  ok(`cogmem home ${loaded.homeDir}`);

  // #150: disk vs registry vs the serving process. Collected before the kernel opens
  // so a skew is reported even when the database is what fails next.
  await collectVersionReport(resolution.path, workspaceRoot, loaded.homeDir, gateDiagnostics);

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

  // The numbers a machine consumer needs. The human line is suppressed under --json — that
  // is the contract — but `--storage` used to produce *only* that line, so an agent asking
  // for storage state received a JSON document with none of it in.
  let storageReport: Record<string, unknown> | undefined;
  if (storage) {
    const storageStats = compactStorage({
      dbPath: kernelDbPath!,
      dryRun: true,
      dimension: loaded.options.vectorDimension,
    });
    // The re-embedding progress used to be its own command (`cogmem re-embed status`), which
    // could only ever report: the re-embedding itself runs in the host, and the numbers are
    // storage state. It reads here instead, so the command is gone (#141).
    const embeddings = new NeuronEmbeddingStore(new Database(kernelDbPath!, { readonly: true })).getProgress();
    // #187: the decision log is append-only and capped, so the operator needs the current count next to
    // the cap — a table at its ceiling is normal, a table missing is "nothing has recalled here yet".
    const trace = readRecallTraceRetention(kernelDbPath!);
    storageReport = {
      rawEvents: storageStats.rawEventsBefore,
      vectorCount: storageStats.vectorCountBefore,
      vectorBytes: storageStats.vectorBytesBefore,
      eligibleVectorBytes: storageStats.eligibleVectorBytes,
      vectorBytesPerRawEvent: storageStats.vectorBytesPerRawEventBefore,
      embeddings: { completed: embeddings.completed, total: embeddings.total, failed: embeddings.failed },
      ...(trace ? { recallDecisions: trace } : {}),
    };
    ok([
      `storage raw_events=${storageStats.rawEventsBefore}`,
      `vectors=${storageStats.vectorCountBefore}`,
      `vector_bytes=${storageStats.vectorBytesBefore}`,
      `eligible_vector_bytes=${storageStats.eligibleVectorBytes}`,
      `vector_bytes_per_raw_event=${storageStats.vectorBytesPerRawEventBefore.toFixed(2)}`,
      `embeddings=${embeddings.completed}/${embeddings.total}`,
      ...(embeddings.failed > 0 ? [`embedding_failures=${embeddings.failed}`] : []),
      ...(trace ? [`recall_decisions=${trace.rows}/${trace.maxRows}`] : []),
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
  const reportPlugin = Boolean(agent === 'openclaw' || workspace || loaded.integrations.openclaw.enabled);
  const plugin = inspectOpenClawAutoMemoryPlugin({
    workspaceRoot,
    pluginDir: pluginDir || defaultOpenClawAutoMemoryPluginDir(workspaceRoot),
  });
  if (reportPlugin) {
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
  // Workspace is what made it name the wrong Host (#81). Availability is read from
  // the same inspection the report uses — the effective plugin dir and workspace —
  // so one run cannot print "installed" and "connect it" at the same time.
  const connectHosts = pendingHostIntegrations([
    { host: 'openclaw', wanted: loaded.integrations.openclaw.enabled, established: plugin.installed },
    {
      host: 'hermes',
      wanted: loaded.integrations.hermes.enabled,
      established: hermesIntegrationEstablished(hermesConfigPath ? resolve(hermesConfigPath) : defaultHermesConfigPath(process.env)),
    },
    {
      host: 'pi',
      wanted: loaded.integrations.pi.enabled,
      established: piIntegrationEstablished(defaultPiConfigPath(process.env)),
    },
  ]);
  // The step carries the workspace of the Host it names, not the OpenClaw one by
  // default: a pending Hermes in a Workspace whose OpenClaw dir is elsewhere would
  // otherwise be told to write into the wrong tree.
  const connectWorkspace = workspace || (connectHosts[0] ? hostWorkspaceFor(loaded, connectHosts[0]) : workspaceRoot);
  emitGate(
    buildGate(level, gateDiagnostics, [...pathSteps, ...postInstallSteps(resolveCogmemInvocation(), connectWorkspace, connectHosts)]),
    {
      configPath: resolution.path,
      workspaceRoot,
      // `workspaceDir` leaves the output: there is one Workspace per config, and
      // it is named `workspaceRoot` (ADR-0010). A second spelling of it was how
      // two commands came to disagree about where they were.
      integrations: {
        openclaw: { enabled: loaded.integrations.openclaw.enabled },
        hermes: { enabled: loaded.integrations.hermes.enabled },
        pi: { enabled: loaded.integrations.pi.enabled },
      },
      dbPath: kernelDbPath,
      ...(versionReport ? { version: versionReport } : {}),
      ...(storageReport ? { storage: storageReport } : {}),
      nextConnectHost: connectHosts[0],
      nextConnectHosts: connectHosts,
      openclaw: reportPlugin ? { plugin } : undefined,
    },
  );
}

/**
 * The remember-queue state `cogmem openclaw diagnose` used to report.
 *
 * That command called the same `inspectOpenClawAutoMemoryPlugin` this one does and had its own
 * copy of the audit reader; the queue was the one thing it had that this did not. It moved here
 * rather than disappearing with the command (#142): a stuck queue is exactly what an injection
 * failure looks like from the outside.
 */
function countJsonlLines(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).length;
}

function readLock(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  const ownerPath = join(path, 'owner.json');
  let owner: Record<string, unknown> | undefined;
  if (existsSync(ownerPath)) {
    try { owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as Record<string, unknown>; }
    catch { owner = { parseError: true }; }
  }
  const stat = statSync(path);
  return { path, mtimeMs: stat.mtimeMs, ageMs: Date.now() - stat.mtimeMs, owner };
}

function inspectOpenClawRememberQueue(workspaceRoot: string): Record<string, unknown> {
  const queuePath = join(workspaceRoot, '.cogmem', 'queue', 'openclaw-remember.jsonl');
  const queueDir = dirname(queuePath);
  const processingFiles = existsSync(queueDir)
    ? readdirSync(queueDir)
      .filter((entry) => entry.startsWith('openclaw-remember.jsonl.') && entry.endsWith('.processing'))
      .map((entry) => {
        const path = join(queueDir, entry);
        const stat = statSync(path);
        return { path, lines: countJsonlLines(path), mtimeMs: stat.mtimeMs, ageMs: Date.now() - stat.mtimeMs };
      })
    : [];
  return {
    queuePath,
    pendingLines: countJsonlLines(queuePath),
    deadPath: `${queuePath}.dead.jsonl`,
    deadLines: countJsonlLines(`${queuePath}.dead.jsonl`),
    lock: readLock(`${queuePath}.lock`),
    spawnLock: readLock(`${queuePath}.spawn.lock`),
    processingFiles,
  };
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
