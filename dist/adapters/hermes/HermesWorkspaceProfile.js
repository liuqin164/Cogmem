import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { computeStableHash } from '../types.js';
export class HermesWorkspaceProfile {
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = resolve(workspaceRoot);
    }
    buildSourceDefinitions(options = {}) {
        const projectId = options.projectId ?? basename(this.workspaceRoot);
        const sources = [];
        const profilePath = resolve(this.workspaceRoot, options.profilePath ?? 'profile.md');
        if (existsSync(profilePath) && statSync(profilePath).isFile()) {
            sources.push({
                sourceId: `hermes-profile-${computeStableHash([projectId, this.relativePath(profilePath)]).slice(0, 12)}`,
                adapterKind: 'soul_markdown',
                sourcePath: profilePath,
                projectId,
                tags: ['hermes', 'profile'],
                metadata: {
                    hermesWorkspaceRoot: this.workspaceRoot,
                    hermesRelativePath: this.relativePath(profilePath),
                    hermesSourceClass: 'profile',
                },
            });
        }
        const sessionDir = resolve(this.workspaceRoot, options.sessionDir ?? 'sessions');
        const sessionPaths = uniquePaths([
            ...listMarkdownFiles(sessionDir),
            ...(options.sessionPaths || []),
        ]);
        for (const sourcePath of sessionPaths) {
            if (!existsSync(sourcePath) || !statSync(sourcePath).isFile())
                continue;
            sources.push({
                sourceId: `hermes-session-${computeStableHash([projectId, this.relativePath(sourcePath)]).slice(0, 12)}`,
                adapterKind: 'conversation_markdown',
                sourcePath,
                projectId,
                tags: ['hermes', 'session'],
                metadata: {
                    hermesWorkspaceRoot: this.workspaceRoot,
                    hermesRelativePath: this.relativePath(sourcePath),
                    hermesSourceClass: 'session',
                },
            });
        }
        return sources;
    }
    relativePath(filePath) {
        return relative(this.workspaceRoot, filePath).replace(/\\/g, '/');
    }
}
function uniquePaths(paths) {
    return Array.from(new Set(paths.map((item) => resolve(item))));
}
function listMarkdownFiles(dir) {
    if (!existsSync(dir))
        return [];
    const entries = readdirSync(dir).map((entry) => join(dir, entry));
    return entries.flatMap((entry) => {
        const stat = statSync(entry);
        if (stat.isDirectory())
            return listMarkdownFiles(entry);
        return /\.(md|markdown)$/i.test(entry) ? [entry] : [];
    });
}
