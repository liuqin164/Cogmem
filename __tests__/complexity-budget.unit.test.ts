import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { filterToolsByProfile } from '../src/mcp/profiles.js';

/**
 * #52, accepted 2026-10-31. The proposal asked for four rules; the owner took the two that
 * cost nothing to hold and left the binary consolidation to its own issue (#111), because
 * merging 22 `cogmem-*` entry points breaks users' scripts and needs a migration.
 *
 * A budget nobody checks is a wish, so both rules are pinned here rather than written down
 * and forgotten.
 */
test('the core MCP profile stays at eight tools or fewer', () => {
  // `core` is the default a host gets, so it is the one surface every user pays for. The
  // full profile is allowed to be large; this one is not.
  const core = filterToolsByProfile('core', listCogmemMcpTools());
  expect(core.length).toBeLessThanOrEqual(8);
});

test('AGENTS.md states the budget, so an agent meets it before adding a module', () => {
  const agents = readFileSync(join(import.meta.dir, '..', 'AGENTS.md'), 'utf8');
  expect(agents).toContain('## Complexity budget');
  expect(agents).toContain('eight tools or fewer');
  // The subtraction half is the one that never happens on its own.
  expect(agents).toContain('removed or merged');
});
