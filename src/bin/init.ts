#!/usr/bin/env bun
import { printCliJson } from './CliJson.js';
import { refusalDocumentFor } from './RefusalDocument.js';
/**
 * cogmem-init — Interactive configuration wizard for cogmem
 *
 * Guides new users through:
 *  1. Database path
 *  2. Vector backend (sqlite-vec vs hnswlib)
 *  3. Embedding provider (auto-detected from Ollama / env keys)
 *  4. Memory & reasoning model roles
 *  5. PII redaction policy
 *  6. AES-256-GCM encryption passphrase (optional)
 *
 * Writes a `.cogmem/config.toml` file loadable by `createMemoryKernelFromConfig()`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { registerAgent } from '../agent/AgentRegistry.js';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { dirname, resolve, join } from 'node:path';

import { defaultCogmemConfigPath, defaultCogmemHome, resolveWorkspaceRoot } from '../config/CogmemConfig.js';
import { cogmemLauncherPath, ensureCogmemLauncher, hasCogmemLauncher, installGateStep, resolveCogmemInstallation, resolveCogmemInvocation } from '../install/InstallSteps.js';
import {
  DEFAULT_VECTOR_DIMENSION,
  HIGH_VECTOR_DIMENSION_THRESHOLD,
  vectorDimensionWarningMessage,
} from '../config/VectorDimension.js';
import { ModelRegistry } from '../models/ModelRegistry.js';
import { assertCliArgs } from './CliArgs.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectionResult {
  ollamaAvailable: boolean;
  ollamaModels: string[];
  openaiAvailable: boolean;
  anthropicAvailable: boolean;
  qwenAvailable: boolean;
}

interface WizardConfig {
  // Core
  dbPath: string;
  vectorBackend: 'sqlite-vec' | 'hnswlib';
  vectorDimension: number;
  // Embedding
  embeddingProvider: 'deterministic_local' | 'openai_compatible';
  embeddingBaseUrl: string;
  embeddingModel: string;
  // Memory model
  memoryProvider: 'rule_only' | 'openai_compatible' | 'anthropic';
  memoryBaseUrl: string;
  memoryApiKey: string;
  memoryModel: string;
  // Reasoning model
  reasoningProvider: 'rule_only' | 'openai_compatible' | 'anthropic';
  reasoningBaseUrl: string;
  reasoningApiKey: string;
  reasoningModel: string;
  // Governance
  piiEmail: boolean;
  piiPhone: boolean;
  piiSsn: boolean;
  encryptionPassphrase: string;
}

interface InitArgs {
  configPath: string;
  homePath: string;
  scope: 'global' | 'project';
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  vectorDimension?: number;
  probeOllama: boolean;
  /** `--register-agent <hostId>`, repeatable. Registration is not the wizard. */
  registerAgents: string[];
  /** `--rotate`: replace an existing agent's credential instead of refusing. */
  rotateAgents: boolean;
  /** `--project` for the registered agents; defaults to each agent's hostId. */
  registerProjectId: string;
}

/**
 * A Human-required setting met without a human: the value fell back to a
 * conservative default, and the report names the setting and the command that
 * sets it. Never a key, never a passphrase. ADR-0003.
 */
interface SettingWarning {
  code: string;
  setting: string;
  message: string;
  command: string;
}

function readArgs(argv: string[]): InitArgs {
  if (argv.includes('--legacy-env') || argv.includes('--env-path')) {
    throw new Error('--legacy-env and --env-path are no longer supported. cogmem init writes .cogmem/config.toml only.');
  }
  const readValue = (name: string, fallback: string): string => {
    const index = argv.indexOf(name);
    if (index === -1) return fallback;
    return argv[index + 1] || fallback;
  };
  // A run with no terminal cannot answer the wizard's prompts, and the alternative it used to take —
  // print the backend notice, write no config, exit 0 — told an agent or a CI job that setup had
  // succeeded when nothing existed. `--yes` is the documented automation path, so a non-interactive
  // run takes it: the same defaults, written for real.
  const yes = argv.includes('--yes') || argv.includes('-y') || !process.stdin.isTTY;
  // The Operator path serves a machine (global); the Agent path serves the
  // workspace it was pointed at (project). --scope overrides either.
  const scope = readValue('--scope', yes ? 'project' : 'global');
  const vectorDimension = parseOptionalPositiveInteger(readValue('--vector-dimension', ''), '--vector-dimension');
  const registerAgents: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--register-agent') continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('--register-agent needs a hostId, for example --register-agent bot-a');
    }
    registerAgents.push(value);
  }
  return {
    configPath: readValue('--config', ''),
    homePath: readValue('--home', ''),
    scope: scope === 'project' ? 'project' : 'global',
    dryRun: argv.includes('--dry-run'),
    yes,
    json: argv.includes('--json'),
    vectorDimension,
    probeOllama: !argv.includes('--no-probe'),
    registerAgents,
    rotateAgents: argv.includes('--rotate'),
    registerProjectId: readValue('--project', ''),
  };
}

// ─── Readline helpers ─────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  const raw = await ask(`${question} ${hint} `);
  if (raw === '') return defaultYes;
  return raw.toLowerCase() === 'y';
}

// ─── Backend detection ────────────────────────────────────────────────────────

async function detectBackends(probeOllama = true): Promise<DetectionResult> {
  let ollamaAvailable = false;
  let ollamaModels: string[] = [];

  if (probeOllama) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch('http://localhost:11434/api/tags', {
        signal: controller.signal,
      });
      if (res.ok) {
        const payload = await res.json() as { models?: Array<{ name?: string }> };
        ollamaModels = (payload.models ?? [])
          .map((m) => m.name ?? '')
          .filter((n) => n.length > 0);
        ollamaAvailable = true;
      }
    } catch {
      // Ollama not running — fine
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ollamaAvailable,
    ollamaModels,
    openaiAvailable: Boolean(process.env.OPENAI_API_KEY),
    anthropicAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    qwenAvailable: Boolean(process.env.QWEN_API_KEY),
  };
}

