import { afterEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { OllamaEmbeddingProvider } from '../src/embedding/OllamaEmbeddingProvider.js';
import { QwenAPIEmbeddingProvider } from '../src/embedding/QwenAPIEmbeddingProvider.js';
import { EmbeddingUnavailableError, type EmbeddingProvider } from '../src/embedding/EmbeddingProvider.js';
import { NeuronEmbeddingStore } from '../src/embedding/NeuronEmbeddingStore.js';
import { OpenAICompatibleClient } from '../src/models/providers/OpenAICompatibleClient.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

class DeterministicProvider implements EmbeddingProvider {
  readonly dimensions = 4;
  readonly modelId = 'test/deterministic';
  async embedBatch(texts: string[]) { return texts.map((text) => this.embedSync(text)); }
  async embed(text: string) { return this.embedSync(text); }
  embedSync(text: string) {
    if (/猫|cat|feline/i.test(text)) return new Float32Array([1, 0.9, 0, 0]);
    if (/狗|dog/i.test(text)) return new Float32Array([0.9, 1, 0, 0]);
    return new Float32Array([0, 0, 1, 1]);
  }
}

describe('EmbeddingProvider', () => {
  test('OllamaEmbeddingProvider.embed returns vector dimensions from response', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ embeddings: [Array.from({ length: 1024 }, () => 0.1)] }))) as unknown as typeof fetch;
    expect((await new OllamaEmbeddingProvider().embed('hello')).length).toBe(1024);
  });
  test('OllamaEmbeddingProvider.embedBatch preserves input length', async () => {
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ embeddings: body.input.map(() => Array.from({ length: 1024 }, () => 0.1)) }));
    }) as unknown as typeof fetch;
    expect(await new OllamaEmbeddingProvider({ batchSize: 10 }).embedBatch(['a', 'b'])).toHaveLength(2);
  });
  test('OllamaEmbeddingProvider dimensions are resolved from model table', () => {
    expect(new OllamaEmbeddingProvider({ model: 'qwen3-embedding:0.6b' }).dimensions).toBe(1024);
    expect(new OllamaEmbeddingProvider({ model: 'qwen3-embedding:4b' }).dimensions).toBe(2560);
    expect(new OllamaEmbeddingProvider({ model: 'qwen3-embedding:8b' }).dimensions).toBe(4096);
  });
  test('OllamaEmbeddingProvider rejects vectors that do not match configured model dimensions', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ embeddings: [[1, 0, 0, 0]] }))) as unknown as typeof fetch;
    await expect(new OllamaEmbeddingProvider({ model: 'qwen3-embedding:0.6b' }).embed('x')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });
  test('Ollama unavailable throws EmbeddingUnavailableError', async () => {
    globalThis.fetch = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    await expect(new OllamaEmbeddingProvider({ timeoutMs: 5 }).embed('x')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });
  test('QwenAPIEmbeddingProvider reads compatible embedding response', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3, 4] }] }))) as unknown as typeof fetch;
    expect(Array.from(await new QwenAPIEmbeddingProvider({ apiKey: 'k' }).embed('x'))).toEqual([1, 2, 3, 4]);
  });
  test('NeuronEmbeddingStore.upsert writes and findNearest reads', () => {
    const store = new NeuronEmbeddingStore(new Database(':memory:'));
    store.upsert('n1', 'm', new Float32Array([1, 0]), 'p');
    expect(store.findNearest(new Float32Array([1, 0]), 'p', 1)[0]?.neuronId).toBe('n1');
  });
  test('findNearest returns topK sorted by score', () => {
    const store = new NeuronEmbeddingStore(new Database(':memory:'));
    store.upsert('near', 'm', new Float32Array([1, 0]), 'p');
    store.upsert('far', 'm', new Float32Array([0, 1]), 'p');
    expect(store.findNearest(new Float32Array([1, 0]), 'p', 2).map((r) => r.neuronId)).toEqual(['near']);
  });
  test('same text embeddings are nearly identical', async () => {
    const provider = new DeterministicProvider();
    const store = new NeuronEmbeddingStore(new Database(':memory:'));
    store.upsert('a', provider.modelId, await provider.embed('cat'), 'p');
    expect(store.findNearest(await provider.embed('cat'), 'p', 1)[0].score).toBeGreaterThanOrEqual(0.99);
  });
  test('semantic neighbor scores above unrelated text', async () => {
    const provider = new DeterministicProvider();
    const store = new NeuronEmbeddingStore(new Database(':memory:'));
    store.upsert('cat', provider.modelId, await provider.embed('猫'), 'p');
    store.upsert('random', provider.modelId, await provider.embed('spaceship'), 'p');
    expect(store.findNearest(await provider.embed('feline cat'), 'p', 2)[0].neuronId).toBe('cat');
  });
  test('hasStaleVectors detects model switch', () => {
    const store = new NeuronEmbeddingStore(new Database(':memory:'));
    store.upsert('n1', 'old', new Float32Array([1]), 'p');
    expect(store.hasStaleVectors('new')).toBe(true);
  });
  test('findNearest is project isolated', () => {
    const store = new NeuronEmbeddingStore(new Database(':memory:'));
    store.upsert('p1', 'm', new Float32Array([1, 0]), 'p1');
    store.upsert('p2', 'm', new Float32Array([1, 0]), 'p2');
    expect(store.findNearest(new Float32Array([1, 0]), 'p1', 10).map((r) => r.neuronId)).toEqual(['p1']);
  });
  test('batch and single deterministic embeddings match', async () => {
    const provider = new DeterministicProvider();
    expect(Array.from((await provider.embedBatch(['cat']))[0])).toEqual(Array.from(await provider.embed('cat')));
  });
  test('empty batch returns empty array', async () => {
    expect(await new DeterministicProvider().embedBatch([])).toEqual([]);
  });
});

describe('OpenAI-compatible embeddings', () => {
  test('sends input_type only when it is configured', async () => {
    // Asymmetrical embedders — NVIDIA's `nemotron-3.5-embed-*` among them — reject a request
    // without this field, which is why a whole family of models was unusable through
    // `openai_compatible`. Symmetrical endpoints must keep seeing the body they saw before, so the
    // field is absent, not empty, when no `[embedding] input_type` is set.
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }));
    }) as unknown as typeof fetch;

    const client = new OpenAICompatibleClient({ baseUrl: 'https://example.test/v1', apiKey: 'k' });
    await client.embed({ model: 'm', input: 'x', inputType: 'passage' });
    await client.embed({ model: 'm', input: 'x' });

    expect(bodies[0]).toMatchObject({ model: 'm', input: 'x', input_type: 'passage' });
    expect(bodies[1]).not.toHaveProperty('input_type');
  });
});
