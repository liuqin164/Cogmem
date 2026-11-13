/**
 * Model access through the mg gateway (magpie): one OpenAI-compatible endpoint, model
 * `auto/deepseek-v4.1-flash`.
 *
 * The provider is a plugin like any other; the core loop only knows `ModelProvider`. A failed call
 * throws, and the loop's failure ladder classifies it (`src/state/retry.ts`): overflow first, then
 * account limits, then a bounded exponential-backoff retry. There is still no fallback model.
 */
import type { AgentMessage, ModelCompletionInput, ModelProvider, ModelTurn, ToolCall, TurnUsage } from '../state/agent-loop.ts';
import type { NativePlugin } from './host.ts';
import { contentToText } from '../content.ts';
import { redactSecrets } from '../model/routes.ts';

export interface MgProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

function toOpenAiMessages(messages: AgentMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.toolCallId,
          type: 'function',
          function: { name: call.toolName, arguments: JSON.stringify(call.input ?? {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const entry = item as { id?: string; function?: { name?: string; arguments?: unknown } };
    let input: unknown = entry.function?.arguments ?? {};
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch {
        input = { raw: input };
      }
    }
    return { toolCallId: entry.id ?? `call-${index}`, toolName: entry.function?.name ?? 'unknown', input };
  });
}

/** The usage block as endpoints actually spell it; every field is unknown until checked. */
export interface RawUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  prompt_cache_hit_tokens?: unknown;
  prompt_cache_miss_tokens?: unknown;
  cached_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown } | null;
}

/**
 * The one normalization of a provider's usage (#165 round 21). The cache field has three spellings
 * in the wild — DeepSeek `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`, OpenAI/OpenRouter
 * `prompt_tokens_details.cached_tokens`, Kimi top-level `cached_tokens` — and `parseChunkUsage`
 * recognizes the same set (`pi-ai/dist/api/openai-completions.js:1153-1162`). Whichever the endpoint
 * sends is the one recorded; a field it did not send is left out rather than defaulted to zero.
 */
export function parseUsage(raw: RawUsage | undefined): TurnUsage | undefined {
  if (!raw) return undefined;
  const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const input = num(raw.prompt_tokens);
  const output = num(raw.completion_tokens);
  const cacheHit = num(raw.prompt_cache_hit_tokens) ?? num(raw.prompt_tokens_details?.cached_tokens) ?? num(raw.cached_tokens);
  const cacheMiss = num(raw.prompt_cache_miss_tokens);
  if (input === undefined && output === undefined && cacheHit === undefined && cacheMiss === undefined) return undefined;
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheHit !== undefined ? { cacheHit } : {}),
    ...(cacheMiss !== undefined ? { cacheMiss } : {}),
  };
}

export class MgModelProvider implements ModelProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly config: MgProviderConfig, name = 'mg') {
    this.name = name;
    this.model = config.model;
  }

  async complete(input: ModelCompletionInput): Promise<ModelTurn> {
    const url = `${this.config.baseUrl.replace(/\/+$/u, '')}/chat/completions`;
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(this.config.timeoutMs)]);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'system', content: input.systemPrompt }, ...toOpenAiMessages(input.messages)],
        tools: input.tools.length
          ? input.tools.map((tool) => ({
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            }))
          : undefined,
        tool_choice: input.tools.length ? 'auto' : undefined,
      }),
      signal,
    });
    const text = await response.text();
    // Some endpoints echo the request (and its Authorization header) back in an error body. The key
    // is a known secret here, so it is stripped before the message can reach a trace or a transcript.
    if (!response.ok) throw new Error(redactSecrets(`mg_gateway_error: ${response.status} ${text.slice(0, 400)}`, [this.config.apiKey]));
    let parsed: { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: string }>; usage?: RawUsage };
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`mg_gateway_unparseable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const message = parsed.choices?.[0]?.message;
    if (!message) throw new Error('mg_gateway_empty_choices');
    // The OpenAI-compatible `finish_reason: "length"` is Pi's `stopReason: "length"`: the loop voids
    // the whole tool batch rather than execute arguments the token limit may have cut in half.
    const finishReason = parsed.choices?.[0]?.finish_reason;
    return {
      text: contentToText(message.content),
      toolCalls: parseToolCalls(message.tool_calls),
      stopReason: finishReason === 'length' ? 'length' : 'stop',
      usage: parseUsage(parsed.usage),
    };
  }
}

/**
 * A test or embedding host can supply its own provider; the plugin surface is identical. The resident
 * itself registers `modelRouterPlugin` (`src/model/router.ts`) instead: it provides the same `model`
 * service while keeping the route table switchable.
 */
export function providedModelPlugin(provider: ModelProvider): NativePlugin {
  return {
    name: 'provided-model',
    provide: ['model'],
    apply(ctx) {
      ctx.provide('model', provider);
    },
  };
}
