import { Embedder } from './Embedder.js';
import { DeterministicEmbedder } from './DeterministicEmbedder.js';
import { ModelRegistry } from '../models/ModelRegistry.js';

export type EmbeddingBackendId = 'deterministic_local' | 'transformers_remote' | 'openai_compatible';

export interface EmbeddingBackendInfo {
  backendId: EmbeddingBackendId;
  requiresModelSetup: boolean;
  mayDownloadModels: boolean;
}

export function resolveEmbeddingBackendId(modelRegistry?: ModelRegistry): EmbeddingBackendId {
  const role = modelRegistry?.getRoleConfig('embedding');
  if (role?.provider === 'openai_compatible') {
    return 'openai_compatible';
  }
  return 'deterministic_local';
}


class ModelRegistryEmbedder extends Embedder {
  constructor(private readonly embedFn: (text: string) => Promise<number[]>) {
    super();
  }

  async warmup(): Promise<void> {
    this.isLoaded = true;
    this.isWarmedUp = true;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.isWarmedUp) {
      await this.warmup();
    }
    return this.embedFn(text);
  }

  isReady(): boolean {
    return this.isLoaded;
  }

  dispose(): void {
    this.isLoaded = false;
    this.isWarmedUp = false;
  }
}

export function createConfiguredEmbedder(
  vectorDimension?: number,
  modelRegistry: ModelRegistry = ModelRegistry.defaults(),
): Embedder {
  const backendId = resolveEmbeddingBackendId(modelRegistry);
  if (backendId === 'openai_compatible') {
    return new ModelRegistryEmbedder(modelRegistry.getEmbedder());
  }
  return backendId === 'transformers_remote'
    ? new Embedder()
    : new DeterministicEmbedder(vectorDimension);
}
