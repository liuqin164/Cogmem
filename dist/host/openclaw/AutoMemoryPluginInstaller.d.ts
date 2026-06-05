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
export declare function defaultOpenClawConfigPath(workspaceRoot: string, env?: NodeJS.ProcessEnv): string;
export declare function defaultOpenClawAutoMemoryPluginDir(workspaceRoot: string): string;
export declare function installOpenClawAutoMemoryPlugin(options: OpenClawAutoMemoryInstallOptions): OpenClawAutoMemoryInstallResult;
//# sourceMappingURL=AutoMemoryPluginInstaller.d.ts.map