import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { AesGcmEncryptionProvider } from '../encryption/index.js';
import type { MemoryKernelOptions } from '../factory.js';
import type { RedactionPolicy } from '../governance/index.js';
import { ModelRegistry } from '../models/ModelRegistry.js';
import type { ModelRoleConfig, ModelRoleName, ProviderType } from '../models/ModelRole.js';
import type { VectorBackend } from '../store/IVectorStore.js';
import {
  type ConfigDiagnosticLike,
  DEFAULT_VECTOR_DIMENSION,
  addVectorDimensionDiagnostics,
  parseVectorDimensionValue,
} from './VectorDimension.js';
export type { ConfigDiagnosticLike } from './VectorDimension.js';
import { normalizeEpisodeBoundaryConfig } from '../episode/EpisodeBoundaryPolicy.js';
import { resolveTimeZone } from '../utils/LocalDateContext.js';

export type CogmemConfigKind = 'toml' | 'missing';
export type EnvLike = Record<string, string | undefined>;

export interface CogmemConfigResolution {
  kind: CogmemConfigKind;
  path: string;
}

export interface CogmemConfigResolutionOptions {
  configPath?: string;
  cwd?: string;
  env?: EnvLike;
}

export interface LoadedCogmemConfig {
  configPath: string;
  homeDir: string;
  /**
   * The directory that contains `.cogmem/` — derived, never declared (ADR-0010).
   * `homeDir` is the config's parent (`<ws>/.cogmem`); this is the Workspace.
   */
  workspaceRoot: string;
  options: MemoryKernelOptions;
  modelRegistry: ModelRegistry;
  paths: {
    embeddingsDir: string;
    snapshotsDir: string;
    logsDir: string;
  };
  integrations: {
    openclaw: {
      enabled: boolean;
      workspaceDir?: string;
    };
    hermes: {
      enabled: boolean;
      workspaceDir?: string;
    };
  };
  diagnostics: ConfigDiagnosticLike[];
}

export interface LoadCogmemConfigOptions extends CogmemConfigResolutionOptions {}

type UnknownRecord = Record<string, unknown>;

export function defaultCogmemHome(env: EnvLike = process.env): string {
  return join(env.HOME || homedir(), '.cogmem');
}

/**
 * The home of the account running this process, ignoring `$HOME`.
 *
 * Both `os.homedir()` and `os.userInfo()` honour `$HOME` on POSIX, so neither
 * can tell a test with an overridden HOME from the real user. The password
 * database can, which is what makes it usable as a boundary for the
 * project-config walk: a config under the account's home is a global config.
 */
function osUserHome(): string | undefined {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (uid === undefined) return undefined;
  try {
    const passwd = readFileSync('/etc/passwd', 'utf8');
    for (const line of passwd.split('\n')) {
      const fields = line.split(':');
      if (fields.length < 6) continue;
      if (Number(fields[2]) !== uid) continue;
      return fields[5] || undefined;
    }
  } catch {
    // No passwd database (or not readable): fall back to no extra boundary.
  }
  return undefined;
}

export function defaultCogmemConfigPath(env: EnvLike = process.env): string {
  return join(defaultCogmemHome(env), 'config.toml');
}

export function resolveCogmemConfigPath(options: CogmemConfigResolutionOptions = {}): CogmemConfigResolution {
  const cwd = resolve(options.cwd || process.cwd());
  const env = options.env || process.env;
  const explicit = options.configPath;
  if (explicit?.trim()) {
    return { kind: 'toml', path: resolvePath(explicit.trim(), cwd, env) };
  }

  const globalConfig = defaultCogmemConfigPath(env);
  // The walk up for a project config stops at every home it could reach:
  // `<home>/.cogmem/config.toml` is that home's *global* config, never a project
  // one. Without the stop, a run with an overridden HOME adopts another user's
  // config, and any test that meant to isolate itself inherits the developer's.
  const projectConfig = findUp(cwd, join('.cogmem', 'config.toml'), [dirname(globalConfig), osUserHome()]);
  if (projectConfig) return { kind: 'toml', path: projectConfig };

  if (existsSync(globalConfig)) return { kind: 'toml', path: globalConfig };

  return { kind: 'missing', path: globalConfig };
}

