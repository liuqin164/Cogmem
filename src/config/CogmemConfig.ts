import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

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
import { asRecord } from '../utils/Values.js';
import { resolveTaxonomy, type TaxonomyResolution } from './MemoryTaxonomy.js';
import {
  defaultCogmemConfigPath,
  defaultCogmemHome,
  findUp,
  resolveCogmemConfigPath,
  resolvePath,
  type CogmemConfigKind,
  type CogmemConfigResolution,
  type CogmemConfigResolutionOptions,
  type EnvLike,
} from './ConfigPath.js';

// The path resolution is split out so the CLI hot path can read `[update]` without
// loading this module (#150). Re-exported here so every existing caller keeps the
// import it already had.
export { defaultCogmemConfigPath, defaultCogmemHome, findUp, resolveCogmemConfigPath };
export type { CogmemConfigKind, CogmemConfigResolution, CogmemConfigResolutionOptions, EnvLike };

export interface LoadedCogmemConfig {
  /** Shared items one recall may append, from `[shared] recall_limit`. */
  sharedRecallLimit?: number;
  /** The `[shared] enabled` switch. Off unless the operator turned it on. */
  sharedEnabled?: boolean;
  /** Where the classification vocabulary came from, and why it fell back if it did (#132). */
  taxonomyStatus?: TaxonomyResolution;
  /** The project's declared language for host-facing vocabulary (#135). */
  language?: string;
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
  diagnostics: ConfigDiagnosticLike[];
}

export interface LoadCogmemConfigOptions extends CogmemConfigResolutionOptions {}

type UnknownRecord = Record<string, unknown>;

/**
 * The Workspace: the directory that contains `.cogmem/`.
 *
 * Derived, never declared (ADR-0010). Every command that needs to know where it
 * is asks here, so two commands cannot derive two different answers.
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

function workspaceOfConfigPath(configPath: string): string {
  const dir = dirname(resolve(configPath));
  return basename(dir) === '.cogmem' ? dirname(dir) : dir;
}

export function loadCogmemConfig(options: LoadCogmemConfigOptions = {}): LoadedCogmemConfig {
  const resolution = resolveCogmemConfigPath(options);
  if (resolution.kind !== 'toml') {
    throw new Error(`Missing cogmem config at ${resolution.path}. Run cogmem init first.`);
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
  // Sharing between agents is off unless the operator turns it on: the default install shares
  // nothing, and a host only becomes a reader by an explicit grant.
  const shared = section(root, 'shared');
  const project = section(root, 'project');

  const optionsOut: MemoryKernelOptions = {};

  // A project's own vocabulary (#132): validated here, and a broken one falls back to the default with the
  // reasons carried through to `doctor` rather than stopping the install.
  optionsOut.taxonomy = resolveTaxonomy(section(root, 'taxonomy'));

  // The language host-facing vocabulary is generated in (#135). A project config carries it, like the
  // timezone, and `zh` stays the default so an install that says nothing behaves as it did.
  const projectLanguage = stringValue(project.language) || stringValue(root.language);
  if (projectLanguage) optionsOut.language = projectLanguage;
  const projectTimeZone = stringValue(project.timezone) || stringValue(root.timezone);
  if (projectTimeZone) {
    try { resolveTimeZone(projectTimeZone); optionsOut.projectTimeZone = projectTimeZone; }
    catch { diagnostics.push({ severity: 'error', code: 'invalid_project_timezone', message: `project.timezone must be a valid IANA timezone: ${projectTimeZone}` }); }
  }

  const dbPath = stringValue(core.db_path) || 'memory.db';
  optionsOut.dbPath = resolvePath(interpolate(dbPath, env, diagnostics), homeDir, env);
  optionsOut.sharedEnabled = booleanValue(shared.enabled) === true;
  if (numberValue(shared.recall_limit) !== undefined) optionsOut.sharedRecallLimit = numberValue(shared.recall_limit);

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

  const embeddingsDir = resolvePath(
    interpolate(stringValue(paths.embeddings_dir) || 'embeddings', env, diagnostics),
    homeDir,
    env
  );
  const snapshotsDir = resolvePath(
    interpolate(stringValue(paths.snapshots_dir) || 'snapshots', env, diagnostics),
    homeDir,
    env
  );
  const logsDir = resolvePath(
    interpolate(stringValue(paths.logs_dir) || 'logs', env, diagnostics),
    homeDir,
    env
  );

  return {
    configPath,
    homeDir,
    workspaceRoot,
    options: optionsOut,
    // These four were declared on the interface and never filled, so `doctor` read `undefined` for all of
    // them: the shared switch was reported off whatever the config said, and the recall limit was unreadable.
    sharedEnabled: optionsOut.sharedEnabled,
    sharedRecallLimit: optionsOut.sharedRecallLimit,
    taxonomyStatus: optionsOut.taxonomy,
    language: optionsOut.language,
    modelRegistry,
    paths: { embeddingsDir, snapshotsDir, logsDir },
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
  const maxTokens = numberValue(values.max_tokens) ?? defaultRoleMaxTokens(role);
  const jsonMode = values.json_mode === true;
  const inputType = stringValue(values.input_type);

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
    maxTokens,
    jsonMode,
    inputType,
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

/**
 * A frame is one long call: measured on the box, a reasoning model needed
 * 150–300 s for one two-turn episode, so a 60 s default aborts the reading
 * mid-response (the body then fails to parse as `Unexpected EOF`, which reads
 * like a model defect instead of a deadline).
 */
function defaultRoleTimeout(role: ModelRoleName): number {
  if (role === 'embedding') return 30000;
  return role === 'memory' ? 300000 : 60000;
}

/**
 * The memory role returns a `memory_frame.v1` document — nodes, relations,
 * temporal references and their evidence ids, plus whatever preamble a
 * reasoning model emits first. Left at the client's 512-token default the answer
 * is cut off mid-string; measured on the box, a real model needed 3.8k for the
 * frame alone and overran 8k on the pipeline's own prompt; 16384 is the measured ceiling it
 * fits in (5337 tokens for one two-turn episode).
 */
function defaultRoleMaxTokens(role: ModelRoleName): number {
  return role === 'memory' ? 16384 : 1024;
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
