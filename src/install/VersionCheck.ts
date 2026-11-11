import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultCogmemHome, resolveCogmemConfigPath, type EnvLike } from '../config/ConfigPath.js';
import { DEFAULT_NPM_PACKAGE } from '../bin/update-release.js';
import { CORE_VERSION } from '../version.js';

/**
 * The version check behind `cogmem update`'s own notice (#150).
 *
 * Four properties, all of them requirements rather than polish:
 *  - **It never blocks.** A caller reads the cache and moves on; the network
 *    round trip happens in a detached child (`version-check-refresh`) that the
 *    command does not wait for. A recall that has to wait for npm is a recall
 *    that is slow because someone else released a package.
 *  - **It is cached for about a day.** One registry read per machine per day,
 *    in `~/.cogmem/update-check.json`. A failed read is cached too, for an hour,
 *    so an offline machine retries tomorrow rather than on every command.
 *  - **It is silent on failure.** No error, no warning, no non-zero exit: the
 *    only thing a failed check changes is that no notice appears.
 *  - **It can be switched off.** `[update] check = false` in the config, or
 *    `COGMEM_UPDATE_CHECK=0` in the environment.
 *
 * It reads version metadata only. Nothing about this machine, the ledger or the
 * operator is sent — that is a promise in the ticket, and the reason this module
 * has no telemetry-shaped parameter at all.
 */

const DEFAULT_UPDATE_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
/** A failed read retries on this cadence rather than the full day. */
export const UPDATE_CHECK_FAILURE_RETRY_MS = 60 * 60 * 1000;
const UPDATE_CACHE_FILENAME = 'update-check.json';
const REQUEST_TIMEOUT_MS = 3000;

export interface UpdateSettings {
  /** `[update] check`, on unless turned off. */
  check: boolean;
  /** `[update] auto_upgrade`, off unless turned on (ADR-0003). */
  autoUpgrade: boolean;
  /**
   * `[update] auto_upgrade_in_service`: the second, separate confirmation a
   * service manager needs. A process that was started by systemd does not get to
   * upgrade the package it is running from on the strength of the ordinary
   * opt-in alone (#150, systemd clause 3).
   */
  autoUpgradeInService: boolean;
  registryUrl: string;
  packageName: string;
  cachePath: string;
  /** The directory the cache and the update log live in, when a config named one. */
  homeDir: string;
  /** The config that was actually read, so the detached child reads the same one. */
  configPath?: string;
}

export interface UpdateCache {
  checkedAt: number;
  latestVersion?: string;
  /** Present when the read failed; the reason is never surfaced, only cached. */
  error?: string;
}

export interface UpdateStatus {
  enabled: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  checkedAt?: number;
  /** The cache is missing or past its cadence, so a refresh is owed. */
  stale: boolean;
}

export interface UpdateCheckOptions {
  env?: EnvLike;
  cwd?: string;
  configPath?: string;
  now?: number;
  cachePath?: string;
}

/**
 * The `[update]` section, read on its own.
 *
 * Deliberately not `loadCogmemConfig`: this runs in the CLI dispatcher, which is
 * the hot path, and the full config load pulls the kernel in with it. Only four
 * file-system calls and one TOML parse belong here.
 */