/**
 * The Workspace: the directory that contains `.cogmem/`.
 *
 * Derived, never declared (ADR-0010). The OpenClaw plugin id is a hash of this
 * path, so two commands that derive it differently compute two identities and
 * `doctor` can never see the plugin `connect` installed. Every command that
 * needs to know where it is asks here.
 *
 * `--config` decides it when given: the Workspace is the directory whose
 * `.cogmem/` holds that config. Otherwise it is the nearest ancestor with a
 * `.cogmem/config.toml`, then the account's global one — which is the same walk
 * `resolveCogmemConfigPath` performs, deliberately not a second copy of it. Only
 * when no config exists anywhere is it the current directory, where `init` will
 * create one.
 */
export function resolveWorkspaceRoot(options: CogmemConfigResolutionOptions = {}): string {
  const resolution = resolveCogmemConfigPath(options);
  if (resolution.kind === 'toml') return workspaceOfConfigPath(resolution.path);
  return resolve(options.cwd || process.cwd());
}

/**
 * The workspace a host's own files belong to.
 *
 * The Workspace, unless the config overrides it for that host — which is only
 * for a host whose files are genuinely elsewhere (Hermes' `~/.hermes`), and is
 * resolved relative to the Workspace rather than to the config directory. It is
 * one function because `connect`, `doctor` and `update` must agree: the plugin id
 * is a hash of this path, so two answers are two identities.
 */
export function hostWorkspaceFor(loaded: LoadedCogmemConfig, host: 'openclaw' | 'hermes'): string {
  return loaded.integrations[host].workspaceDir || loaded.workspaceRoot;
}

function workspaceOfConfigPath(configPath: string): string {
  const dir = dirname(resolve(configPath));
  return basename(dir) === '.cogmem' ? dirname(dir) : dir;
}

/**
 * Record that a host is wired: `enabled = true` under `[integrations.<host>]`,
 * adding the section when the file has none.
 *
 * Text-level rather than a TOML round trip, because a serializer would drop the
 * comments and ordering an operator put into a file this command owns exactly one
 * boolean of (ADR-0010). A file that already says `true` is not rewritten, so a
 * repeated `connect` leaves the config byte-identical.
 */
