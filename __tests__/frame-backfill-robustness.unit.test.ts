import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryAtlasService } from '../src/atlas/MemoryAtlasService.js';
import { createMemoryKernel } from '../src/factory.js';
import type { EventStore } from '../src/store/EventStore.js';
import type { MemoryAtlasStore } from '../src/store/MemoryAtlasStore.js';
import type { MemoryAtlasEdge, MemoryAtlasNode } from '../src/atlas/MemoryAtlasTypes.js';
import { normalizeEpisodeKind } from '../src/semantic/MemoryFrameTypes.js';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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

test('a staged frame is reported as staged, not as no frame at all (#143)', async () => {
  // `frame-backfill` answers `created: 2, needsReview: 2`, and the read that follows answered
  // `memory_frame_not_found` — three different facts (no frame / staged frame / active frame)
  // collapsed into one, with no hint at the flag that reveals the staged one.
  const dir = makeTempDir('cogmem-frame-staged-');
  const configDir = join(dir, '.cogmem');
  mkdirSync(configDir, { recursive: true });
  const dbPath = join(configDir, 'memory.db');
  writeFileSync(join(configDir, 'config.toml'), '[core]\ndb_path = "memory.db"\n');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  kernel.appendEpisodeMessage({ projectId: 'p', sessionId: 's1', sourceAgent: 'a', role: 'user', text: '归档保留期定成七年。', timestamp: Date.now() - 3_600_000 });
  const backfill = kernel.backfillMemoryFrames({ projectId: 'p', limit: 50 });
  expect(backfill.created).toBe(1);
  const episodeId = kernel.listEpisodes({ projectId: 'p', limit: 1 })[0]!.episodeId;
  kernel.close();

  const read = (extra: string[]) => Bun.spawnSync({
    cmd: ['bun', join(coreRoot, 'src', 'bin', 'memory.ts'), 'frame', '--project', 'p', '--episode', episodeId, '--config', join(configDir, 'config.toml'), '--json', ...extra],
    cwd: coreRoot, stdout: 'pipe', stderr: 'pipe',
  });
  const staged = read([]);
  const text = new TextDecoder().decode(staged.stdout) + new TextDecoder().decode(staged.stderr);
  expect(staged.exitCode).toBe(1);
  expect(text).toContain('memory_frame_not_active');
  expect(text).toContain('--include-staged');

  const revealed = read(['--include-staged']);
  expect(revealed.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(revealed.stdout)).episodeId).toBe(episodeId);

  // And without --json the same read has to say something: `memory frame` had no human
  // rendering, so a successful read printed nothing at all.
  const human = Bun.spawnSync({
    cmd: ['bun', join(coreRoot, 'src', 'bin', 'memory.ts'), 'frame', '--project', 'p', '--episode', episodeId, '--config', join(configDir, 'config.toml'), '--include-staged'],
    cwd: coreRoot, stdout: 'pipe', stderr: 'pipe',
  });
  expect({ exitCode: human.exitCode, printed: new TextDecoder().decode(human.stdout).trim().length > 0 }).toEqual({ exitCode: 0, printed: true });
});

test('reviewing a staged frame names the state and the step that changes it (#144)', async () => {
  // The store answered a bare `false` for "not in a reviewable state", so `frame-review`
  // reported `applied: false` and nothing else — the same collapse of different facts that the
  // staged-frame read had. Its evidence and conflict cases already threw named errors.
  const dir = makeTempDir('cogmem-frame-review-state-');
  const configDir = join(dir, '.cogmem');
  mkdirSync(configDir, { recursive: true });
  const dbPath = join(configDir, 'memory.db');
  writeFileSync(join(configDir, 'config.toml'), '[core]\ndb_path = "memory.db"\n');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  kernel.appendEpisodeMessage({ projectId: 'p', sessionId: 's1', sourceAgent: 'a', role: 'user', text: '归档保留期定成七年。', timestamp: Date.now() - 3_600_000 });
  kernel.backfillMemoryFrames({ projectId: 'p', limit: 50 });
  const episodeId = kernel.listEpisodes({ projectId: 'p', limit: 1 })[0]!.episodeId;
  const frameId = kernel.getMemoryFrame(episodeId, 'p', { includeStaged: true })!.frameId;
  kernel.close();

  const review = Bun.spawnSync({
    cmd: ['bun', join(coreRoot, 'src', 'bin', 'memory.ts'), 'frame-review', '--project', 'p', '--id', frameId, '--action', 'approve', '--actor', 'op', '--reason', 'probe', '--config', join(configDir, 'config.toml'), '--json'],
    cwd: coreRoot, stdout: 'pipe', stderr: 'pipe',
  });
  const text = new TextDecoder().decode(review.stdout) + new TextDecoder().decode(review.stderr);
  expect(review.exitCode).toBe(1);
  expect(text).toContain('memory_frame_review_not_applicable');
  expect(text).toContain('staged');
  expect(text).toContain('--mode active');
});