export function loadUpdateSettings(options: UpdateCheckOptions = {}): UpdateSettings {
  const env = options.env ?? process.env;
  const homeDir = defaultCogmemHome(env);
  // `COGMEM_UPDATE_CONFIG` is how the detached child is told which config its
  // parent used; it is this module's own handshake, not a general override.
  const explicitConfig = options.configPath ?? env.COGMEM_UPDATE_CONFIG?.trim() ?? undefined;
  const resolution = resolveCogmemConfigPath({ env, cwd: options.cwd, configPath: explicitConfig });
  let update: Record<string, unknown> = {};
  if (resolution.kind === 'toml') {
    try {
      const root = Bun.TOML.parse(readFileSync(resolution.path, 'utf8')) as Record<string, unknown>;
      const section = root.update;
      if (section && typeof section === 'object' && !Array.isArray(section)) update = section as Record<string, unknown>;
    } catch {
      // An unreadable config is not this module's failure to report: `doctor` owns
      // that, and a version check that refuses to run because the file has a typo
      // would be the loudest thing in the install.
    }
  }
  const registry = env.COGMEM_UPDATE_REGISTRY?.trim() || DEFAULT_UPDATE_REGISTRY;
  return {
    check: envUpdateCheck(env) ?? (update.check !== false),
    autoUpgrade: update.auto_upgrade === true,
    autoUpgradeInService: update.auto_upgrade_in_service === true,
    registryUrl: registry.replace(/\/+$/u, ''),
    packageName: DEFAULT_NPM_PACKAGE,
    cachePath: options.cachePath ?? join(homeDir, UPDATE_CACHE_FILENAME),
    // The config's own directory when there is one, so the update log lands beside
    // the database rather than in a home the operator may not have configured.
    homeDir: resolution.kind === 'toml' ? dirname(resolution.path) : homeDir,
    configPath: resolution.kind === 'toml' ? resolution.path : undefined,
  };
}

function envUpdateCheck(env: EnvLike): boolean | undefined {
  const raw = env.COGMEM_UPDATE_CHECK?.trim().toLowerCase();
  if (raw === undefined || raw === '') return undefined;
  if (['0', 'false', 'off', 'no'].includes(raw)) return false;
  if (['1', 'true', 'on', 'yes'].includes(raw)) return true;
  return undefined;
}