export function enableHostIntegration(configPath: string, host: 'openclaw' | 'hermes'): { configPath: string; changed: boolean } {
  const path = resolve(configPath);
  const original = readFileSync(path, 'utf8');
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  // Whitespace inside the brackets is legal TOML, and a padded header that read
  // as "no section" would get a second one appended — a file that no longer
  // parses, in the config every later command reads.
  const header = lines.findIndex((line) => line.replace(/\s*#.*$/, '').replace(/\s+/g, '') === `[integrations.${host}]`);

  if (header === -1) {
    const prefix = original.trimEnd();
    writeFileSync(path, `${prefix}${prefix ? '\n\n' : ''}[integrations.${host}]\nenabled = true\n`, 'utf8');
    return { configPath: path, changed: true };
  }

  let end = header + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end += 1;
  const enabled = lines.findIndex((line, index) => index > header && index < end && /^\s*enabled\s*=/.test(line));
  if (enabled !== -1) {
    if (/^\s*enabled\s*=\s*true\s*$/.test(lines[enabled])) return { configPath: path, changed: false };
    lines[enabled] = 'enabled = true';
  } else {
    lines.splice(header + 1, 0, 'enabled = true');
  }
  writeFileSync(path, `${lines.join('\n').replace(/\n+$/u, '')}\n`, 'utf8');
  return { configPath: path, changed: true };
}

export function loadCogmemConfig(options: LoadCogmemConfigOptions = {}): LoadedCogmemConfig {
  const resolution = resolveCogmemConfigPath(options);
  if (resolution.kind !== 'toml') {
    throw new Error(`Missing cogmem config at ${resolution.path}. Run cogmem-init first.`);
  }

  const env = options.env || process.env;
  const configPath = resolution.path;
  const homeDir = dirname(configPath);
  const workspaceRoot = workspaceOfConfigPath(configPath);
  const diagnostics: ConfigDiagnosticLike[] = [];
  let parsed: unknown;

  try {
    parsed = Bun.TOML.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'invalid_toml',
      message: error instanceof Error ? error.message : String(error),
    });
    parsed = {};
  }

  const root = asRecord(parsed);
  const core = section(root, 'core');
  const paths = section(root, 'paths');
  const embedding = section(root, 'embedding');
  const memoryModel = section(root, 'memory_model');
  const reasoningModel = section(root, 'reasoning_model');
  const governance = section(root, 'governance');
  const episodeBoundary = section(root, 'episode_boundary');
  const project = section(root, 'project');
  const integrations = section(root, 'integrations');
  const openclaw = section(integrations, 'openclaw');
  const hermes = section(integrations, 'hermes');

  const optionsOut: MemoryKernelOptions = {};

  const projectTimeZone = stringValue(project.timezone) || stringValue(root.timezone);
  if (projectTimeZone) {
    try { resolveTimeZone(projectTimeZone); optionsOut.projectTimeZone = projectTimeZone; }
    catch { diagnostics.push({ severity: 'error', code: 'invalid_project_timezone', message: `project.timezone must be a valid IANA timezone: ${projectTimeZone}` }); }
  }

  const dbPath = stringValue(core.db_path) || 'memory.db';
  optionsOut.dbPath = resolveConfigPath(interpolate(dbPath, env, diagnostics), homeDir, env);

  const vectorBackend = stringValue(core.vector_backend) || 'sqlite-vec';
  if (vectorBackend === 'sqlite-vec' || vectorBackend === 'hnswlib') {
    optionsOut.vectorBackend = vectorBackend as VectorBackend;
  } else {
    diagnostics.push({
      severity: 'error',
      code: 'invalid_vector_backend',
      message: 'core.vector_backend must be sqlite-vec or hnswlib.',
    });
  }

  const coreVectorDimension = core.vector_dimension;
  const embeddingVectorDimension = embedding.vector_dimension;
  if (
    coreVectorDimension !== undefined
    && embeddingVectorDimension !== undefined
    && coreVectorDimension !== embeddingVectorDimension
  ) {
    diagnostics.push({
      severity: 'warning',
      code: 'conflicting_vector_dimension',
      message: 'Both core.vector_dimension and embedding.vector_dimension are set; core.vector_dimension wins.',
    });
  }
  const vectorDimension = parseVectorDimensionValue(
    coreVectorDimension ?? embeddingVectorDimension ?? DEFAULT_VECTOR_DIMENSION,
    coreVectorDimension !== undefined ? 'core.vector_dimension' : 'embedding.vector_dimension',
    diagnostics,
  );
  if (vectorDimension !== undefined) {
    optionsOut.vectorDimension = vectorDimension;
    addVectorDimensionDiagnostics(vectorDimension, diagnostics);
  }

  const redactionPolicy: RedactionPolicy = {};
  const piiEmail = booleanValue(governance.pii_redact_email);
  const piiPhone = booleanValue(governance.pii_redact_phone);
  const piiSsn = booleanValue(governance.pii_redact_ssn);
  if (piiEmail !== undefined) {
    redactionPolicy.email = piiEmail;
  }
  if (piiPhone !== undefined) {
    redactionPolicy.phone = piiPhone;
  }
  if (piiSsn !== undefined) {
    redactionPolicy.ssn = piiSsn;
  }
  if (Object.keys(redactionPolicy).length > 0) optionsOut.redactionPolicy = redactionPolicy;

  const boundaryInput = {
    enabled: boundaryBoolean(episodeBoundary.enabled, 'enabled', diagnostics),
    mode: boundaryString(episodeBoundary.mode, 'mode', diagnostics) as never,
    maxEvents: boundaryNumber(episodeBoundary.max_events, 'max_events', diagnostics),
    maxDurationMs: boundaryNumber(episodeBoundary.max_duration_ms, 'max_duration_ms', diagnostics),
    maxIdleGapMs: boundaryNumber(episodeBoundary.max_idle_gap_ms, 'max_idle_gap_ms', diagnostics),
    splitOnTrustedLocalDateChange: boundaryBoolean(episodeBoundary.split_on_trusted_local_date_change, 'split_on_trusted_local_date_change', diagnostics),
    auditDecisions: boundaryBoolean(episodeBoundary.audit_decisions, 'audit_decisions', diagnostics),
    applyToLive: boundaryBoolean(episodeBoundary.apply_to_live, 'apply_to_live', diagnostics),
    applyToImports: boundaryBoolean(episodeBoundary.apply_to_imports, 'apply_to_imports', diagnostics),
    policyVersion: boundaryString(episodeBoundary.policy_version, 'policy_version', diagnostics),
    timezone: boundaryString(episodeBoundary.timezone, 'timezone', diagnostics),
  };
  const configuredBoundary = Object.values(boundaryInput).some((value) => value !== undefined);
  if (configuredBoundary) {
    const normalizedBoundary = normalizeEpisodeBoundaryConfig(boundaryInput);
    optionsOut.episodeBoundary = normalizedBoundary.config;
    diagnostics.push(...normalizedBoundary.diagnostics);
    if (projectTimeZone && normalizedBoundary.config.timezone && projectTimeZone !== normalizedBoundary.config.timezone) {
      diagnostics.push({ severity: 'error', code: 'conflicting_project_timezones', message: 'project.timezone and episode_boundary.timezone must match; project.timezone is the canonical project clock.' });
    }
  }

  const encryptionEnabled = booleanValue(governance.encryption) === true;
  const encryptionPassphrase = interpolate(
    stringValue(governance.encryption_passphrase) || stringValue(governance.passphrase) || '',
    env,
    diagnostics
  );
  if (encryptionEnabled) {
    if (encryptionPassphrase) {
      optionsOut.encryptionProvider = AesGcmEncryptionProvider.fromPassphrase(encryptionPassphrase);
    } else {
      diagnostics.push({
        severity: 'error',
        code: 'missing_encryption_passphrase',
        message: 'governance.encryption is true but governance.encryption_passphrase is empty.',
      });
    }
  }

  const modelRegistry = new ModelRegistry({
    embedding: buildRoleConfig('embedding', embedding, env, diagnostics),
    memory: buildRoleConfig('memory', memoryModel, env, diagnostics, 'rule_only'),
    reasoning: buildRoleConfig('reasoning', reasoningModel, env, diagnostics, 'memory'),
  });
  optionsOut.modelRegistry = modelRegistry;

  const embeddingsDir = resolveConfigPath(
    interpolate(stringValue(paths.embeddings_dir) || 'embeddings', env, diagnostics),
    homeDir,
    env
  );
  const snapshotsDir = resolveConfigPath(
    interpolate(stringValue(paths.snapshots_dir) || 'snapshots', env, diagnostics),
    homeDir,
    env
  );
  const logsDir = resolveConfigPath(
    interpolate(stringValue(paths.logs_dir) || 'logs', env, diagnostics),
    homeDir,
    env
  );

  const openclawEnabled = booleanValue(openclaw.enabled) === true;
  const hermesEnabled = booleanValue(hermes.enabled) === true;
  const openclawWorkspaceDir = maybeResolveWorkspace(openclaw.workspace_dir, workspaceRoot, env, diagnostics);
  const hermesWorkspaceDir = maybeResolveWorkspace(hermes.workspace_dir, workspaceRoot, env, diagnostics);

  return {
    configPath,
    homeDir,
    workspaceRoot,
    options: optionsOut,
    modelRegistry,
    paths: { embeddingsDir, snapshotsDir, logsDir },
    integrations: {
      openclaw: { enabled: openclawEnabled, workspaceDir: openclawWorkspaceDir },
      hermes: { enabled: hermesEnabled, workspaceDir: hermesWorkspaceDir },
    },
    diagnostics,
  };
}

