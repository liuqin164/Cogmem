/**
 * The model step: pick where the companion thinks, then prove it can actually speak before the
 * install moves on.
 *
 * The shell has exactly one provider shape — OpenAI-compatible chat completions, which is what the
 * mg gateway speaks (`src/plugins/mg-provider.ts`). So there are two choices, not three: the local
 * gateway, or someone else's OpenAI-compatible endpoint. An Anthropic option would be a lie: no
 * plugin in this shell can call it.
 */
import { MgModelProvider } from '../plugins/mg-provider.ts';
import type { ModelProvider } from '../state/agent-loop.ts';
import { classifyEndpointFailure } from '../state/retry.ts';

export type ModelProviderKind = 'mg' | 'openai_compatible';

export interface ModelChoice {
  provider: ModelProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const MG_DEFAULT_MODEL = 'auto/deepseek-v4.1-flash';
export const MG_DEFAULT_BASE_URL = 'http://127.0.0.1:3425/v1';

export const MODEL_PRESETS: Record<ModelProviderKind, { label: string; baseUrl: string; model: string; needsKey: boolean }> = {
  mg: { label: 'mg 网关（本机 magpie，OpenAI 兼容）', baseUrl: MG_DEFAULT_BASE_URL, model: MG_DEFAULT_MODEL, needsKey: false },
  openai_compatible: { label: '自填 OpenAI 兼容端点', baseUrl: '', model: '', needsKey: true },
};

export type ProbeResult =
  | { ok: true; latencyMs: number; sample: string }
  | { ok: false; code: string; message: string; hint: string };

export interface ProbeOptions {
  timeoutMs?: number;
  /** Tests and hosts inject a provider; the default is the real mg chat call. */
  provider?: ModelProvider;
  now?: () => number;
}

/**
 * The mg gateway's routing group measured ~2.5 minutes for a one-word reply on this box, and a cold
 * route can be slower. The probe waits long enough to tell "slow" from "dead" — a liveness check that
 * gives up before the thing it is checking ever answers is a false negative, not a safety property.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 360_000;

/** The env names the resident already reads (`defaultShellConfig`); the key never leaves the env file. */
export function modelEnv(choice: ModelChoice): Record<string, string> {
  return { MG_BASE_URL: choice.baseUrl, MG_API_KEY: choice.apiKey, MG_MODEL: choice.model };
}

/**
 * One failure, said in plain language. The class comes from the ladder's own `classifyEndpointFailure`
 * (`src/state/retry.ts`); this layer only turns a class into a sentence a user can act on. A URL is
 * never echoed here, so a key embedded in one cannot leak through a diagnosis.
 */
function classify(error: unknown): { code: string; message: string; hint: string } {
  const message = error instanceof Error ? error.message : String(error);
  const status = /(?<![a-z0-9])(\d{3})(?![a-z0-9])/i.exec(message)?.[1];
  switch (classifyEndpointFailure(message)) {
    case 'timeout':
      return { code: 'model_timeout', message: '调用超时，端点没有在时限内回答。', hint: '核对 base URL 与网络；本地网关要先把模型路由跑起来。' };
    case 'unreachable':
      return { code: 'model_unreachable', message: '连不上这个端点。', hint: '检查 base URL、端口与进程是否在跑；本地网关默认 127.0.0.1:3425。' };
    case 'auth':
      return { code: 'model_unauthorized', message: `端点拒绝了这枚钥匙（HTTP ${status}）。`, hint: '钥匙只在安全输入里填一次，不会打印；错了就重跑本步换一枚。' };
    case 'model_not_found':
      return { code: 'model_not_found', message: '端点没有这个路径或这个模型。', hint: 'OpenAI 兼容端点的 base URL 通常要以 /v1 结尾，模型名要与端点提供的一致。' };
    case 'rate_limit':
      return { code: 'model_rate_limited', message: '端点限流（HTTP 429），这一发没打进去。', hint: '限流是端点侧的状态，不是钥匙或模型名的问题；等一会儿重跑本步。' };
    case 'http':
      return { code: 'model_http_error', message: `端点回了 HTTP ${status}。`, hint: '看下面的原始应答；多半是模型名、配额或端点侧配置。' };
    default:
      return { code: 'model_call_failed', message, hint: '这是一次真实调用，失败了就不是配置问题就是链路问题。' };
  }
}

/**
 * One real chat call. Nothing here is simulated: the same `ModelProvider` the resident uses answers,
 * so a green probe is the same code path the first turn will take.
 */
export async function probeModel(choice: ModelChoice, options: ProbeOptions = {}): Promise<ProbeResult> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const provider = options.provider ?? new MgModelProvider({ baseUrl: choice.baseUrl, apiKey: choice.apiKey, model: choice.model, timeoutMs });
  const started = now();
  try {
    const turn = await provider.complete({
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      tools: [],
      systemPrompt: 'You are a liveness probe. Answer in one short word.',
      model: choice.model,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = now() - started;
    return { ok: true, latencyMs, sample: turn.text.trim().slice(0, 60) || '（端点回了空文，但调用成功）' };
  } catch (error) {
    return { ok: false, ...classify(error) };
  }
}
