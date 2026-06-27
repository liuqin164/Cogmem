import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';
import { stripCogmemRecallBlocks } from '../src/agent/ContextHygiene.js';

test('OpenClaw direct plugin routes broad history questions through Atlas without MCP', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-atlas-openclaw-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  const openclawConfigPath = join(root, 'openclaw.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(openclawConfigPath, '{}');
  const result = installOpenClawAutoMemoryPlugin({ workspaceRoot: root, configPath, openclawConfigPath, force: true });
  const index = readFileSync(join(result.pluginDir, 'index.js'), 'utf8');
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
  expect(bridge).toContain('kernel.graphExplore');
  expect(bridge).toContain('kernel.graphPath');
  expect(bridge).toContain('kernel.graphTimeline');
  expect(bridge).toContain("command === 'context'");
  expect(bridge).toContain('evidenceEventIds');
  expect(bridge).toContain('nodeDetails');
  expect(bridge).toContain('function safeAtlasText');
  expect(bridge).toContain(String.raw`value === '<' ? '\\u003c' : '\\u003e'`);
  expect(index).not.toContain('cogmem_graph_explore');
});

test('Atlas prompt blocks are volatile and stripped before remembering', () => {
  const result = stripCogmemRecallBlocks('user\n<COGMEM_MEMORY_ATLAS>navigation only</COGMEM_MEMORY_ATLAS>\nassistant');
  expect(result.text).toBe('user\n\nassistant');
  expect(result.blockCount).toBe(1);
});
