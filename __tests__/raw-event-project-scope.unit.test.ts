import { expect, test } from 'bun:test';
import { createMemoryKernel } from '../src/factory.js';

test('raw event stream versions and thread sequences are project scoped', () => {
  const kernel = createMemoryKernel();
  const base = { streamId: 'shared-stream', threadId: 'shared-thread', streamType: 'thread' as const, eventType: 'MESSAGE' as const, payload: { text: 'x' } };
  const a = kernel.eventStore.append({ ...base, projectId: 'a', eventVersion: 1 });
  const b = kernel.eventStore.append({ ...base, projectId: 'b', eventVersion: 1 });
  const global = kernel.eventStore.append({ ...base, projectId: '', eventVersion: 1 });

  expect([a.threadSeq, b.threadSeq, global.threadSeq]).toEqual([1, 1, 1]);
  expect(kernel.eventStore.getNextEventVersion('shared-stream', 'a')).toBe(2);
  expect(kernel.eventStore.getNextEventVersion('shared-stream', 'b')).toBe(2);
  expect(kernel.eventStore.getNextEventVersion('shared-stream', '')).toBe(2);
  expect(kernel.eventStore.getEventsByStreamId('shared-stream', 'a').map((event) => event.eventId)).toEqual([a.eventId]);
  expect(kernel.eventStore.getEventsByStreamId('shared-stream', '').map((event) => event.eventId)).toEqual([global.eventId]);
  kernel.close();
});

test('projectless import anchors remain idempotent', () => {
  const kernel = createMemoryKernel();
  const input = {
    streamId: 'projectless-import', streamType: 'import' as const, eventType: 'MESSAGE' as const,
    projectId: '', sourceId: 'transcript', contentHash: 'same-content',
    payload: { text: 'imported once', metadata: { importAnchor: 'line:1' } },
  };
  const first = kernel.eventStore.append(input);
  const second = kernel.eventStore.append(input);
  expect(second.eventId).toBe(first.eventId);
  expect(kernel.eventStore.getEventsByStreamId('projectless-import', '')).toHaveLength(1);
  kernel.close();
});
