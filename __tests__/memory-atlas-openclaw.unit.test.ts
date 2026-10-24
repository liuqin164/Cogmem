import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  // The plugin records the package entry it will import at hook time. Running the
  // installer from a checkout used to write src/public.js, which is never built.
  const patched = JSON.parse(readFileSync(openclawConfigPath, 'utf8'));
  const pluginEntryKey = Object.keys(patched.plugins.entries).find((k) => k.startsWith('cogmem-auto-memory-'));
  expect(pluginEntryKey).toBeDefined();
  const installed = patched.plugins.entries[pluginEntryKey!];
  expect(existsSync(installed.config.publicEntrypoint)).toBe(true);
  expect(installed.config.publicEntrypoint.endsWith('public.js')).toBe(true);
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
  expect(bridge).toContain('nodeDetails');
  // Selecting the episodes, retaining a strict facet match and assembling the
  // result are the kernel's shared orchestration now (`recallForHost`, ADR-0004);
  // the bridge hands over and passes back. Those rules are executed in
  // `__tests__/host-bridge.unit.test.ts`; here the point is that the bridge no
  // longer holds its own copy of them.
  expect(bridge).toContain('render.recallForHost(');
  expect(bridge).toContain('recallForHost: api.recallForHost');
  expect(bridge).not.toContain('selectedEpisodeCards');
  expect(bridge).not.toContain('retainedCanonicalId');
  expect(bridge).not.toContain("result.decisionTrace.selectedLane === 'facet_graph_raw_ledger'");
  // The Atlas/recall text itself is rendered by the kernel now (ADR-0004), so
  // the bridge must delegate rather than carry a second copy of it. Its own
  // test executes those renderers; here the point is that they are not here.
  expect(bridge).toContain('formatAtlasContext: api.formatAtlasContext');
  expect(bridge).toContain('formatRecallContext: api.formatRecallContext');
  expect(bridge).not.toContain('memory_atlas.v2');
  expect(bridge).not.toContain('Selected memory cards:');
  expect(bridge).not.toContain('function safeAtlasText');
  expect(bridge).not.toContain('function serializeUntrustedMemory');
  expect(bridge).not.toContain('evidenceEventIds');
  // Escaping untrusted memory into the block is the renderer's job, so it moved
  // with the renderer; `__tests__/recall-block.unit.test.ts` asserts that a
  // hostile item cannot escape the block it is rendered into.
  expect(bridge).not.toContain("replace(/</g, '&lt;')");
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