// ─── Model suggestion helpers ─────────────────────────────────────────────────

function pickFirst(models: string[], ...matchers: Array<(n: string) => boolean>): string | undefined {
  for (const matcher of matchers) {
    const found = models.find((m) => matcher(m.toLowerCase()));
    if (found) return found;
  }
  return undefined;
}

export function suggestEmbeddingModel(det: DetectionResult): {
  provider: 'deterministic_local' | 'openai_compatible';
  model: string;
  baseUrl: string;
  vectorDimension: number;
} {
  if (det.ollamaAvailable) {
    const model = pickFirst(
      det.ollamaModels,
      (n) => n.includes('qwen3-embedding'),
      (n) => n.includes('bge-m3'),
      (n) => n.includes('nomic-embed-text'),
      (n) => n.startsWith('dmeta'),
      (n) => n.startsWith('mxbai'),
    );
    if (model) {
      return {
        provider: 'openai_compatible',
        model,
        baseUrl: 'http://localhost:11434/v1',
        vectorDimension: inferEmbeddingVectorDimension('openai_compatible', model),
      };
    }
  }
  return {
    provider: 'deterministic_local',
    model: 'deterministic_local',
    baseUrl: '',
    vectorDimension: DEFAULT_VECTOR_DIMENSION,
  };
}

export function inferEmbeddingVectorDimension(
  provider: 'deterministic_local' | 'openai_compatible',
  model: string,
): number {
  if (provider === 'deterministic_local') return DEFAULT_VECTOR_DIMENSION;
  const normalized = model.toLowerCase();
  if (/qwen3-embedding[-:]8b/.test(normalized)) return 4096;
  if (/qwen3-embedding[-:]4b/.test(normalized)) return 2560;
  if (/qwen3-embedding[-:]0\.6b/.test(normalized)) return 1024;
  if (normalized.includes('bge-m3')) return 1024;
  if (normalized.includes('mxbai')) return 1024;
  if (normalized.includes('nomic-embed-text')) return 768;
  if (normalized.includes('all-minilm-l6-v2')) return DEFAULT_VECTOR_DIMENSION;
  return DEFAULT_VECTOR_DIMENSION;
}

function suggestMemoryModel(det: DetectionResult): {
  provider: 'rule_only' | 'openai_compatible' | 'anthropic';
  model: string;
  baseUrl: string;
  apiKey: string;
} {
  if (det.ollamaAvailable && det.ollamaModels.length > 0) {
    const model = pickFirst(
      det.ollamaModels,
      (n) => n.includes('qwen2.5'),
      (n) => n.includes('qwen'),
      (n) => n.includes('gemma'),
      () => true,
    ) ?? det.ollamaModels[0];
    return { provider: 'openai_compatible', model, baseUrl: 'http://localhost:11434/v1', apiKey: '' };
  }
  if (det.openaiAvailable) {
    return { provider: 'openai_compatible', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKey: '${OPENAI_API_KEY}' };
  }
  if (det.anthropicAvailable) {
    return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', baseUrl: '', apiKey: '${ANTHROPIC_API_KEY}' };
  }
  return { provider: 'rule_only', model: 'rule_only', baseUrl: '', apiKey: '' };
}

