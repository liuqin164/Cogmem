import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/** A kernel of its own, in its own directory: no shared state between cases. */
function kernel(sharedEnabled: boolean): { kernel: ReturnType<typeof createMemoryKernel> } {
  const dir = makeTempDir('cogmem-kernel-shared-');
  const built = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec', sharedEnabled });
  return { kernel: built };
}

const item = (over: Record<string, unknown> = {}) => ({
  itemHash: 'h1', sourceHost: 'claude', sourceItem: 's1', collection: 'team-standards',
  payload: { t: 'deploy window is Tuesday' }, publishedAt: 1, ...over,
});

/**
 * #63: the shared methods live on the kernel, so MCP tools and host plugins reach the same code, and
 * the switch is enforced here rather than trusted to each surface.
 */
test('a kernel with sharing off refuses to write and reads nothing', async () => {
  const { kernel: k } = kernel(false);
  try {
    expect(k.sharedEnabled).toBe(false);
    await expect(k.publishShared([item()])).rejects.toThrow(/shared_disabled/);
    await expect(k.grantSharedReader('team-standards', 'hermes', 'claude')).rejects.toThrow(/shared_disabled/);
    expect(await k.subscribeShared(['team-standards'], 'claude')).toEqual([]);
    expect(await k.listSharedCollections()).toEqual([]);
  } finally {
    k.close();
  }
});

test('with sharing on, publishing, reading, granting and revoking behave as the ACL says', async () => {
  const { kernel: k } = kernel(true);
  try {
    expect(await k.publishShared([item()])).toBe(1);
    // The owner reads; a third host that knows the name does not.
    expect(await k.subscribeShared(['team-standards'], 'claude')).toHaveLength(1);
    expect(await k.subscribeShared(['team-standards'], 'hermes')).toEqual([]);
    expect(await k.subscribeShared(['team-standards'], undefined)).toEqual([]);
    expect(await k.listSharedCollections()).toMatchObject([
      { collection: 'team-standards', ownerHost: 'claude', readers: [], itemCount: 1 },
    ]);
    await k.grantSharedReader('team-standards', 'hermes', 'claude');
    expect(await k.subscribeShared(['team-standards'], 'hermes')).toHaveLength(1);
    await k.revokeSharedReader('team-standards', 'hermes', 'claude');
    expect(await k.subscribeShared(['team-standards'], 'hermes')).toEqual([]);
  } finally {
    k.close();
  }
});

test('a retraction takes effect for readers and stays explainable for the publisher', async () => {
  const { kernel: k } = kernel(true);
  try {
    await k.publishShared([item()]);
    await k.grantSharedReader('team-standards', 'hermes', 'claude');
    await k.retractShared({ itemHash: 'h1', retractedAt: 2, retractedBy: 'claude' });
    expect(await k.subscribeShared(['team-standards'], 'hermes')).toEqual([]);
    // The history is not rewritten: the publisher can still explain what happened.
    expect(await k.explainShared('h1')).toMatchObject({ retractedAt: 2 });
  } finally {
    k.close();
  }
});
