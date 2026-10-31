interface OpenAICompatibleClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface OpenAIChatCompleteParams {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  jsonMode?: boolean;
}

interface OpenAIEmbedParams {
  model: string;
  input: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export class OpenAICompatibleClient {
  constructor(private options: OpenAICompatibleClientOptions) {}

  async chatComplete(params: OpenAIChatCompleteParams): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30000);

    try {
      const response = await globalThis.fetch(`${normalizeBaseUrl(this.options.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: params.model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt }
          ],
          temperature: 0,
          max_tokens: params.maxTokens ?? 512,
          ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {})
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        console.warn(`[cogmem] openai_compatible chat failed with HTTP ${response.status}`);
        return '';
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      };
      const message = payload.choices?.[0]?.message;
      // Some OpenAI-compatible providers put the answer in `reasoning_content`
      // and leave `content` empty; returning '' there reads downstream as
      // `provider_invalid_output` with an empty detail. Measured on the box.
      return message?.content?.trim() ? message.content : (message?.reasoning_content ?? '');
    } catch (error) {
      console.warn('[cogmem] openai_compatible chat failed', error);
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }

  async embed(params: OpenAIEmbedParams): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30000);

    try {
      const response = await globalThis.fetch(`${normalizeBaseUrl(this.options.baseUrl)}/embeddings`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: params.model,
          input: params.input
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Embedding HTTP ${response.status}`);
      }

      const payload = await response.json() as {
        data?: Array<{ embedding?: number[] }>;
      };
      return payload.data?.[0]?.embedding ?? [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(): Record<string, string> {
    return this.options.apiKey && this.options.apiKey.trim()
      ? {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`
        }
      : {
          'Content-Type': 'application/json'
        };
  }
}