export function readUpdateCache(cachePath: string): UpdateCache | undefined {
  if (!existsSync(cachePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as UpdateCache;
    if (typeof parsed.checkedAt !== 'number' || !Number.isFinite(parsed.checkedAt)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Whether the cache can still answer for today.
 *
 * A successful read is good for a day; a failed one for an hour, so a transient
 * outage does not cost a day of no notices.
 */
export function isUpdateCacheFresh(cache: UpdateCache | undefined, now: number): boolean {
  if (!cache) return false;
  const window = cache.latestVersion ? DEFAULT_UPDATE_CHECK_TTL_MS : UPDATE_CHECK_FAILURE_RETRY_MS;
  return now - cache.checkedAt < window;
}

function writeUpdateCache(cachePath: string, cache: UpdateCache): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    // Written beside the target and renamed: a command that reads the cache while a
    // refresh is writing it must never see half a JSON document.
    const temporary = `${cachePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    renameSync(temporary, cachePath);
  } catch {
    // A cache that cannot be written only means the check runs again next time.
  }
}

/** The answer today's command should show, from the cache and nothing else. */
export function checkForUpdate(options: UpdateCheckOptions = {}): UpdateStatus {
  const settings = loadUpdateSettings(options);
  const now = options.now ?? Date.now();
  const currentVersion = CORE_VERSION;
  if (!settings.check) {
    return { enabled: false, currentVersion, updateAvailable: false, stale: false };
  }
  const cache = readUpdateCache(options.cachePath ?? settings.cachePath);
  const latestVersion = cache?.latestVersion;
  return {
    enabled: true,
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion !== undefined && isNewerVersion(latestVersion, currentVersion),
    checkedAt: cache?.checkedAt,
    stale: !isUpdateCacheFresh(cache, now),
  };
}

export interface FetchLatestOptions {
  registryUrl?: string;
  packageName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** The registry's `latest` version, or undefined. Never throws. */
export async function fetchLatestVersion(options: FetchLatestOptions = {}): Promise<string | undefined> {
  const registryUrl = (options.registryUrl ?? DEFAULT_UPDATE_REGISTRY).replace(/\/+$/u, '');
  const packageName = options.packageName ?? DEFAULT_NPM_PACKAGE;
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await doFetch(`${registryUrl}/${encodeURIComponent(packageName)}/latest`, {
      // No version and no machine detail: the ticket forbids sending anything about
      // this install, and a User-Agent carrying `cogmem/<version>` is exactly that.
      // The same identifier `update-release` sends, so one product has one name.
      headers: { Accept: 'application/json', 'User-Agent': 'cogmem-update' },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { version?: unknown };
    const version = typeof payload.version === 'string' ? payload.version.trim() : '';
    return version || undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/** Read the registry and record the answer — success or failure — in the cache. */
export async function refreshUpdateCache(options: UpdateCheckOptions & FetchLatestOptions = {}): Promise<UpdateCache> {
  const settings = loadUpdateSettings(options);
  const cachePath = options.cachePath ?? settings.cachePath;
  const latestVersion = await fetchLatestVersion({
    registryUrl: options.registryUrl ?? settings.registryUrl,
    packageName: options.packageName ?? settings.packageName,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  const cache: UpdateCache = latestVersion
    ? { checkedAt: options.now ?? Date.now(), latestVersion }
    : { checkedAt: options.now ?? Date.now(), error: 'registry_unreachable' };
  writeUpdateCache(cachePath, cache);
  return cache;
}

/**
 * Compare two dotted versions.
 *
 * Numeric segments only, and a pre-release suffix is dropped: the registry's
 * `latest` tag is what this compares, and that is a stable release. A version
 * this cannot parse compares as equal, which is the quiet answer.
 */
export function compareVersions(a: string, b: string): number {
  const left = versionSegments(a);
  const right = versionSegments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function versionSegments(version: string): number[] {
  return version.trim().replace(/^v/u, '').split('-')[0]!.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/** A process started by systemd, told apart from a shell by the manager's own marks. */
export function isSystemdManaged(env: EnvLike = process.env): boolean {
  return Boolean(env.INVOCATION_ID || env.NOTIFY_SOCKET);
}

/**
 * The one line the CLI adds after a normal command's output.
 *
 * A hint, not a nag: it names both versions, the command that fixes it, and the
 * one step a service manager still owns. `undefined` when there is nothing to say.
 */
export function renderUpdateNotice(status: UpdateStatus): string | undefined {
  if (!status.enabled || !status.updateAvailable || !status.latestVersion) return undefined;
  return `cogmem ${status.latestVersion} is available (you have ${status.currentVersion}). Run \`cogmem update\`; restart the resident process afterwards if one is running.`;
}

/**
 * Start the detached refresh if one is owed, and return immediately.
 *
 * The caller is a command that is about to do its real work; this must not add a
 * network round trip to it. The child is `version-check-refresh`, which reads the
 * registry, writes the cache and (when opted in) stages an upgrade.
 */
export function maybeStartVersionCheck(options: UpdateCheckOptions = {}): { started: boolean; reason: string } {
  const settings = loadUpdateSettings(options);
  if (!settings.check) return { started: false, reason: 'check_disabled' };
  const now = options.now ?? Date.now();
  if (isUpdateCacheFresh(readUpdateCache(options.cachePath ?? settings.cachePath), now)) {
    return { started: false, reason: 'cache_fresh' };
  }
  const entry = resolveSiblingBin('version-check-refresh');
  if (!entry) return { started: false, reason: 'entrypoint_missing' };
  try {
    const env = { ...(options.env ?? process.env) };
    // The child resolves the config by walking up from the cwd, which is a different
    // answer from the one `--config` gave the command that started it. Handing the
    // path over is what keeps `[update] check` in that file in effect (#150).
    if (settings.configPath) env.COGMEM_UPDATE_CONFIG = settings.configPath;
    const child = Bun.spawn({
      cmd: [process.execPath || 'bun', entry],
      cwd: options.cwd ?? process.cwd(),
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    // Detached from this process's event loop: the command must be able to exit
    // without waiting for a package registry.
    (child as { unref?: () => void }).unref?.();
    return { started: true, reason: 'started' };
  } catch {
    return { started: false, reason: 'spawn_failed' };
  }
}

/**
 * A bin beside this module: `name.js` in the build, `name.ts` in the checkout.
 *
 * One helper rather than one resolver per entry, because the build and the
 * checkout differ only in the extension and a second copy is a second place to
 * forget it.
 */
export function resolveSiblingBin(name: string): string | undefined {
  const binDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin');
  const compiled = join(binDir, `${name}.js`);
  if (existsSync(compiled)) return compiled;
  const source = join(binDir, `${name}.ts`);
  return existsSync(source) ? source : undefined;
}
