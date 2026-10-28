import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(makeTempDir('cogmem-atlas-related-read-'), 'memory.db') });
}

function seedEpisode(kernel: MemoryKernel, id: string, label: string, projectId = 'p'): void {
  kernel.memoryAtlasStore.upsertDocument({
    id: `episode:${id}`,
    projectId,
    nodeType: 'episode',
    sourceId: id,
    label,
    summary: label,
    confidence: 0.9,
    supportCount: 1,
    status: 'active',
    occurredAt: Date.UTC(2026, 5, 5, 12, 22),
    evidenceEventIds: [],
  });
}

function addEdge(kernel: MemoryKernel, edgeId: string, sourceId: string, targetId: string, relation: string, projectId = 'p'): void {
  kernel.memoryAtlasStore.db.prepare(`
    INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,base_weight,stability,activation,
      evidence_event_ids_json,status,valid_from,valid_to,version,source_authority,created_at,updated_at
    ) VALUES (?,?,'episode',?,?,'episode',?,1,1,1,0,'[]','active',?,NULL,1,'test',?,?)
  `).run(edgeId, projectId, sourceId, relation, targetId, Date.UTC(2026, 5, 5), Date.UTC(2026, 5, 5), Date.UTC(2026, 5, 5));
}

/** Every plan line that touches the edge table, produced by the read under test. */
function captureEdgePlans(kernel: MemoryKernel, run: () => void): string[] {
  const db = kernel.memoryAtlasStore.db as unknown as { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } };
  const prepare = db.prepare.bind(db);
  const plans: string[] = [];
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (/^\s*SELECT/i.test(sql) && sql.includes('memory_edges')) {
      const all = statement.all.bind(statement);
      statement.all = (...args: unknown[]) => {
        plans.push(...(prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map((row) => row.detail));
        return all(...args);
      };
    }
    return statement;
  };
  try {
    run();
  } finally {
    db.prepare = prepare;
  }
  return plans;
}

test('related episodes are read by an index seek on the anchor, not a project-wide edge scan', () => {
  const kernel = createKernel();
  try {
    seedEpisode(kernel, 'anchor', 'Anchor episode');
    seedEpisode(kernel, 'followup', 'Follow-up episode');
    addEdge(kernel, 'edge-followup', 'anchor', 'followup', 'FOLLOWS_UP');
    // Unrelated edges make a project-wide index scan the visible cost it is on a
    // real corpus, and keep the planner's choice between seek and scan honest.
    for (let index = 0; index < 2000; index += 1) {
      addEdge(kernel, `edge-noise-${index}`, `noise-${index}`, `noise-target-${index}`, 'RELATED_TO');
    }

    let related: Array<{ canonicalId: string; reason: string }> = [];
    const plans = captureEdgePlans(kernel, () => {
      related = kernel.memoryAtlasStore.relatedEpisodeCards('p', 'episode:anchor', new Set(), 4);
    });

    expect(related).toEqual([{ canonicalId: 'episode:followup', displayTitle: 'Follow-up episode', reason: 'follows_up' }]);

    const edgeLines = plans.filter((line) => line.includes('memory_edges'));
    expect(edgeLines.length).toBeGreaterThan(0);
    // A scan narrowed only by project_id is the shape that cost 34 ms per call
    // and 1.6 s per recall on the year-scale corpus.
    expect(edgeLines.every((line) => /(source_id|target_id)=\?/.test(line))).toBe(true);
  } finally {
    kernel.close();
  }
});
