import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';

test('maintenance deterministically refreshes Atlas and decays navigation activation', () => {
  const kernel = createMemoryKernel({ dbPath: join(mkdtempSync(join(tmpdir(), 'cogmem-atlas-maintenance-')), 'memory.db') });
  try {
    kernel.memoryBindingStore.upsertEntity({ projectId: 'cogmem', canonicalName: 'Hermes', entityType: 'project' });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    kernel.graphSearch('Hermes', { projectId: 'cogmem' });
    const result = kernel.runMaintenanceTick({ projectId: 'cogmem', activationDecayFactor: 0.5, now: 1000 });
    expect(result.executed.memoryAtlasRefresh.documents).toBeGreaterThan(0);
    expect(result.executed.memoryAtlasActivationDecay).toBeGreaterThan(0);
    expect(result.executed.hiddenDaemonStarted).toBe(false);
  } finally { kernel.close(); }
});
