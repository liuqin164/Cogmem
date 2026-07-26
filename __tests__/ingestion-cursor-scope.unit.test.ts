import { expect, test } from 'bun:test';
import { IngestionCursorStore } from '../src/batch/IngestionCursorStore.js';

test('ingestion cursor and dedup identities are project scoped', () => {
  const store = new IngestionCursorStore(':memory:');
  for (const projectId of ['a', 'b', '']) {
    store.registerSource({ sourceId: 'same', sourcePath: `/${projectId || 'global'}`, adapterKind: 'conversation_markdown', projectId });
    store.markRecordProcessed({
      recordHash: 'same-hash', sourceId: 'same', sourcePath: '/', sourceType: 'conversation_markdown',
      projectId, contentHash: 'content', contentWindowStart: 0, contentWindowEnd: 1, processedAt: 1,
    });
  }
  expect(store.getCursor('same', 'a')?.sourcePath).toBe('/a');
  expect(store.getCursor('same', 'b')?.sourcePath).toBe('/b');
  expect(store.getCursor('same', '')?.projectId).toBe('');
  expect(store.listProcessedRecordHashes('same', 0, 1, 'a')).toEqual(new Set(['same-hash']));
  expect(store.listProcessedRecordHashes('same', 0, 1, 'b')).toEqual(new Set(['same-hash']));
  store.close();
});
