export interface OpenClawAutoMemoryInstallOptions {
    workspaceRoot: string;
    configPath?: string;
    openclawConfigPath?: string;
    pluginDir?: string;
    bunPath?: string;
    agentId?: string;
    projectId?: string;
    pluginId?: string;
    dryRun?: boolean;
    force?: boolean;
}
export interface OpenClawAutoMemoryInstallResult {
    enabled: true;
    pluginId: string;
    pluginDir: string;
    openclawConfigPath: string;
    configPath: string;
    dryRun: boolean;
    installed: boolean;
    alreadyCurrent: boolean;
    configUpdated: boolean;
    backupPath?: string;
    hookNames: string[];
    nextCommands: string[];
}
export interface OpenClawAutoMemoryPluginInspection {
    pluginId: string;
    pluginDir: string;
    installed: boolean;
    current: boolean;
    version?: string;
    expectedVersion: string;
    files: Array<{
        path: string;
        exists: boolean;
        current: boolean;
        expectedSha256: string;
        actualSha256?: string;
    }>;
}
export declare function defaultOpenClawConfigPath(workspaceRoot: string, env?: NodeJS.ProcessEnv): string;
export declare function defaultOpenClawAutoMemoryPluginDir(workspaceRoot: string): string;
/**
 * The plugin spawns this binary to load the package entry, and that entry imports
 * `bun:sqlite`. A Node binary therefore installs cleanly and only fails later, on
 * every hook, inside the OpenClaw gateway log. Reject it before the config is written.
 */
export declare function assertBunRuntime(bunPath: string): void;
export declare function installOpenClawAutoMemoryPlugin(options: OpenClawAutoMemoryInstallOptions): OpenClawAutoMemoryInstallResult;
export declare function inspectOpenClawAutoMemoryPlugin(options: Pick<OpenClawAutoMemoryInstallOptions, 'workspaceRoot' | 'pluginDir'>): OpenClawAutoMemoryPluginInspection;
//# sourceMappingURL=AutoMemoryPluginInstaller.d.ts.map