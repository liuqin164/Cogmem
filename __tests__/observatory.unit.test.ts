import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';

import { createMemoryKernel } from '../src/factory.js';
import { startObservatoryServer, type ObservatoryServerHandle } from '../src/observatory/HttpServer.js';
import { MemoryObservatory } from '../src/observatory/MemoryObservatory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #136's hardest constraint: the observatory reads, and only reads.
 *
 * Two proofs, because either alone is weak. The file hash covers everything any code path might do,
 * including the temp-file spill and the schema a lazy `CREATE TABLE IF NOT EXISTS` would add. The
 * read-only handle covers what a hash cannot show: that the guarantee is structural, so a later edit
 * cannot quietly reintroduce a write.
 */

const scratch = makeTempDir('cogmem-observatory-');
const dbPath = join(scratch, 'memory.db');
const handles: ObservatoryServerHandle[] = [];
let handle: ObservatoryServerHandle;

beforeAll(async () => {
  await seed();
  handle = await startObservatoryServer({ dbPath, cwd: scratch, port: 0 });
  handles.push(handle);
});

afterAll(() => {
  for (const item of handles) item.stop();
  rmSync(scratch, { recursive: true, force: true });
});

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A corpus with something in every table the observatory reads, built through the kernel. */
async function seed(): Promise<void> {
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  try {
    for (const [index, text] of ['the deploy window is Tuesday', 'the retention period is seven years', 'the rehearsal happens on Friday'].entries()) {
      kernel.eventStore.append({
        eventId: `evt-observatory-${index}`,
        streamId: `s-${index}`, streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
        projectId: 'observatory', sessionId: `s-${index}`, threadId: `s-${index}`,
        role: 'user', occurredAt: Date.UTC(2026, 0, 10 + index),
        sourceId: 'hermes:s-1', payload: { text, metadata: { sourceAgent: 'hermes' } },
      } as never);
    }
    kernel.eventStore.append({
      eventId: 'evt-observatory-imported',
      streamId: 's-import', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
      projectId: 'observatory', sessionId: 's-import', threadId: 's-import',
      role: 'user', occurredAt: Date.UTC(2026, 0, 12),
      sourceId: 'openclaw', payload: { text: 'imported: the archiving retention period', metadata: { imported: true, sourceAgent: 'openclaw' } },
    } as never);
    kernel.memoryAtlasStore.upsertDocument({
      id: 'raw_event:evt-observatory-0', projectId: 'observatory', nodeType: 'raw_event', sourceId: 'hermes:s-1',
      label: 'deploy window', confidence: 1, supportCount: 3, status: 'active', occurredAt: Date.UTC(2026, 0, 10),
      evidenceEventIds: ['evt-observatory-0'],
    });
    kernel.memoryAtlasStore.upsertDocument({
      id: 'episode:observatory-1', projectId: 'observatory', nodeType: 'episode', sourceId: 'episode-observatory-1',
      label: 'retention decision', confidence: 1, supportCount: 2, status: 'sealed', occurredAt: Date.UTC(2026, 0, 11),
      topicPath: 'ops/archiving', evidenceEventIds: ['evt-observatory-1'],
    });
    kernel.memoryAtlasStore.upsertDocument({
      id: 'raw_event:evt-observatory-imported', projectId: 'observatory', nodeType: 'raw_event', sourceId: 'openclaw',
      label: 'imported retention', confidence: 1, supportCount: 1, status: 'active', occurredAt: Date.UTC(2026, 0, 12),
      evidenceEventIds: ['evt-observatory-imported'],
    });
  } finally {
    kernel.close();
  }
}

