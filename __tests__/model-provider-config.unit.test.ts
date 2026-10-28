import { afterEach, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernelFromConfig } from '../src/factory.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { makeTempDir } from './helpers/tmp.js';

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

/** An OpenAI-compatible endpoint that answers Dream's schema, echoing the evidence it was given. */
function startModelServer(): { url: string; requests: Array<{ authorization: string | null; model: string; maxTokens?: number; responseFormat?: string }> } {
  const requests: Array<{ authorization: string | null; model: string; maxTokens?: number; responseFormat?: string }> = [];
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.json() as { model: string; messages: Array<{ role: string; content: string }>; max_tokens?: number; response_format?: { type?: string } };
      requests.push({ authorization: request.headers.get('authorization'), model: body.model, maxTokens: body.max_tokens, responseFormat: body.response_format?.type });
      const prompt = JSON.parse(body.messages.find((message) => message.role === 'user')!.content) as {
        rawLedgerEvents: Array<{ eventId: string; role?: string }>;
      };
      const evidence = prompt.rawLedgerEvents.filter((event) => event.role === 'user').map((event) => event.eventId);
      const content = JSON.stringify({
        userPreferenceCandidates: [{
          statement: '用户希望记忆系统能定位到原始对话。',
          confidence: 0.8,
          evidenceEventIds: evidence,
          tags: ['auditability'],
        }],
      });
      return Response.json({ choices: [{ message: { content } }] });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, requests };
}

function writeConfig(dir: string, baseUrl: string): string {
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    `db_path = ${JSON.stringify(join(dir, 'memory.db'))}`,
    'vector_backend = "sqlite-vec"',
    '',
    '[memory_model]',
    'provider = "openai_compatible"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    'model = "test-model"',
    'api_key = "test-key-do-not-leak"',
    'timeout_ms = 10000',
    '',
  ].join('\n'));
  return configPath;
}

test('a configured OpenAI-compatible provider is what Dream reads a conversation with', async () => {
  const model = startModelServer();
  const dir = makeTempDir('cogmem-model-config-');
  const kernel = createMemoryKernelFromConfig({ configPath: writeConfig(dir, model.url) });
  try {
    const backend = new KernelAgentMemoryBackend(kernel);
    await backend.rememberTurnWithResult({
      agentId: 'openclaw',
      projectId: 'demo',
      sessionId: 'session-model',
      userText: '我希望记忆系统能定位到原始对话，别做成黑盒。',
      assistantText: '明白，会保留 raw ledger 的锚点。',
      ingestMode: 'raw_then_dream',
    });

    const result = await kernel.runDreamCurator({ projectId: 'demo', limit: 10 });

    // The provider was reached with the configured key and model, and what it
    // answered became a governance candidate.
    expect(model.requests.length).toBeGreaterThan(0);
    expect(model.requests[0]!.authorization).toBe('Bearer test-key-do-not-leak');
    expect(model.requests[0]!.model).toBe('test-model');
    // A memory frame is far larger than the client's 512-token default; capped
    // there the answer arrives cut off mid-JSON and is thrown away as invalid.
    expect(model.requests[0]!.maxTokens).toBeGreaterThan(512);
    expect(result.skipped).toBe(false);
    expect(result.candidateCount).toBeGreaterThan(0);
    expect(result.semanticProcessorAvailable).toBe(true);

    // The key is a secret: it may reach the endpoint, never the record of what happened.
    expect(JSON.stringify(result)).not.toContain('test-key-do-not-leak');
    expect(JSON.stringify(kernel.listDreamCandidates({ limit: 20 }))).not.toContain('test-key-do-not-leak');
  } finally {
    kernel.close();
  }
});

test('with no provider configured Dream still lands a rule-only result', async () => {
  const dir = makeTempDir('cogmem-model-config-none-');
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    `db_path = ${JSON.stringify(join(dir, 'memory.db'))}`,
    'vector_backend = "sqlite-vec"',
    '',
    '[memory_model]',
    'provider = "rule_only"',
    'model = "rule_only"',
    '',
  ].join('\n'));
  const kernel = createMemoryKernelFromConfig({ configPath });
  try {
    const backend = new KernelAgentMemoryBackend(kernel);
    await backend.rememberTurnWithResult({
      agentId: 'openclaw',
      projectId: 'demo',
      sessionId: 'session-rule',
      userText: '请以后始终记住：记忆内核不是 Obsidian 替代品。',
      assistantText: '明白，会作为边界约束处理。',
      ingestMode: 'raw_then_dream',
    });
    const result = await kernel.runDreamCurator({ projectId: 'demo', limit: 10 });
    expect(result.skipped).toBe(false);
    expect(result.candidateCount).toBeGreaterThan(0);
    expect(result.semanticProcessorAvailable).toBe(false);
  } finally {
    kernel.close();
  }
});

test('max_tokens is configurable per role and defaults past the frame size', async () => {
  const model = startModelServer();
  const dir = makeTempDir('cogmem-model-config-tokens-');
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    `db_path = ${JSON.stringify(join(dir, 'memory.db'))}`,
    'vector_backend = "sqlite-vec"',
    '',
    '[memory_model]',
    'provider = "openai_compatible"',
    `base_url = ${JSON.stringify(model.url)}`,
    'model = "test-model"',
    'api_key = "test-key"',
    'max_tokens = 4096',
    '',
  ].join('\n'));
  const kernel = createMemoryKernelFromConfig({ configPath });
  try {
    const backend = new KernelAgentMemoryBackend(kernel);
    await backend.rememberTurnWithResult({
      agentId: 'openclaw',
      projectId: 'demo',
      sessionId: 'session-tokens',
      userText: '我希望记忆系统能定位到原始对话。',
      assistantText: '明白。',
      ingestMode: 'raw_then_dream',
    });
    await kernel.runDreamCurator({ projectId: 'demo', limit: 5 });
    expect(model.requests[0]!.maxTokens).toBe(4096);
  } finally {
    kernel.close();
  }
});

test('json_mode asks the endpoint to constrain decoding to a JSON object', async () => {
  const model = startModelServer();
  const dir = makeTempDir('cogmem-model-config-json-');
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, [
    '[core]',
    `db_path = ${JSON.stringify(join(dir, 'memory.db'))}`,
    'vector_backend = "sqlite-vec"',
    '',
    '[memory_model]',
    'provider = "openai_compatible"',
    `base_url = ${JSON.stringify(model.url)}`,
    'model = "test-model"',
    'api_key = "test-key"',
    'json_mode = true',
    '',
  ].join('\n'));
  const kernel = createMemoryKernelFromConfig({ configPath });
  try {
    const backend = new KernelAgentMemoryBackend(kernel);
    await backend.rememberTurnWithResult({
      agentId: 'openclaw',
      projectId: 'demo',
      sessionId: 'session-json',
      userText: '我希望记忆系统能定位到原始对话。',
      assistantText: '明白。',
      ingestMode: 'raw_then_dream',
    });
    await kernel.runDreamCurator({ projectId: 'demo', limit: 5 });
    // Without it the granted model answers in prose, and the whole reading is
    // discarded as invalid output.
    expect(model.requests[0]!.responseFormat).toBe('json_object');
  } finally {
    kernel.close();
  }
});
