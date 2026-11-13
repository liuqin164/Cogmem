import { describe, expect, test } from 'bun:test';
import { MgModelProvider } from '../src/plugins/mg-provider.ts';

const baseUrl = process.env.MG_BASE_URL ?? 'http://127.0.0.1:3425/v1';

async function gatewayUp(): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/u, '')}/models`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

const online = await gatewayUp();
// A real flash call through the routing group measured ~2 minutes on this box, so the live probe is
// opt-in: SHELL_LIVE_MODEL=1 bun test test/mg-live.test.ts. The default suite stays fast.
const liveEnabled = online && process.env.SHELL_LIVE_MODEL === '1';

describe('mg gateway (live, skipped when the gateway is down)', () => {
  test.skipIf(!liveEnabled)('a call goes through the mg gateway with the pinned flash model', async () => {
    const provider = new MgModelProvider({
      baseUrl,
      apiKey: process.env.MG_API_KEY ?? 'magpie',
      model: process.env.MG_MODEL ?? 'auto/deepseek-v4.1-flash',
      timeoutMs: 600_000,
    });
    const turn = await provider.complete({
      messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }],
      tools: [],
      systemPrompt: 'You are a test probe. Answer with one word.',
      model: provider.model,
      signal: new AbortController().signal,
    });
    expect(turn.text.trim().length).toBeGreaterThan(0);
    expect(turn.toolCalls).toHaveLength(0);
  }, 660_000);
});
