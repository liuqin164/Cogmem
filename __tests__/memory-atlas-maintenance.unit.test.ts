import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';

test('maintenance skips a clean Atlas, decays explicit-use activation, and prunes old telemetry', () => {
  const kernel = createMemoryKernel({ dbPath: join(mkdtempSync(join(tmpdir(), 'cogmem-atlas-maintenance-')), 'memory.db') });
  try {
    kernel.memoryBindingStore.upsertEntity({ projectId: 'cogmem', canonicalName: 'Hermes', entityType: 'project' });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const node = kernel.graphSearch('Hermes', { projectId: 'cogmem' }).nodes[0]!;
    kernel.touchMemoryAtlas({ projectId: 'cogmem', nodeIds: [node.id], reason: 'used_in_answer', now: 100 });
    kernel.memoryAtlasStore.db.prepare(`UPDATE memory_atlas_access SET accessed_at=0`).run();
    const result = kernel.runMaintenanceTick({ projectId: 'cogmem', activationDecayFactor: 0.5, now: 100 * 24 * 60 * 60 * 1000 });
    expect(result.executed.memoryAtlasRefresh.documents).toBeGreaterThan(0);
    expect(result.executed.memoryAtlasRefresh.refreshed).toBe(false);
    expect(result.executed.memoryAtlasActivationDecay).toBeGreaterThan(0);
    expect(result.executed.memoryAtlasAccessPruned).toBe(1);
    expect(result.executed.hiddenDaemonStarted).toBe(false);
  } finally { kernel.close(); }
});
