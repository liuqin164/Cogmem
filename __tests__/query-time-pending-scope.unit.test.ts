import { expect, test } from 'bun:test';
import { QueryTimePendingEntityResolver } from '../src/retrieval/QueryTimePendingEntityResolver.js';

test('query-time pending resolution never falls back across project scope', () => {
  const requested: Array<string | undefined> = [];
  const store = {
    listPendingResolutions: ({ projectId }: { projectId?: string }) => {
      requested.push(projectId);
      return projectId === 'a'
        ? []
        : [{ pendingId: `p-${projectId}`, referenceText: '之前那个设备', entityType: 'device', contextNeuronId: `n-${projectId}`, status: 'pending', createdAt: 1, updatedAt: 1 }];
    },
    listReferenceCandidatesWithRelativeSupport: () => [],
  };
  const resolver = new QueryTimePendingEntityResolver(store as never, () => null, () => undefined);
  const input = {
    query: '之前那个设备',
    ir: { entities: ['之前那个设备'], semantics: { entityHints: [] } },
    semanticCompilation: { relativeReferences: ['之前那个设备'] },
    baseEntityResolution: { disambiguation: [] },
  } as never;
  expect(resolver.resolve({ ...input, projectId: 'a' }).candidateEntityIds).toEqual([]);
  expect(resolver.resolve({ ...input, projectId: '' }).results[0]?.matchedPendingIds).toEqual(['p-']);
  expect(requested).toEqual(['a', '']);
});
