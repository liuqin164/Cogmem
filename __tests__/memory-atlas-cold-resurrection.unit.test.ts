import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';

// ADR 0001: activation decay controls visibility, never existence. A memory that
// nothing has touched for a year must still come back when its facet matches.
test('a memory whose activation has decayed to nothing is still found by its facet', () => {
  const kernel = createMemoryKernel({ dbPath: join(mkdtempSync(join(tmpdir(), 'cogmem-cold-resurrection-')), 'memory.db') });
  try {
    kernel.memoryBindingStore.upsertEntity({ projectId: 'cogmem', canonicalName: 'Hermes', entityType: 'project' });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const warm = kernel.graphSearch('Hermes', { projectId: 'cogmem' });
    expect(warm.nodes.length).toBeGreaterThan(0);
    const nodeId = warm.nodes[0]!.id;

    // Give the node real activation, then let maintenance decay it to nothing.
    kernel.touchMemoryAtlas({ projectId: 'cogmem', nodeIds: [nodeId], reason: 'used_in_answer', now: 1 });
    const day = 24 * 60 * 60 * 1000;
    for (let tick = 0; tick < 40; tick += 1) {
      kernel.runMaintenanceTick({ projectId: 'cogmem', activationDecayFactor: 0.5, now: (tick + 2) * day });
    }

    const activation = kernel.memoryAtlasStore.db
      .prepare(`SELECT activation FROM memory_atlas_activation WHERE project_id = ? AND node_id = ?`)
      .get('cogmem', nodeId) as { activation: number } | null;
    if (activation) expect(activation.activation).toBeLessThan(1e-6);

    const cold = kernel.graphSearch('Hermes', { projectId: 'cogmem' });
    expect(cold.nodes.map((node) => node.id)).toContain(nodeId);
  } finally {
    kernel.close();
  }
});
