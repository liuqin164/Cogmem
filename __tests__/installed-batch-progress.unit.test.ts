import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IngestionCursorStore } from '../src/batch/IngestionCursorStore.js';
import {
  InstalledBatchProcessor,
  type BatchProgressEvent,
} from '../src/batch/InstalledBatchProcessor.js';
import type { SourceDefinition } from '../src/adapters/types.js';

test('InstalledBatchProcessor emits source and ingest progress events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-batch-progress-'));
  mkdirSync(join(root, 'memory'), { recursive: true });
  const sourcePath = join(root, 'memory', '2026-06-03-1207.md');
  writeFileSync(sourcePath, 'User: Import progress should be visible.\nAgent: Confirmed.');

  const source: SourceDefinition = {
    sourceId: 'openclaw-progress-test',
    sourcePath,
    adapterKind: 'openclaw_daily_memory',
    projectId: 'openclaw',
  };
  const events: BatchProgressEvent[] = [];
  const cursorStore = new IngestionCursorStore(':memory:');
  const processor = new InstalledBatchProcessor({
    cursorStore,
    ingestBatch: async (items) => items.map((_, index) => ({ id: `neuron-${index}` }) as any),
    runOfflineWindow: async () => ({}) as any,
    onProgress: (event) => events.push(event),
  });

  try {
    const summary = await processor.runOnce({
      sources: [source],
      window: { start: 0, end: Number.MAX_SAFE_INTEGER, label: 'full-history' },
    });

    expect(summary.recordsIngested).toBeGreaterThan(0);
    expect(events.map((event) => event.stage)).toContain('source:start');
    expect(events.map((event) => event.stage)).toContain('source:parsed');
    expect(events.map((event) => event.stage)).toContain('source:ingest:start');
    expect(events.map((event) => event.stage)).toContain('source:ingest:complete');
    expect(events.map((event) => event.stage)).toContain('offline:start');
    expect(events.map((event) => event.stage)).toContain('offline:complete');
  } finally {
    cursorStore.close();
  }
});