function buildRoleConfig(
  role: ModelRoleName,
  values: UnknownRecord,
  env: EnvLike,
  diagnostics: ConfigDiagnosticLike[],
  fallback?: ModelRoleName | 'rule_only' | 'deterministic_local',
): ModelRoleConfig {
  const provider = normalizeRoleProvider(role, stringValue(values.provider), diagnostics);
  const baseUrl = stringValue(values.base_url);
  const model = stringValue(values.model) || defaultRoleModel(role);
  const apiKey = stringValue(values.api_key);
  const timeoutMs = numberValue(values.timeout_ms) ?? defaultRoleTimeout(role);

  return {
    role,
    provider,
    baseUrl: baseUrl
      ? interpolate(baseUrl, env, diagnostics)
      : provider === 'openai_compatible'
        ? 'http://localhost:11434/v1'
        : '',
    apiKey: apiKey ? interpolate(apiKey, env, diagnostics) : '',
    modelName: interpolate(model, env, diagnostics),
    timeoutMs,
    fallback,
  };
}

function normalizeRoleProvider(
  role: ModelRoleName,
  rawProvider: string | undefined,
  diagnostics: ConfigDiagnosticLike[],
): ProviderType {
  const provider = rawProvider || defaultRoleProvider(role);
  const valid = role === 'embedding'
    ? ['deterministic_local', 'openai_compatible']
    : ['rule_only', 'openai_compatible', 'anthropic'];
  if (valid.includes(provider)) return provider as ProviderType;
  diagnostics.push({
    severity: 'error',
    code: 'invalid_model_provider',
    message: `${role.toLowerCase()} provider must be one of: ${valid.join(', ')}.`,
  });
  return defaultRoleProvider(role);
}

