export type ModelRoleName = 'memory' | 'reasoning' | 'embedding';

export type ProviderType = 'openai_compatible' | 'anthropic' | 'rule_only' | 'deterministic_local';

export interface ModelRoleConfig {
  role: ModelRoleName;
  provider: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  modelName: string;
  timeoutMs?: number;
  /** Output budget. A memory frame is far larger than the 512-token client default. */
  maxTokens?: number;
  /** Ask the endpoint to constrain decoding to a JSON object (the frame contract). */
  jsonMode?: boolean;
  /**
   * Sent as `input_type` on every embeddings call. Asymmetrical embedders (NVIDIA's
   * `nemotron-3.5-embed-*`, for one) reject a request without it, which made a whole family of
   * models unusable through `openai_compatible`. Omitted when unset, so symmetric endpoints see
   * exactly the request they saw before.
   */
  inputType?: string;
  fallback?: ModelRoleName | 'rule_only' | 'deterministic_local';
}

export interface ModelRegistryConfig {
  memory: ModelRoleConfig;
  reasoning: ModelRoleConfig;
  embedding: ModelRoleConfig;
}

export type TextGenerateFn = (system: string, user: string) => Promise<string>;
export type EmbedFn = (text: string) => Promise<number[]>;
