import type { MemoryKernelOptions } from '../factory.js';
import { ModelRegistry } from '../models/ModelRegistry.js';
import { type ConfigDiagnosticLike } from './VectorDimension.js';
export type { ConfigDiagnosticLike } from './VectorDimension.js';
export type CogmemConfigKind = 'toml' | 'missing';
export type EnvLike = Record<string, string | undefined>;
export interface CogmemConfigResolution {
    kind: CogmemConfigKind;
    path: string;
}
export interface CogmemConfigResolutionOptions {
    configPath?: string;
    cwd?: string;
    env?: EnvLike;
}
export interface LoadedCogmemConfig {
    configPath: string;
    homeDir: string;
    options: MemoryKernelOptions;
    modelRegistry: ModelRegistry;
    paths: {
        embeddingsDir: string;
        snapshotsDir: string;
        logsDir: string;
    };
    integrations: {
        openclaw: {
            enabled: boolean;
            workspaceDir?: string;
        };
        hermes: {
            enabled: boolean;
            workspaceDir?: string;
        };
    };
    diagnostics: ConfigDiagnosticLike[];
}
export interface LoadCogmemConfigOptions extends CogmemConfigResolutionOptions {
}
export declare function defaultCogmemHome(env?: EnvLike): string;
export declare function defaultCogmemConfigPath(env?: EnvLike): string;
export declare function resolveCogmemConfigPath(options?: CogmemConfigResolutionOptions): CogmemConfigResolution;
export declare function loadCogmemConfig(options?: LoadCogmemConfigOptions): LoadedCogmemConfig;
//# sourceMappingURL=CogmemConfig.d.ts.map