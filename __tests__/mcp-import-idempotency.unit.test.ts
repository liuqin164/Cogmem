import { afterAll, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';

const scratch = mkdtempSync(join(tmpdir(), 'cogmem-mcp-import-'));
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

describe('cogmem_import_apply idempotency', () => {
  test('a second apply ingests nothing and leaves memory_events untouched', async () => {
    const workspaceRoot = makeWorkspace('idempotent');
    const dbPath = join(workspaceRoot, 'memory.db');
    const kernel = createMemoryKernel({ dbPath });
    const args = { agent: 'hermes', workspaceRoot, projectId };

    try {
      const first = await callCogmemMcpTool('cogmem_import_apply', args, { kernel });
      expect(first.isError).toBeFalsy();
      const firstBody = first.structuredContent as Record<string, number>;
      expect(firstBody.recordsParsed).toBe(4);
      expect(firstBody.recordsIngested).toBe(4);
      expect(firstBody.skippedRecords).toBe(0);

      const rowsAfterFirst = eventRows(dbPath);
      const totalAfterFirst = eventTotal(dbPath);
      expect(totalAfterFirst).toBeGreaterThan(0);
      expect(readCount(dbPath, 'SELECT COUNT(*) AS n FROM neurons WHERE is_deleted = 0')).toBeGreaterThan(0);

      const second = await callCogmemMcpTool('cogmem_import_apply', args, { kernel });
      expect(second.isError).toBeFalsy();
      const secondBody = second.structuredContent as Record<string, number>;
      expect(secondBody.recordsParsed).toBe(4);
      expect(secondBody.recordsIngested).toBe(0);
      expect(secondBody.skippedRecords).toBe(4);
      expect(secondBody.sourcesChanged).toBe(0);

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
    const args = { agent: 'hermes', workspaceRoot, projectId };

    try {
      const preview = await callCogmemMcpTool('cogmem_import_preview', args, { kernel });
      expect(preview.isError).toBeFalsy();
      const previewBody = preview.structuredContent as Record<string, number>;
      expect(previewBody.dryRun).toBe(true);
      expect(previewBody.recordsParsed).toBe(4);
      expect(previewBody.recordsWouldIngest).toBe(4);
      expect(previewBody.recordsIngested).toBe(0);
      expect(eventTotal(dbPath)).toBe(0);

      const applied = await callCogmemMcpTool('cogmem_import_apply', args, { kernel });
      expect(applied.isError).toBeFalsy();
      expect((applied.structuredContent as Record<string, number>).recordsIngested).toBe(4);
    } finally {
      kernel.close();
    }
  });

  test('an import leaves the caller kernel usable for later tool calls', async () => {
    const workspaceRoot = makeWorkspace('resident');
    const dbPath = join(workspaceRoot, 'memory.db');
    // Mirrors the HTTP server, which owns one kernel for the whole process and hands it
    // to every tool call: the import path must not close a kernel it does not own.
    const kernel = createMemoryKernel({ dbPath });
    const args = { agent: 'hermes', workspaceRoot, projectId };

    try {
      const applied = await callCogmemMcpTool('cogmem_import_apply', args, { kernel });
      expect(applied.isError).toBeFalsy();

      const recall = await callCogmemMcpTool(
        'cogmem_recall',
        { projectId, query: 'Bluetooth', limit: 5 },
        { kernel },
      );
      expect(recall.isError).toBeFalsy();
      expect(JSON.stringify(recall.structuredContent)).not.toContain('closed database');
      expect((recall.structuredContent as { items?: unknown[] }).items?.length ?? 0).toBeGreaterThan(0);

      const remembered = await callCogmemMcpTool(
        'cogmem_remember_turn',
        {
          agentId: 'import-test',
          projectId,
          sessionId: 'import-idempotency-session',
          userText: 'The printer queue drains after each shift.',
        },
        { kernel },
      );
      expect(remembered.isError).toBeFalsy();
    } finally {
      kernel.close();
    }
  });
});
