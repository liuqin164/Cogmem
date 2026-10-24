import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatAtlasCard, formatRecallContext } from '../src/host/RecallBlock.js';
import { installOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';

/**
 * The plugin used to carry its own copy of the renderer, and this file used to
 * assert that the copy contained the string `facet.productFacet || facet.type`.
 * That checks a copy's text, not what the model reads: it would pass while the
 * copy printed something else, and it said nothing about whether a second copy
 * had appeared. The renderer now lives in the kernel (`src/host/RecallBlock.ts`,
 * ADR-0004), so the properties worth pinning are:
 *
 *   1. the block a host injects prints the product facet word, and
 *   2. the generated plugin delegates to the kernel instead of carrying a copy,
 *      which is what makes a label change reach every host at once.
 */
test('the injected block prints the product facet word when there is one', () => {
  const line = formatAtlasCard({
    canonicalId: 'ep:1', displayTitle: 'T', oneLineSummary: 'S',
    matchedFacets: [{ type: 'entity', productFacet: 'person', value: 'Ana' }],
  });
  expect(line).toContain('matchedFacets=person:Ana');

  const block = formatRecallContext({
    items: [{
      id: 'i1', text: 'Ana prefers dark mode', sourceType: 'compiled_memory',
      matchedFacets: [{ type: 'entity', productFacet: 'person', value: 'Ana' }],
    }],
  }, { memoryContextMaxItems: 3, memoryContextMaxChars: 3500 });
  expect(block).toContain('matchedFacets=person:Ana');
  expect(block).not.toContain('matchedFacets=entity:Ana');
});

test('the generated plugin delegates the renderers instead of embedding a copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-plugin-labels-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  const openclawConfigPath = join(root, 'openclaw.json');
  mkdirSync(join(root, '.cogmem'), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(openclawConfigPath, '{}');
  const result = installOpenClawAutoMemoryPlugin({ workspaceRoot: root, configPath, openclawConfigPath, force: true });

  const bridge = readFileSync(join(result.pluginDir, 'bridge.mjs'), 'utf8');

  // It takes them from the kernel it already imports.
  expect(bridge).toContain('formatRecallContext: api.formatRecallContext');
  expect(bridge).toContain('formatAtlasContext: api.formatAtlasContext');
  expect(bridge).toContain('compactRecallItems: api.compactRecallItems');
  expect(bridge).toContain('contextCandidateFromRecallItem: api.contextCandidateFromRecallItem');

  // And it no longer carries a copy that could drift from them.
  expect(bridge).not.toContain('function serializeUntrustedMemory');
  expect(bridge).not.toContain('function safeAtlasText');
  expect(bridge).not.toContain('function formatRecallContext');
  expect(bridge).not.toContain('function formatAtlasContext');
  expect(bridge).not.toContain('function formatAtlasCard');
  expect(bridge).not.toContain('function truncateLineWithMeta');
  expect(bridge).not.toContain('Selected memory cards:');
  expect(bridge).not.toContain('facet.productFacet || facet.type');
});
