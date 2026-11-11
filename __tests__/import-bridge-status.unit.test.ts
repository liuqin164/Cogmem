import { afterAll, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { applyImport } from '../src/import/ImportBridge.js';
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

function eventTotal(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM memory_events').get() as { n: number }).n);
  } finally {
    db.close();
  }
}

describe('the import bridge status view', () => {
  test('reports every imported source with its processed record count', async () => {
    const workspaceRoot = makeWorkspace('listed');
    const kernel = createMemoryKernel({ dbPath: join(workspaceRoot, 'memory.db') });
    const request = { agent: 'hermes', workspaceRoot, projectId } as const;

    try {
      await applyImport(kernel, request);

      const body = kernel.importStatus(projectId);
      expect(body.totalSources).toBe(2);
      expect(body.sources).toHaveLength(2);
      expect(body.sources.map((source: StatusSource) => source.processedRecordCount).sort()).toEqual([2, 4]);
      for (const source of body.sources as StatusSource[]) {
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
    const request = { agent: 'hermes', workspaceRoot, projectId } as const;

    try {
      await applyImport(kernel, request);

      const body = kernel.importStatus(projectId, { limit: 1 });
      expect(body.limit).toBe(1);
      expect(body.totalSources).toBe(2);
      expect(body.sources).toHaveLength(1);
      expect(body.returnedSources).toBe(1);

      // The ordering must be stable across calls, otherwise "the first N sources" is not a
      // usable answer for a caller that pages through status.
      const again = kernel.importStatus(projectId, { limit: 1 });
      expect((again.sources as StatusSource[])[0]?.sourceId).toBe((body.sources as StatusSource[])[0]?.sourceId);

      expect(() => kernel.importStatus(projectId, { limit: 0 })).toThrow(/positive integer/);
    } finally {
      kernel.close();
    }
  });

  test('is read-only and answers an unimported project with an empty list', async () => {
    const workspaceRoot = makeWorkspace('readonly');
    const dbPath = join(workspaceRoot, 'memory.db');
    const kernel = createMemoryKernel({ dbPath });

    try {
      const empty = kernel.importStatus(projectId);
      expect(empty.totalSources).toBe(0);
      expect(empty.sources).toEqual([]);

      await applyImport(kernel, { agent: 'hermes', workspaceRoot, projectId });
      const before = eventTotal(dbPath);
      expect(before).toBeGreaterThan(0);

      kernel.importStatus(projectId);
      expect(eventTotal(dbPath)).toBe(before);

      // Another project's status must not see this project's sources.
      expect(kernel.importStatus('unrelated-project').totalSources).toBe(0);
    } finally {
      kernel.close();
    }
  });
});
