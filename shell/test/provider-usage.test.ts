/**
 * #165 round 21: the provider's own usage reaching the trace and the status face.
 *
 * Every provider case here runs against a real local OpenAI-compatible endpoint, the same fake
 * `Bun.serve` shape `model-routes.test.ts` uses — the thing under test *is* the response parsing, so
 * a stub that hands back an already-parsed usage object would only be testing the stub. The
 * end-to-end cases then drive a real `CompanionShell` whose router points at that endpoint, because
 * "the trace has the number and `/context` agrees with it" is a claim about the wiring, not about
 * `parseUsage` alone.
 *
 * The two discriminating shapes are the two spellings the fleet actually reports: DeepSeek
 * (`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`) and OpenAI/OpenRouter
 * (`prompt_tokens_details.cached_tokens`). Both must reconcile to the same ratio. And the third case
 * asserts absence — a response with no usage leaves no record and no ratio, never a zero.
 */
import { describe, expect, test } from 'bun:test';
import { defaultRenderEnv, frameText, rowText } from '../src/tui/frame.ts';
import { renderTui } from '../src/tui/layout.ts';
import { overlayRows } from '../src/tui/commands.ts';
import { TuiView } from '../src/tui/view.ts';
import { MgModelProvider } from '../src/plugins/mg-provider.ts';
import type { ModelTurn } from '../src/state/agent-loop.ts';
import { makeShell, makeTempDir } from './helpers.ts';
import { fixtureEditor } from './tui-fixture.ts';

// ── The fake OpenAI-compatible endpoint ─────────────────────────────────────────────────────────

interface FakeEndpoint {
  baseUrl: string;
  stop(): void;
}

function startFake(body: unknown): FakeEndpoint {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  return { baseUrl: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true) };
}

/**
 * A provider named `custom`: that is exactly what `ModelRouter.build` hands every stored route
 * (`mg-provider.ts` constructor arg), so the custom OpenAI-protocol route and the built-in mg route
 * are the same code path and this one call covers both.
 */
function completeAt(baseUrl: string): Promise<ModelTurn> {
  const provider = new MgModelProvider({ baseUrl, apiKey: 'sk-test', model: 'test-model', timeoutMs: 3_000 }, 'custom');
  return provider.complete({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    systemPrompt: 'probe',
    model: 'test-model',
    signal: AbortSignal.timeout(3_000),
  });
}

function reply(usage?: unknown): unknown {
  return { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], ...(usage === undefined ? {} : { usage }) };
}

async function turnFor(body: unknown): Promise<ModelTurn> {
  const endpoint = startFake(body);
  try {
    return await completeAt(endpoint.baseUrl);
  } finally {
    endpoint.stop();
  }
}

const ENV = defaultRenderEnv({ TERM: 'xterm-256color' } as NodeJS.ProcessEnv);

describe('the provider usage parser: both cache shapes, and their absence', () => {
  test('DeepSeek shape: prompt_cache_hit_tokens / prompt_cache_miss_tokens ride back as reported', async () => {
    const turn = await turnFor(reply({ prompt_tokens: 1_000, completion_tokens: 20, prompt_cache_hit_tokens: 768, prompt_cache_miss_tokens: 232 }));
    expect(turn.usage).toEqual({ input: 1_000, output: 20, cacheHit: 768, cacheMiss: 232 });
  });

  test('OpenAI shape: prompt_tokens_details.cached_tokens is the same hit', async () => {
    const turn = await turnFor(reply({ prompt_tokens: 1_000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 768 } }));
    expect(turn.usage).toEqual({ input: 1_000, output: 20, cacheHit: 768 });
    // OpenAI does not report misses; the field must be absent, not a fabricated 232.
    expect(turn.usage && 'cacheMiss' in turn.usage).toBe(false);
  });

  test('a usage block with no cache field carries no cache field', async () => {
    const turn = await turnFor(reply({ prompt_tokens: 5, completion_tokens: 1 }));
    expect(turn.usage).toEqual({ input: 5, output: 1 });
    expect(turn.usage && 'cacheHit' in turn.usage).toBe(false);
  });

  test('no usage at all leaves usage undefined, not zero-filled', async () => {
    const turn = await turnFor(reply());
    expect(turn.usage).toBeUndefined();
  });
});