test('an overview that hides the relations behind its node budget says so (#145)', () => {
  // Every edge of a frame-sourced projection starts at an episode, and an episode ranks last
  // on support_count — so the default 8-node overview of a connected project reported
  // `nodes: 8, edges: 0` while `--limit 20` reported `nodes: 19, edges: 24`. An empty edges
  // array was the only signal, and it reads as "this project has no relations".
  const node = (id: string): MemoryAtlasNode => ({ id, projectId: 'p', type: 'time', label: id, aliases: [], evidenceEventIds: [], confidence: 1, supportCount: 1 } as unknown as MemoryAtlasNode);
  const ambient = ['time:1', 'time:2', 'session:1', 'thread:1'].map(node);
  const edge = { id: 'e1', projectId: 'p', source: 'episode:1', target: 'raw_event:1', relationType: 'PART_OF_EVENT', confidence: 0.7, evidenceEventIds: ['evt-1'] } as unknown as MemoryAtlasEdge;
  const store = {
    // the budget is spent on nodes no relation touches, which is the shape the box produced
    listNodes: () => ambient,
    listEdgesWithinNodes: () => [],
    listEdges: () => [edge],
    getNode: (id: string) => node(id),
  } as unknown as MemoryAtlasStore;
  const service = new MemoryAtlasService(store, { getEvent: () => ({ projectId: 'p' }) } as unknown as EventStore);

  const hidden = service.overview({ projectId: 'p', limit: 8 });
  expect(hidden.edges).toEqual([]);
  expect(hidden.warnings.join(' ')).toContain('edges_hidden_by_node_budget');
  expect(hidden.warnings.join(' ')).toContain('--limit');

  // and with the relations inside the budget the warning is not there
  const internal = { ...edge, source: 'time:1', target: 'time:2' } as unknown as MemoryAtlasEdge;
  const shown = new MemoryAtlasService({ ...store, listEdgesWithinNodes: () => [internal], listEdges: () => [internal] } as unknown as MemoryAtlasStore, { getEvent: () => ({ projectId: 'p' }) } as unknown as EventStore)
    .overview({ projectId: 'p', limit: 8 });
  expect(shown.edges).toHaveLength(1);
  expect(shown.warnings).toEqual([]);
});

test('the frame-stamp report names exactly the frames whose episode changed (#110)', () => {
  // The read-only half of #110: compare every active frame's stored `source_fingerprint` with
  // the fingerprint of its episode's events as they stand now. Nothing may be written by it.
  const dir = makeTempDir('cogmem-frame-stamp-');
  const configDir = join(dir, '.cogmem');
  mkdirSync(configDir, { recursive: true });
  const dbPath = join(configDir, 'memory.db');
  writeFileSync(join(configDir, 'config.toml'), '[core]\ndb_path = "memory.db"\n');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  const now = Date.now();
  for (const [index, text] of ['归档保留期定成七年，第八年统一销毁。', '这条决定来自合规评审，记录在案。'].entries()) {
    kernel.appendEpisodeMessage({ projectId: 'p', sessionId: 's1', sourceAgent: 'a', role: 'user', text, timestamp: now - 3_600_000 + index * 1000 });
  }
  kernel.backfillMemoryFrames({ projectId: 'p', limit: 50 });
  const episodeId = kernel.listEpisodes({ projectId: 'p', limit: 1 })[0]!.episodeId;
  const frame = kernel.getMemoryFrame(episodeId, 'p', { includeStaged: true })!;
  // A rule-backfilled frame starts `staged`; publishing it moves it to the state the publish
  // status names. It cannot reach `active` in a unit test (approval needs publishable evidence,
  // which is what a model frame has), so the scan is widened to the status it can hold.
  expect(kernel.memoryFrameStore.publish(frame.frameId, frame.status)).toBe(true);

  // A rule-backfilled frame cannot reach `active` in a unit test — approval needs publishable
  // evidence, which is what a model frame has — so the scan is widened to the status this
  // frame can hold. The default (`active`) is the set the projector projects.
  const scan = () => kernel.memoryFrameStore.listStaleFrames({ projectId: 'p', statuses: ['needs_confirmation'] });
  const before = scan();
  expect({ ...before, stale: before.stale.length }).toEqual({ checked: 1, total: 1, stale: 0, truncated: false });

  // An episode whose event set changed is exactly what a repair, split or merge leaves behind.
  const db = new Database(dbPath);
  db.prepare('DELETE FROM memory_episode_events WHERE rowid = (SELECT rowid FROM memory_episode_events WHERE episode_id=? LIMIT 1)').run(episodeId);
  db.close();

  const after = scan();
  expect(after.stale).toEqual([frame.frameId]);
  expect(after.checked).toBe(1);

  // Reporting is read-only: the frame row and the projection stay exactly as they were.
  const rowsBefore = kernel.memoryFrameStore.list('p', { statuses: ['needs_confirmation'], limit: 10 });
  const afterSecond = scan();
  expect(afterSecond.stale).toEqual([frame.frameId]);
  expect(kernel.memoryFrameStore.list('p', { statuses: ['needs_confirmation'], limit: 10 })).toEqual(rowsBefore);
  kernel.close();
});

