import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCogmemConfigPath } from '../../config/CogmemConfig.js';
function makePluginId(workspaceRoot) {
    const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
    return `cogmem-auto-memory-${hash}`;
}
const PLUGIN_ID = 'cogmem-auto-memory'; // legacy default, not used for multi-workspace
const PLUGIN_VERSION = '0.7.2';
function defaultPublicEntrypoint() {
    const here = resolve(dirname(fileURLToPath(import.meta.url)));
    // Running from dist/host/openclaw, the package entry is two levels up. Running
    // from src/host/openclaw (a checkout, no build step), it lives under dist/,
    // and recording src/public.js would leave the plugin pointing at a file that
    // was never built.
    const candidates = [
        join(here, '../..', 'public.js'),
        join(here, '../../..', 'dist', 'public.js'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
export function defaultOpenClawConfigPath(workspaceRoot, env = process.env) {
    const resolvedWorkspace = resolve(workspaceRoot);
    const parentConfig = join(dirname(resolvedWorkspace), 'openclaw.json');
    if (basename(resolvedWorkspace) === 'workspace' && existsSync(parentConfig)) {
        return parentConfig;
    }
    return join(env.HOME || homedir(), '.openclaw', 'openclaw.json');
}
export function defaultOpenClawAutoMemoryPluginDir(workspaceRoot) {
    return join(resolve(workspaceRoot), 'extensions', makePluginId(workspaceRoot));
}
/**
 * The plugin spawns this binary to load the package entry, and that entry imports
 * `bun:sqlite`. A Node binary therefore installs cleanly and only fails later, on
 * every hook, inside the OpenClaw gateway log. Reject it before the config is written.
 */
export function assertBunRuntime(bunPath) {
    const probe = spawnSync(bunPath, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    const reported = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim().split('\n')[0] ?? '';
    if (probe.error || probe.status !== 0) {
        const reason = probe.error ? probe.error.message : `exit ${probe.status}`;
        throw new Error(`--bun ${bunPath} is not runnable (${reason}). Pass the Bun binary that should run the Cogmem bridge, e.g. --bun "$(command -v bun)".`);
    }
    // `bun --version` prints `1.3.14`; `node --version` prints `v24.16.0`.
    if (!/^\d+\.\d+\.\d+/.test(reported)) {
        throw new Error(`--bun ${bunPath} reported "${reported}", which is not Bun. The Cogmem bridge loads a bundle that imports bun:sqlite, so a Node runtime installs fine and then fails on every hook. Pass a real Bun binary, e.g. --bun "$(command -v bun)".`);
    }
}
export function installOpenClawAutoMemoryPlugin(options) {
    const workspaceRoot = resolve(options.workspaceRoot);
    const configResolution = options.configPath
        ? { kind: 'toml', path: resolve(options.configPath) }
        : resolveCogmemConfigPath({ cwd: workspaceRoot });
    if (configResolution.kind !== 'toml') {
        throw new Error(`Missing cogmem config at ${configResolution.path}. Ask an operator to run the interactive setup: cogmem init --agent openclaw --scope project.`);
    }
    const configPath = configResolution.path;
    const pluginId = options.pluginId || makePluginId(workspaceRoot);
    const pluginDir = resolve(options.pluginDir || join(resolve(workspaceRoot), 'extensions', pluginId));
    const openclawConfigPath = resolve(options.openclawConfigPath || defaultOpenClawConfigPath(workspaceRoot));
    const bunPath = options.bunPath || process.execPath || 'bun';
    assertBunRuntime(bunPath);
    const projectId = options.projectId || `openclaw-${createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 8)}`;
    const agentId = options.agentId || `openclaw-${createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 8)}`;
    const files = buildPluginFiles(pluginId);
    const desiredFiles = new Map([
        [join(pluginDir, 'package.json'), files.packageJson],
        [join(pluginDir, 'openclaw.plugin.json'), files.manifestJson],
        [join(pluginDir, 'index.js'), files.indexJs],
        [join(pluginDir, 'bridge.mjs'), files.bridgeMjs],
    ]);
    const filesAlreadyCurrent = Array.from(desiredFiles.entries())
        .every(([path, body]) => existsSync(path) && readFileSync(path, 'utf8') === body);
    const patchedConfig = buildPatchedOpenClawConfig({
        openclawConfigPath,
        pluginDir,
        configPath,
        workspaceRoot,
        bunPath,
        agentId,
        projectId,
        pluginId,
    });
    const alreadyCurrent = filesAlreadyCurrent && !patchedConfig.changed;
    let backupPath;
    if (!options.dryRun) {
        if (!existsSync(openclawConfigPath)) {
            throw new Error(`Missing OpenClaw config at ${openclawConfigPath}. Pass --openclaw-config <path>.`);
        }
        if (!filesAlreadyCurrent || options.force) {
            mkdirSync(pluginDir, { recursive: true });
            for (const [path, body] of desiredFiles) {
                writeFileSync(path, body, 'utf8');
            }
        }
        if (patchedConfig.changed || options.force) {
            backupPath = `${openclawConfigPath}.cogmem.bak-${Date.now()}`;
            writeFileSync(backupPath, readFileSync(openclawConfigPath, 'utf8'), 'utf8');
            writeFileSync(openclawConfigPath, patchedConfig.text, 'utf8');
        }
    }
    return {
        enabled: true,
        pluginId,
        pluginDir,
        openclawConfigPath,
        configPath,
        dryRun: options.dryRun === true,
        installed: !options.dryRun && (!filesAlreadyCurrent || patchedConfig.changed || options.force === true),
        alreadyCurrent,
        configUpdated: patchedConfig.changed || options.force === true,
        backupPath,
        hookNames: ['before_prompt_build', 'agent_end'],
        nextCommands: [
            `openclaw plugins inspect ${pluginId} --runtime --json`,
            'openclaw gateway restart',
        ],
    };
}
export function inspectOpenClawAutoMemoryPlugin(options) {
    const workspaceRoot = resolve(options.workspaceRoot);
    const pluginId = makePluginId(workspaceRoot);
    const pluginDir = resolve(options.pluginDir || defaultOpenClawAutoMemoryPluginDir(workspaceRoot));
    const files = buildPluginFiles(pluginId);
    const desiredFiles = new Map([
        [join(pluginDir, 'package.json'), files.packageJson],
        [join(pluginDir, 'openclaw.plugin.json'), files.manifestJson],
        [join(pluginDir, 'index.js'), files.indexJs],
        [join(pluginDir, 'bridge.mjs'), files.bridgeMjs],
    ]);
    const fileResults = Array.from(desiredFiles.entries()).map(([path, body]) => {
        const exists = existsSync(path);
        const actual = exists ? readFileSync(path, 'utf8') : undefined;
        return {
            path,
            exists,
            current: actual === body,
            expectedSha256: sha256(body),
            actualSha256: actual ? sha256(actual) : undefined,
        };
    });
    let version;
    const packagePath = join(pluginDir, 'package.json');
    if (existsSync(packagePath)) {
        try {
            version = JSON.parse(readFileSync(packagePath, 'utf8')).version;
        }
        catch {
            version = undefined;
        }
    }
    return {
        pluginId,
        pluginDir,
        installed: fileResults.some((file) => file.exists),
        current: fileResults.every((file) => file.current),
        version,
        expectedVersion: PLUGIN_VERSION,
        files: fileResults,
    };
}
function sha256(text) {
    return createHash('sha256').update(text).digest('hex');
}
function buildPatchedOpenClawConfig(input) {
    const original = existsSync(input.openclawConfigPath)
        ? readFileSync(input.openclawConfigPath, 'utf8')
        : '{}';
    const root = parseJsonObject(original, input.openclawConfigPath);
    const before = JSON.stringify(root);
    const plugins = ensureObject(root, 'plugins');
    plugins.enabled = true;
    const load = ensureObject(plugins, 'load');
    load.paths = appendUniqueArray(load.paths, input.pluginDir);
    if (Array.isArray(plugins.allow)) {
        plugins.allow = appendUniqueArray(plugins.allow, input.pluginId);
    }
    const entries = ensureObject(plugins, 'entries');
    // Find migration source: prefer existing entry for this pluginId, then legacy entry
    // that matches this workspace (by configPath/projectId), then empty object.
    let migrationSource = {};
    if (isRecord(entries[input.pluginId])) {
        migrationSource = entries[input.pluginId];
    }
    else if (isRecord(entries[PLUGIN_ID])) {
        const legacy = entries[PLUGIN_ID];
        const legacyConfig = isRecord(legacy.config) ? legacy.config : {};
        // Only migrate if legacy entry belongs to this workspace
        if (legacyConfig.configPath === input.configPath && legacyConfig.projectId === input.projectId) {
            migrationSource = legacy;
        }
    }
    // Build new entry with migration source as base
    entries[input.pluginId] = {
        ...migrationSource,
        enabled: true,
        hooks: {
            ...(isRecord(migrationSource.hooks) ? migrationSource.hooks : {}),
            allowConversationAccess: true,
            allowPromptInjection: true,
            timeoutMs: 30000,
            timeouts: {
                before_prompt_build: 30000,
                agent_end: 60000,
            },
        },
        config: {
            ...(isRecord(migrationSource.config) ? migrationSource.config : {}),
            configPath: input.configPath,
            cwd: input.workspaceRoot,
            bunPath: input.bunPath,
            publicEntrypoint: defaultPublicEntrypoint(),
            bridgeDaemon: true,
            bridgeSocket: join(input.pluginDir || defaultOpenClawAutoMemoryPluginDir(input.workspaceRoot), 'run', 'bridge.sock'),
            bridgeTimeoutMs: 5000,
            agentId: input.agentId,
            projectId: input.projectId,
            autoRecall: true,
            autoRemember: true,
            autoAtlas: true,
            atlasLimit: 8,
            atlasMaxChars: 3000,
            limit: 3,
            maxQueryChars: 1200,
            maxAssistantChars: 6000,
            ingestMode: 'selective_compile',
            stripRecallBlocksBeforeRemember: true,
            compileSignalSource: 'user_only',
            excludeCurrentSessionCompiledMemory: true,
            memoryContextMaxChars: 3500,
            memoryContextMaxItems: 3,
            sourceWindowMaxChars: 1200,
            includeSourceWindowByDefault: false,
            contextCortexEnabled: true,
            strategyCortexEnabled: true,
            contextAvailableTokens: 16000,
            contextMemoryMaxRatio: 0.25,
            turnBridgeEnabled: true,
            turnBridgeMaxTurns: 3,
            turnBridgeMaxChars: 1200,
            turnBridgeInjectPolicy: 'same_topic_only',
            sessionStateEnabled: true,
            sessionStateMaxChars: 1800,
            recallTimeoutMs: 30000,
            rememberTimeoutMs: 60000,
            rememberStrategy: 'queued',
            rememberQueuePath: '',
            rememberDrainTimeoutMs: 60000,
            rememberDrainBatchSize: 20,
            rememberMaxAttempts: 3,
            auditLog: true,
        },
    };
    // Clean up legacy entry if it belonged to this workspace (prevents duplicate enabled plugins)
    if (isRecord(entries[PLUGIN_ID])) {
        const legacy = entries[PLUGIN_ID];
        const legacyConfig = isRecord(legacy.config) ? legacy.config : {};
        if (legacyConfig.configPath === input.configPath && legacyConfig.projectId === input.projectId) {
            delete entries[PLUGIN_ID];
            // Also remove from allow list if present
            if (Array.isArray(plugins.allow)) {
                plugins.allow = plugins.allow.filter((id) => id !== PLUGIN_ID);
            }
        }
    }
    const after = JSON.stringify(root);
    return {
        text: `${JSON.stringify(root, null, 2)}\n`,
        changed: before !== after,
    };
}
function buildPluginFiles(pluginId) {
    const pid = pluginId || PLUGIN_ID;
    return {
        packageJson: `${JSON.stringify({
            name: pid,
            version: PLUGIN_VERSION,
            private: true,
            type: 'commonjs',
            main: 'index.js',
        }, null, 2)}\n`,
        manifestJson: `${JSON.stringify({
            id: pid,
            name: 'CogMem Auto Memory',
            version: PLUGIN_VERSION,
            main: 'index.js',
            hooks: ['before_prompt_build', 'agent_end'],
            configSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    configPath: { type: 'string' },
                    cwd: { type: 'string' },
                    bunPath: { type: 'string' },
                    publicEntrypoint: { type: 'string' },
                    bridgeDaemon: { type: 'boolean' },
                    bridgeSocket: { type: 'string' },
                    bridgeTimeoutMs: { type: 'number' },
                    agentId: { type: 'string' },
                    projectId: { type: 'string' },
                    autoRecall: { type: 'boolean' },
                    autoRemember: { type: 'boolean' },
                    autoAtlas: { type: 'boolean' },
                    atlasLimit: { type: 'number' },
                    atlasMaxChars: { type: 'number' },
                    limit: { type: 'number' },
                    maxQueryChars: { type: 'number' },
                    maxAssistantChars: { type: 'number' },
                    ingestMode: {
                        type: 'string',
                        enum: ['immediate_compile', 'selective_compile', 'raw_archive_only', 'raw_then_dream'],
                    },
                    stripRecallBlocksBeforeRemember: { type: 'boolean' },
                    compileSignalSource: {
                        type: 'string',
                        enum: ['user_only'],
                    },
                    excludeCurrentSessionCompiledMemory: { type: 'boolean' },
                    memoryContextMaxChars: { type: 'number' },
                    memoryContextMaxItems: { type: 'number' },
                    sourceWindowMaxChars: { type: 'number' },
                    includeSourceWindowByDefault: { type: 'boolean' },
                    contextCortexEnabled: { type: 'boolean' },
                    strategyCortexEnabled: { type: 'boolean' },
                    contextAvailableTokens: { type: 'number' },
                    contextMemoryMaxRatio: { type: 'number' },
                    turnBridgeEnabled: { type: 'boolean' },
                    turnBridgeMaxTurns: { type: 'number' },
                    turnBridgeMaxChars: { type: 'number' },
                    turnBridgeInjectPolicy: {
                        type: 'string',
                        enum: ['same_topic_only', 'always', 'off'],
                    },
                    sessionStateEnabled: { type: 'boolean' },
                    sessionStateMaxChars: { type: 'number' },
                    recallTimeoutMs: { type: 'number' },
                    rememberTimeoutMs: { type: 'number' },
                    rememberStrategy: {
                        type: 'string',
                        enum: ['queued'],
                    },
                    rememberQueuePath: { type: 'string' },
                    rememberDrainTimeoutMs: { type: 'number' },
                    rememberDrainBatchSize: { type: 'number' },
                    rememberMaxAttempts: { type: 'number' },
                    auditLog: { type: 'boolean' },
                    auditLogPath: { type: 'string' },
                },
            },
        }, null, 2)}\n`,
        indexJs: pluginIndexJs(),
        bridgeMjs: pluginBridgeMjs(),
    };
}
function pluginIndexJs() {
    return String.raw `'use strict';

const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');

// PLUGIN_ID is injected at install time from the workspace hash
const PLUGIN_ID = '${PLUGIN_ID}';
const PLUGIN_VERSION = '${PLUGIN_VERSION}';
const DEFAULTS = {
  configPath: '',
  cwd: process.cwd(),
  bunPath: 'bun',
  publicEntrypoint: '',
  bridgeDaemon: true,
  bridgeSocket: '',
  bridgeTimeoutMs: 5000,
  agentId: 'openclaw',
  projectId: 'openclaw',
  autoRecall: true,
  autoRemember: true,
  autoAtlas: true,
  atlasLimit: 8,
  atlasMaxChars: 3000,
  limit: 3,
  maxQueryChars: 1200,
  maxAssistantChars: 6000,
  ingestMode: 'selective_compile',
  stripRecallBlocksBeforeRemember: true,
  compileSignalSource: 'user_only',
  excludeCurrentSessionCompiledMemory: true,
  memoryContextMaxChars: 3500,
  memoryContextMaxItems: 3,
  sourceWindowMaxChars: 1200,
  includeSourceWindowByDefault: false,
  contextCortexEnabled: true,
  strategyCortexEnabled: true,
  contextAvailableTokens: 16000,
  contextMemoryMaxRatio: 0.25,
  turnBridgeEnabled: true,
  turnBridgeMaxTurns: 3,
  turnBridgeMaxChars: 1200,
  turnBridgeInjectPolicy: 'same_topic_only',
  sessionStateEnabled: true,
  sessionStateMaxChars: 1800,
  recallTimeoutMs: 30000,
  rememberTimeoutMs: 60000,
  rememberStrategy: 'queued',
  rememberQueuePath: '',
  rememberDrainTimeoutMs: 60000,
  rememberDrainBatchSize: 20,
  rememberMaxAttempts: 3,
  auditLog: true,
  auditLogPath: '',
};
const seenTurns = new Map();
const lastRecallAnchors = new Map();
const lastRecallForSession = new Map();

function pluginConfig(api, event, ctx) {
  return Object.assign(
    {},
    DEFAULTS,
    api && (api.pluginConfig || api.config || {}),
    ctx && (ctx.config || ctx.pluginConfig || {}),
    event && event.context && event.context.pluginConfig || {}
  );
}

function asMessages(event) {
  return event && (
    event.messages ||
    (event.context && event.context.messages) ||
    (event.prompt && event.prompt.messages) ||
    (event.request && event.request.messages)
  ) || [];
}

function roleOf(message) {
  return String(message && (message.role || message.type || '')).toLowerCase();
}

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) return textOf(value.content);
  }
  return '';
}

function messageText(message) {
  return textOf(message && (message.content || message.text || message.message));
}

function latestByRole(messages, role) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (roleOf(messages[index]) === role) return messageText(messages[index]);
  }
  return '';
}

function stripCogmemRecallBlocks(text) {
  const input = String(text || '');
  let strippedChars = 0;
  let blockCount = 0;
  const output = input
    .replace(/<(COGMEM_RECALL_CONTEXT|COGMEM_MEMORY_ATLAS|COGMEM_TURN_BRIDGE|COGMEM_SESSION_STATE|COGMEM_STRATEGY_CONTEXT)\b[\s\S]*?<\/\1>/g, (match) => {
      strippedChars += match.length;
      blockCount += 1;
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    text: output,
    stripped: blockCount > 0,
    strippedChars,
    blockCount,
  };
}

function safeSessionFileName(sessionId) {
  return String(sessionId || 'openclaw-session').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 160) || 'openclaw-session';
}

function sessionBridgePath(config, sessionId) {
  return path.join(config.cwd || process.cwd(), '.cogmem', 'session_bridges', 'openclaw', safeSessionFileName(sessionId) + '.jsonl');
}

function sessionStatePath(config, sessionId) {
  return path.join(config.cwd || process.cwd(), '.cogmem', 'session_state', 'openclaw', safeSessionFileName(sessionId) + '.json');
}

function readJsonlTail(filePath, limit) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-Math.max(1, limit || 3))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function appendJsonl(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(value) + '\n');
}

function digestText(text) {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

function uniqueNonEmpty(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function firstSentence(text, limit) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const sentence = normalized.split(/(?<=[.!?。！？])\s+/)[0] || normalized;
  return sentence.length > limit ? sentence.slice(0, limit) + '...' : sentence;
}

function createMemoryUsageReceipt(input) {
  const recallItems = Array.isArray(input.recallItems) ? input.recallItems : [];
  const createdAt = Date.now();
  const usedMemoryIds = uniqueNonEmpty(recallItems.map((item) => item && item.id)).slice(0, 8);
  const sourceAnchors = recallItems.slice(0, 8).map((item) => {
    const anchor = item && item.sourceAnchor || {};
    return {
      memoryId: item && item.id,
      eventId: anchor.eventId,
      sessionId: anchor.sessionId,
      role: anchor.role,
    };
  }).filter((anchor) => anchor.memoryId || anchor.eventId || anchor.sessionId || anchor.role);
  const usedThemes = uniqueNonEmpty(recallItems.flatMap((item) => {
    if (!item) return [];
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag) => /^topic:|^collection:/.test(tag)) : [];
    return [...tags, firstSentence(item.text, 140)];
  })).slice(0, 5);
  return {
    sessionId: input.sessionId,
    turnId: input.turnId || input.sessionId + ':' + createdAt,
    createdAt,
    userQueryDigest: digestText(input.userText),
    assistantAnswerDigest: digestText(input.assistantText),
    usedMemoryIds,
    sourceAnchors,
    usedThemes,
    workingConclusion: firstSentence(input.assistantText, 220),
    ttlTurns: Math.max(1, Math.min(10, Number(input.ttlTurns || 3))),
    compileAllowed: false,
  };
}

function formatSourceAnchor(anchor) {
  return [
    anchor.memoryId ? 'memory:' + serializeUntrustedMemory(anchor.memoryId, 160) : '',
    anchor.eventId ? 'event:' + serializeUntrustedMemory(anchor.eventId, 160) : '',
    anchor.sessionId ? 'session:' + serializeUntrustedMemory(anchor.sessionId, 160) : '',
    anchor.role ? 'role:' + serializeUntrustedMemory(anchor.role, 80) : '',
  ].filter(Boolean).join('; ');
}

function listLines(values) {
  return values.length ? values.map((value) => '- ' + serializeUntrustedMemory(value, 260)) : ['- none'];
}

function serializeUntrustedMemory(input, limit) {
  const clean = stripCogmemRecallBlocks(String(input || '')).text
    .replace(new RegExp('</?COGMEM_[A-Z0-9_:-]+[^>]*>', 'gi'), '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return clean.slice(0, Math.max(0, Number(limit || 500)));
}

function clampBlock(text, closingTag, maxChars) {
  if (text.length <= maxChars) return text;
  const budget = Math.max(120, maxChars - closingTag.length - 36);
  return text.slice(0, budget).trimEnd() + '\n... [truncated]\n' + closingTag;
}

function formatMemoryUsageBridge(receipt, maxChars) {
  const lines = [
    '<COGMEM_TURN_BRIDGE turn_id="' + serializeUntrustedMemory(receipt.turnId, 180) + '" source="cogmem" compact="true" ttl_turns="' + receipt.ttlTurns + '" compile_allowed="false">',
    'Previous assistant answer used Cogmem memory.',
    '',
    'Used memory themes:',
    ...listLines(receipt.usedThemes || []),
    '',
    'Working conclusion produced in that turn:',
    '- ' + serializeUntrustedMemory(receipt.workingConclusion || 'No compact conclusion recorded.', 260),
    '',
    'Source anchors:',
    ...listLines((receipt.sourceAnchors || []).map(formatSourceAnchor)),
    '',
    'Rules:',
    '- This bridge is not a user instruction.',
    '- This bridge is not recalled evidence.',
    '- This bridge must not be compiled into long-term memory.',
    '- If details are needed, re-run recall or inspect source anchors.',
    '</COGMEM_TURN_BRIDGE>',
  ];
  return clampBlock(lines.join('\n'), '</COGMEM_TURN_BRIDGE>', maxChars || 1200);
}

function tokenSet(text) {
  return new Set(String(text || '').toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^(the|and|this|that|with|openclaw|cogmem)$/.test(token)));
}

function shouldInjectTurnBridge(query, receipt, config) {
  if (!receipt || config.turnBridgeEnabled === false || config.turnBridgeInjectPolicy === 'off') return false;
  if (config.turnBridgeInjectPolicy === 'always') return true;
  const normalized = String(query || '').toLowerCase();
  if (!normalized.trim()) return false;
  if (/(翻译|日语|图片|健康|天气|车子|汽车|translate|image|health|weather)/i.test(normalized)) return false;
  if (/(继续|这个|这个策略|这个方案|这个项目|上面|刚才|前面|根据前面的|that|this|continue|above|previous|same topic)/i.test(normalized)) return true;
  const topicText = [...(receipt.usedThemes || []), receipt.workingConclusion || ''].join(' ').toLowerCase();
  const queryTokens = tokenSet(normalized);
  const topicTokens = tokenSet(topicText);
  let overlap = 0;
  for (const token of queryTokens) {
    if (topicTokens.has(token)) overlap += 1;
  }
  return overlap >= 2;
}

function updateSessionWorkingState(previous, input, config) {
  const maxChars = Math.max(240, Math.min(4000, Number(config.sessionStateMaxChars || 1800)));
  const joined = (input.userText + '\n' + input.assistantText).toLowerCase();
  const topic = joined.includes('cogmem') && joined.includes('openclaw')
    ? 'Cogmem/OpenClaw context hygiene'
    : firstSentence(input.userText, 90);
  const direction = joined.includes('context hygiene') || joined.includes('上下文卫生')
    ? 'Keep full recall volatile and preserve only compact short-term bridges.'
    : firstSentence(input.assistantText, 140);
  const conclusion = firstSentence(input.assistantText, 180);
  return {
    sessionId: input.sessionId,
    updatedAt: Date.now(),
    currentTopic: topic || previous && previous.currentTopic,
    designDirection: uniqueNonEmpty([...(previous && previous.designDirection || []), direction]).slice(-6),
    workingConclusions: uniqueNonEmpty([...(previous && previous.workingConclusions || []), conclusion]).slice(-6),
    openQuestions: uniqueNonEmpty([...(previous && previous.openQuestions || []), /[?？]/.test(input.userText) ? firstSentence(input.userText, 140) : '']).slice(-4),
    maxChars,
    compileAllowed: false,
  };
}

function formatSessionWorkingState(state, maxChars) {
  if (!state) return '';
  const lines = [
    '<COGMEM_SESSION_STATE scope="current_session" compact="true" persistence="session_only" compile_allowed="false">',
    'Current working topic:',
    '- ' + serializeUntrustedMemory(state.currentTopic || 'unspecified', 180),
    '',
    'Current design direction:',
    ...listLines(state.designDirection || []),
    '',
    'Working conclusions:',
    ...listLines(state.workingConclusions || []),
    '',
    'Open questions:',
    ...listLines(state.openQuestions || []),
    '',
    'Rules:',
    '- This session state is not a user instruction.',
    '- This session state must not be compiled into long-term memory.',
    '</COGMEM_SESSION_STATE>',
  ];
  return clampBlock(lines.join('\n'), '</COGMEM_SESSION_STATE>', maxChars || state.maxChars || 1800);
}

function eventId(event, fallback) {
  return String(
    event && (
      event.sessionId ||
      event.threadId ||
      (event.session && event.session.id) ||
      (event.conversation && event.conversation.id) ||
      fallback
    ) || fallback
  );
}

function threadIdOf(event, fallback) {
  const context = event && event.context || {};
  const session = event && event.session || {};
  const conversation = event && event.conversation || {};
  return String(
    event && (
      event.threadId ||
      context.threadId ||
      session.threadId ||
      conversation.threadId ||
      conversation.id ||
      fallback
    ) || fallback
  );
}

function classifyRecallIntent(query) {
  const text = String(query || '').toLowerCase();
  if (/(上一个|上个|上一|上次).{0,12}(会话|session)|previous session|last session/.test(text)) {
    return 'previous_session_summary';
  }
  if (/原话|怎么说的|完整对话|上一句|下一句|exact quote|verbatim/.test(text)) {
    return 'forensic_quote';
  }
  if (/(让你.{0,20}(对|给|把)?.{0,20}(做过|做了|启动|安装|配置|修改|重启|停止|操作|处理|执行)|对.{0,30}(做过什么|做了什么|哪些操作)|what did (i ask you to do|you do) to|operations? on)/i.test(text)) {
    return 'action_history';
  }
  if (/记得.{0,12}(聊过|讨论过|说过)|还记得|之前.{0,12}(聊过|讨论过|说过)|以前.{0,12}(聊过|讨论过|说过)|(过去|几个月前|半年前|上个月|前几天|昨天|上次|上个).{0,20}(聊过|讨论过|说过)|当时.{0,12}(聊|说|问)|那次.{0,12}(聊|说|问)|有没有.{0,12}(记录|聊过|讨论过)|have we discussed|did we talk about|previously discussed/.test(text)) {
    return 'historical_discussion';
  }
  return 'memory_recall';
}

function classifyContextIntent(query) {
  const text = String(query || '').trim().toLowerCase();
  if (/^(hi|hello|hey|你好|您好|早上好|晚上好|嗨)[!！。. ]*$/.test(text)) return 'greeting';
  if (/^(继续|接着|然后呢|上面那个|刚才说的|这个呢|continue|go on|and then)[?？!！。. ]*$/.test(text)) return 'short_followup';
  if (/原话|逐字|怎么说的|完整对话|exact quote|verbatim|word for word/.test(text)) return 'exact_quote';
  return 'memory_query';
}

function classifyMemoryNavigationIntent(query) {
  const text = String(query || '').trim().toLowerCase();
  if (/(我记得什么|有哪些记忆|记忆里有什么|之前聊过什么|项目.{0,8}状态|历史|去年|前年|做过什么|关联|关系|路径|what do (i|you) remember|memory inventory|project state|history|last year|related)/i.test(text)) return 'atlas_explore';
  return 'direct_fact';
}

function bridgeRequest(socketPath, request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    let socketRef = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (socketRef) socketRef.end(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    // OpenClaw runs on Node, where net.createConnection is the only option. Bun
    // is used by the tests and by the bridge itself; there, net emits socket
    // errors in a way the test runner reports as uncaught, and Bun.connect
    // rejects cleanly instead.
    if (typeof Bun !== 'undefined' && typeof Bun.connect === 'function') {
      Promise.resolve(Bun.connect({
        unix: socketPath,
        socket: {
          open(socket) {
            socketRef = socket;
            socket.write(JSON.stringify(request) + '\n');
          },
          data(socket, chunk) {
            buffer += chunk.toString();
            const index = buffer.indexOf('\n');
            if (index >= 0) {
              try { finish(JSON.parse(buffer.slice(0, index))); } catch { finish(null); }
            }
          },
          close() { finish(null); },
          error() { finish(null); },
        },
      })).catch(() => finish(null));
      return;
    }

    const socket = net.createConnection(socketPath);
    socketRef = socket;
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const index = buffer.indexOf('\n');
      if (index >= 0) {
        try { finish(JSON.parse(buffer.slice(0, index))); } catch { finish(null); }
      }
    });
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
  });
}

async function bridgeDaemonHealth(config) {
  if (!config.bridgeSocket) return null;
  const response = await bridgeRequest(config.bridgeSocket, { command: 'health' }, 500).catch(() => null);
  return response && response.ok ? response.result : null;
}

let daemonStart = null;

async function ensureBridgeDaemon(config) {
  if (config.bridgeDaemon === false || !config.bridgeSocket) return false;
  const health = await bridgeDaemonHealth(config);
  if (health && health.version === PLUGIN_VERSION) return true;
  if (daemonStart) return await daemonStart;
  daemonStart = (async () => {
    if (health && health.pid) {
      // A daemon left over from an older build keeps the old kernel and the old
      // payload shape. Replace it rather than serving stale behaviour.
      try { process.kill(health.pid); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    try {
      mkdirSync(path.dirname(config.bridgeSocket), { recursive: true });
      const child = spawn(config.bunPath || 'bun', [path.join(__dirname, 'bridge.mjs'), 'serve', config.bridgeSocket, config.configPath, config.publicEntrypoint || ''], {
        cwd: config.cwd || process.cwd(),
        detached: true,
        stdio: 'ignore',
        env: Object.assign({}, process.env, { COGMEM_BRIDGE_VERSION: PLUGIN_VERSION }),
      });
      child.unref();
    } catch {
      return false;
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const ready = await bridgeDaemonHealth(config);
      if (ready) return ready.version === PLUGIN_VERSION;
    }
    return false;
  })();
  try {
    return await daemonStart;
  } finally {
    daemonStart = null;
  }
}

async function runBridge(command, payload, config, timeoutMs) {
  if (config.bridgeDaemon !== false && config.bridgeSocket) {
    const ready = await ensureBridgeDaemon(config);
    if (ready) {
      const response = await bridgeRequest(
        config.bridgeSocket,
        { command, payload },
        Number(config.bridgeTimeoutMs || timeoutMs || 5000),
      );
      if (response && response.ok) return response.result;
      // An error reply means the daemon saw the request. Retrying in a fresh
      // process could double-write a turn, so surface it instead.
      if (response && response.ok === false) throw new Error(response.error || 'cogmem bridge daemon error');
    }
  }
  const bridgePath = path.join(__dirname, 'bridge.mjs');
  const child = spawnSync(config.bunPath || 'bun', [bridgePath, command], {
    cwd: config.cwd || process.cwd(),
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  if (child.error) {
    throw child.error;
  }
  if (child.status !== 0) {
    throw new Error((child.stderr || child.stdout || 'cogmem bridge failed').trim());
  }
  return child.stdout ? JSON.parse(child.stdout) : {};
}

function bridgeErrorInfo(error) {
  const message = error && error.message || String(error || '');
  return {
    reason: message,
    errorClass: error && error.name || 'Error',
    dbLocked: /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message),
  };
}

function injectionResult(context, warning) {
  const result = context ? { prependContext: context, context, promptPrefix: context } : {};
  if (warning) result.warning = warning;
  return result;
}

function bridgeConfig(config) {
  return {
    configPath: config.configPath,
    cwd: config.cwd,
    bunPath: config.bunPath,
    agentId: config.agentId,
    projectId: config.projectId,
    ingestMode: config.ingestMode,
    stripRecallBlocksBeforeRemember: config.stripRecallBlocksBeforeRemember !== false,
    memoryContextMaxChars: config.memoryContextMaxChars || 3500,
    memoryContextMaxItems: config.memoryContextMaxItems || 3,
    sourceWindowMaxChars: config.sourceWindowMaxChars || 1200,
    includeSourceWindowByDefault: config.includeSourceWindowByDefault === true,
    contextCortexEnabled: config.contextCortexEnabled !== false,
    strategyCortexEnabled: config.strategyCortexEnabled !== false,
    contextAvailableTokens: config.contextAvailableTokens || 16000,
    contextMemoryMaxRatio: config.contextMemoryMaxRatio || 0.25,
    atlasLimit: config.atlasLimit || 8,
    atlasMaxChars: config.atlasMaxChars || 3000,
    rememberQueuePath: rememberQueuePath(config),
    rememberMaxAttempts: config.rememberMaxAttempts || 3,
    rememberDrainBatchSize: config.rememberDrainBatchSize || 20,
    rememberDrainTimeoutMs: config.rememberDrainTimeoutMs || 60000,
  };
}

function rememberQueuePath(config) {
  return config.rememberQueuePath || path.join(config.cwd || process.cwd(), '.cogmem', 'queue', 'openclaw-remember.jsonl');
}

function rememberQueueLockPath(config) {
  return rememberQueuePath(config) + '.lock';
}

function queueLockIsFresh(config) {
  const lockPath = rememberQueueLockPath(config);
  if (!existsSync(lockPath)) return false;
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    return ageMs >= 0 && ageMs < Number(config.rememberDrainTimeoutMs || 60000);
  } catch {
    return true;
  }
}

function rememberQueueSpawnLockPath(config) {
  return rememberQueuePath(config) + '.spawn.lock';
}

function acquireRememberQueueSpawnLock(config) {
  const lockPath = rememberQueueSpawnLockPath(config);
  const timeoutMs = Number(config.rememberDrainTimeoutMs || 60000);
  try {
    mkdirSync(lockPath, { recursive: false });
    writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      purpose: 'spawn-remember-drainer',
    }) + '\n');
    return { acquired: true, lockPath };
  } catch {
    try {
      const ageMs = Date.now() - statSync(lockPath).mtimeMs;
      if (Number.isFinite(ageMs) && ageMs > timeoutMs) {
        rmSync(lockPath, { recursive: true, force: true });
        mkdirSync(lockPath, { recursive: false });
        writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          staleLockRecovered: true,
          purpose: 'spawn-remember-drainer',
        }) + '\n');
        return { acquired: true, lockPath };
      }
    } catch {}
    return { acquired: false, lockPath };
  }
}

function stableJobId(payload) {
  return createHash('sha256')
    .update(JSON.stringify({
      sessionId: payload.sessionId,
      userText: payload.userText,
      assistantText: payload.assistantText,
      toolCalls: payload.toolCalls,
      toolResults: payload.toolResults,
      taskEvents: payload.taskEvents,
    }))
    .digest('hex')
    .slice(0, 32);
}

function enqueueRememberJob(config, payload) {
  const queuePath = rememberQueuePath(config);
  mkdirSync(path.dirname(queuePath), { recursive: true });
  const job = {
    jobId: stableJobId(payload),
    createdAt: new Date().toISOString(),
    attempts: 0,
    payload,
  };
  appendFileSync(queuePath, JSON.stringify(job) + '\n');
  return { jobId: job.jobId, queuePath };
}

function spawnBridgeDrain(config) {
  if (queueLockIsFresh(config)) {
    audit(config, {
      hook: 'agent_end',
      action: 'skip_spawn_drain',
      reason: 'remember_queue_locked',
      queuePath: rememberQueuePath(config),
    });
    return;
  }
  const spawnLock = acquireRememberQueueSpawnLock(config);
  if (!spawnLock.acquired) {
    audit(config, {
      hook: 'agent_end',
      action: 'skip_spawn_drain',
      reason: 'remember_queue_spawn_locked',
      queuePath: rememberQueuePath(config),
    });
    return;
  }
  const bridgePath = path.join(__dirname, 'bridge.mjs');
  let child;
  try {
    child = spawn(config.bunPath || 'bun', [bridgePath, 'drain-remember-queue'], {
      cwd: config.cwd || process.cwd(),
      detached: false,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
  } catch (error) {
    rmSync(spawnLock.lockPath, { recursive: true, force: true });
    audit(config, {
      hook: 'agent_end',
      action: 'error',
      reason: error && error.message || String(error || 'failed to spawn remember drainer'),
      bridgeCommand: 'drain-remember-queue',
      queuePath: rememberQueuePath(config),
    });
    return;
  }
  child.once('exit', () => rmSync(spawnLock.lockPath, { recursive: true, force: true }));
  child.once('error', () => rmSync(spawnLock.lockPath, { recursive: true, force: true }));
  child.stdin.end(JSON.stringify({ config: bridgeConfig(config) }));
  child.unref();
}

function arrayFrom(...values) {
  const out = [];
  for (const value of values) {
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

function normalizeToolCall(value, index) {
  if (!value || typeof value !== 'object') return null;
  const fn = value.function && typeof value.function === 'object' ? value.function : {};
  const toolName = value.toolName || value.name || value.tool || fn.name;
  if (!toolName) return null;
  return {
    toolCallId: String(value.toolCallId || value.callId || value.id || ''),
    toolName: String(toolName),
    input: value.input !== undefined ? value.input : (value.args !== undefined ? value.args : (value.arguments !== undefined ? value.arguments : fn.arguments)),
    eventOrdinal: Number.isFinite(value.eventOrdinal) ? value.eventOrdinal : 3 + index * 2,
    timestamp: Number.isFinite(value.timestamp) ? value.timestamp : undefined,
    metadata: { sourceShape: 'openclaw_tool_call' },
  };
}

function normalizeToolResult(value, index) {
  if (!value || typeof value !== 'object') return null;
  const toolName = value.toolName || value.name || value.tool;
  const output = value.output !== undefined ? value.output : (value.result !== undefined ? value.result : value.content);
  if (!toolName || output === undefined) return null;
  return {
    toolCallId: String(value.toolCallId || value.callId || value.id || ''),
    toolName: String(toolName),
    output: typeof output === 'string' ? output : JSON.stringify(output),
    eventOrdinal: Number.isFinite(value.eventOrdinal) ? value.eventOrdinal : 4 + index * 2,
    timestamp: Number.isFinite(value.timestamp) ? value.timestamp : undefined,
    metadata: { sourceShape: 'openclaw_tool_result' },
  };
}

function normalizeTaskEvent(value, index) {
  if (!value || typeof value !== 'object') return null;
  const content = value.content || value.text || value.message || value.summary;
  if (!content) return null;
  return {
    taskId: value.taskId || value.id,
    title: value.title || value.type || 'OpenClaw task event',
    content: typeof content === 'string' ? content : JSON.stringify(content),
    eventOrdinal: Number.isFinite(value.eventOrdinal) ? value.eventOrdinal : 100 + index,
    timestamp: Number.isFinite(value.timestamp) ? value.timestamp : undefined,
    metadata: { sourceShape: 'openclaw_task_event' },
  };
}

function extractLifecyclePayload(event) {
  const context = event && event.context || {};
  const trace = event && event.trace || {};
  return {
    toolCalls: arrayFrom(event && event.toolCalls, event && event.tool_calls, context.toolCalls, context.tool_calls, trace.toolCalls, trace.tool_calls)
      .map(normalizeToolCall)
      .filter(Boolean)
      .slice(0, 32),
    toolResults: arrayFrom(event && event.toolResults, event && event.tool_results, context.toolResults, context.tool_results, trace.toolResults, trace.tool_results)
      .map(normalizeToolResult)
      .filter(Boolean)
      .slice(0, 32),
    taskEvents: arrayFrom(event && event.taskEvents, event && event.task_events, context.taskEvents, context.task_events, trace.taskEvents, trace.task_events)
      .map(normalizeTaskEvent)
      .filter(Boolean)
      .slice(0, 32),
  };
}

function contextOutcomePayload(recall, config) {
  if (!recall || !recall.strategyCapsule || !recall.activationReceipt) return undefined;
  const items = Array.isArray(recall.items) ? recall.items : [];
  return {
    receiptId: recall.activationReceipt.receiptId,
    capsule: recall.strategyCapsule,
    selected: items.map((item) => {
      const sourceType = String(item && item.sourceType || 'compiled_memory');
      const sourceRole = item && item.sourceAnchor && item.sourceAnchor.role;
      const tags = Array.isArray(item && item.tags) ? item.tags : [];
      return {
        id: String(item && item.id || 'recall-item'),
        layer: item && item.whyMatched === 'memory_binding_graph' ? 'graph'
          : sourceType.startsWith('raw_ledger') ? 'raw_source' : 'belief',
        hasSourceEvidence: Boolean(item && item.sourceAnchor && item.sourceAnchor.eventId),
        superseded: tags.includes('status:superseded'),
        crossProject: Boolean(item && item.projectId && item.projectId !== (config.projectId || 'openclaw')),
        ownership: tags.includes('ownership:user') ? 'user' : undefined,
        sourceRoles: sourceRole ? [sourceRole] : [],
        containsStrategyContext: String(item && item.text || '').includes('<COGMEM_STRATEGY_CONTEXT'),
      };
    }),
    usedTokens: Number(recall.activationReceipt.usedTokens || 0),
    budgetTokens: Number(recall.activationReceipt.budgetTokens || 0),
    latencyMs: Number(recall.recallLatencyMs || 0),
  };
}

function logWarn(api, message) {
  if (api && api.logger && typeof api.logger.warn === 'function') {
    api.logger.warn(message);
    return;
  }
  console.warn(message);
}

function audit(config, record) {
  if (config.auditLog === false) return;
  try {
    const logPath = config.auditLogPath || path.join(config.cwd || process.cwd(), '.cogmem', 'logs', 'openclaw-auto-memory.jsonl');
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(),
      pluginId: '${PLUGIN_ID}',
      ...record,
    }) + '\n');
  } catch {
    // Audit logging must never block the host agent.
  }
}

const plugin = {
  id: PLUGIN_ID,
  name: 'CogMem Auto Memory',
  version: '${PLUGIN_VERSION}',
  register(api) {
    if (!api || typeof api.on !== 'function') {
      throw new Error('OpenClaw plugin API missing api.on');
    }

    // Start the kernel while the host is idle instead of paying for it inside
    // the first prompt of the session.
    try {
      const warmConfig = pluginConfig(api, null, null);
      if (warmConfig.bridgeDaemon !== false && warmConfig.bridgeSocket) {
        ensureBridgeDaemon(warmConfig).catch(() => {});
      }
    } catch {}

    api.on('before_prompt_build', async (event, ctx) => {
      const config = pluginConfig(api, event, ctx);
      if (config.autoRecall === false) return {};
      const sessionId = eventId(event, 'openclaw-session');
      const threadId = threadIdOf(event, sessionId);
      const messages = asMessages(event);
      const rawQuery = latestByRole(messages, 'user');
      const cleanQuery = stripCogmemRecallBlocks(rawQuery);
      const query = cleanQuery.text.slice(0, config.maxQueryChars || 1200);
      if (!query.trim()) {
        lastRecallForSession.delete(sessionId);
        audit(config, { hook: 'before_prompt_build', sessionId, action: 'skip', reason: 'empty_user_query' });
        return {};
      }
      const contextIntent = classifyContextIntent(query);
      if (config.contextCortexEnabled !== false && contextIntent === 'greeting') {
        lastRecallForSession.delete(sessionId);
        audit(config, { hook: 'before_prompt_build', sessionId, action: 'skip', reason: 'context_cortex:greeting' });
        return {};
      }
      try {
        lastRecallForSession.delete(sessionId);
        const intent = classifyRecallIntent(query);
        const anchor = intent === 'forensic_quote' ? lastRecallAnchors.get(sessionId) : undefined;
        const memoryLayers = [];
        let sessionStateInjected = false;
        let turnBridgeCount = 0;
        if (config.sessionStateEnabled !== false) {
          const state = readJson(sessionStatePath(config, sessionId));
          const rendered = formatSessionWorkingState(state, config.sessionStateMaxChars || 1800);
          if (rendered) {
            memoryLayers.push(rendered);
            sessionStateInjected = true;
          }
        }
        if (config.turnBridgeEnabled !== false) {
          const bridges = readJsonlTail(sessionBridgePath(config, sessionId), config.turnBridgeMaxTurns || 3)
            .filter((receipt) => shouldInjectTurnBridge(query, receipt, config))
            .map((receipt) => formatMemoryUsageBridge(receipt, config.turnBridgeMaxChars || 1200))
            .filter(Boolean);
          memoryLayers.push(...bridges);
          turnBridgeCount = bridges.length;
        }
        const navigationIntent = classifyMemoryNavigationIntent(query);
        let atlasInjected = false;
        const recalled = config.contextCortexEnabled !== false && contextIntent === 'short_followup'
          ? { context: '', items: [], itemCount: 0, intent, recallMode: 'context_cortex_short_followup', fallbackUsed: false }
          : await runBridge(navigationIntent === 'atlas_explore' && config.autoAtlas !== false ? 'context' : 'recall', {
            query,
            sessionId,
            threadId,
            intent,
            excludeSessionId: config.excludeCurrentSessionCompiledMemory === false ? undefined : sessionId,
            anchorEventId: anchor && anchor.eventId,
            anchorText: anchor && anchor.text,
            config,
          }, config, config.recallTimeoutMs || 30000);
        if (recalled.atlasContext) {
          memoryLayers.push(recalled.atlasContext);
          atlasInjected = true;
        }
        lastRecallForSession.set(sessionId, {
          items: Array.isArray(recalled.items) ? recalled.items : [],
          context: recalled.context || '',
          activationReceipt: recalled.activationReceipt,
          strategyCapsule: recalled.strategyCapsule,
          recallLatencyMs: recalled.recallLatencyMs,
        });
        if (recalled.anchorEventId) {
          lastRecallAnchors.set(sessionId, {
            eventId: recalled.anchorEventId,
            text: recalled.anchorText || '',
          });
        }
        if (recalled.context) memoryLayers.push(recalled.context);
        const context = memoryLayers.filter(Boolean).join('\n\n');
        audit(config, {
          hook: 'before_prompt_build',
          sessionId,
          intent: recalled.intent,
          action: context ? 'inject' : 'skip',
          reason: context ? undefined : 'empty_recall_context',
          itemCount: recalled.itemCount || 0,
          contextChars: context.length,
          recallMode: recalled.recallMode,
          fallbackUsed: recalled.fallbackUsed === true,
          decisionTrace: recalled.decisionTrace,
          contextIntent,
          activationReceipt: recalled.activationReceipt,
          strategyCapsule: recalled.strategyCapsule,
          strategyReplanned: recalled.strategyReplanned === true,
          strategyReplanReason: recalled.strategyReplanReason,
          anchorEventId: recalled.anchorEventId,
          hygiene: {
            strippedRecallBlocks: cleanQuery.stripped,
            strippedBlockCount: cleanQuery.blockCount,
            strippedChars: cleanQuery.strippedChars,
          },
          bridgeCommand: navigationIntent === 'atlas_explore' && config.autoAtlas !== false ? 'context' : 'recall',
          returnedInjectionShape: context ? 'prependContext+context+promptPrefix' : 'empty',
          turnBridgeCount,
          sessionStateInjected,
          navigationIntent,
          atlasInjected,
        });
        return injectionResult(context);
      } catch (error) {
        lastRecallForSession.delete(sessionId);
        const info = bridgeErrorInfo(error);
        audit(config, {
          hook: 'before_prompt_build',
          sessionId,
          action: 'error',
          reason: info.reason,
          errorClass: info.errorClass,
          bridgeCommand: 'recall',
          dbLocked: info.dbLocked,
          returnedInjectionShape: 'empty',
          contextChars: 0,
          itemCount: 0,
        });
        const warning = info.dbLocked
          ? '[cogmem-auto-memory] recall skipped because Cogmem SQLite is busy; run cogmem doctor --agent openclaw --workspace <workspace> --plugin-only if this persists.'
          : '[cogmem-auto-memory] recall skipped: ' + info.reason;
        logWarn(api, warning);
        return injectionResult('', warning);
      }
    }, { priority: 10 });

    api.on('agent_end', async (event, ctx) => {
      const config = pluginConfig(api, event, ctx);
      if (config.autoRemember === false) return;
      const messages = asMessages(event);
      const rawUserText = latestByRole(messages, 'user');
      const rawAssistantText = latestByRole(messages, 'assistant');
      const cleanUser = config.stripRecallBlocksBeforeRemember === false
        ? { text: rawUserText, stripped: false, strippedChars: 0, blockCount: 0 }
        : stripCogmemRecallBlocks(rawUserText);
      const cleanAssistant = config.stripRecallBlocksBeforeRemember === false
        ? { text: rawAssistantText, stripped: false, strippedChars: 0, blockCount: 0 }
        : stripCogmemRecallBlocks(rawAssistantText);
      const userText = cleanUser.text;
      const assistantText = cleanAssistant.text;
      const sessionId = eventId(event, 'openclaw-session');
      if (!userText.trim() || !assistantText.trim()) {
        audit(config, { hook: 'agent_end', sessionId, action: 'skip', reason: 'missing_turn_text' });
        return;
      }
      const key = sessionId + ':' + userText.length + ':' + assistantText.length + ':' + assistantText.slice(0, 80);
      if (seenTurns.get(sessionId) === key) {
        audit(config, { hook: 'agent_end', sessionId, action: 'skip', reason: 'duplicate_turn' });
        return;
      }
      seenTurns.set(sessionId, key);
      try {
        const lifecycle = extractLifecyclePayload(event);
        const hygiene = {
          strippedRecallBlocks: cleanUser.stripped || cleanAssistant.stripped,
          strippedBlockCount: cleanUser.blockCount + cleanAssistant.blockCount,
          strippedChars: cleanUser.strippedChars + cleanAssistant.strippedChars,
        };
        const queued = enqueueRememberJob(config, {
          sessionId,
          userText,
          assistantText: assistantText.slice(0, config.maxAssistantChars || 6000),
          config: bridgeConfig(config),
          hygiene,
          contextOutcome: contextOutcomePayload(lastRecallForSession.get(sessionId), config),
          ...lifecycle,
        });
        spawnBridgeDrain(config);
        try {
          const recall = lastRecallForSession.get(sessionId) || {};
          const recallItems = Array.isArray(recall.items) ? recall.items : [];
          if (config.turnBridgeEnabled !== false && (recallItems.length > 0 || recall.context)) {
            appendJsonl(sessionBridgePath(config, sessionId), createMemoryUsageReceipt({
              sessionId,
              turnId: queued.jobId,
              userText,
              assistantText,
              recallItems,
              ttlTurns: config.turnBridgeMaxTurns || 3,
            }));
          }
          if (config.sessionStateEnabled !== false) {
            const previous = readJson(sessionStatePath(config, sessionId));
            const state = updateSessionWorkingState(previous, { sessionId, userText, assistantText }, config);
            writeJson(sessionStatePath(config, sessionId), state);
          }
        } catch (sidecarError) {
          audit(config, {
            hook: 'agent_end',
            sessionId,
            action: 'sidecar_error',
            reason: sidecarError && sidecarError.message || String(sidecarError),
          });
        }
        audit(config, {
          hook: 'agent_end',
          sessionId,
          action: 'enqueue_remember',
          jobId: queued.jobId,
          queuePath: queued.queuePath,
          userChars: userText.length,
          assistantChars: assistantText.length,
          toolCallCount: lifecycle.toolCalls.length,
          toolResultCount: lifecycle.toolResults.length,
          taskEventCount: lifecycle.taskEvents.length,
          ingestMode: config.ingestMode || 'selective_compile',
          hygiene,
        });
      } catch (error) {
        audit(config, {
          hook: 'agent_end',
          sessionId,
          action: 'error',
          reason: error && error.message || String(error),
        });
        logWarn(api, '[cogmem-auto-memory] remember skipped: ' + (error && error.message || String(error)));
      }
    }, { priority: 90 });
  },
};

module.exports = plugin;
module.exports.default = plugin;
module.exports.__testing = {
  stripCogmemRecallBlocks,
  serializeUntrustedMemory,
  shouldInjectTurnBridge,
  formatMemoryUsageBridge,
  formatSessionWorkingState,
  classifyMemoryNavigationIntent,
  ensureBridgeDaemon,
  bridgeDaemonHealth,
  runBridge,
};
`;
}
function pluginBridgeMjs() {
    return String.raw `#!/usr/bin/env bun
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const invokedCommand = process.argv[2];

let cachedRuntime = null;

async function acquireRuntime(config, keepAlive) {
  if (cachedRuntime && cachedRuntime.configPath === config.configPath) return cachedRuntime;
  if (cachedRuntime) {
    try { cachedRuntime.kernel.close(); } catch {}
    cachedRuntime = null;
  }
  const api = await loadCogmemApi(config);
  const kernel = api.createMemoryKernelFromConfig({ configPath: config.configPath });
  const runtime = {
    configPath: config.configPath,
    kernel,
    memory: new api.KernelAgentMemoryBackend(kernel),
    formatStrategyContext: api.formatStrategyContext,
    // The prompt-block renderers live in the kernel (src/host/RecallBlock.ts),
    // not here: they are host-neutral, every host adapter shares one copy, and a
    // copy inside this template is a copy no test can execute. See ADR-0004.
    formatRecallContext: api.formatRecallContext,
    formatAtlasContext: api.formatAtlasContext,
    compactRecallItems: api.compactRecallItems,
    contextCandidateFromRecallItem: api.contextCandidateFromRecallItem,
  };
  if (keepAlive) cachedRuntime = runtime;
  return runtime;
}

function releaseRuntime(runtime) {
  if (!runtime || runtime === cachedRuntime) return;
  try { runtime.kernel.close(); } catch {}
}

async function execute(command, input, keepAlive) {
  const config = input.config || {};
  if (!config.configPath) {
    throw new Error('missing cogmem configPath');
  }

  let drainQueueLock;
  if (command === 'drain-remember-queue') {
    drainQueueLock = acquireRememberQueueLock(config);
    if (!drainQueueLock.acquired) {
      return { drained: 0, failed: 0, locked: drainQueueLock.locked, empty: drainQueueLock.empty === true };
    }
  }

  const runtime = await acquireRuntime(config, keepAlive);
  const kernel = runtime.kernel;
  const memory = runtime.memory;
  const formatStrategyContext = runtime.formatStrategyContext;
  try {
    if (command === 'context') {
      const projectId = config.projectId || 'openclaw';
      const atlas = kernel.graphExplore(input.query || '', { projectId, limit: Number(config.atlasLimit || 8) });
      const nodeDetails = atlas.nodes.slice(0, 4).map((node) => kernel.graphNode(node.id, {
        projectId, evidenceLimit: 2, includeEvidence: false,
      })).filter(Boolean);
      const timeline = kernel.graphTimeline(input.query || '', { projectId, limit: Math.min(6, Number(config.atlasLimit || 8)) });
      const atlasResult = { ...atlas, nodeDetails, timeline };
      const recalled = await recallPayload(input, config, kernel, memory, runtime);
      return {
        ...recalled,
        atlasContext: runtime.formatAtlasContext(atlasResult, Number(config.atlasMaxChars || 3000)),
        atlasResult,
      };
    } else if (command === 'graph-explore') {
      const projectId = config.projectId || 'openclaw';
      const result = kernel.graphExplore(input.query || '', { projectId, limit: Number(config.atlasLimit || 8) });
      return { context: runtime.formatAtlasContext(result, Number(config.atlasMaxChars || 3000)), result };
    } else if (command === 'graph-node') {
      const projectId = config.projectId || 'openclaw';
      return kernel.graphNode(input.id, { projectId, includeEvidence: input.includeEvidence === true });
    } else if (command === 'graph-path') {
      const projectId = config.projectId || 'openclaw';
      return kernel.graphPath(input.from, input.to, { projectId });
    } else if (command === 'graph-timeline') {
      const projectId = config.projectId || 'openclaw';
      return kernel.graphTimeline(input.query || '', { projectId, limit: Number(config.atlasLimit || 8) });
    } else if (command === 'recall') {
      return await recallPayload(input, config, kernel, memory, runtime);
    } else if (command === 'remember') {
      const result = await rememberPayload(input, config, kernel, memory);
      return { remembered: true, ...result };
    } else if (command === 'drain-remember-queue') {
      return await drainRememberQueueWithLock(config, drainQueueLock, kernel, memory);
    }
    throw new Error('unknown cogmem bridge command: ' + command);
  } finally {
    releaseRuntime(runtime);
    if (drainQueueLock && drainQueueLock.acquired) {
      rmSync(drainQueueLock.lockPath, { recursive: true, force: true });
    }
  }
}

function acquireDaemonLock(socketPath) {
  const lockPath = socketPath + '.lock';
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    return { lockPath, acquired: true, running: false };
  } catch {
    let pid = 0;
    try { pid = Number(readFileSync(lockPath, 'utf8')); } catch {}
    if (pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return { lockPath, acquired: false, running: true, pid };
      } catch {}
    }
    try { writeFileSync(lockPath, String(process.pid)); } catch {}
    return { lockPath, acquired: true, running: false };
  }
}

function daemonResponsive(socketPath) {
  return new Promise((resolve) => {
    let settled = false;
    let socketRef = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (socketRef) socketRef.end(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 400);
    Promise.resolve(Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) { socketRef = socket; socket.write('{"command":"health"}\n'); },
        data() { finish(true); },
        close() { finish(false); },
        error() { finish(false); },
      },
    })).catch(() => finish(false));
  });
}

async function startSocketServer(socketPath) {
  mkdirSync(dirname(socketPath), { recursive: true });
  const lock = acquireDaemonLock(socketPath);
  // A pid that is merely alive is not proof of a working daemon: the process may
  // be an orphan whose socket was unlinked, or a recycled pid. Only a socket
  // that answers keeps this instance out.
  if (!lock.acquired && lock.running && await daemonResponsive(socketPath)) {
    console.error('[cogmem-bridge] already running pid ' + lock.pid);
    process.exit(0);
  }
  try { writeFileSync(lock.lockPath, String(process.pid)); } catch {}
  process.on('exit', () => {
    try { rmSync(lock.lockPath, { force: true }); } catch {}
  });
  if (existsSync(socketPath)) {
    try { rmSync(socketPath, { force: true }); } catch {}
  }
  const server = createServer((socket) => {
    let buffer = '';
    let chain = Promise.resolve();
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        chain = chain.then(async () => {
          let request;
          try {
            request = JSON.parse(line);
          } catch {
            socket.write(JSON.stringify({ ok: false, error: 'bad_json' }) + '\n');
            return;
          }
          try {
            if (request.command === 'health') {
              socket.write(JSON.stringify({
                ok: true,
                result: { version: process.env.COGMEM_BRIDGE_VERSION || null, pid: process.pid, uptimeMs: Math.round(process.uptime() * 1000) },
              }) + '\n');
              return;
            }
            const result = await execute(request.command, request.payload || {}, true);
            socket.write(JSON.stringify({ ok: true, result }) + '\n');
          } catch (error) {
            socket.write(JSON.stringify({ ok: false, error: String(error && error.message || error) }) + '\n');
          }
        });
      }
    });
  });
  server.listen(socketPath, () => {
    try { chmodSync(socketPath, 0o600); } catch {}
    console.error('[cogmem-bridge] listening ' + socketPath);
  });
  server.on('error', (error) => {
    console.error('[cogmem-bridge] ' + String(error && error.message || error));
    process.exit(1);
  });
  return server;
}

function callBridgeSocket(socketPath, request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    let socketRef = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (socketRef) socketRef.end(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    Promise.resolve(Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          socketRef = socket;
          socket.write(JSON.stringify(request) + '\n');
        },
        data(socket, chunk) {
          buffer += chunk.toString();
          const index = buffer.indexOf('\n');
          if (index >= 0) {
            try { finish(JSON.parse(buffer.slice(0, index))); } catch { finish(null); }
          }
        },
        close() { finish(null); },
        error() { finish(null); },
      },
    })).catch(() => finish(null));
  });
}

async function main() {
  if (invokedCommand === 'serve') {
    const socketPath = process.argv[3];
    if (!socketPath) throw new Error('missing bridge socket path');
    await startSocketServer(socketPath);
    // Build the kernel while the host is idle so the first prompt is not the one
    // that pays for it.
    const warmConfigPath = process.argv[4];
    if (warmConfigPath) {
      // The entrypoint must travel with the warm-up: without it the bridge
      // resolves the installed package instead of the build the host configured,
      // and every later request reuses that stale module from the cache.
      const warmEntrypoint = process.argv[5];
      acquireRuntime({ configPath: warmConfigPath, publicEntrypoint: warmEntrypoint }, true).catch(() => {});
    }
    return;
  }
  const input = JSON.parse(readFileSync(0, 'utf8') || process.env.COGMEM_BRIDGE_STDIN || '{}');
  const config = input.config || {};
  if (config.bridgeSocket) {
    const response = await callBridgeSocket(
      config.bridgeSocket,
      { command: invokedCommand, payload: input },
      Number(config.bridgeTimeoutMs || 5000),
    );
    if (response && response.ok) {
      console.log(JSON.stringify(response.result));
      return;
    }
    if (response && response.ok === false) {
      throw new Error(response.error || 'cogmem bridge daemon error');
    }
  }
  console.log(JSON.stringify(await execute(invokedCommand, input, false)));
}

await main();

async function recallPayload(input, config, kernel, memory, render) {
  const formatStrategyContext = render.formatStrategyContext;
  const formatRecallContext = render.formatRecallContext;
  const compactRecallItems = render.compactRecallItems;
  const contextCandidateFromRecallItem = render.contextCandidateFromRecallItem;
  const recallStartedAt = Date.now();
  const contextIntent = kernel.contextCortex.classifyIntent(input.query || '');
  let strategyCapsule = config.strategyCortexEnabled === false ? undefined : kernel.strategyCortex.plan({
    query: input.query || '', intent: contextIntent, projectId: config.projectId || 'openclaw',
  });
  let result = await memory.recall({
    agentId: config.agentId || 'openclaw', projectId: config.projectId || 'openclaw',
    query: input.query || '', sessionId: input.sessionId, threadId: input.threadId,
    excludeSessionId: input.excludeSessionId, intent: input.intent || undefined,
    anchorEventId: input.anchorEventId, anchorText: input.anchorText,
    limit: Number(config.limit || 3), retrievalPolicy: strategyCapsule && strategyCapsule.retrievalPolicy,
  });
  const sourceRequirementSatisfied = result.items.some((item) => item && item.sourceType && String(item.sourceType).startsWith('raw_ledger'));
  const replan = strategyCapsule ? kernel.strategyCortex.replan(strategyCapsule, {
    intent: contextIntent, projectId: config.projectId || 'openclaw', sourceRequirementSatisfied,
  }) : { replanned: false, capsule: undefined };
  if (replan.replanned) {
    strategyCapsule = replan.capsule;
    result = await memory.recall({
      agentId: config.agentId || 'openclaw', projectId: config.projectId || 'openclaw',
      query: input.query || '', sessionId: input.sessionId, threadId: input.threadId,
      excludeSessionId: input.excludeSessionId, intent: input.intent || undefined,
      anchorEventId: input.anchorEventId, anchorText: input.anchorText,
      limit: Number(config.limit || 3), retrievalPolicy: strategyCapsule && strategyCapsule.retrievalPolicy,
    });
  }
  const activationPlan = config.contextCortexEnabled === false ? undefined : kernel.contextCortex.plan({
    query: input.query || '', projectId: config.projectId || 'openclaw', currentSessionId: input.sessionId,
    availableTokens: Number(config.contextAvailableTokens || 16000),
    maxMemoryRatio: Number(config.contextMemoryMaxRatio || 0.25), strategy: strategyCapsule,
    candidates: result.items.map(contextCandidateFromRecallItem),
  });
  let plannedResult = activationPlan
    ? { ...result, items: activationPlan.selected.map((candidate) => candidate.recallItem) }
    : result;
  let activationReceipt = activationPlan && activationPlan.receipt;
  if (activationPlan && Array.isArray(result.items)) {
    const selectedIds = new Set(plannedResult.items.map((item) => item && item.id).filter(Boolean));
    const strictFacetItem = (result.decisionTrace && result.decisionTrace.selectedLane === 'facet_graph_raw_ledger')
      ? result.items.find((item) => item && item.canonicalId && Array.isArray(item.matchedFacets) && item.matchedFacets.length > 0)
      : undefined;
    if (strictFacetItem && !selectedIds.has(strictFacetItem.id)) {
      plannedResult = { ...plannedResult, items: [strictFacetItem, ...plannedResult.items].slice(0, Number(config.limit || 3)) };
      activationReceipt = {
        ...(activationReceipt || {}),
        facetGraphRetained: true,
        retainedCanonicalId: strictFacetItem.canonicalId,
        matchedFacets: strictFacetItem.matchedFacets,
        reason: 'strict_facet_match_must_not_be_silently_dropped',
      };
    }
  }
  const anchorItem = plannedResult.items.find((item) => item && item.sourceAnchor && item.sourceAnchor.eventId);
  const selectedCanonicalIds = new Set(plannedResult.items.map((item) => item && item.canonicalId).filter(Boolean));
  const selectedEpisodeCards = Array.isArray(result.atlasCards)
    ? result.atlasCards.filter((card) => card && selectedCanonicalIds.has(card.canonicalId))
    : [];
  plannedResult = { ...plannedResult, atlasCards: selectedEpisodeCards };
  const recallContext = formatRecallContext(plannedResult, config);
  return {
    context: recallContext ? (strategyCapsule ? formatStrategyContext(strategyCapsule) + '\n\n' : '') + recallContext : '',
    items: compactRecallItems(plannedResult.items, config), itemCount: plannedResult.items.length,
    recallMode: result.recallMode, fallbackUsed: result.fallbackUsed, intent: (result.queryPlan && result.queryPlan.intent) || input.intent || 'memory_recall',
    anchorEventId: anchorItem && anchorItem.sourceAnchor && anchorItem.sourceAnchor.eventId,
    anchorText: anchorItem && anchorItem.text, queryPlan: result.queryPlan, decisionTrace: result.decisionTrace,
    atlasCards: result.atlasCards, selectedEpisodeCards,
    relatedButNotSelected: result.relatedButNotSelected, relaxationTrace: result.relaxationTrace,
    activationReceipt, strategyCapsule,
    strategyReplanned: replan.replanned, strategyReplanReason: replan.reason,
    recallLatencyMs: Date.now() - recallStartedAt,
  };
}

async function loadCogmemApi(bridgeConfig) {
  const candidates = [];
  const entrypoint = bridgeConfig.publicEntrypoint || process.env.COGMEM_PUBLIC_ENTRYPOINT;
  if (entrypoint) {
    // No package-name fallback here: resolving a different Cogmem version than
    // the one the host configured is worse than failing loudly.
    candidates.push(pathToFileURL(entrypoint).href);
  } else {
    candidates.push('cogmem');
  }
  const errors = [];
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch (error) {
      errors.push(candidate + ': ' + (error && error.message || String(error)));
    }
  }
  throw new Error('Unable to load cogmem API. Tried ' + errors.join('; '));
}

function stripCogmemRecallBlocks(text) {
  const input = String(text || '');
  let strippedChars = 0;
  let blockCount = 0;
  const output = input
    .replace(/<(COGMEM_RECALL_CONTEXT|COGMEM_MEMORY_ATLAS|COGMEM_TURN_BRIDGE|COGMEM_SESSION_STATE|COGMEM_STRATEGY_CONTEXT)\b[\s\S]*?<\/\1>/g, (match) => {
      strippedChars += match.length;
      blockCount += 1;
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    text: output,
    stripped: blockCount > 0,
    strippedChars,
    blockCount,
  };
}


async function rememberPayload(payload, bridgeConfig, kernel, memory) {
  const cleanUser = bridgeConfig.stripRecallBlocksBeforeRemember === false
    ? { text: payload.userText || '', stripped: false, strippedChars: 0, blockCount: 0 }
    : stripCogmemRecallBlocks(payload.userText || '');
  const cleanAssistant = bridgeConfig.stripRecallBlocksBeforeRemember === false
    ? { text: payload.assistantText || '', stripped: false, strippedChars: 0, blockCount: 0 }
    : stripCogmemRecallBlocks(payload.assistantText || '');
  const hygiene = {
    ...(payload.hygiene || {}),
    strippedRecallBlocks: Boolean(payload.hygiene && payload.hygiene.strippedRecallBlocks) || cleanUser.stripped || cleanAssistant.stripped,
    strippedBlockCount: Number(payload.hygiene && payload.hygiene.strippedBlockCount || 0) + cleanUser.blockCount + cleanAssistant.blockCount,
    strippedChars: Number(payload.hygiene && payload.hygiene.strippedChars || 0) + cleanUser.strippedChars + cleanAssistant.strippedChars,
  };
  const result = await memory.rememberTurnWithResult({
    agentId: bridgeConfig.agentId || 'openclaw',
    projectId: bridgeConfig.projectId || 'openclaw',
    workspaceId: bridgeConfig.projectId || 'openclaw',
    sessionId: payload.sessionId || 'openclaw-session',
    userText: cleanUser.text,
    assistantText: cleanAssistant.text,
    ingestMode: bridgeConfig.ingestMode || 'selective_compile',
    timestamp: Date.now(),
    metadata: {
      source: 'openclaw-plugin',
      pluginId: 'cogmem-auto-memory',
      lifecycle: 'turn',
      hygiene,
    },
  });
  const assistantEventId = result.rawEventIds[1];
  const toolCallEventIds = new Map();
  let toolCallCount = 0;
  let toolResultCount = 0;
  let taskEventCount = 0;

  for (const call of Array.isArray(payload.toolCalls) ? payload.toolCalls : []) {
    const event = await memory.ingestToolCall({
      agentId: bridgeConfig.agentId || 'openclaw',
      projectId: bridgeConfig.projectId || 'openclaw',
      workspaceId: bridgeConfig.projectId || 'openclaw',
      sessionId: payload.sessionId || 'openclaw-session',
      assistantEventId,
      toolCallId: call.toolCallId || undefined,
      toolName: call.toolName || 'unknown_tool',
      input: call.input,
      eventOrdinal: call.eventOrdinal,
      timestamp: call.timestamp,
      metadata: call.metadata,
    });
    if (call.toolCallId) toolCallEventIds.set(call.toolCallId, event.eventId);
    toolCallCount += 1;
  }

  for (const observation of Array.isArray(payload.toolResults) ? payload.toolResults : []) {
    const toolCallEventId = observation.toolCallId ? toolCallEventIds.get(observation.toolCallId) : undefined;
    if (toolCallEventId) {
      await memory.ingestToolObservation({
        agentId: bridgeConfig.agentId || 'openclaw',
        projectId: bridgeConfig.projectId || 'openclaw',
        workspaceId: bridgeConfig.projectId || 'openclaw',
        sessionId: payload.sessionId || 'openclaw-session',
        toolCallEventId,
        toolCallId: observation.toolCallId || undefined,
        toolName: observation.toolName || 'unknown_tool',
        output: observation.output || '',
        eventOrdinal: observation.eventOrdinal,
        timestamp: observation.timestamp,
        metadata: observation.metadata,
      });
      toolResultCount += 1;
    } else {
      await memory.ingestTaskEvent({
        agentId: bridgeConfig.agentId || 'openclaw',
        projectId: bridgeConfig.projectId || 'openclaw',
        workspaceId: bridgeConfig.projectId || 'openclaw',
        sessionId: payload.sessionId || 'openclaw-session',
        parentEventId: assistantEventId,
        title: 'Tool result without matching tool call',
        content: observation.output || '',
        eventOrdinal: observation.eventOrdinal,
        timestamp: observation.timestamp,
        metadata: {
          ...(observation.metadata || {}),
          toolCallId: observation.toolCallId,
          toolName: observation.toolName,
          causality: 'partial',
          reason: 'missing_tool_call_event',
        },
      });
      taskEventCount += 1;
    }
  }

  for (const task of Array.isArray(payload.taskEvents) ? payload.taskEvents : []) {
    await memory.ingestTaskEvent({
      agentId: bridgeConfig.agentId || 'openclaw',
      projectId: bridgeConfig.projectId || 'openclaw',
      workspaceId: bridgeConfig.projectId || 'openclaw',
      sessionId: payload.sessionId || 'openclaw-session',
      parentEventId: assistantEventId,
      taskId: task.taskId,
      title: task.title,
      content: task.content || '',
      eventOrdinal: task.eventOrdinal,
      timestamp: task.timestamp,
      metadata: task.metadata,
    });
    taskEventCount += 1;
  }

  let contextOutcomeId;
  if (payload.contextOutcome) {
    const outcome = kernel.memoryUseJudge.judge(payload.contextOutcome);
    kernel.contextOutcomeStore.record(outcome);
    contextOutcomeId = outcome.outcomeId;
  }

  return {
    ...result,
    hygiene,
    toolCallCount,
    toolResultCount,
    taskEventCount,
    contextOutcomeId,
  };
}

async function drainRememberQueue(bridgeConfig) {
  const { createMemoryKernelFromConfig, KernelAgentMemoryBackend } = await loadCogmemApi(bridgeConfig);
  const kernel = createMemoryKernelFromConfig({ configPath: bridgeConfig.configPath });
  try {
    const memory = new KernelAgentMemoryBackend(kernel);
    return drainRememberQueueWithLock(bridgeConfig, acquireRememberQueueLock(bridgeConfig), kernel, memory);
  } finally {
    kernel.close();
  }
}

function acquireRememberQueueLock(bridgeConfig) {
  const queuePath = bridgeConfig.rememberQueuePath;
  if (!queuePath) throw new Error('missing rememberQueuePath');
  mkdirSync(dirname(queuePath), { recursive: true });
  const lockPath = queuePath + '.lock';
  const recoveredProcessing = recoverStaleProcessingFiles(bridgeConfig);
  if (!existsSync(queuePath)) return { acquired: false, locked: false, empty: true, lockPath, recoveredProcessing };
  const timeoutMs = Number(bridgeConfig.rememberDrainTimeoutMs || 60000);
  try {
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      queuePath,
    }) + '\n');
  } catch {
    try {
      const ageMs = Date.now() - statSync(lockPath).mtimeMs;
      if (Number.isFinite(ageMs) && ageMs > timeoutMs) {
        rmSync(lockPath, { recursive: true, force: true });
        mkdirSync(lockPath);
        writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          staleLockRecovered: true,
          queuePath,
        }) + '\n');
        return { acquired: true, locked: false, empty: false, lockPath, staleRecovered: true, recoveredProcessing };
      }
    } catch {}
    return { acquired: false, locked: true, empty: false, lockPath };
  }
  return { acquired: true, locked: false, empty: false, lockPath, recoveredProcessing };
}

async function drainRememberQueueWithLock(bridgeConfig, queueLock, kernel, memory) {
  if (!queueLock.acquired) return { drained: 0, failed: 0, locked: queueLock.locked, empty: queueLock.empty === true };
  const queuePath = bridgeConfig.rememberQueuePath;
  const processingPath = queuePath + '.' + Date.now() + '.' + process.pid + '.processing';
  let drained = 0;
  let failed = 0;
  let deferred = 0;
  try {
    if (!existsSync(queuePath)) return { drained: 0, failed: 0, locked: false };
    renameSync(queuePath, processingPath);
    const lines = readFileSync(processingPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const batchSize = Math.max(1, Math.min(Number(bridgeConfig.rememberDrainBatchSize || 20), 100));
    const activeLines = lines.slice(0, batchSize);
    const deferredLines = lines.slice(batchSize);
    deferred = deferredLines.length;
    for (const line of activeLines) {
      let job;
      try {
        job = JSON.parse(line);
        await rememberPayload(job.payload || {}, job.payload?.config || bridgeConfig, kernel, memory);
        drained += 1;
      } catch (error) {
        failed += 1;
        const attempts = Number(job?.attempts || 0) + 1;
        const failedJob = {
          ...(job || { payload: { rawLine: line } }),
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          lastErrorAt: new Date().toISOString(),
        };
        const maxAttempts = Number(bridgeConfig.rememberMaxAttempts || 3);
        const targetPath = attempts < maxAttempts ? queuePath : queuePath + '.dead.jsonl';
        appendFileSync(targetPath, JSON.stringify(failedJob) + '\n');
      }
    }
    for (const line of deferredLines) {
      appendFileSync(queuePath, line + '\n');
    }
    rmSync(processingPath, { force: true });
  } finally {
    if (queueLock.acquired) rmSync(queueLock.lockPath, { recursive: true, force: true });
  }
  return { drained, failed, deferred, locked: false, staleRecovered: queueLock.staleRecovered === true, recoveredProcessing: queueLock.recoveredProcessing || 0 };
}

function recoverStaleProcessingFiles(bridgeConfig) {
  const queuePath = bridgeConfig.rememberQueuePath;
  const dir = dirname(queuePath);
  const prefix = queuePath.split('/').pop() + '.';
  const timeoutMs = Number(bridgeConfig.rememberDrainTimeoutMs || 60000);
  let recovered = 0;
  if (!existsSync(dir)) return recovered;
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.processing')) continue;
    const path = join(dir, entry);
    try {
      const ageMs = Date.now() - statSync(path).mtimeMs;
      if (!Number.isFinite(ageMs) || ageMs < timeoutMs) continue;
      const lines = readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
      for (const line of lines) appendFileSync(queuePath, line + '\n');
      rmSync(path, { force: true });
      recovered += lines.length;
    } catch {}
  }
  return recovered;
}

`;
}
function parseJsonObject(text, path) {
    try {
        const parsed = text.trim() ? JSON.parse(text) : {};
        if (isRecord(parsed))
            return parsed;
    }
    catch (error) {
        throw new Error(`Invalid OpenClaw config JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new Error(`Invalid OpenClaw config JSON at ${path}: expected object`);
}
function ensureObject(parent, key) {
    if (!isRecord(parent[key]))
        parent[key] = {};
    return parent[key];
}
function appendUniqueArray(value, item) {
    const out = Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
    if (!out.includes(item))
        out.push(item);
    return out;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
