import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createMemoryKernel } from 'cogmem';
import { startKernelHttpFace } from '../src/kernel-host.ts';
import { makeTempDir } from './helpers.ts';

describe('in-process kernel host and its loopback HTTP face', () => {
  test('the HTTP face starts on the kernel the shell owns and stops cleanly', async () => {
    const dir = makeTempDir();
    const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.sqlite'), projectTimeZone: 'UTC' });
    const face = await startKernelHttpFace(kernel, { port: 0, hostname: '127.0.0.1' });
    try {
      expect(face.port).toBeGreaterThan(0);
      expect(face.baseUrl).toContain('127.0.0.1');
      expect(face.healthUrl).toBe(`${face.baseUrl}/health`);
      // An unknown path is a plain 404, not a crash.
      expect((await fetch(`${face.baseUrl}/nope`)).status).toBe(404);
    } finally {
      face.stop();
      kernel.close();
    }
  });

  test('the removed MCP endpoint is a 404: no protocol path survives the face (#200 R2)', async () => {
    const dir = makeTempDir();
    const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.sqlite'), projectTimeZone: 'UTC' });
    const face = await startKernelHttpFace(kernel, { port: 0, hostname: '127.0.0.1' });
    try {
      const post = await fetch(`${face.baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      expect(post.status).toBe(404);
      // No session header and no initialize verb: the old transport path is not answered at all.
      expect(post.headers.get('mcp-session-id')).toBeNull();
      expect((await fetch(`${face.baseUrl}/mcp`)).status).toBe(404);
    } finally {
      face.stop();
      kernel.close();
    }
  });

  test('health answers the kernel status and the host fields without a second kernel', async () => {
    const dir = makeTempDir();
    const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.sqlite'), projectTimeZone: 'UTC' });
    const face = await startKernelHttpFace(kernel, { port: 0, hostname: '127.0.0.1', health: () => ({ state: 'IDLE' }) });
    try {
      const health = (await (await fetch(face.healthUrl)).json()) as { status: string; bind: string; state?: string; kernel?: { package?: string } };
      expect(health.status).toBe('ok');
      expect(health.bind).toBe('127.0.0.1');
      expect(health.kernel?.package).toBe('cogmem');
      expect(health.state).toBe('IDLE');
    } finally {
      face.stop();
      kernel.close();
    }
  });

  test('the star map is mounted read-only beside health', async () => {
    const dir = makeTempDir();
    const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.sqlite'), projectTimeZone: 'UTC' });
    const face = await startKernelHttpFace(kernel, { port: 0, hostname: '127.0.0.1' });
    try {
      const page = await fetch(`${face.baseUrl}/observatory/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      const snapshot = await fetch(`${face.baseUrl}/observatory/snapshot`);
      expect(snapshot.status).toBe(200);
      // The page is GET-only.
      expect((await fetch(`${face.baseUrl}/observatory/snapshot`, { method: 'POST' })).status).toBe(405);
    } finally {
      face.stop();
      kernel.close();
    }
  });

  test('the kernel event stream rides the same loopback face as the star map', async () => {
    const dir = makeTempDir();
    const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.sqlite'), projectTimeZone: 'UTC' });
    const face = await startKernelHttpFace(kernel, { port: 0, hostname: '127.0.0.1' });
    const controller = new AbortController();
    try {
      // The factory takes the kernel's stream as its second argument; without it this route is a
      // 500 (`events` undefined), which is the drift the 23-165 probe found.
      const events = await fetch(`${face.baseUrl}/observatory/events?since=${kernel.events.headCursor}`, { signal: controller.signal });
      expect(events.status).toBe(200);
      expect(events.headers.get('content-type')).toContain('text/event-stream');
    } finally {
      controller.abort();
      face.stop();
      kernel.close();
    }
  });
});
