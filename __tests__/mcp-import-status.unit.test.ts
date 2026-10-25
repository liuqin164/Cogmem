import { afterAll, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';
import { makeTempDir } from './helpers/tmp.js';

const scratch = makeTempDir('cogmem-import-status-');
const projectId = 'import-status';

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Two Hermes session files so the workspace registers two distinct import sources. */
function makeWorkspace(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'sessions', '2026-05-07.md'), [
    '# 2026-05-07',
    '',
    '- 09:00 User: Bluetooth provisioning uses a GATT config service.',
    '- 09:01 Agent: Stored the Bluetooth project context.',
    '- 09:05 User: The kiosk printer speaks ESC/POS over USB.',
    '- 09:06 Agent: Noted the printer transport.',
  ].join('\n'));
  writeFileSync(join(dir, 'sessions', '2026-05-08.md'), [
    '# 2026-05-08',
    '',
    '- 10:00 User: Shift handover happens at 07:00.',
    '- 10:01 Agent: Recorded the handover time.',
  ].join('\n'));
  return dir;
}

interface StatusSource {
  sourceId: string;
  sourcePath: string;
  sourceType: string;
  lastProcessedAt?: number;
  processedRecordCount: number;
}

interface StatusBody {
  projectId: string;
  sources: StatusSource[];
  totalSources: number;
  returnedSources?: number;
  limit: number;
}

function eventTotal(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM memory_events').get() as { n: number }).n);
  } finally {
    db.close();
  }
}

describe('cogmem_import_status', () => {
  test('reports every imported source with its processed record count', async () => {
    const workspaceRoot = makeWorkspace('listed');
    const kernel = createMemoryKernel({ dbPath: join(workspaceRoot, 'memory.db') });
    const args = { agent: 'hermes', workspaceRoot, projectId };

    try {
      const applied = await callCogmemMcpTool('cogmem_import_apply', args, { kernel });
      expect(applied.isError).toBeFalsy();

      const status = await callCogmemMcpTool('cogmem_import_status', { projectId }, { kernel });
      expect(status.isError).toBeFalsy();
      const body = status.structuredContent as unknown as StatusBody;

      expect(body.totalSources).toBe(2);
      expect(body.sources).toHaveLength(2);
      expect(body.sources.map((source) => source.processedRecordCount).sort()).toEqual([2, 4]);
      for (const source of body.sources) {
        expect(source.sourceId).toStartWith('hermes-session-');
        expect(source.sourceType).toBe('conversation_markdown');
        expect(source.sourcePath.endsWith('.md')).toBe(true);
        expect(typeof source.lastProcessedAt).toBe('number');
      }
    } finally {
      kernel.close();
    }
  });

  test('limit truncates the returned sources but keeps the true total', async () => {
    const workspaceRoot = makeWorkspace('limited');
    const kernel = createMemoryKernel({ dbPath: join(workspaceRoot, 'memory.db') });
    const args = { agent: 'hermes', workspaceRoot, projectId };

    try {
      const applied = await callCogmemMcpTool('cogmem_import_apply', args, { kernel });
      expect(applied.isError).toBeFalsy();

      const limited = await callCogmemMcpTool('cogmem_import_status', { projectId, limit: 1 }, { kernel });
      expect(limited.isError).toBeFalsy();
      const body = limited.structuredContent as unknown as StatusBody;

      expect(body.limit).toBe(1);
      expect(body.totalSources).toBe(2);
      expect(body.sources).toHaveLength(1);
      expect(body.returnedSources).toBe(1);

      // The ordering must be stable across calls, otherwise "the first N sources" is not a
      // usable answer for a caller that pages through status.
      const again = await callCogmemMcpTool('cogmem_import_status', { projectId, limit: 1 }, { kernel });
      expect((again.structuredContent as unknown as StatusBody).sources[0]?.sourceId).toBe(body.sources[0]?.sourceId);

      const rejected = await callCogmemMcpTool('cogmem_import_status', { projectId, limit: 0 }, { kernel });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected.structuredContent)).toContain('limit must be a positive integer');
    } finally {
      kernel.close();
    }
  });

  test('is read-only and answers an unimported project with an empty list', async () => {
    const workspaceRoot = makeWorkspace('readonly');
    const dbPath = join(workspaceRoot, 'memory.db');
    const kernel = createMemoryKernel({ dbPath });

    try {
      const empty = await callCogmemMcpTool('cogmem_import_status', { projectId }, { kernel });
      expect(empty.isError).toBeFalsy();
      const emptyBody = empty.structuredContent as unknown as StatusBody;
      expect(emptyBody.totalSources).toBe(0);
      expect(emptyBody.sources).toEqual([]);

      await callCogmemMcpTool('cogmem_import_apply', { agent: 'hermes', workspaceRoot, projectId }, { kernel });
      const before = eventTotal(dbPath);
      expect(before).toBeGreaterThan(0);

      await callCogmemMcpTool('cogmem_import_status', { projectId }, { kernel });
      expect(eventTotal(dbPath)).toBe(before);

      // Another project's status must not see this project's sources.
      const other = await callCogmemMcpTool('cogmem_import_status', { projectId: 'unrelated-project' }, { kernel });
      expect((other.structuredContent as unknown as StatusBody).totalSources).toBe(0);
    } finally {
      kernel.close();
    }
  });
});
