import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { createSqlitePorts } from '../src/adapters/sqlite/SqliteMemoryPorts.js';
import type { BrainRecall } from '../src/recall/BrainRecall.js';
import type { MemoryGovernanceExecutor } from '../src/governance/MemoryGovernanceExecutor.js';

function freshPorts() {
  const db = new Database(':memory:');
  return { db, ports: createSqlitePorts({ db }) };
}

const eventInput = (n: number) => ({
  streamId: `stream-${n}`,
  streamType: 'system' as const,
  eventType: 'RAW_EVENT_RECORDED' as const,
  projectId: 'p1',
  sessionId: 's1',
  occurredAt: 1_700_000_000_000 + n,
  payload: { text: `turn ${n}` },
});

describe('RawLedgerPort', () => {
  test('appends and reads back one event', async () => {
    const { ports } = freshPorts();
    const written = await ports.rawLedger.appendEvent(eventInput(1));

    expect(written.eventId).toBeTruthy();
    expect(written.globalSeq).toBeGreaterThan(0);

    const read = await ports.rawLedger.getEvent(written.eventId);
    expect(read?.eventId).toBe(written.eventId);
    expect(read?.payload.text).toBe('turn 1');
  });

  test('batch append lands every row and is ordered by global sequence', async () => {
    const { ports } = freshPorts();
    const written = await ports.rawLedger.appendBatch([1, 2, 3].map(eventInput));

    expect(written).toHaveLength(3);
    const seqs = written.map((e) => e.globalSeq as number);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    const listed = await ports.rawLedger.listBySeq(1);
    expect(listed).toHaveLength(3);
    expect(listed.map((e) => e.payload.text)).toEqual(['turn 1', 'turn 2', 'turn 3']);
    expect(await ports.rawLedger.count()).toBe(3);
  });

  test('listBySeq honours an inclusive upper bound', async () => {
    const { ports } = freshPorts();
    await ports.rawLedger.appendBatch([1, 2, 3].map(eventInput));
    const all = await ports.rawLedger.listBySeq(1);
    const firstTwo = await ports.rawLedger.listBySeq(1, all[1].globalSeq);

    expect(firstTwo).toHaveLength(2);
    expect(firstTwo[1].eventId).toBe(all[1].eventId);
  });

  test('unknown event id returns null rather than throwing', async () => {
    const { ports } = freshPorts();
    expect(await ports.rawLedger.getEvent('does-not-exist')).toBeNull();
  });
});

describe('EpisodePort', () => {
  test('creates, links an event, seals, and reloads an episode', async () => {
    const { ports } = freshPorts();
    const event = await ports.rawLedger.appendEvent(eventInput(1));

    const created = await ports.episodes.create({
      projectId: 'p1',
      sessionId: 's1',
      episodeType: 'discussion',
      importance: 0.5,
      eventId: event.eventId,
      globalSeq: event.globalSeq,
      occurredAt: event.occurredAt,
    });

    expect(created.episodeId).toBeTruthy();
    expect(created.status).toBe('open');

    await ports.episodes.appendEvent({
      episodeId: created.episodeId,
      eventId: event.eventId,
      relation: 'continues_previous',
      confidence: 1,
      globalSeq: event.globalSeq,
      occurredAt: event.occurredAt,
      summaryText: 'turn 1',
    });

    const sealed = await ports.episodes.seal(created.episodeId, {
      mode: 'manual',
      reason: 'test seal',
      now: 1_700_000_100_000,
    });
    expect(sealed.status).toBe('sealed');

    const reloaded = await ports.episodes.get(created.episodeId);
    expect(reloaded?.status).toBe('sealed');
  });

  test('sealing an empty episode fails instead of producing an empty seal', async () => {
    const { ports } = freshPorts();
    const created = await ports.episodes.create({
      projectId: 'p1',
      sessionId: 's1',
      episodeType: 'discussion',
      importance: 0.5,
      eventId: 'evt-empty',
      occurredAt: 1_700_000_000_000,
    });

    await expect(
      ports.episodes.seal(created.episodeId, { mode: 'manual', reason: 'empty' }),
    ).rejects.toThrow(/episode_empty/);
  });

  test('missing episode returns null', async () => {
    const { ports } = freshPorts();
    expect(await ports.episodes.get('nope')).toBeNull();
  });
});

/**
 * Delegation tests. These prove the adapter forwards calls and returns results
 * untouched; they do not exercise BrainRecall or the governance executor.
 */
describe('RecallPort and GovernancePort wiring', () => {
  test('recall forwards the query and options, and returns the engine result', async () => {
    const seen: unknown[] = [];
    const engine = {
      recallAsync: async (query: string, options: unknown) => {
        seen.push([query, options]);
        return { query, neurons: [], facts: [] } as never;
      },
    } as unknown as BrainRecall;

    const { db } = freshPorts();
    const ports = createSqlitePorts({ db, recall: engine });

    const result = await ports.recall!.recall('why seekdb', { projectId: 'p1', limit: 5 });

    expect(seen).toEqual([['why seekdb', { projectId: 'p1', limit: 5 }]]);
    expect(result).toEqual({ query: 'why seekdb', neurons: [], facts: [] });
  });

  test('recall is absent when no engine is supplied', () => {
    const { ports } = freshPorts();
    expect(ports.recall).toBeNull();
  });

  test('governance returns the executor result untouched', async () => {
    const plan = { planId: 'plan-1', operations: [] };
    const executor = {
      execute: (received: unknown) => ({ ok: true, received }) as never,
    } as unknown as MemoryGovernanceExecutor;

    const { db } = freshPorts();
    const ports = createSqlitePorts({ db, governance: executor });

    const result = await ports.governance!.commit(plan as never);

    expect(result).toEqual({ ok: true, received: plan });
  });
});
