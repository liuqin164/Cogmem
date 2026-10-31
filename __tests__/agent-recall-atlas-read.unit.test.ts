import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { makeTempDir } from './helpers/tmp.js';

function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(makeTempDir('cogmem-agent-atlas-read-'), 'memory.db') });
}

test('an ordinary recall reads the atlas once, not once per lane', async () => {
  const kernel = createKernel();
  try {
    await kernel.ingest({ projectId: 'p', content: 'The retry path policy is exponential backoff with jitter.' });

    const service = kernel.memoryAtlasService as unknown as { explore: (...args: unknown[]) => unknown };
    const originalExplore = service.explore.bind(service);
    let atlasReads = 0;
    service.explore = (...args: unknown[]) => {
      atlasReads += 1;
      return originalExplore(...args);
    };

    const result = new KernelAgentMemoryBackend(kernel).recall({
      agentId: 'a',
      projectId: 'p',
      query: 'what is the retry path policy',
      limit: 5,
    });

    expect(result.queryPlan?.intent).toBe('memory_recall');
    // The atlas is read for the cards the result merges. Reading it a second time
    // for a set only the other intents use doubled every recall's atlas cost.
    expect(atlasReads).toBe(1);
  } finally {
    kernel.close();
  }
});
