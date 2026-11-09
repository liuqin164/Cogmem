import { describe, expect, it } from 'bun:test';
import Database from 'bun:sqlite';
import type { TraceEvent } from '../src/observability/TraceEvent.js';
import { TraceStore } from '../src/observability/TraceStore.js';

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    timestamp: overrides.timestamp ?? Date.now(),
    taskId: overrides.taskId,
    projectId: overrides.projectId,
    eventType: overrides.eventType ?? 'recall.request',
    payload: overrides.payload ?? { query: 'default' },
    parentEventId: overrides.parentEventId
  };
}

function makeStore(): { db: Database; store: TraceStore } {
  const db = new Database(':memory:');
  const store = new TraceStore(db);
  store.initSchema();
  return { db, store };
}

describe('TraceStore', () => {
  it('initSchema allows appending a trace event', () => {
    const { db, store } = makeStore();
    store.append(makeEvent({ taskId: 'task-1' }));

    const count = db.prepare('SELECT COUNT(*) AS count FROM trace_events').get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('queryByTaskId returns only events for the requested task', () => {
    const { store } = makeStore();
    store.append(makeEvent({ id: 'a', taskId: 'task-a' }));
    store.append(makeEvent({ id: 'b', taskId: 'task-b' }));

    expect(store.queryByTaskId('task-a').map((event) => event.id)).toEqual(['a']);
  });

  it('queryByEventType filters correctly', () => {
    const { store } = makeStore();
    store.append(makeEvent({ id: 'a', eventType: 'recall.request' }));
    store.append(makeEvent({ id: 'b', eventType: 'task_router.plan' }));

    expect(store.queryByEventType('task_router.plan').map((event) => event.id)).toEqual(['b']);
  });

  it('queryByProjectId filters correctly', () => {
    const { store } = makeStore();
    store.append(makeEvent({ id: 'a', projectId: 'proj-a' }));
    store.append(makeEvent({ id: 'b', projectId: 'proj-b' }));

    expect(store.queryByProjectId('proj-b').map((event) => event.id)).toEqual(['b']);
  });

  it('getDecisionChain follows parentEventId recursively', () => {
    const { store } = makeStore();
    store.append(makeEvent({ id: 'root', eventType: 'task_router.plan' }));
    store.append(makeEvent({ id: 'child', eventType: 'confidence_gate.decision', parentEventId: 'root' }));
    store.append(makeEvent({ id: 'leaf', eventType: 'risk_gate.decision', parentEventId: 'child' }));

    expect(store.getDecisionChain('leaf').map((event) => event.id)).toEqual(['root', 'child', 'leaf']);
  });

  it('append is immediately queryable after synchronous write', () => {
    const { store } = makeStore();
    store.append(makeEvent({ id: 'sync-event', taskId: 'sync-task' }));

    expect(store.queryByTaskId('sync-task')[0]?.id).toBe('sync-event');
  });

  it('serializes and deserializes JSON payloads correctly', () => {
    const { store } = makeStore();
    store.append(makeEvent({
      id: 'json-event',
      taskId: 'json-task',
      payload: {
        query: 'hello',
        factCount: 3,
        nested: { verdict: 'cpu_resolved' }
      }
    }));

    expect(store.queryByTaskId('json-task')[0]?.payload).toEqual({
      query: 'hello',
      factCount: 3,
      nested: { verdict: 'cpu_resolved' }
    });
  });

  it('returns an empty array when no task events exist', () => {
    const { store } = makeStore();
    expect(store.queryByTaskId('missing')).toEqual([]);
  });

  it('orders task queries by timestamp ascending', () => {
    const { store } = makeStore();
    store.append(makeEvent({ id: 'later', taskId: 'ordered', timestamp: 20 }));
    store.append(makeEvent({ id: 'earlier', taskId: 'ordered', timestamp: 10 }));

    expect(store.queryByTaskId('ordered').map((event) => event.id)).toEqual(['earlier', 'later']);
  });

  it('pruneToLimit keeps the newest rows and reports how many it deleted', () => {
    const { store } = makeStore();
    for (let timestamp = 1; timestamp <= 5; timestamp += 1) {
      store.append(makeEvent({ id: `e${timestamp}`, timestamp }));
    }

    expect(store.pruneToLimit(2)).toBe(3);
    expect(store.queryByEventType('recall.request').map((event) => event.id)).toEqual(['e4', 'e5']);
    // Nothing to do when the table is already inside the cap.
    expect(store.pruneToLimit(2)).toBe(0);
  });
});
