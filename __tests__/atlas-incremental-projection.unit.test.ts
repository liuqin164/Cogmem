import { expect, test } from 'bun:test';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

function createKernelAt(dbPath: string): MemoryKernel {
  return createMemoryKernel({ dbPath });
}

function seedEpisode(kernel: MemoryKernel, index: number, text = '部署流程复盘，负责小组是青栎组。'): string {
  const sessionId = `session-${index}`;
  const eventId = `evt-${index}`;
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
    payload: { text },
  });
  kernel.appendRawEventToEpisode(event, { projectId: 'p', sessionId, sourceAgent: 'test', now: occurredAt });
  return eventId;
}

/** The canonical graph: node identities and the edges between them. */
function canonicalGraph(kernel: MemoryKernel): { nodes: string[]; edges: string[] } {
  const db = kernel.memoryAtlasStore.db;
  const nodes = (db.prepare(`SELECT node_id, node_type, label FROM memory_atlas_documents WHERE project_id='p' ORDER BY node_id`).all() as Array<{ node_id: string; node_type: string; label: string }>)
    .map((row) => `${row.node_type}\u0000${row.node_id}\u0000${row.label}`);
  const edges = (db.prepare(`SELECT source_type, source_id, relation_type, target_type, target_id FROM memory_edges WHERE project_id='p' ORDER BY source_id, relation_type, target_id`).all() as Array<Record<string, string>>)
    .map((row) => `${row.source_type}:${row.source_id}\u0000${row.relation_type}\u0000${row.target_type}:${row.target_id}`);
  return { nodes, edges };
}

test('adding one episode writes that episode, not the corpus', () => {
  const kernel = createKernelAt(join(makeTempDir('cogmem-atlas-incremental-'), 'memory.db'));
  try {
    for (let index = 0; index < 8; index += 1) seedEpisode(kernel, index);
    kernel.rebuildMemoryAtlas({ projectId: 'p' });
    const documentsAfterFullRebuild = kernel.memoryAtlasStore.countDocuments('p');

    const newEventId = seedEpisode(kernel, 99, '新的部署流程复盘，负责小组仍是青栎组。');
    const db = kernel.memoryAtlasStore.db as unknown as { prepare: (sql: string) => unknown };
    const prepare = db.prepare.bind(db);
    let documentsWritten = 0;
    db.prepare = (sql: string) => {
      if (/INSERT INTO memory_atlas_documents/i.test(sql)) documentsWritten += 1;
      return prepare(sql);
    };
    let result: { curatedEpisodes: number } = { curatedEpisodes: 0 };
    try {
      result = kernel.reindexMemoryAtlas({ projectId: 'p', eventId: newEventId });
    } finally {
      db.prepare = prepare;
    }

    expect(result.curatedEpisodes).toBe(1);
    // One episode is a handful of nodes. The full path would write every
    // document in the corpus, which is what made a targeted reindex a rebuild.
    expect(documentsWritten).toBeGreaterThan(0);
    expect(documentsWritten).toBeLessThan(documentsAfterFullRebuild);
    const episodeNode = kernel.memoryAtlasStore.db
      .prepare(`SELECT node_id FROM memory_atlas_documents WHERE project_id='p' AND node_type='episode'`)
      .all() as Array<{ node_id: string }>;
    expect(episodeNode.length).toBe(9);
  } finally {
    kernel.close();
  }
});

test('the incremental graph matches what a full rebuild produces', () => {
  const dbPath = join(makeTempDir('cogmem-atlas-equivalence-'), 'memory.db');
  const kernel = createKernelAt(dbPath);
  let incremental: { nodes: string[]; edges: string[] } = { nodes: [], edges: [] };
  try {
    for (let index = 0; index < 8; index += 1) seedEpisode(kernel, index);
    kernel.rebuildMemoryAtlas({ projectId: 'p' });
    const newEventId = seedEpisode(kernel, 99, '新的部署流程复盘，负责小组仍是青栎组。');
    kernel.reindexMemoryAtlas({ projectId: 'p', eventId: newEventId });
    incremental = canonicalGraph(kernel);
  } finally {
    kernel.close();
  }

  // Same database, full rebuild: the graph must not depend on which path built it.
  const copyPath = join(makeTempDir('cogmem-atlas-equivalence-copy-'), 'memory.db');
  copyFileSync(dbPath, copyPath);
  const rebuiltKernel = createKernelAt(copyPath);
  try {
    rebuiltKernel.rebuildMemoryAtlas({ projectId: 'p' });
    const full = canonicalGraph(rebuiltKernel);
    expect(incremental.nodes).toEqual(full.nodes);
    expect(incremental.edges).toEqual(full.edges);
  } finally {
    rebuiltKernel.close();
  }
});

test('reindex reports the projection state, not the intent of the call', () => {
  // `projectEpisodes` projects the canonical layer and leaves the dirty flag as
  // it found it, so `refreshed: true` was a claim about the call rather than
  // about the store. The two fields now agree with the projection state.
  const kernel = createKernelAt(join(makeTempDir('cogmem-reindex-state-'), 'memory.db'));
  try {
    const eventId = seedEpisode(kernel, 1, 'reindex target for the state assertion');
    // A project that owes a refresh is the case the old code reported wrongly:
    // it returned `refreshed: true` whatever the store said.
    kernel.memoryAtlasStore.markProjectionDirty('p', { reason: 'test' });
    const result = kernel.reindexMemoryAtlas({ projectId: 'p', eventId });
    const status = kernel.memoryAtlasStore.getProjectionState('p')?.status;
    expect(status).not.toBe('clean');
    expect({ refreshed: result.refreshed, owed: result.refreshOwed }).toEqual({ refreshed: false, owed: true });
  } finally {
    kernel.close();
  }
});