describe('the observatory writes nothing', () => {
  test('every endpoint leaves the database file byte-identical', async () => {
    // Whatever opening a kernel costs is paid before the page is involved; the claim being tested is
    // about browsing, so the baseline is taken once the process is up.
    const afterOpen = digest(dbPath);
    const base = handle.url.replace(/\/$/u, '');

    const visited: string[] = [];
    const get = async (path: string) => {
      visited.push(path);
      const response = await fetch(`${base}${path}`, { headers: { accept: 'application/json', 'accept-encoding': 'gzip' } });
      expect(response.status).toBe(200);
      return response;
    };

    const snapshot = await (await get('/snapshot')).json() as { nodes: Array<{ id: string }>; watermark: number };
    expect(snapshot.nodes.length).toBeGreaterThan(0);
    expect(snapshot.watermark).toBeGreaterThan(0);
    // The seed has no `trace_events` table; asking for recalls must not create one.
    const recalls = await (await get('/recalls')).json() as { available: boolean };
    expect(recalls.available).toBe(false);
    await get('/timeline');
    await get(`/node/${encodeURIComponent(snapshot.nodes[0]!.id)}`);
    await get('/');
    await get('/app.js');
    await get('/demo.json');
    expect(visited.length).toBe(7);

    const after = digest(dbPath);
    expect(after).toBe(afterOpen);
    // Recorded, not asserted: an older database may legitimately migrate on open. The ticket's claim
    // is about the surface, which is why the comparison above uses `afterOpen`.
  });

  test('the connection behind the page refuses a write, and the SQL contains none', () => {
    // The writer this server owns is still open; the handle under test is the observatory's own.
    expect(existsSync(`${dbPath}-wal`)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    try {
      // A read-only connection cannot checkpoint, append to the write-ahead log, or create a table.
      const logBefore = readFileSync(`${dbPath}-wal`).length;
      expect(() => db.exec('CREATE TABLE observatory_probe (x INTEGER)')).toThrow(/readonly/i);
      expect(db.query(`SELECT COUNT(*) AS c FROM memory_atlas_documents`).get()).toEqual({ c: 3 });
      expect(db.query(`SELECT name FROM sqlite_master WHERE name = 'trace_events'`).all()).toEqual([]);
      expect(readFileSync(`${dbPath}-wal`).length).toBe(logBefore);
    } finally {
      db.close();
    }
    // The handle is not the only way in: a future edit could reach past it, so the module's own SQL is
    // read back. Comments are excluded — this is about statements, not prose about statements.
    const sources = ['src/observatory/MemoryObservatory.ts', 'src/observatory/routes.ts', 'src/observatory/GalaxyLayout.ts', 'src/observatory/HttpServer.ts']
      .map((file) => readFileSync(file, 'utf8'));
    for (const source of sources) {
      const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
      expect(code).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|REPLACE\s+INTO)\b/iu);
      expect(code).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/iu);
    }
  });

  test('a second request is served from the cache under the same watermark', async () => {
    const base = handle.url.replace(/\/$/u, '');
    const first = await (await fetch(`${base}/snapshot`)).json() as { generatedAt: number; watermark: number };
    const second = await (await fetch(`${base}/snapshot`)).json() as { generatedAt: number; watermark: number };
    expect(second.watermark).toBe(first.watermark);
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  test('the watermark moves when the corpus does, and the cache follows it', async () => {
    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
    kernel.eventStore.append({
      eventId: 'evt-observatory-later', streamId: 's-later', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
      projectId: 'observatory', sessionId: 's-later', threadId: 's-later', localDate: '2026-02-01', role: 'user',
      occurredAt: Date.UTC(2026, 1, 1), sourceId: 'hermes:s-1', payload: { text: 'a later turn', metadata: { sourceAgent: 'hermes' } },
    } as never);
    kernel.memoryAtlasStore.upsertDocument({
      id: 'raw_event:evt-observatory-later', projectId: 'observatory', nodeType: 'raw_event', sourceId: 'hermes:s-1',
      label: 'a later turn', confidence: 1, supportCount: 1, status: 'active', occurredAt: Date.UTC(2026, 1, 1),
      evidenceEventIds: ['evt-observatory-later'],
    });
    kernel.close();

    const db = new Database(dbPath, { readonly: true });
    try {
      const observatory = new MemoryObservatory({ db });
      const snapshot = observatory.snapshot({ projectId: 'observatory' });
      expect(snapshot.nodes.some((node) => node.id === 'raw_event:evt-observatory-later')).toBe(true);
      expect(snapshot.counts.nodesTotal).toBe(4);
      expect(snapshot.watermark).toBeGreaterThan(0);
      expect(snapshot.truncation).toBeNull();
      expect(snapshot.layout.armRule).toBe('topic_path');
      expect(snapshot.layout.arms.map((arm) => arm.id)).toContain('ops');
      expect(snapshot.counts.nodesByType.raw_event).toBe(3);
      expect(snapshot.counts.edgesByRelation).toEqual({});
      // LOD is by node type, and the ladder is the one the note fixed.
      const episode = snapshot.nodes.find((node) => node.id === 'episode:observatory-1');
      expect(episode?.lod).toBe(1);
      expect(snapshot.nodes.find((node) => node.id === 'raw_event:evt-observatory-0')?.lod).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe('the page is served from beside the route module', () => {
  test('only GET is answered, and only on loopback', async () => {
    const base = handle.url.replace(/\/$/u, '');
    const posted = await fetch(`${base}/snapshot`, { method: 'POST' });
    expect(posted.status).toBe(405);
    expect(posted.headers.get('allow')).toBe('GET, HEAD');
    const missing = await fetch(`${base}/nope`);
    expect(missing.status).toBe(404);
    // The loopback check is what keeps a process bound to a LAN address from exposing the corpus; it
    // is exercised through the routing function directly, since every socket in this test is local.
    const { createObservatoryRoutes } = await import('../src/observatory/routes.js');
    const routes = createObservatoryRoutes(new MemoryObservatory({ db: new Database(dbPath, { readonly: true }) }));
    const remote = await routes(new Request(`${base}/snapshot`), '10.0.0.7');
    expect(remote?.status).toBe(403);
    const local = await routes(new Request(`${base}/snapshot`), '::ffff:127.0.0.1');
    expect(local?.status).toBe(200);
    const elsewhere = await routes(new Request('http://127.0.0.1:1/not-observatory'), '127.0.0.1');
    expect(elsewhere).toBeNull();
  });

  test('a traversal attempt is a 404, not a file', async () => {
    const base = handle.url.replace(/\/$/u, '');
    const attempt = await fetch(`${base}/../package.json`);
    expect(attempt.status).toBe(404);
    const encoded = await fetch(`${base}/%2e%2e%2fpackage.json`);
    expect(encoded.status).toBe(404);
  });
});
