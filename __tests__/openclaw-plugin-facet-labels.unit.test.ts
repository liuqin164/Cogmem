import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';

// The generated plugin is a copy of the renderer: if it keeps printing
// facet.type, a model on a hookless host keeps reading "entity" even though the
// kernel now publishes productFacet.
test('the generated plugin prints the product facet word when there is one', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-plugin-labels-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  const openclawConfigPath = join(root, 'openclaw.json');
  mkdirSync(join(root, '.cogmem'), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(openclawConfigPath, '{}');
  const result = installOpenClawAutoMemoryPlugin({ workspaceRoot: root, configPath, openclawConfigPath, force: true });

  const bridge = readFileSync(join(result.pluginDir, 'bridge.mjs'), 'utf8');
  expect(bridge).toContain('facet.productFacet || facet.type');
});