describe('the run lands the provider account next to round 17s estimate', () => {
  test('DeepSeek shape: trace carries the reported split, and /context agrees with it', async () => {
    const endpoint = startFake(reply({ prompt_tokens: 1_000, completion_tokens: 20, prompt_cache_hit_tokens: 768, prompt_cache_miss_tokens: 232 }));
    const dir = makeTempDir();
    const shell = makeShell(dir, undefined, { model: { baseUrl: endpoint.baseUrl, apiKey: 'sk-test', model: 'test-model', timeoutMs: 3_000 } });
    try {
      await shell.start();
      await shell.submit('hello');
      const records = shell.trace.read();
      const usage = records.find((record) => record.kind === 'provider_usage');
      expect(usage).toMatchObject({ input: 1_000, output: 20, cacheHit: 768, cacheMiss: 232 });
      // The estimate is a separate record with the same key, never merged into this one: that pairing
      // is the whole point of putting it "beside" `context_assembled`.
      const estimate = records.find((record) => record.kind === 'context_assembled' && record.runId === usage!.runId && record.turnIndex === usage!.turnIndex && record.attempt === usage!.attempt);
      expect(estimate).toBeDefined();
      expect(estimate!.totalTokens).toBeGreaterThan(0);
      expect(usage!.totalTokens).toBeUndefined();

      const cache = shell.currentStatus().promptCache;
      expect(cache).toEqual({ hit: 768, miss: 232, percent: 77 });
      const replyText = (await shell.runCommand('context')).text;
      expect(replyText).toContain('缓存命中 77%');
    } finally {
      await shell.stop();
      endpoint.stop();
    }
  }, 30_000);

  test('OpenAI shape reconciles to the same ratio, with the miss derived from the prompt size', async () => {
    const endpoint = startFake(reply({ prompt_tokens: 1_000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 768 } }));
    const dir = makeTempDir();
    const shell = makeShell(dir, undefined, { model: { baseUrl: endpoint.baseUrl, apiKey: 'sk-test', model: 'test-model', timeoutMs: 3_000 } });
    try {
      await shell.start();
      await shell.submit('hello');
      const usage = shell.trace.read().find((record) => record.kind === 'provider_usage');
      expect(usage).toMatchObject({ input: 1_000, output: 20, cacheHit: 768 });
      expect(usage!.cacheMiss).toBeUndefined();
      // Same ratio as the DeepSeek case: 768 / (768 + (1000 - 768)).
      expect(shell.currentStatus().promptCache).toEqual({ hit: 768, miss: 232, percent: 77 });
    } finally {
      await shell.stop();
      endpoint.stop();
    }
  }, 30_000);
});

describe('no reported usage is no measurement, on every face', () => {
  test('no usage: no trace record, no status ratio, no /context line, no footer segment', async () => {
    const endpoint = startFake(reply());
    const dir = makeTempDir();
    const shell = makeShell(dir, undefined, { model: { baseUrl: endpoint.baseUrl, apiKey: 'sk-test', model: 'test-model', timeoutMs: 3_000 } });
    try {
      await shell.start();
      await shell.submit('hello');
      // Asserting "there is none", not "it is zero": a zero here would be an invented measurement.
      // `null` is the explicit none that survives the attach socket, where JSON would drop undefined.
      expect(shell.trace.read().filter((record) => record.kind === 'provider_usage')).toHaveLength(0);
      expect(shell.currentStatus().promptCache).toBeNull();
      const replyText = (await shell.runCommand('context')).text;
      expect(replyText).not.toContain('缓存');
    } finally {
      await shell.stop();
      endpoint.stop();
    }
  }, 30_000);

  test('the TUI draws the ratio only once a status carries one', () => {
    const view = new TuiView();
    view.status = { ...view.status, model: 'mg/x', contextTokens: 1_000, contextSweetSpot: 6_000, costTokens: 0 };
    view.overlay = { kind: 'context' };

    expect(overlayRows(view, 80, ENV).map(rowText).join('\n')).not.toContain('缓存');
    expect(frameText(renderTui(view, fixtureEditor(''), { width: 120, height: 40 }, ENV))).not.toContain('缓存');

    view.status = { ...view.status, promptCache: { hit: 768, miss: 232, percent: 77 } };
    expect(overlayRows(view, 80, ENV).map(rowText).join('\n')).toContain('命中 77%');
    expect(frameText(renderTui(view, fixtureEditor(''), { width: 120, height: 40 }, ENV))).toContain('缓存 77%');

    // A status that crosses the socket with no report clears the last one instead of leaving it up.
    view.applyEvent({ name: 'companion_status', payload: { status: { promptCache: null } } });
    expect(overlayRows(view, 80, ENV).map(rowText).join('\n')).not.toContain('缓存');
    expect(frameText(renderTui(view, fixtureEditor(''), { width: 120, height: 40 }, ENV))).not.toContain('缓存');
  });
});
