/**
 * Runtime route switching, in the resident the TUI actually attaches to: the route list the view
 * sees, `/model` (list and switch), and the two things a switch must not do — restart the process or
 * touch the session's checkpoint. The key of a switched-to route never reaches the trace.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AttachClient } from '../src/attach/client.ts';
import type { AttachServerMessage } from '../src/attach/server.ts';
import { RouteStore } from '../src/model/routes.ts';
import { makeShell, makeTempDir } from './helpers.ts';

const KEY = 'sk-runtime-secret-value';
const CUSTOM = { name: 'deepseek', baseUrl: `https://api.deepseek.com/v1?key=${KEY}`, apiKey: KEY, model: 'deepseek-chat' };

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

async function shellWithRoutes() {
  const dir = makeTempDir();
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const store = new RouteStore(join(dataDir, 'routes.json')).load();
  store.add(CUSTOM);
  store.setActive('deepseek');
  const shell = makeShell(dir, undefined);
  await shell.start();
  return { dir, dataDir, shell };
}

describe('runtime model routes in the resident', () => {
  test('the TUI sees the built-in and the custom route, with the stored one active', async () => {
    const { shell } = await shellWithRoutes();
    try {
      expect(shell.modelRoutes()).toEqual(['mg/auto/deepseek-v4.1-flash', 'deepseek/deepseek-chat']);
      expect(shell.currentStatus().model).toBe('deepseek/deepseek-chat');
      const listed = await shell.runCommand('model');
      expect(listed.text).toContain('当前路线：deepseek');
      expect(listed.text).toContain('● deepseek · deepseek-chat');
      expect(listed.text).toContain('○ mg · auto/deepseek-v4.1-flash');
      // A URL that carries the key is printed redacted.
      expect(listed.text).not.toContain(KEY);
      expect(listed.text).toContain('***');
    } finally {
      await shell.stop();
    }
  });

  test('switching moves the live provider, tells the view, and leaves the session alone', async () => {
    const { dataDir, shell } = await shellWithRoutes();
    try {
      const runtimeBefore = shell.runtimeInstance;
      const seqBefore = shell.machine.seq;
      const checkpointBefore = readFileSync(join(dataDir, 'checkpoint.json'), 'utf8');

      const switched = await shell.runCommand('model', 'mg');
      expect(switched.text).toContain('已切到路线「mg」');
      expect(shell.currentStatus().model).toBe('mg/auto/deepseek-v4.1-flash');
      expect(shell.modelRoutes()).toHaveLength(2);

      // The same runtime object and the same checkpoint: no restart, no session rewrite.
      expect(shell.runtimeInstance).toBe(runtimeBefore);
      expect(shell.machine.seq).toBe(seqBefore);
      expect(readFileSync(join(dataDir, 'checkpoint.json'), 'utf8')).toBe(checkpointBefore);
      // And the switch is remembered for the next process: no pointer means the built-in route.
      expect(new RouteStore(join(dataDir, 'routes.json')).load().active).toBeUndefined();

      const unknown = shell.switchModelRoute('nope');
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.message).toContain('route_unknown');
    } finally {
      await shell.stop();
    }
    const trace = readFileSync(join(dataDir, 'shell-events.jsonl'), 'utf8');
    expect(trace).toContain('model_route_switched');
    expect(trace).not.toContain(KEY);
  });

  test('a resident with no route file still answers /model the old way', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, undefined);
    await shell.start();
    try {
      expect(shell.modelRoutes()).toEqual(['mg/auto/deepseek-v4.1-flash']);
      expect((await shell.runCommand('model')).text).toContain('当前路线：mg');
    } finally {
      await shell.stop();
    }
  });

  test('a broken routes file is surfaced, does not stop the resident, and mg still answers', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'routes.json'), '{ not json', { mode: 0o600 });
    const shell = makeShell(dir, undefined);
    await shell.start();
    try {
      expect(shell.modelRoutes()).toEqual(['mg/auto/deepseek-v4.1-flash']);
      const listed = await shell.runCommand('model');
      expect(listed.text).toContain('路线表有问题');
      expect(listed.text).toContain('routes_unreadable');
      expect(listed.text).toContain('当前路线：mg');
    } finally {
      await shell.stop();
    }
    expect(readFileSync(join(dataDir, 'shell-events.jsonl'), 'utf8')).toContain('model_routes_load_failed');
  });

  test('`/model <name>` reaches the resident over the attach socket and switches it', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir, { recursive: true });
    const store = new RouteStore(join(dataDir, 'routes.json')).load();
    store.add(CUSTOM);
    store.setActive('deepseek');
    const shell = makeShell(dir, undefined, { attach: { enabled: true }, dream: { windowStartHour: 0, windowEndHour: 0, runKernelNight: false, maxEpisodes: 5 } });
    await shell.start();
    const client = new AttachClient();
    const events: AttachServerMessage[] = [];
    try {
      const snapshot = await client.connect(join(dataDir, 'attach.sock'));
      client.onEvent = (message) => events.push(message);
      expect(snapshot.modelRoutes).toEqual(['mg/auto/deepseek-v4.1-flash', 'deepseek/deepseek-chat']);

      client.send({ t: 'command', name: 'model', args: 'mg' });
      await waitFor(() => events.some((message) => message.t === 'event' && message.name === 'companion_command_result' && (message.payload.text as string).includes('已切到路线「mg」')));
      expect(shell.currentStatus().model).toBe('mg/auto/deepseek-v4.1-flash');
    } finally {
      client.close();
      await shell.stop();
    }
  });
});
