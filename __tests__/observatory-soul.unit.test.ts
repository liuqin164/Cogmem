import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { startObservatoryServer, type ObservatoryServerHandle } from '../src/observatory/HttpServer.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #194's star-sea editor: the two soul POST routes are the observatory's only write exception, and
 * every GET/HEAD route (including `/observatory/soul`) is still zero-write.
 *
 * The fingerprint covers the database file and its write-ahead log, because a write in WAL mode can
 * move the log before it moves the main file. The traversal test is deliberately the first test in
 * the file: the POST tests that follow are allowed to move the fingerprint.
 */

const scratch = makeTempDir('cogmem-observatory-soul-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;
let handle: ObservatoryServerHandle;

beforeAll(async () => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
  kernel.soul.ensureDefault('agent-a', 'A soul v0\n', 1_000);
  kernel.soul.ensureDefault('agent-b', 'B soul v0\n', 1_000);
  handle = await startObservatoryServer({ kernel, port: 0 });
});

afterAll(() => {
  handle.stop();
  kernel.close();
  rmSync(scratch, { recursive: true, force: true });
});

function fingerprint(): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(dbPath));
  const wal = `${dbPath}-wal`;
  if (existsSync(wal)) hash.update(readFileSync(wal));
  return hash.digest('hex');
}

function base(): string {
  return handle.url.replace(/\/$/u, '');
}

describe('the revised zero-write rule (#194 discriminator 5)', () => {
  test('a full GET/HEAD traversal, including the soul read, leaves the file and WAL byte-identical', async () => {
    const before = fingerprint();
    const paths = [
      '/snapshot',
      '/timeline',
      '/recalls',
      '/soul?agent=agent-a',
      '/soul?agent=agent-b',
      '/',
      '/app.js',
      '/demo.json',
    ];
    for (const path of paths) {
      const response = await fetch(`${base()}${path}`, { headers: { accept: 'application/json' } });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const head = await fetch(`${base()}/soul?agent=agent-a`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(fingerprint()).toBe(before);
  });

  test('every other POST is still refused with Allow: GET, HEAD', async () => {
    for (const path of ['/snapshot', '/timeline', '/recalls', '/events']) {
      const response = await fetch(`${base()}${path}`, { method: 'POST' });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, HEAD');
    }
  });
});

describe('the soul endpoints', () => {
  test('GET requires an agent and never returns a merged view', async () => {
    const missing = await fetch(`${base()}/soul`);
    expect(missing.status).toBe(400);
    expect((await missing.json() as { error: string }).error).toBe('agent_id_required');

    const a = await (await fetch(`${base()}/soul?agent=agent-a`)).json() as {
      agentId: string;
      current: { content: string; version: number };
      versions: Array<{ agentId: string }>;
      maxTokens: number;
    };
    expect(a.agentId).toBe('agent-a');
    expect(a.current.content).toBe('A soul v0\n');
    expect(a.versions.every((row) => row.agentId === 'agent-a')).toBe(true);
    expect(a.maxTokens).toBe(2000);
    expect(JSON.stringify(a)).not.toContain('B soul v0');
  });

  test('POST saves a new version, and the next GET sees it', async () => {
    const saved = await fetch(`${base()}/soul`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-a', content: 'A soul v1\n', reason: 'editor' }),
    });
    expect(saved.status).toBe(200);
    const body = await saved.json() as { version: number; content: string };
    expect(body.version).toBe(1);
    expect(body.content).toBe('A soul v1\n');

    const read = await (await fetch(`${base()}/soul?agent=agent-a`)).json() as {
      current: { content: string; version: number };
      audit: Array<{ action: string; version: number }>;
    };
    expect(read.current.content).toBe('A soul v1\n');
    expect(read.current.version).toBe(1);
    expect(read.audit.some((row) => row.action === 'soul_save' && row.version === 1)).toBe(true);
  });

  test('POST rollback copies an older version into a new version and is audited', async () => {
    const rolled = await fetch(`${base()}/soul/rollback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-a', version: 0, reason: 'undo' }),
    });
    expect(rolled.status).toBe(200);
    const body = await rolled.json() as { version: number; content: string; supersedes: number };
    expect(body.version).toBe(2);
    expect(body.content).toBe('A soul v0\n');
    expect(body.supersedes).toBe(1);

    const read = await (await fetch(`${base()}/soul?agent=agent-a`)).json() as {
      current: { content: string; version: number };
      versions: Array<{ version: number }>;
      audit: Array<{ action: string; version: number; fromVersion?: number }>;
    };
    expect(read.current.version).toBe(2);
    expect(read.versions.map((row) => row.version)).toEqual([2, 1, 0]);
    expect(read.audit.some((row) => row.action === 'soul_rollback' && row.version === 2 && row.fromVersion === 0)).toBe(true);
  });

  test('a malformed body is a typed 400, not a crash', async () => {
    const bad = await fetch(`${base()}/soul`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: string }).error).toBe('invalid_json');
  });
});

describe('the editor is present and shows the token estimate', () => {
  test('the page has a soul tab and the live limit is rendered', () => {
    const root = fileURLToPath(new URL('../src/observatory/web/', import.meta.url));
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const app = readFileSync(join(root, 'app.js'), 'utf8');
    expect(html).toContain('id="tab-soul"');
    expect(html).toContain('id="view-soul"');
    expect(app).toContain('soulTokens');
    expect(app).toContain('maxTokens');
    expect(app).toContain("api('soul'");
    expect(app).toContain("postJson('soul'");
  });
});