function defaultRoleProvider(role: ModelRoleName): ProviderType {
  return role === 'embedding' ? 'deterministic_local' : 'rule_only';
}

function defaultRoleModel(role: ModelRoleName): string {
  return role === 'embedding' ? 'deterministic_local' : 'rule_only';
}

function defaultRoleTimeout(role: ModelRoleName): number {
  return role === 'embedding' ? 30000 : 60000;
}

function maybeResolveWorkspace(
  value: unknown,
  baseDir: string,
  env: EnvLike,
  diagnostics: ConfigDiagnosticLike[],
): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  return resolveConfigPath(interpolate(raw, env, diagnostics), baseDir, env);
}

function interpolate(value: string, env: EnvLike, diagnostics: ConfigDiagnosticLike[]): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => {
    const resolved = env[key];
    if (resolved === undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'missing_env',
        message: `Environment variable ${key} is not set.`,
      });
      return '';
    }
    return resolved;
  });
}

function resolveConfigPath(value: string, baseDir: string, env: EnvLike): string {
  return resolvePath(value, baseDir, env);
}

function resolvePath(value: string, baseDir: string, env: EnvLike): string {
  const expanded = expandHome(value, env);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

function expandHome(value: string, env: EnvLike): string {
  if (value === '~') return env.HOME || homedir();
  if (value.startsWith('~/')) return join(env.HOME || homedir(), value.slice(2));
  return value;
}

function findUp(start: string, relativePath: string, stopAt: Array<string | undefined> = []): string | undefined {
  const stops = new Set(stopAt.filter((entry): entry is string => Boolean(entry)).map((entry) => resolve(entry)));
  let current = resolve(start);
  while (true) {
    if (stops.has(current)) return undefined;
    const candidate = join(current, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function section(root: UnknownRecord, key: string): UnknownRecord {
  return asRecord(root[key]);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boundaryBoolean(value: unknown, name: string, diagnostics: ConfigDiagnosticLike[]): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  diagnostics.push({ severity: 'warning', code: `invalid_episode_boundary_${name}_type`, message: `episode_boundary.${name} must be a boolean.` });
  return undefined;
}

function boundaryNumber(value: unknown, name: string, diagnostics: ConfigDiagnosticLike[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  diagnostics.push({ severity: 'warning', code: `invalid_episode_boundary_${name}_type`, message: `episode_boundary.${name} must be a finite number.` });
  return undefined;
}

function boundaryString(value: unknown, name: string, diagnostics: ConfigDiagnosticLike[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  diagnostics.push({ severity: 'warning', code: `invalid_episode_boundary_${name}_type`, message: `episode_boundary.${name} must be a string.` });
  return undefined;
}
