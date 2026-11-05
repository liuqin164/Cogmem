import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(makeTempDir('cogmem-atlas-fts-'), 'memory.db') });
}

function seedEpisodes(kernel: MemoryKernel, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const eventId = `evt-${index}`;
    const sessionId = `session-${index}`;
    const occurredAt = Date.UTC(2026, 5, 5, 12, 0, 0) + index * 60_000;
    const event = kernel.eventStore.append({
      eventId,
      streamId: sessionId,
      streamType: 'thread',
      eventType: 'MESSAGE',
      rawEventType: 'message',
      projectId: 'p',
      sessionId,
      threadId: sessionId,
      role: 'user',
      occurredAt,
      localDate: '2026-06-05',
      payload: { text: `部署流程第 ${index} 次复盘，负责小组是青栎组。` },
    });
    kernel.appendRawEventToEpisode(event, { projectId: 'p', sessionId, sourceAgent: 'test', now: occurredAt });
  }
}

/** Count the statements the rebuild issues against the atlas FTS table. */
function captureFtsInserts(kernel: MemoryKernel, run: () => void): number {
  const db = kernel.memoryAtlasStore.db as unknown as { prepare: (sql: string) => unknown };
  const prepare = db.prepare.bind(db);
  let inserts = 0;
  db.prepare = (sql: string) => {
    if (/INSERT INTO memory_atlas_fts/i.test(sql)) inserts += 1;
    return prepare(sql);
  };
  try {
    run();
  } finally {
    db.prepare = prepare;
  }
  return inserts;
}

test('a full atlas rebuild writes the search index in one pass, not one statement per node', () => {
  const kernel = createKernel();
  try {
    seedEpisodes(kernel, 6);
    let rebuilt: { documents: number } = { documents: 0 };
    const inserts = captureFtsInserts(kernel, () => {
      rebuilt = kernel.rebuildMemoryAtlas({ projectId: 'p' });
    });

    const db = kernel.memoryAtlasStore.db;
    const documents = (db.prepare(`SELECT COUNT(*) AS count FROM memory_atlas_documents WHERE project_id='p'`).get() as { count: number }).count;
    const indexed = (db.prepare(`SELECT COUNT(*) AS count FROM memory_atlas_fts WHERE project_id='p'`).get() as { count: number }).count;

    expect(rebuilt.documents).toBe(documents);
    expect(documents).toBeGreaterThanOrEqual(5);
    // The index is a projection of the documents: every one of them is searchable.
    expect(indexed).toBe(documents);
    // One pass per project. A per-node write path would issue one statement per
    // document — that is the 71.8 s of the 90.4 s rebuild.
    expect(inserts).toBeLessThanOrEqual(2);
  } finally {
    kernel.close();
  }
});
