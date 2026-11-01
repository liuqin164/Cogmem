import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { normalizeEpisodeKind } from '../src/semantic/MemoryFrameTypes.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * Found by running the compile chain end to end on a diverse corpus: `frame-backfill`
 * wrote 112 frames and then threw `invalid_memory_frame:invalid_episode_kind`, leaving
 * every episode after that one unbackfilled with no record of which one stopped it.
 *
 * Two things were wrong, and the second is the one that turned a bad frame into a lost
 * batch: the fallback builder passed an episode type it did not recognise straight through
 * (the enum keeps `other` for exactly this), and the batch had no way to skip an episode.
 */

test('an episode type the frame layer does not know becomes "other" (#134)', () => {
  expect(normalizeEpisodeKind('prospective')).toBe('other');
  expect(normalizeEpisodeKind('decision')).toBe('decision');
  expect(normalizeEpisodeKind(undefined)).toBe('other');
  expect(normalizeEpisodeKind(42)).toBe('other');
});

test('a backfill survives an episode it cannot frame, and says which (#134)', () => {
  const dir = makeTempDir('cogmem-frame-kind-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  const now = Date.now();
  for (const [session, text] of [['s1', '归档保留期定成七年。'], ['s2', '限流阈值定在每秒八百次。']] as const) {
    kernel.appendEpisodeMessage({ projectId: 'p', sessionId: session, sourceAgent: 'a', role: 'user', text, timestamp: now - 3_600_000 });
  }
  // An episode type outside the enum, which is what the corpus produced.
  const db = new Database(dbPath);
  db.prepare("UPDATE memory_episodes SET episode_type = 'prospective'").run();
  db.close();

  const result = kernel.backfillMemoryFrames({ projectId: 'p', limit: 50 });
  // Neither episode is lost, and the unknown kind did not abort the page.
  expect(result.failed).toBe(0);
  expect(result.created).toBe(2);
  // Both episodes got a frame, and the unknown kind became the enum's own escape hatch.
  const episodes = kernel.listEpisodes({ projectId: 'p', limit: 10 });
  expect(episodes.length).toBe(2);
  for (const episode of episodes) {
    const frame = kernel.getMemoryFrame(episode.episodeId, 'p', { includeStaged: true });
    expect(frame?.episodeKind).toBe('other');
  }
  kernel.close();
});
