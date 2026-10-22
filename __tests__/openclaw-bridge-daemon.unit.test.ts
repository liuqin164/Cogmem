import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';

const CONFIG_TOML = `[core]
db_path = "memory.db"
vector_backend = "sqlite-vec"
vector_dimension = 384

[embedding]
provider = "deterministic_local"
model = "deterministic_local"

[memory_model]
provider = "rule_only"
`;

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-bridge-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  const openclawConfigPath = join(root, 'openclaw.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, CONFIG_TOML);
  writeFileSync(openclawConfigPath, '{}');
  const result = installOpenClawAutoMemoryPlugin({ workspaceRoot: root, configPath, openclawConfigPath, projectId: 'bridge-test', agentId: 'bridge-test', force: true });
  const config = JSON.parse(readFileSync(openclawConfigPath, 'utf8')).plugins.entries['cogmem-auto-memory'].config;
  mkdirSync(dirname(config.bridgeSocket), { recursive: true });
  const plugin = createRequire(import.meta.url)(join(result.pluginDir, 'index.js'));
  return { config, testing: plugin.__testing };
}

async function waitForHealth(testing: any, config: any): Promise<any> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const health = await testing.bridgeDaemonHealth(config);
    if (health) return health;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

test('the bridge daemon answers recalls in-process and survives a restart', async () => {
  const { config, testing } = setup();

  expect(await testing.ensureBridgeDaemon(config)).toBe(true);
  const first = await testing.bridgeDaemonHealth(config);
  expect(first.version).toBe('0.7.2');

  await testing.runBridge('remember', {
    config,
    sessionId: 'bridge-test-1',
    userText: '本轮发布代号是 Orion，负责人是林。',
    assistantText: '记下了：Orion，林。',
  }, config, 30000);

  // Recall from a different session: memory from the session already in context
  // is deliberately not re-injected.
  const payload = { config, query: '发布代号是什么', sessionId: 'bridge-test-2' };

  const warm = await testing.runBridge('recall', payload, config, 30000);
  expect(warm.itemCount).toBeGreaterThan(0);
  expect(warm.context).toContain('<COGMEM_RECALL_CONTEXT');

  // Same daemon, same kernel: no second process, no second startup.
  expect((await testing.bridgeDaemonHealth(config)).pid).toBe(first.pid);

  process.kill(first.pid);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const afterKill = await testing.runBridge('recall', payload, config, 30000);
  expect(afterKill.itemCount).toBeGreaterThan(0);
  expect(afterKill.context).toContain('<COGMEM_RECALL_CONTEXT');

  const restarted = await testing.bridgeDaemonHealth(config);
  expect(restarted.pid).not.toBe(first.pid);
  process.kill(restarted.pid);
});

test('a daemon from another build is replaced instead of serving stale behaviour', async () => {
  const { config, testing } = setup();

  const bridgePath = join(dirname(config.bridgeSocket), '..', 'bridge.mjs');
  const stale = Bun.spawn({
    cmd: [process.execPath, bridgePath, 'serve', config.bridgeSocket],
    env: { ...process.env, COGMEM_BRIDGE_VERSION: '0.0.0' },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const before = await waitForHealth(testing, config);
  expect(before?.version).toBe('0.0.0');

  expect(await testing.ensureBridgeDaemon(config)).toBe(true);
  const after = await testing.bridgeDaemonHealth(config);
  expect(after.version).toBe('0.7.2');
  expect(after.pid).not.toBe(before.pid);

  process.kill(after.pid);
  try { stale.kill(); } catch {}
});
