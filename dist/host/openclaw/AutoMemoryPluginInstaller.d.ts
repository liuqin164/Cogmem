export interface OpenClawAutoMemoryInstallOptions {
    workspaceRoot: string;
    configPath?: string;
    openclawConfigPath?: string;
    pluginDir?: string;
    bunPath?: string;
    agentId?: string;
    projectId?: string;
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
export declare function installOpenClawAutoMemoryPlugin(options: OpenClawAutoMemoryInstallOptions): OpenClawAutoMemoryInstallResult;
export declare function inspectOpenClawAutoMemoryPlugin(options: Pick<OpenClawAutoMemoryInstallOptions, 'workspaceRoot' | 'pluginDir'>): OpenClawAutoMemoryPluginInspection;
//# sourceMappingURL=AutoMemoryPluginInstaller.d.ts.map