function suggestReasoningModel(det: DetectionResult): {
  provider: 'rule_only' | 'openai_compatible' | 'anthropic';
  model: string;
  baseUrl: string;
  apiKey: string;
} {
  if (det.anthropicAvailable) {
    return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', baseUrl: '', apiKey: '${ANTHROPIC_API_KEY}' };
  }
  if (det.openaiAvailable) {
    return { provider: 'openai_compatible', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKey: '${OPENAI_API_KEY}' };
  }
  if (det.ollamaAvailable && det.ollamaModels.length > 0) {
    // Prefer a 7B+ model for reasoning
    const sevenBPlus = det.ollamaModels.find((n) =>
      /\b(7b|8b|9b|11b|12b|13b|14b|20b|27b|32b|70b)\b/i.test(n) ||
      /:(7|8|9|11|12|13|14|20|27|32|34|70)b\b/i.test(n)
    );
    const model = sevenBPlus ?? det.ollamaModels[0];
    return { provider: 'openai_compatible', model, baseUrl: 'http://localhost:11434/v1', apiKey: '' };
  }
  return { provider: 'rule_only', model: 'rule_only', baseUrl: '', apiKey: '' };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function tick(ok: boolean): string { return ok ? '✓' : '✗'; }

function printDetection(det: DetectionResult, probed = true): void {
  console.log('');
  console.log('  Detection results:');
  if (!probed) {
    console.log('    Ollama    – skipped (--no-probe)');
  } else if (det.ollamaAvailable) {
    console.log(`    Ollama    ${tick(true)} running — ${det.ollamaModels.length} model(s): ${det.ollamaModels.slice(0, 4).join(', ')}${det.ollamaModels.length > 4 ? ' …' : ''}`);
  } else {
    console.log(`    Ollama    ${tick(false)} not running (install: https://ollama.com)`);
  }
  console.log(`    OpenAI    ${tick(det.openaiAvailable)} ${det.openaiAvailable ? 'OPENAI_API_KEY set' : 'not set'}`);
  console.log(`    Anthropic ${tick(det.anthropicAvailable)} ${det.anthropicAvailable ? 'ANTHROPIC_API_KEY set' : 'not set'}`);
  console.log(`    Qwen      ${tick(det.qwenAvailable)} ${det.qwenAvailable ? 'QWEN_API_KEY set' : 'not set'}`);
}

function noBackendQuickstart(): void {
  console.log('');
  console.log('  No model backend detected. The kernel will run in rule_only mode');
  console.log('  (no model downloads needed — works out of the box, reduced quality).');
  console.log('');
  console.log('  To unlock richer memory consolidation, set up a backend first:');
  console.log('');
  console.log('    Option A — Local (Ollama, free, private):');
  console.log('      brew install ollama          # macOS');
  console.log('      ollama pull nomic-embed-text # semantic embeddings');
  console.log('      ollama pull qwen2.5:3b       # memory consolidation');
  console.log('      ollama pull qwen2.5:7b       # agent reasoning');
  console.log('      cogmem init                  # re-run this wizard');
  console.log('');
  console.log('    Option B — Cloud reasoning only:');
  console.log('      export ANTHROPIC_API_KEY=sk-ant-...');
  console.log('      export OPENAI_API_KEY=sk-...      # or OpenAI');
  console.log('      cogmem init');
  console.log('');
}

// ─── Wizard sections ──────────────────────────────────────────────────────────

async function stepDatabase(): Promise<string> {
  console.log('');
  console.log('  ── Step 1 of 5: Database ─────────────────────────────────────');
  console.log('  The kernel persists all memory to a single SQLite file.');
  console.log('  Relative paths are resolved from the cogmem config directory.');
  console.log('');
  const raw = await ask('  DB path [memory.db]: ');
  return raw || 'memory.db';
}

async function stepVectorBackend(): Promise<'sqlite-vec' | 'hnswlib'> {
  console.log('');
  console.log('  ── Step 2 of 5: Vector Backend ───────────────────────────────');
  console.log('  sqlite-vec  Pure SQLite cosine search. Zero native deps. (recommended)');
  console.log('  hnswlib     HNSW graph. Faster at scale but requires a native addon.');
  console.log('');
  const raw = await ask('  Backend [sqlite-vec]: ');
  const choice = raw.toLowerCase();
  if (choice === 'hnswlib') return 'hnswlib';
  return 'sqlite-vec';
}

async function stepEmbedding(det: DetectionResult): Promise<{
  provider: 'deterministic_local' | 'openai_compatible';
  model: string;
  baseUrl: string;
  vectorDimension: number;
}> {
  console.log('');
  console.log('  ── Step 3 of 5: Embedding ────────────────────────────────────');
  const suggestion = suggestEmbeddingModel(det);

  if (suggestion.provider === 'openai_compatible') {
    console.log(`  Auto-detected: ${suggestion.model} via Ollama`);
  } else {
    console.log('  No embedding model detected — using deterministic_local (BM25-style, no download).');
    console.log('  For real semantic recall: ollama pull nomic-embed-text OR bge-m3');
  }
  console.log('');

  const edit = await confirm('  Edit embedding settings?', false);
  if (!edit) {
    return {
      ...suggestion,
      vectorDimension: await stepVectorDimension(suggestion.vectorDimension),
    };
  }

  const providerRaw = await ask(`  Provider [${suggestion.provider}]: `);
  const provider = (providerRaw || suggestion.provider) as 'deterministic_local' | 'openai_compatible';

  if (provider === 'openai_compatible') {
    const baseUrl = await ask(`  Base URL [${suggestion.baseUrl || 'http://localhost:11434/v1'}]: `);
    const model   = await ask(`  Model name [${suggestion.model}]: `);
    const resolvedModel = model || suggestion.model;
    return {
      provider: 'openai_compatible',
      baseUrl: baseUrl || suggestion.baseUrl || 'http://localhost:11434/v1',
      model:   resolvedModel,
      vectorDimension: await stepVectorDimension(
        inferEmbeddingVectorDimension('openai_compatible', resolvedModel),
      ),
    };
  }

  return {
    provider: 'deterministic_local',
    model: 'deterministic_local',
    baseUrl: '',
    vectorDimension: await stepVectorDimension(DEFAULT_VECTOR_DIMENSION),
  };
}

async function stepVectorDimension(suggested: number): Promise<number> {
  console.log('');
  console.log('  Vector dimension controls the storage/index width for neuron vectors.');
  console.log('  It must match the embedding model output dimension.');
  const raw = await ask(`  Vector dimension [${suggested}]: `);
  const dimension = parseOptionalPositiveInteger(raw, 'vector dimension') ?? suggested;
  printVectorDimensionWarning(dimension);
  return dimension;
}

async function stepModelRoles(det: DetectionResult): Promise<{
  memoryProvider: 'rule_only' | 'openai_compatible' | 'anthropic';
  memoryBaseUrl: string;
  memoryApiKey: string;
  memoryModel: string;
  reasoningProvider: 'rule_only' | 'openai_compatible' | 'anthropic';
  reasoningBaseUrl: string;
  reasoningApiKey: string;
  reasoningModel: string;
}> {
  console.log('');
  console.log('  ── Step 4 of 5: Model Roles ──────────────────────────────────');
  console.log('  memory    — extracts and consolidates long-term knowledge');
  console.log('  reasoning — answers questions and drives tool-use');
  console.log('  (Both can be rule_only if no LLM backend is configured.)');
  console.log('');

  const memSug = suggestMemoryModel(det);
  const reasSug = suggestReasoningModel(det);

  console.log(`  Suggested memory    → ${memSug.provider} / ${memSug.model}${memSug.baseUrl ? ` @ ${memSug.baseUrl.replace(/^https?:\/\//, '').replace(/\/v1$/, '')}` : ''}`);
  console.log(`  Suggested reasoning → ${reasSug.provider} / ${reasSug.model}${reasSug.baseUrl ? ` @ ${reasSug.baseUrl.replace(/^https?:\/\//, '').replace(/\/v1$/, '')}` : ''}`);
  console.log('');

  const edit = await confirm('  Edit model role settings?', false);

  if (!edit) {
    return {
      memoryProvider:   memSug.provider,
      memoryBaseUrl:    memSug.baseUrl,
      memoryApiKey:     memSug.apiKey,
      memoryModel:      memSug.model,
      reasoningProvider: reasSug.provider,
      reasoningBaseUrl:  reasSug.baseUrl,
      reasoningApiKey:   reasSug.apiKey,
      reasoningModel:    reasSug.model,
    };
  }

  // Memory role
  console.log('');
  console.log('  [memory role]');
  const mProvRaw  = await ask(`  Provider (openai_compatible | anthropic | rule_only) [${memSug.provider}]: `);
  const mProv     = (mProvRaw || memSug.provider) as 'rule_only' | 'openai_compatible' | 'anthropic';
  const mModel    = await ask(`  Model name [${memSug.model}]: `);
  let mBaseUrl = memSug.baseUrl;
  let mApiKey  = memSug.apiKey;
  if (mProv === 'openai_compatible') {
    const bu  = await ask(`  Base URL [${memSug.baseUrl || 'http://localhost:11434/v1'}]: `);
    mBaseUrl  = bu || memSug.baseUrl || 'http://localhost:11434/v1';
    const ak  = await ask(`  API key or env-var placeholder [${memSug.apiKey}]: `);
    mApiKey   = ak || memSug.apiKey;
  } else if (mProv === 'anthropic') {
    const ak  = await ask(`  API key env-var [${memSug.apiKey || '${ANTHROPIC_API_KEY}'}]: `);
    mApiKey   = ak || memSug.apiKey || '${ANTHROPIC_API_KEY}';
    mBaseUrl  = '';
  } else {
    mBaseUrl = '';
    mApiKey  = '';
  }

  // Reasoning role
  console.log('');
  console.log('  [reasoning role]');
  const rProvRaw  = await ask(`  Provider (openai_compatible | anthropic | rule_only) [${reasSug.provider}]: `);
  const rProv     = (rProvRaw || reasSug.provider) as 'rule_only' | 'openai_compatible' | 'anthropic';
  const rModel    = await ask(`  Model name [${reasSug.model}]: `);
  let rBaseUrl = reasSug.baseUrl;
  let rApiKey  = reasSug.apiKey;
  if (rProv === 'openai_compatible') {
    const bu  = await ask(`  Base URL [${reasSug.baseUrl || 'http://localhost:11434/v1'}]: `);
    rBaseUrl  = bu || reasSug.baseUrl || 'http://localhost:11434/v1';
    const ak  = await ask(`  API key or env-var placeholder [${reasSug.apiKey}]: `);
    rApiKey   = ak || reasSug.apiKey;
  } else if (rProv === 'anthropic') {
    const ak  = await ask(`  API key env-var [${reasSug.apiKey || '${ANTHROPIC_API_KEY}'}]: `);
    rApiKey   = ak || reasSug.apiKey || '${ANTHROPIC_API_KEY}';
    rBaseUrl  = '';
  } else {
    rBaseUrl = '';
    rApiKey  = '';
  }

  return {
    memoryProvider:    mProv,
    memoryBaseUrl:     mBaseUrl,
    memoryApiKey:      mApiKey,
    memoryModel:       mModel || memSug.model,
    reasoningProvider: rProv,
    reasoningBaseUrl:  rBaseUrl,
    reasoningApiKey:   rApiKey,
    reasoningModel:    rModel || reasSug.model,
  };
}

async function stepGovernance(): Promise<{
  piiEmail: boolean;
  piiPhone: boolean;
  piiSsn: boolean;
  encryptionPassphrase: string;
}> {
  console.log('');
  console.log('  ── Step 5 of 5: Governance ───────────────────────────────────');
  console.log('  PII redaction strips sensitive patterns before writing to the DB.');
  console.log('  AES-256-GCM field encryption protects content at rest.');
  console.log('');

  const piiAll = await confirm('  Enable PII auto-redaction (email / phone / SSN)?', true);
  let piiEmail = piiAll;
  let piiPhone = piiAll;
  let piiSsn   = piiAll;

  if (piiAll) {
    const fine = await confirm('  Fine-tune individual PII categories?', false);
    if (fine) {
      piiEmail = await confirm('    Redact email addresses?', true);
      piiPhone = await confirm('    Redact phone numbers?', true);
      piiSsn   = await confirm('    Redact SSNs (XXX-XX-XXXX)?', true);
    }
  }

  console.log('');
  const useEncryption = await confirm('  Enable AES-256-GCM field encryption at rest?', false);
  let encryptionPassphrase = '';
  if (useEncryption) {
    console.log('  ⚠  The passphrase cannot be recovered. Store it safely.');
    encryptionPassphrase = await ask('  Passphrase: ');
    if (!encryptionPassphrase) {
      console.log('  Empty passphrase entered — encryption disabled.');
    }
  }

  return { piiEmail, piiPhone, piiSsn, encryptionPassphrase };
}

// ─── Config file writer ───────────────────────────────────────────────────────

function buildTomlLines(cfg: WizardConfig): string[] {
  const lines: string[] = [];
  lines.push('# Generated by cogmem init');
  lines.push(`# date = ${tomlString(new Date().toISOString())}`);
  lines.push('');
  lines.push('[core]');
  lines.push(`db_path = ${tomlString(cfg.dbPath)}`);
  lines.push(`vector_backend = ${tomlString(cfg.vectorBackend)}`);
  lines.push(`vector_dimension = ${cfg.vectorDimension}`);
  lines.push('');
  lines.push('[paths]');
  lines.push('embeddings_dir = "embeddings"');
  lines.push('snapshots_dir = "snapshots"');
  lines.push('logs_dir = "logs"');
  lines.push('');
  // The generated timeouts come from the roles themselves. Writing a smaller number here (the
  // memory role used to get 60s against its own 300s default) makes a slow model abort mid-Dream
  // with only an opaque DOMException to show for it — measured on the box against a 550B model
  // whose Dream call takes ~84s.
  const roleTimeouts = ModelRegistry.defaultConfig();
  lines.push('[embedding]');
  lines.push(`provider = ${tomlString(cfg.embeddingProvider)}`);
  if (cfg.embeddingBaseUrl) lines.push(`base_url = ${tomlString(cfg.embeddingBaseUrl)}`);
  lines.push(`model = ${tomlString(cfg.embeddingModel)}`);
  lines.push(`timeout_ms = ${roleTimeouts.embedding.timeoutMs}`);
  lines.push('');
  lines.push('[memory_model]');
  lines.push(`provider = ${tomlString(cfg.memoryProvider)}`);
  if (cfg.memoryBaseUrl) lines.push(`base_url = ${tomlString(cfg.memoryBaseUrl)}`);
  lines.push(`model = ${tomlString(cfg.memoryModel)}`);
  if (cfg.memoryApiKey) lines.push(`api_key = ${tomlString(cfg.memoryApiKey)}`);
  lines.push(`timeout_ms = ${roleTimeouts.memory.timeoutMs}`);
  lines.push('');
  lines.push('[reasoning_model]');
  lines.push(`provider = ${tomlString(cfg.reasoningProvider)}`);
  if (cfg.reasoningBaseUrl) lines.push(`base_url = ${tomlString(cfg.reasoningBaseUrl)}`);
  lines.push(`model = ${tomlString(cfg.reasoningModel)}`);
  if (cfg.reasoningApiKey) lines.push(`api_key = ${tomlString(cfg.reasoningApiKey)}`);
  lines.push(`timeout_ms = ${roleTimeouts.reasoning.timeoutMs}`);
  lines.push('');
  lines.push('[governance]');
  lines.push(`pii_redact_email = ${cfg.piiEmail}`);
  lines.push(`pii_redact_phone = ${cfg.piiPhone}`);
  lines.push(`pii_redact_ssn = ${cfg.piiSsn}`);
  lines.push(`encryption = ${Boolean(cfg.encryptionPassphrase)}`);
  if (cfg.encryptionPassphrase) {
    lines.push(`encryption_passphrase = ${tomlString(cfg.encryptionPassphrase)}`);
  }
  // No `workspace_dir`: the Workspace is derived from where `.cogmem/` is, so a
  // declared one could only disagree with it (ADR-0010). A config written before
  // this change still carries `"."`, and that resolves to the Workspace too.
  lines.push('');
  return lines;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function parseOptionalPositiveInteger(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = /^[0-9]+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function printVectorDimensionWarning(dimension: number): void {
  if (dimension < HIGH_VECTOR_DIMENSION_THRESHOLD) return;
  console.log(`  Warning: ${vectorDimensionWarningMessage(dimension)}`);
}

function resolveInstallTarget(args: InitArgs): { homeDir: string; configPath: string } {
  const explicitConfigPath = args.configPath ? resolveInputPath(args.configPath) : '';
  const homeDir = args.homePath
    ? resolveInputPath(args.homePath)
    : explicitConfigPath
      ? dirname(explicitConfigPath)
      : args.scope === 'project'
        ? resolve(process.cwd(), '.cogmem')
        : defaultCogmemHome();
  return {
    homeDir,
    configPath: explicitConfigPath || join(homeDir, 'config.toml'),
  };
}

function resolveInputPath(value: string): string {
  return resolve(process.cwd(), expandUserPath(value));
}

function expandUserPath(value: string): string {
  const home = process.env.HOME || homedir();
  if (value === '~') return home;
  if (value.startsWith('~/')) return join(home, value.slice(2));
  return value;
}

function ensureInstallDirs(homeDir: string): void {
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(join(homeDir, 'embeddings'), { recursive: true });
  mkdirSync(join(homeDir, 'snapshots'), { recursive: true });
  mkdirSync(join(homeDir, 'logs'), { recursive: true });
}

// ─── Post-write code snippet ──────────────────────────────────────────────────

function printUsageSnippet(cfg: WizardConfig): void {
  console.log('');
  console.log('  Quick-start snippet:');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────┐');
  console.log("  │  import { createMemoryKernelFromConfig } from 'cogmem';");
  console.log('  │');
  console.log("  │  // Auto-discovers .cogmem/config.toml or ~/.cogmem/config.toml");
  console.log('  │  const kernel = createMemoryKernelFromConfig();');
  console.log('  │');
  console.log("  │  await kernel.ingest({ content: 'Remember that the user prefers concise answers.', projectId: 'my-agent' });");
  console.log("  │  const memory = new KernelAgentMemoryBackend(kernel);");
  console.log("  │  const result = await memory.recall({ agentId: 'my-agent', projectId: 'my-agent', query: 'what does the user prefer?' });");
  console.log('  │  console.log(result.rawEvidence.map((item) => item.content));');
  if (cfg.encryptionPassphrase) {
    console.log('  │');
    console.log("  │  // AES-256-GCM is created from config by createMemoryKernelFromConfig().");
  }
  console.log('  └─────────────────────────────────────────────────────────────┘');

  if (cfg.encryptionPassphrase) {
    console.log('');
    console.log('  Encryption note:');
    console.log('  │  createMemoryKernelFromConfig() will create the AES-256-GCM provider from config.');
  }
}

// ─── Unattended configuration (the Agent path) ────────────────────────────────

/**
 * Build the config an unattended run may write, plus the warnings for every
 * Human-required setting it had to settle without a human.
 *
 * Agent-decidable settings keep real defaults: database path, vector backend,
 * all three PII redaction switches on.
 *
 * Human-required settings fall back to conservative values: no key is written,
 * no passphrase is invented, and no provider that could spend money is selected.
 * Detection still runs, but only to suggest.
 */
function buildUnattendedConfig(
  args: InitArgs,
  det: DetectionResult,
): { cfg: WizardConfig; warnings: SettingWarning[] } {
  const warnings: SettingWarning[] = [];
  // Deliberately the literal `cogmem init`, not a resolved path: these are the
  // runtime-built command templates `__tests__/command-templates.unit.test.ts`
  // renders and resolves against the real dispatch tables, and a template built
  // from the resolver is outside what that guard can render. Changing this means
  // changing that guard's coverage too — a decision of its own, not a side effect
  // of #78. Recorded as an open boundary in the ledger.
  const rerun = 'cogmem init';

  const embedding = suggestEmbeddingModel(det);
  warnings.push({
    code: 'embedding_provider_defaulted',
    setting: 'embedding provider',
    message: embedding.provider === 'deterministic_local'
      ? 'deterministic_local embedding is written; semantic recall stays off until an embedding model is chosen.'
      : `${embedding.model} was detected via Ollama, but an unattended run does not choose a provider; deterministic_local is written instead.`,
    command: rerun,
  });

  const memory = suggestMemoryModel(det);
  const reasoning = suggestReasoningModel(det);
  const detectedModels = memory.provider !== 'rule_only' || reasoning.provider !== 'rule_only';
  warnings.push({
    code: 'model_provider_defaulted',
    setting: 'memory and reasoning provider',
    message: detectedModels
      ? `${memory.model} / ${reasoning.model} were detected, but an unattended run does not choose a provider; rule_only is written.`
      : 'rule_only is written; Dream curation and model-backed consolidation stay off until a provider is chosen.',
    command: rerun,
  });

  warnings.push({
    code: 'api_key_defaulted',
    setting: 'API key',
    message: 'no API key is written; an unattended run never copies one from the environment, so no provider can be called and no cost can be incurred.',
    command: rerun,
  });

  warnings.push({
    code: 'encryption_defaulted',
    setting: 'encryption passphrase',
    message: 'field encryption is off; an unattended run never invents a passphrase, because losing it loses the database.',
    command: rerun,
  });

  const cfg: WizardConfig = {
    dbPath: 'memory.db',
    vectorBackend: 'sqlite-vec',
    vectorDimension: args.vectorDimension ?? DEFAULT_VECTOR_DIMENSION,
    embeddingProvider: 'deterministic_local',
    embeddingBaseUrl: '',
    embeddingModel: 'deterministic_local',
    memoryProvider: 'rule_only',
    memoryBaseUrl: '',
    memoryApiKey: '',
    memoryModel: 'rule_only',
    reasoningProvider: 'rule_only',
    reasoningBaseUrl: '',
    reasoningApiKey: '',
    reasoningModel: 'rule_only',
    piiEmail: true,
    piiPhone: true,
    piiSsn: true,
    encryptionPassphrase: '',
  };
  return { cfg, warnings };
}

function printSettingWarnings(warnings: SettingWarning[]): void {
  if (warnings.length === 0) return;
  console.log('');
  console.log('  Warnings — settings this unattended run settled conservatively:');
  for (const warning of warnings) {
    console.log(`    WARN ${warning.code}: ${warning.setting}`);
    console.log(`         ${warning.message}`);
    console.log(`         set it with: ${warning.command}`);
  }
}

function emitInitJson(input: {
  dryRun: boolean;
  configPath: string;
  homeDir: string;
  config: WizardConfig;
  warnings: SettingWarning[];
  written: boolean;
}): void {
  // A runnable command, not the bin directory: `--json` is what an agent follows,
  // and `/path/to/bin doctor --json` is exit 126. Off PATH the step is the
  // absolute launcher, on PATH the bare name (#78).
  // Point the managed launcher at this installation before printing the steps, so the
  // commands a reader copies name the stable path rather than this installation (#114).
  // A dry run writes nothing, so the launcher may not exist yet — but the step a reader
  // copies has to name the path the real run creates, or it names this installation and
  // stops working after the prefix moves (#114). Fall back to the installation when there
  // is none to point at (a source checkout).
  const bin = input.dryRun && !hasCogmemLauncher() && resolveCogmemInstallation()
    ? cogmemLauncherPath()
    : resolveCogmemInvocation();
  console.log(JSON.stringify({
    schemaVersion: 'cogmem.cli.v1',
    command: 'init',
    dryRun: input.dryRun,
    written: input.written,
    configPath: input.configPath,
    homeDir: input.homeDir,
    config: {
      dbPath: input.config.dbPath,
      vectorBackend: input.config.vectorBackend,
      vectorDimension: input.config.vectorDimension,
      embedding: { provider: input.config.embeddingProvider, model: input.config.embeddingModel },
      memoryModel: { provider: input.config.memoryProvider, model: input.config.memoryModel },
      reasoningModel: { provider: input.config.reasoningProvider, model: input.config.reasoningModel },
      piiRedaction: {
        email: input.config.piiEmail,
        phone: input.config.piiPhone,
        ssn: input.config.piiSsn,
      },
      encryption: Boolean(input.config.encryptionPassphrase),
    },
    warnings: input.warnings,
    // Read from the shared module rather than restated here: a second copy of
    // this step is how the two versions drifted apart before.
    nextSteps: [installGateStep(bin, 'now')],
  }, null, 2));
}

// ─── Agent registration (#65) ─────────────────────────────────────────────────

/**
 * `--register-agent` is not a configuration action.
 *
 * It mints a credential and writes the agent registry, and deliberately does not
 * touch `config.toml`: the second agent on a machine is onboarded long after the
 * config exists, and this command refuses to overwrite an existing config, so
 * folding the two together would mean hand-editing a file to add an agent.
 */
function runAgentRegistration(args: InitArgs, homeDir: string): void {
  const agentsPath = join(homeDir, 'agents.json');
  const registered: Array<Record<string, unknown>> = [];
  try {
    for (const hostId of args.registerAgents) {
      if (args.dryRun) {
        registered.push({
          hostId,
          token: null,
          projectId: args.registerProjectId || hostId,
          replaced: false,
          dryRun: true,
        });
        continue;
      }
      const agent = registerAgent({
        path: agentsPath,
        hostId,
        projectId: args.registerProjectId || undefined,
        rotate: args.rotateAgents,
      });
      registered.push({
        hostId: agent.hostId,
        token: agent.token,
        projectId: agent.projectId,
        replaced: agent.replaced,
        dryRun: false,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      console.error(JSON.stringify({
        schemaVersion: 'cogmem.cli.v1',
        command: 'init',
        status: 'refused',
        reason: 'agent_registration_failed',
        agentsPath,
        message,
      }, null, 2));
    } else {
      console.error(`  ${message}`);
    }
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify({
      schemaVersion: 'cogmem.cli.v1',
      command: 'init',
      status: args.dryRun ? 'dry_run' : 'registered',
      dryRun: args.dryRun,
      written: !args.dryRun,
      agentsPath,
      registeredAgents: registered,
    }, null, 2));
    return;
  }

  console.log('');
  console.log(args.dryRun
    ? `  Dry run: would register ${registered.length} agent(s) in ${agentsPath}`
    : `  Registered ${registered.length} agent(s) in ${agentsPath}`);
  for (const entry of registered) {
    console.log(`    ${String(entry.hostId)}   project=${String(entry.projectId)}`);
    console.log(`      credential: ${args.dryRun ? '(dry run — nothing generated)' : String(entry.token)}`);
  }
  if (!args.dryRun) {
    console.log('');
    console.log('  Store each credential now. The registry keeps only a digest, so it cannot');
    console.log('  be read back: a lost credential is replaced with --rotate.');
  }
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// The flags this command honours, named once: `assertCliArgs` allows them and the help
// prints them, so the two cannot drift. `env-path` and `legacy-env` are allowed through
// only so `readArgs` can refuse them with a reason instead of "unknown flag".
const INIT_FLAGS = ['config', 'dry-run', 'home', 'json', 'no-probe', 'project', 'register-agent', 'rotate', 'scope', 'vector-dimension', 'yes'] as const;

function usage(): string {
  return [
    'Usage: cogmem init [options]',
    '  With no flags this runs the setup wizard; with --yes it takes every default.',
    `  ${INIT_FLAGS.map((flag) => `--${flag}`).join(' ')}`,
  ].join('\n');
}

async function main(): Promise<void> {
  assertCliArgs(process.argv.slice(2), { usage: usage(), extraFlags: [...INIT_FLAGS, 'env-path', 'legacy-env'] });
  const args = readArgs(process.argv.slice(2));
  // In --json mode stdout carries one JSON document and nothing else, and the
  // progress chatter is suppressed rather than moved to stderr: the JSON already
  // reports every setting and warning, so the human rendering has nothing to add.
  const say = (line = ''): void => {
    if (!args.json) console.log(line);
  };
  if (args.registerAgents.length > 0) {
    // Where the readers look. `--home`/`--config` name the place and win; otherwise
    // the registry goes into the config-derived Workspace's own `.cogmem/`, so a
    // registration made from a subdirectory lands beside the config `cogmem observatory`
    // and `cogmem-host-bridge` read, instead of in a `.cogmem/` no reader derives
    // (#80). On a machine whose only config is the global one, `--scope project`
    // still means the directory the operator ran this in — the readers find that by
    // walking up for the registry itself.
    const target = resolveInstallTarget(args);
    const workspace = resolveWorkspaceRoot({ cwd: process.cwd() });
    const projectConfig = join(workspace, '.cogmem', 'config.toml');
    const usesProjectConfig = projectConfig !== defaultCogmemConfigPath(process.env) && existsSync(projectConfig);
    const registryHome = args.homePath || args.configPath || !usesProjectConfig
      ? target.homeDir
      : join(workspace, '.cogmem');
    runAgentRegistration(args, registryHome);
    return;
  }
  say('');
  say('╔═══════════════════════════════════════════════════════════════╗');
  say('║                  cogmem — Memory Kernel Init                 ║');
  say('║                   Interactive Setup Wizard                    ║');
  say('╚═══════════════════════════════════════════════════════════════╝');
  say('');
  const target = resolveInstallTarget(args);
  say(`  This wizard writes ${args.scope === 'project' ? '.cogmem/config.toml in the current project' : '~/.cogmem/config.toml by default'}.`);
  say('  Run cogmem init again at any time to reconfigure.');
  say(`  Cogmem home: ${target.homeDir}`);

  // Detect backends
  if (!args.json) process.stdout.write('\n  Detecting available backends …');
  const det = await detectBackends(args.probeOllama);
  if (!args.json) {
    process.stdout.write(' done.\n');
    printDetection(det, args.probeOllama);
  }

  const hasAnyBackend = det.ollamaAvailable || det.openaiAvailable || det.anthropicAvailable || det.qwenAvailable;
  if (!hasAnyBackend && !args.yes) {
    noBackendQuickstart();
    const proceed = await confirm('  Continue and configure rule_only mode?', false);
    if (!proceed) {
      console.log('  Aborted. Run cogmem init again after setting up a backend.');
      process.exit(0);
    }
  }

  if (args.yes) {
    const { cfg, warnings } = buildUnattendedConfig(args, det);
    const lines = buildTomlLines(cfg);
    const outputPath = target.configPath;

    if (args.dryRun) {
      if (args.json) {
        emitInitJson({
          dryRun: true,
          configPath: outputPath,
          homeDir: target.homeDir,
          config: cfg,
          warnings,
          written: false,
        });
        return;
      }
      console.log('');
      console.log(`  Dry run config for ${outputPath}:`);
      console.log(lines.join('\n'));
      printVectorDimensionWarning(cfg.vectorDimension);
      printSettingWarnings(warnings);
      console.log('');
      return;
    }

    if (existsSync(outputPath)) {
      const message = `Aborted — config already exists at ${outputPath}. Use interactive mode to overwrite.`;
      if (args.json) {
        console.error(JSON.stringify({
          schemaVersion: 'cogmem.cli.v1',
          command: 'init',
          status: 'refused',
          reason: 'config_exists',
          configPath: outputPath,
          message,
        }, null, 2));
      } else {
        console.log(`  ${message}`);
      }
      process.exit(1);
    }

    ensureInstallDirs(target.homeDir);
    writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
    // The managed launcher is part of finishing an install, not part of printing JSON:
    // it used to be created only by the `--json` output path, so an interactive `cogmem
    // init` left no launcher and every host configuration written afterwards named this
    // installation directly — the failure #114 exists to prevent.
    ensureCogmemLauncher();

    if (args.json) {
      emitInitJson({
        dryRun: false,
        configPath: outputPath,
        homeDir: target.homeDir,
        config: cfg,
        warnings,
        written: true,
      });
      return;
    }

    console.log(`  Configuration written to ${outputPath}`);
    console.log(`  Cogmem home ${target.homeDir}`);
    console.log(`  Database    ${join(target.homeDir, cfg.dbPath)}`);
    console.log(`  Snapshots   ${join(target.homeDir, 'snapshots')}`);
    printVectorDimensionWarning(cfg.vectorDimension);
    printSettingWarnings(warnings);
    printUsageSnippet(cfg);
    return;
  }

  // Run all wizard steps
  const dbPath        = await stepDatabase();
  const vectorBackend = await stepVectorBackend();
  const embedding     = await stepEmbedding(det);
  const models        = await stepModelRoles(det);
  const governance    = await stepGovernance();

  // Compose final config
  const cfg: WizardConfig = {
    dbPath,
    vectorBackend,
    vectorDimension: args.vectorDimension ?? embedding.vectorDimension,
    embeddingProvider: embedding.provider,
    embeddingBaseUrl:  embedding.baseUrl,
    embeddingModel:    embedding.model,
    ...models,
    ...governance,
  };

  const outputPath = target.configPath;
  const alreadyExists = existsSync(outputPath);
  if (alreadyExists) {
    const overwrite = await confirm(`\n  ${outputPath} already exists. Overwrite?`, false);
    if (!overwrite) {
      console.log('  Aborted — existing config left unchanged.');
      process.exit(0);
    }
  }

  const lines = buildTomlLines(cfg);
  // A dry run is a promise not to touch the machine — no file, and no directories
  // either. The summary below is printed the same way in both cases, so what a
  // dry run shows is exactly what the real run would have written.
  if (!args.dryRun) {
    ensureInstallDirs(target.homeDir);
    writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
    // The managed launcher is part of finishing an install, not part of printing JSON:
    // it used to be created only by the `--json` output path, so an interactive `cogmem
    // init` left no launcher and every host configuration written afterwards named this
    // installation directly — the failure #114 exists to prevent.
    ensureCogmemLauncher();
  }

  // Summary
  console.log('');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log(args.dryRun
    ? `  Dry run — nothing written. Would write ${outputPath}`
    : `  Configuration written to ${outputPath}`);
  console.log(`  Cogmem home    ${target.homeDir}`);
  console.log(`  Config         ${target.configPath}`);
  console.log(`  Database       ${join(target.homeDir, cfg.dbPath)}`);
  console.log(`  Snapshots      ${join(target.homeDir, 'snapshots')}`);
  console.log('');
  console.log(`  DB             ${cfg.dbPath}`);
  console.log(`  Vector backend ${cfg.vectorBackend}`);
  console.log(`  Vector dim     ${cfg.vectorDimension}`);
  console.log(`  Embedding      ${cfg.embeddingProvider} / ${cfg.embeddingModel}`);
  console.log(`  Memory model   ${cfg.memoryProvider} / ${cfg.memoryModel}`);
  console.log(`  Reasoning      ${cfg.reasoningProvider} / ${cfg.reasoningModel}`);
  console.log(`  PII redaction  email=${cfg.piiEmail} phone=${cfg.piiPhone} ssn=${cfg.piiSsn}`);
  console.log(`  Encryption     ${cfg.encryptionPassphrase ? 'AES-256-GCM enabled' : 'disabled'}`);
  printVectorDimensionWarning(cfg.vectorDimension);

  printUsageSnippet(cfg);
  console.log('  Done. ✓');
  console.log('');
}

if (import.meta.main) {
  main().catch((err) => {
    // Same refusal rendering as every other entry that can open a database.
    const refusal = process.argv.includes('--json') ? refusalDocumentFor(err, 'init') : undefined;
    if (refusal) {
      printCliJson('init', refusal);
      process.exit(1);
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
