// @ts-nocheck
import type {
  EmbedFn,
  ModelRegistryConfig,
  ModelRoleConfig,
  ModelRoleName,
  ProviderType,
  TextGenerateFn
} from './ModelRole.js';
import { AnthropicClient } from './providers/AnthropicClient.js';
import { OpenAICompatibleClient } from './providers/OpenAICompatibleClient.js';

export class ModelRegistry {
  constructor(private config: ModelRegistryConfig) {}

  static defaultConfig(): ModelRegistryConfig {
    return {
      memory: {
        role: 'memory',
        provider: 'rule_only',
        baseUrl: '',
        apiKey: '',
        modelName: 'rule_only',
        timeoutMs: 60000,
        maxTokens: 8192,
        fallback: 'rule_only'
      },
      reasoning: {
        role: 'reasoning',
        provider: 'rule_only',
        baseUrl: '',
        apiKey: '',
        modelName: 'rule_only',
        timeoutMs: 60000,
        fallback: 'memory'
      },
      embedding: {
        role: 'embedding',
        provider: 'deterministic_local',
        baseUrl: '',
        apiKey: '',
        modelName: 'deterministic_local',
        timeoutMs: 30000
      }
    };
  }

  static defaults(): ModelRegistry {
    return new ModelRegistry(ModelRegistry.defaultConfig());
  }

  getTextGenerator(role: 'memory' | 'reasoning'): TextGenerateFn {
    return async (system: string, user: string): Promise<string> => {
      return this.generateText(role, system, user, new Set<ModelRoleName>());
    };
  }

  getRoleConfig(role: ModelRoleName): ModelRoleConfig {
    return { ...this.config[role] };
  }

  getEmbedder(): EmbedFn {
    const role = this.config.embedding;
    if (role.provider === 'deterministic_local') {
      throw new Error('Embedding role uses deterministic_local; caller should use Embedder directly.');
    }
    if (role.provider !== 'openai_compatible') {
      throw new Error(`Unsupported embedding provider: ${role.provider}`);
    }

    const client = new OpenAICompatibleClient({
      baseUrl: role.baseUrl || 'http://localhost:11434/v1',
      apiKey: role.apiKey,
      timeoutMs: role.timeoutMs
    });
    return async (text: string): Promise<number[]> => client.embed({
      model: role.modelName,
      input: text
    });
  }

  isRuleOnly(role: 'memory' | 'reasoning'): boolean {
    return this.resolveTextProvider(role, new Set<ModelRoleName>()) === 'rule_only';
  }

  private async generateText(
    roleName: 'memory' | 'reasoning',
    system: string,
    user: string,
    visited: Set<ModelRoleName>
  ): Promise<string> {
    if (visited.has(roleName)) return '';
    visited.add(roleName);

    const role = this.config[roleName];
    if (role.provider === 'openai_compatible') {
      const client = new OpenAICompatibleClient({
        baseUrl: role.baseUrl || 'http://localhost:11434/v1',
        apiKey: role.apiKey,
        timeoutMs: role.timeoutMs
      });
      const result = await client.chatComplete({
        model: role.modelName,
        systemPrompt: system,
        userPrompt: user,
        maxTokens: role.maxTokens,
        jsonMode: role.jsonMode
      });
      if (result.trim()) return result;
      return this.runFallback(role.fallback, system, user, visited);
    }

    if (role.provider === 'anthropic') {
      if (!role.apiKey?.trim()) {
        return this.runFallback(role.fallback, system, user, visited);
      }
      const client = new AnthropicClient({
        apiKey: role.apiKey,
        timeoutMs: role.timeoutMs
      });
      const result = await client.chatComplete({
        model: role.modelName,
        systemPrompt: system,
        userPrompt: user
      });
      if (result.trim()) return result;
      return this.runFallback(role.fallback, system, user, visited);
    }

    return this.runFallback(role.fallback, system, user, visited);
  }

  private async runFallback(
    fallback: ModelRoleConfig['fallback'],
    system: string,
    user: string,
    visited: Set<ModelRoleName>
  ): Promise<string> {
    if (!fallback || fallback === 'rule_only' || fallback === 'deterministic_local') return '';
    return this.generateText(fallback, system, user, visited);
  }

  private resolveTextProvider(roleName: 'memory' | 'reasoning', visited: Set<ModelRoleName>): ProviderType {
    if (visited.has(roleName)) return 'rule_only';
    visited.add(roleName);

    const role = this.config[roleName];
    if (role.provider === 'rule_only') {
      if (!role.fallback || role.fallback === 'rule_only' || role.fallback === 'deterministic_local') {
        return 'rule_only';
      }
      if (role.fallback === 'memory' || role.fallback === 'reasoning') {
        return this.resolveTextProvider(role.fallback, visited);
      }
      return 'rule_only';
    }

    if (role.provider === 'deterministic_local') return 'rule_only';
    return role.provider;
  }
}
