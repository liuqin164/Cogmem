#!/usr/bin/env bun
/**
 * cogmem-init — Interactive configuration wizard for @CognitiveOS/core
 *
 * Guides new users through:
 *  1. Database path
 *  2. Vector backend (sqlite-vec vs hnswlib)
 *  3. Embedding provider (auto-detected from Ollama / env keys)
 *  4. Memory & reasoning model roles
 *  5. PII redaction policy
 *  6. AES-256-GCM encryption passphrase (optional)
 *  7. OpenClaw workspace integration (auto-detected)
 *
 * Writes a `.cogmem/config.toml` file loadable by `createMemoryKernelFromConfig()`.
 */
export interface DetectionResult {
    ollamaAvailable: boolean;
    ollamaModels: string[];
    openaiAvailable: boolean;
    anthropicAvailable: boolean;
    qwenAvailable: boolean;
}
export declare function suggestEmbeddingModel(det: DetectionResult): {
    provider: 'deterministic_local' | 'openai_compatible';
    model: string;
    baseUrl: string;
    vectorDimension: number;
};
export declare function inferEmbeddingVectorDimension(provider: 'deterministic_local' | 'openai_compatible', model: string): number;
//# sourceMappingURL=init.d.ts.map