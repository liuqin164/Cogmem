import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool, listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import {
  ADMIN_TOOLS,
  CORE_TOOLS,
  filterToolsByProfile,
  type McpToolProfile,
} from '../src/mcp/profiles.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #63: 4.1 exposes the shared region again — through the kernel, the MCP surface and the public entry
 * that host plugins load.
 *
 * 4.0 removed the surface on purpose (ADR-0005) and `#68` guarded its absence, including that a fresh
 * database carried no shared storage. ADR-0005 itself says the region is deferred **to 4.1**, and the
 * maintainer settled on 2026-11-03 that sharing lands in 4.1, so this file replaces that guard with the
 * 4.1 one. What must stay true is narrower and sharper:
 *
 * 1. `core` still ships none of them — the default surface a host gets pays nothing for sharing;
 * 2. with `[shared] enabled` false (the default), a call is refused because sharing is off, not because
 *    the tool is unknown: "unknown" would send an operator hunting a typo, and "widen the profile"
 *    would send them after a capability the switch is withholding;
 * 3. a database nobody shared into still carries no shared table, because the adapter creates its
 *    schema on first use rather than at construction.
 */

const SHARED_PREFIX = 'cogmem_shared_';
const SHARED_TOOLS = [
  'cogmem_shared_publish',
  'cogmem_shared_retract',
  'cogmem_shared_subscribe',
  'cogmem_shared_explain',
];

const scratch = makeTempDir('cogmem-mcp-shared-surface-');

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function sharedTables(db: Database): string[] {
  return (db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%shared%'",
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

describe('#63 the shared surface is registered, and only above core', () => {
  test('the registry names all four shared tools', () => {
    const names = listCogmemMcpTools().map((tool) => tool.name);
    expect(SHARED_TOOLS.filter((tool) => names.includes(tool))).toEqual(SHARED_TOOLS);
  });

  test('core offers none of them; admin and full offer all four', () => {
    const all = listCogmemMcpTools();
    const inProfile = (profile: McpToolProfile) =>
      filterToolsByProfile(profile, all).map((tool) => tool.name).filter((name) => name.startsWith(SHARED_PREFIX));
    expect(inProfile('core')).toEqual([]);
    expect(inProfile('admin')).toEqual(SHARED_TOOLS);
    expect(inProfile('full')).toEqual(SHARED_TOOLS);
  });

  test('the profile constants agree with the filter', () => {
    expect(CORE_TOOLS.filter((name) => name.startsWith(SHARED_PREFIX))).toEqual([]);
    expect(ADMIN_TOOLS.filter((name) => name.startsWith(SHARED_PREFIX))).toEqual(SHARED_TOOLS);
  });
});

describe('#63 with the switch off, a shared call is refused rather than unknown', () => {
  test('publishing answers shared_disabled, not Unknown cogmem MCP tool', async () => {
    const dbPath = join(scratch, 'off', 'memory.db');
    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
    try {
      const result = await callCogmemMcpTool('cogmem_shared_publish', {
        collection: 'team-standards',
        items: [{ itemHash: 'h1', sourceItem: 's1', payload: { t: 'x' } }],
      }, { kernel, hostId: 'unit-host' });
      expect(result.isError).toBe(true);
      const body = result.structuredContent as { error?: string };
      expect(String(body.error)).toContain('shared_disabled');
      expect(String(body.error)).not.toContain('Unknown cogmem MCP tool');
      // Refused before any write: the collection was never created.
      expect(await kernel.listSharedCollections()).toEqual([]);
    } finally {
      kernel.close();
    }
  });

  test('subscribing with the switch off returns nothing, and says nothing went wrong', async () => {
    const dbPath = join(scratch, 'off-read', 'memory.db');
    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
    try {
      const result = await callCogmemMcpTool('cogmem_shared_subscribe', { collections: ['team-standards'] },
        { kernel, hostId: 'unit-host' });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ items: [], count: 0 });
    } finally {
      kernel.close();
    }
  });

  test('the publisher identity comes from the connection, never from the arguments', async () => {
    const dbPath = join(scratch, 'identity', 'memory.db');
    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec', sharedEnabled: true });
    try {
      // A caller may not name itself: `sourceHost` in the arguments is ignored.
      await callCogmemMcpTool('cogmem_shared_publish', {
        collection: 'team-standards',
        sourceHost: 'attacker',
        items: [{ itemHash: 'h1', sourceItem: 's1', sourceHost: 'attacker', payload: { t: 'x' } }],
      }, { kernel, hostId: 'claude' });
      expect(await kernel.listSharedCollections()).toMatchObject([{ ownerHost: 'claude' }]);
      // #146: reading is not gated per reader, so the host that was never granted reads it too.
      expect(await kernel.subscribeShared(['team-standards'], 'attacker')).toHaveLength(1);
      expect(await kernel.subscribeShared(['team-standards'], 'claude')).toHaveLength(1);
    } finally {
      kernel.close();
    }
  });
});

describe('#63 a database nobody shared into carries no shared storage', () => {
  test('opening a kernel does not create the shared tables', () => {
    const dbPath = join(scratch, 'fresh-db', 'memory.db');
    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
    kernel.close();
    const db = new Database(dbPath, { readonly: true });
    try {
      expect(sharedTables(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
