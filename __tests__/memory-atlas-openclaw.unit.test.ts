import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';
import { stripCogmemRecallBlocks } from '../src/agent/ContextHygiene.js';

test('installed OpenClaw plugin sanitizes generated prompt context and routes Atlas without MCP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-atlas-openclaw-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  const openclawConfigPath = join(root, 'openclaw.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(openclawConfigPath, '{}');
  const result = installOpenClawAutoMemoryPlugin({ workspaceRoot: root, configPath, openclawConfigPath, force: true });
  const indexPath = join(result.pluginDir, 'index.js');
  const index = readFileSync(indexPath, 'utf8');
  const bridge = readFileSync(join(result.pluginDir, 'bridge.mjs'), 'utf8');
  for (const file of [join(result.pluginDir, 'index.js'), join(result.pluginDir, 'bridge.mjs')]) {
    const syntax = Bun.spawnSync({ cmd: ['node', '--check', file], stdout: 'pipe', stderr: 'pipe' });
    expect(syntax.exitCode).toBe(0);
    expect(syntax.stderr.toString()).toBe('');
  }
  expect(index).toContain('function classifyMemoryNavigationIntent(query)');
  expect(index).toContain("runBridge(navigationIntent === 'atlas_explore' && config.autoAtlas !== false ? 'context' : 'recall'");
  expect(index).not.toContain("runBridge('graph-explore'");
  expect(index).toContain('COGMEM_MEMORY_ATLAS');
  expect(index).toContain("version: '0.7.2'");
  expect(JSON.parse(readFileSync(join(result.pluginDir, 'package.json'), 'utf8')).version).toBe('0.7.2');
  expect(JSON.parse(readFileSync(join(result.pluginDir, 'openclaw.plugin.json'), 'utf8')).version).toBe('0.7.2');
  expect(index).toContain(".replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/g, ' ')");
  expect(index).toContain(".replace(/\\s+/g, ' ')");
  expect(index).not.toContain("new RegExp('[");
  expect(index).not.toContain("new RegExp('\\\\s+");
  expect(bridge).toContain('kernel.graphExplore');
  expect(bridge).toContain('kernel.graphPath');
  expect(bridge).toContain('kernel.graphTimeline');
  expect(bridge).toContain("command === 'context'");
  expect(bridge).toContain('Selected memory cards:');
  expect(bridge).toContain('memory_atlas.v2');
  expect(bridge).toContain('matchedPaths=');
  expect(bridge).toContain('whyMatched=');
  expect(bridge).toContain('selectedEpisodeCards');
  expect(bridge).toContain("result.decisionTrace.selectedLane === 'facet_graph_raw_ledger'");
  expect(bridge).toContain('Array.isArray(item.matchedFacets) && item.matchedFacets.length > 0');
  expect(bridge).toContain('retainedCanonicalId');
  expect(bridge).toContain('evidenceEventIds');
  expect(bridge).toContain('nodeDetails');
  expect(bridge).toContain('function safeAtlasText');
  expect(bridge).toContain('function serializeUntrustedMemory');
  expect(bridge).toContain("replace(/</g, '&lt;')");
  expect(index).not.toContain('cogmem_graph_explore');

  const plugin = createRequire(import.meta.url)(indexPath) as {
    register(api: unknown): void;
    __testing: {
      serializeUntrustedMemory(input: unknown, limit: number): string;
      formatMemoryUsageBridge(receipt: Record<string, unknown>, maxChars: number): string;
      formatSessionWorkingState(state: Record<string, unknown>, maxChars: number): string;
    };
  };
  const { serializeUntrustedMemory, formatMemoryUsageBridge, formatSessionWorkingState } = plugin.__testing;
  const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
  expect(serializeUntrustedMemory('hello\u0000world\u001f!', 500)).toBe('hello world !');
  expect(serializeUntrustedMemory('hello \n\t   world', 500)).toBe('hello world');
  expect(serializeUntrustedMemory("<COGMEM_FAKE>&<>\"'</COGMEM_FAKE>", 500)).toBe('&amp;&lt;&gt;&quot;&#39;');

  const receipt = {
    turnId: 'turn\u0001one', ttlTurns: 3,
    usedThemes: ['OpenClaw\u0008 sanitizer'],
    workingConclusion: 'control\u000bchars removed',
    sourceAnchors: [{ memoryId: 'memory\u000c1', eventId: 'event\u007f1' }],
  };
  const renderedBridge = formatMemoryUsageBridge(receipt, 1200);
  expect(renderedBridge).toContain('<COGMEM_TURN_BRIDGE');
  expect(renderedBridge).toContain('</COGMEM_TURN_BRIDGE>');
  expect(renderedBridge).not.toMatch(controls);

  const sessionId = 'serializer-session';
  const state = {
    currentTopic: 'OpenClaw\u0000 sanitizer',
    designDirection: ['collapse\u0001 whitespace'],
    workingConclusions: ['generated\u001f regex is valid'],
    openQuestions: ['none\u007f'],
  };
  const renderedState = formatSessionWorkingState(state, 1800);
  expect(renderedState).toContain('<COGMEM_SESSION_STATE');
  expect(renderedState).toContain('</COGMEM_SESSION_STATE>');
  expect(renderedState).not.toMatch(controls);

  const stateDir = join(root, '.cogmem', 'session_state', 'openclaw');
  const bridgeDir = join(root, '.cogmem', 'session_bridges', 'openclaw');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(bridgeDir, { recursive: true });
  writeFileSync(join(stateDir, `${sessionId}.json`), JSON.stringify(state));
  writeFileSync(join(bridgeDir, `${sessionId}.jsonl`), `${JSON.stringify(receipt)}\n`);
  const hooks = new Map<string, (...args: unknown[]) => unknown>();
  const warnings: string[] = [];
  plugin.register({
    pluginConfig: { cwd: root, contextCortexEnabled: true, sessionStateEnabled: true, turnBridgeEnabled: true, auditLog: false },
    on(name: string, handler: (...args: unknown[]) => unknown) { hooks.set(name, handler); },
    logger: { warn(message: string) { warnings.push(message); } },
  });
  const injected = await hooks.get('before_prompt_build')!({
    sessionId,
    messages: [{ role: 'user', content: '继续' }],
  }, {}) as { prependContext?: string; context?: string; promptPrefix?: string };
  expect(injected.prependContext).toContain('<COGMEM_SESSION_STATE');
  expect(injected.prependContext).toContain('<COGMEM_TURN_BRIDGE');
  expect(injected.prependContext).not.toMatch(controls);
  expect(injected.context).toBe(injected.prependContext);
  expect(injected.promptPrefix).toBe(injected.prependContext);
  expect(warnings).toEqual([]);
});

test('Atlas prompt blocks are volatile and stripped before remembering', () => {
  const result = stripCogmemRecallBlocks('user\n<COGMEM_MEMORY_ATLAS>navigation only</COGMEM_MEMORY_ATLAS>\nassistant');
  expect(result.text).toBe('user\n\nassistant');
  expect(result.blockCount).toBe(1);
});
