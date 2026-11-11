import { afterAll, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { applyImport, previewImport } from '../src/import/ImportBridge.js';
import { makeTempDir } from './helpers/tmp.js';

const scratch = makeTempDir('cogmem-import-bridge-');
const projectId = 'import-idempotency';

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A minimal Hermes workspace whose session markdown the conversation adapter understands. */
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
  return dir;
}

function eventRows(dbPath: string): Array<{ event_type: string; n: number }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(
      'SELECT event_type, COUNT(*) AS n FROM memory_events GROUP BY event_type ORDER BY event_type',
    ).all() as Array<{ event_type: string; n: number }>;
  } finally {
    db.close();
  }
}

function eventTotal(dbPath: string): number {
  return eventRows(dbPath).reduce((sum, row) => sum + Number(row.n), 0);
}

function readCount(dbPath: string, sql: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return Number((db.prepare(sql).get() as { n: number }).n);
  } finally {
    db.close();
  }
}

describe('the import bridge is idempotent', () => {
  test('a second apply ingests nothing and leaves memory_events untouched', async () => {
    const workspaceRoot = makeWorkspace('idempotent');
    const dbPath = join(workspaceRoot, 'memory.db');
    const kernel = createMemoryKernel({ dbPath });
    const request = { agent: 'hermes', workspaceRoot, projectId } as const;

    try {
      const first = await applyImport(kernel, request);
      expect(first.recordsParsed).toBe(4);
      expect(first.recordsIngested).toBe(4);
      expect(first.skippedRecords).toBe(0);

      const rowsAfterFirst = eventRows(dbPath);
      const totalAfterFirst = eventTotal(dbPath);
      expect(totalAfterFirst).toBeGreaterThan(0);
      expect(readCount(dbPath, 'SELECT COUNT(*) AS n FROM neurons WHERE is_deleted = 0')).toBeGreaterThan(0);

      const second = await applyImport(kernel, request);
      expect(second.recordsParsed).toBe(4);
      expect(second.recordsIngested).toBe(0);
      expect(second.skippedRecords).toBe(4);
      expect(second.sourcesChanged).toBe(0);

      // No duplicate raw evidence, no duplicate memories, no duplicate belief writes.
      expect(eventRows(dbPath)).toEqual(rowsAfterFirst);
      expect(eventTotal(dbPath)).toBe(totalAfterFirst);
    } finally {
      kernel.close();
    }
  });

  test('preview is read-only and reports the same record count the apply then ingests', async () => {
    const workspaceRoot = makeWorkspace('preview');
    const dbPath = join(workspaceRoot, 'memory.db');
    const kernel = createMemoryKernel({ dbPath });
    const request = { agent: 'hermes', workspaceRoot, projectId } as const;

    try {
      const preview = await previewImport(kernel, request);
      expect(preview.dryRun).toBe(true);
      expect(preview.recordsParsed).toBe(4);
      expect(preview.recordsWouldIngest).toBe(4);
      expect(preview.recordsIngested).toBe(0);
      expect(eventTotal(dbPath)).toBe(0);

      const applied = await applyImport(kernel, request);
      expect(applied.recordsIngested).toBe(4);
    } finally {
      kernel.close();
    }
  });

  test('an import leaves the caller kernel usable', async () => {
    const workspaceRoot = makeWorkspace('resident');
    const dbPath = join(workspaceRoot, 'memory.db');
    // Mirrors the process that owns one kernel for its whole life and hands it to every call:
    // the import path must not close a kernel it does not own.
    const kernel = createMemoryKernel({ dbPath });
    const request = { agent: 'hermes', workspaceRoot, projectId } as const;

    try {
      await applyImport(kernel, request);
      // A later read on the same kernel still answers, so the bridge did not close it.
      expect(kernel.importStatus(projectId).totalSources).toBeGreaterThan(0);
      expect(kernel.listEpisodes({ projectId }).length).toBeGreaterThan(0);
    } finally {
      kernel.close();
    }
  });
});
