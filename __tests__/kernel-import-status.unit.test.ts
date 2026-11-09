import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createMemoryKernelFromConfig } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';
import * as publicEntry from '../src/public.js';
import { makeTempDir } from './helpers/tmp.js';
import { writeFileSync } from 'node:fs';

/**
 * #63: `cogmem_import_status` was reachable only as an MCP tool, so a host plugin — which gets the
 * public entry and builds its API from `createMemoryKernelFromConfig` — could not ask whether an
 * import had finished. The capability now lives on the kernel and the tool delegates to it.
 */
function install(): { configPath: string } {
  const dir = makeTempDir('cogmem-kernel-import-status-');
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, `[core]\ndb_path = ${JSON.stringify(join(dir, 'memory.db'))}\n`);
  const kernel = createMemoryKernelFromConfig({ configPath });
  kernel.close();
  return { configPath };
}

test('a plugin reaches import status through the public entry, not only through MCP', async () => {
  const { configPath } = install();
  const kernel = publicEntry.createMemoryKernelFromConfig({ configPath });
  try {
    // Reachable at all is the point of the ticket; an empty project answers with the shape, not an error.
    expect(kernel.importStatus('no-such-project')).toEqual({
      projectId: 'no-such-project', sources: [], totalSources: 0, returnedSources: 0, limit: 50,
    });
    expect(kernel.importStatus('no-such-project', { limit: 3 }).limit).toBe(3);
    expect(() => kernel.importStatus('no-such-project', { limit: 0 })).toThrow(/positive integer/);

    // The MCP tool returns exactly what the kernel returns: one implementation, not two.
    const viaTool = await callCogmemMcpTool('cogmem_import_status', { projectId: 'no-such-project' }, { kernel });
    expect(viaTool.isError).toBeFalsy();
    expect(viaTool.structuredContent).toEqual(kernel.importStatus('no-such-project'));
  } finally {
    kernel.close();
  }
});
