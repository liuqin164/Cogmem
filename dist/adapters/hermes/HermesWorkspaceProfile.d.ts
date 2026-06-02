import { type SourceDefinition } from '../types.js';
export interface HermesWorkspaceSourceOptions {
    projectId?: string;
    sessionDir?: string;
    sessionPaths?: string[];
    profilePath?: string;
}
export declare class HermesWorkspaceProfile {
    readonly workspaceRoot: string;
    constructor(workspaceRoot: string);
    buildSourceDefinitions(options?: HermesWorkspaceSourceOptions): SourceDefinition[];
    private relativePath;
}
//# sourceMappingURL=HermesWorkspaceProfile.d.ts.map