import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'recall-thread-scope-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  return { kernel, backend };
}

test('raw recall reaches a previous thread when the current one has nothing', () => {
  const { kernel, backend } = setup();
  kernel.recordRawEvent({
    projectId: 'p1',
    workspaceId: 'w1',
    threadId: 'thread-a',
    sessionId: 'session-a',
    role: 'user',
    content: '记一下，本轮发布代号是 Orion，负责人是林。',
  });

  const result = backend.recall({
    agentId: 'openclaw',
    projectId: 'p1',
    workspaceId: 'w1',
    threadId: 'thread-b',
    sessionId: 'session-b',
    query: '发布代号是什么',
    limit: 5,
  });

  expect(result.items.length).toBeGreaterThan(0);
  expect(result.items[0]?.text).toContain('Orion');
  kernel.close();
});

test('the current thread wins when it has its own evidence', () => {
  const { kernel, backend } = setup();
  kernel.recordRawEvent({
    projectId: 'p1',
    workspaceId: 'w1',
    threadId: 'thread-a',
    sessionId: 'session-a',
    role: 'user',
    content: '发布代号是 Orion，旧的那次。',
  });
  kernel.recordRawEvent({
    projectId: 'p1',
    workspaceId: 'w1',
    threadId: 'thread-b',
    sessionId: 'session-b',
    role: 'user',
    content: '发布代号改成了 Vega，这次以这个为准。',
  });

  const result = backend.recall({
    agentId: 'openclaw',
    projectId: 'p1',
    workspaceId: 'w1',
    threadId: 'thread-b',
    sessionId: 'session-b',
    query: '发布代号是什么',
    limit: 5,
  });

  expect(result.items[0]?.text).toContain('Vega');
  kernel.close();
});
