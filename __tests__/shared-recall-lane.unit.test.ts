import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #67: shared memory arriving automatically must be a labelled reference, never something that looks
 * like this agent's own memory, and it must not take the budget the agent's own memory was using.
 */
function fixture() {
  const dir = makeTempDir('cogmem-shared-lane-');
  const kernel = createMemoryKernel({
    dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec', sharedEnabled: true,
  });
  return { kernel, backend: new KernelAgentMemoryBackend(kernel), dir };
}

async function seedPrivate(backend: KernelAgentMemoryBackend, agentId: string, texts: string[]) {
  for (const [index, text] of texts.entries()) {
    await backend.rememberTurn({
      agentId, sessionId: `${agentId}-s1`, projectId: 'project-a', turnId: `${agentId}-t${index}`,
      userText: text, assistantText: 'noted', timestamp: Date.UTC(2026, 0, 1, 0, index),
    });
  }
}

function publishFrom(kernel: ReturnType<typeof createMemoryKernel>, host: string, collection: string, texts: string[]) {
  return kernel.publishShared(texts.map((text, index) => ({
    itemHash: `${collection}-${index}`, sourceHost: host, sourceItem: `s${index}`, collection,
    payload: { text }, publishedAt: Date.UTC(2026, 0, 2, 0, index),
  })));
}

test('shared items carry their source host and collection, and are not private memory', async () => {
  const { kernel, backend } = fixture();
  try {
    await seedPrivate(backend, 'hermes', ['Deploy window is Tuesday.']);
    await publishFrom(kernel, 'claude', 'team-standards', ['We standardised on pnpm.']);
    await kernel.grantSharedReader('team-standards', 'hermes', 'claude');

    const result = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'deploy window tuesday', limit: 5 });
    const shared = result.items.filter((item) => item.shared);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({
      source: 'shared_memory',
      shared: { sourceHost: 'claude', collection: 'team-standards' },
      text: 'We standardised on pnpm.',
    });
    expect(shared[0]!.tags).toContain('shared_host:claude');
    // Distinguishable from this agent's own memory: the private item carries no `shared` marker.
    const priv = result.items.filter((item) => !item.shared);
    expect(priv.length).toBeGreaterThan(0);
    expect(result.decisionTrace?.sharedCount).toBe(1);
  } finally {
    kernel.close();
  }
});

test('a retracted item stops being recalled, and every shared collection is readable (#146)', async () => {
  const { kernel, backend } = fixture();
  try {
    await seedPrivate(backend, 'hermes', ['Deploy window is Tuesday.', 'Shared too, while sharing is on.']);
    await publishFrom(kernel, 'claude', 'team-standards', ['We standardised on pnpm.']);
    await publishFrom(kernel, 'claude', 'claude-private-notes', ['Shared too, while sharing is on.']);

    const before = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'standardised pnpm', limit: 5 });
    // Presence of the collection, not a total: while sharing is on every readable collection may contribute (#146).
    expect(before.items.some((item) => item.shared?.collection === 'team-standards')).toBe(true);
    // No grant is involved any more (#146), and this is asserted where the decision puts it — on subscribe, not on a
    // private-lane recall whose relevance filter is a different question.
    expect((await kernel.subscribeShared(['claude-private-notes'], 'hermes')).length).toBeGreaterThan(0);
    expect((await kernel.subscribeShared(['claude-private-notes'], 'openclaw')).length).toBeGreaterThan(0);

    await kernel.retractShared({ itemHash: 'team-standards-0', retractedAt: Date.UTC(2026, 0, 3), retractedBy: 'claude' });
    const after = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'standardised pnpm', limit: 5 });
    // The retracted item is gone from the lane immediately, which is the case the decision names.
    expect(after.items.some((item) => item.shared?.collection === 'team-standards')).toBe(false);
  } finally {
    kernel.close();
  }
});

test('the shared lane has its own budget and never displaces private memory', async () => {
  const { kernel, backend } = fixture();
  try {
    await seedPrivate(backend, 'hermes', ['Alpha deploy fact.', 'Beta deploy fact.', 'Gamma deploy fact.']);

    const limit = 5;
    // Before anything is shared, this is the private result the agent owns.
    const before = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'deploy fact', limit });
    expect(before.items.filter((item) => item.shared)).toHaveLength(0);
    const privateIds = before.items.map((item) => item.id);

    // Five shared items arrive: more than the derived budget (a third of 5, rounded up = 2).
    await publishFrom(kernel, 'claude', 'team-standards', ['S1', 'S2', 'S3', 'S4', 'S5']);
    await kernel.grantSharedReader('team-standards', 'hermes', 'claude');
    const flooded = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'deploy fact', limit });
    expect(flooded.decisionTrace?.sharedCount).toBe(2);
    expect(flooded.decisionTrace?.sharedDropped).toBeGreaterThan(0);
    // The private slots are byte-identical to the unflooded run: shared items were appended, not merged.
    expect(flooded.items.filter((item) => !item.shared).map((item) => item.id)).toEqual(privateIds);

  } finally {
    kernel.close();
  }
});

test('a configured fitted budget is honoured instead of the derived default', async () => {
  const dir = makeTempDir('cogmem-shared-lane-fitted-');
  const fitted = createMemoryKernel({
    dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec', sharedEnabled: true, sharedRecallLimit: 1,
  });
  try {
    const fittedBackend = new KernelAgentMemoryBackend(fitted);
    await seedPrivate(fittedBackend, 'hermes', ['Deploy window is Tuesday.']);
    await publishFrom(fitted, 'claude', 'team-standards', ['S1', 'S2', 'S3']);
    await fitted.grantSharedReader('team-standards', 'hermes', 'claude');
    const capped = fittedBackend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'deploy window', limit: 5 });
    expect(capped.decisionTrace?.sharedCount).toBe(1);
    expect(capped.decisionTrace?.sharedDropped).toBe(1);
  } finally {
    fitted.close();
  }
});
