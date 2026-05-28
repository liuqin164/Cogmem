import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { computeStableHash, type SourceAdapterKind, type SourceDefinition } from '../types.js';

export type OpenClawSourceClassification =
  | 'memory_source'
  | 'identity_profile_source'
  | 'operational_ignore'
  | 'unknown';

export interface OpenClawClassifiedPath {
  path: string;
  relativePath: string;
  classification: OpenClawSourceClassification;
  adapterKind?: SourceAdapterKind;
  reason: string;
}

export interface OpenClawWorkspaceSourceOptions {
  projectId?: string;
  date?: string;
  sessionPaths?: string[];
  optionalMemoryPaths?: string[];
}

export interface OpenClawWorkspaceSelectionDiagnostic extends OpenClawClassifiedPath {
  explicit: boolean;
  exists: boolean;
  included: boolean;
}

export interface OpenClawWorkspaceSelection {
  sources: SourceDefinition[];
  diagnostics: OpenClawWorkspaceSelectionDiagnostic[];
}

const REQUIRED_MEMORY_FILES = [
  'MEMORY.md',
  'memory',
  'USER.md',
  'SOUL.md',
] as const;

const SESSION_DIR_CANDIDATES = [
  'sessions',
  'session-logs',
  'session_logs',
  'conversations',
  join('exports', 'sessions'),
  join('exports', 'conversations'),
];

export class OpenClawWorkspaceProfile {
  readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  static discoverWorkspaceRoot(startPath: string): string | null {
    let current = resolve(startPath);
    try {
      if (!statSync(current).isDirectory()) current = dirname(current);
    } catch {
      return null;
    }

    while (true) {
      if (this.looksLikeWorkspaceRoot(current)) return current;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }

  static looksLikeWorkspaceRoot(candidate: string): boolean {
    return REQUIRED_MEMORY_FILES.some((entry) => existsSync(join(candidate, entry)));
  }

  classifyPath(filePath: string): OpenClawClassifiedPath {
    const absolutePath = resolve(filePath);
    const rel = relative(this.workspaceRoot, absolutePath);
    const normalized = rel.replace(/\\/g, '/');
    const name = basename(absolutePath);

    if (name === 'USER.md') {
      return this.result(absolutePath, normalized, 'identity_profile_source', 'openclaw_user_profile', 'Static user seed/profile source.');
    }
    if (name === 'SOUL.md' || name === 'IDENTITY.md' || name === 'PERSONA.md') {
      return this.result(absolutePath, normalized, 'identity_profile_source', 'openclaw_persona', 'Agent persona/identity source, not episodic memory.');
    }
    if (name === 'MEMORY.md') {
      return this.result(absolutePath, normalized, 'memory_source', 'openclaw_memory_index', 'Imported summary/index memory source.');
    }
    if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/i.test(normalized)) {
      return this.result(absolutePath, normalized, 'memory_source', 'openclaw_daily_memory', 'Daily episodic memory source.');
    }
    if (this.isSessionPath(normalized)) {
      return this.result(absolutePath, normalized, 'memory_source', 'openclaw_session', 'Session log / exported conversation source.');
    }
    if (name === 'AGENTS.md' || name === 'TOOLS.md' || name === 'HEARTBEAT.md' || name === 'BOOTSTRAP.md') {
      return this.result(absolutePath, normalized, 'operational_ignore', undefined, 'Operational/bootstrap source; do not import into long-term brain by default.');
    }
    if (/(^|\/)(dialogues|threads|chatlogs|catchups?)\//i.test(normalized)) {
      return this.result(absolutePath, normalized, 'unknown', undefined, 'Session-like markdown outside the default reference layout. Pass it explicitly as a session path.');
    }
    if (/(^|\/)(notes|project-memory|project_memory|daily-notes|memories)\//i.test(normalized)) {
      return this.result(absolutePath, normalized, 'unknown', undefined, 'Memory-like markdown outside the default reference layout. Pass it explicitly as project memory.');
    }
    return this.result(absolutePath, normalized, 'unknown', undefined, 'Not part of the default OpenClaw reference workspace contract.');
  }

  listReferenceWorkspaceContract(): OpenClawClassifiedPath[] {
    return [
      'SOUL.md',
      'USER.md',
      'PERSONA.md',
      'IDENTITY.md',
      'MEMORY.md',
      join('memory', 'YYYY-MM-DD.md'),
      join('sessions', '<exported-conversation>.md'),
      'AGENTS.md',
      'TOOLS.md',
      'HEARTBEAT.md',
      'BOOTSTRAP.md',
    ].map((entry) => this.classifyPath(join(this.workspaceRoot, entry)));
  }

  buildInstalledBatchSources(options: OpenClawWorkspaceSourceOptions = {}): SourceDefinition[] {
    return this.buildInstalledBatchSelection(options).sources;
  }

  buildInstalledBatchSelection(options: OpenClawWorkspaceSourceOptions = {}): OpenClawWorkspaceSelection {
    const projectId = options.projectId || basename(this.workspaceRoot);
    const discoveredPaths = new Set<string>();
    const diagnostics = new Map<string, OpenClawWorkspaceSelectionDiagnostic>();
    const date = options.date;

    const maybeAdd = (path: string, explicit = false, mode?: 'session' | 'project_memory'): void => {
      const absolute = resolve(path);
      const exists = existsSync(absolute) && statSync(absolute).isFile();
      const classified = exists
        ? (mode ? this.classifyExplicitPath(absolute, mode) : this.classifyPath(absolute))
        : this.result(absolute, relative(this.workspaceRoot, absolute).replace(/\\/g, '/'), 'unknown', undefined, 'Explicit path does not exist or is not a file.');
      const included = Boolean(exists && classified.adapterKind);

      diagnostics.set(absolute, {
        ...classified,
        explicit,
        exists,
        included,
      });

      if (included) discoveredPaths.add(absolute);
    };

    maybeAdd(join(this.workspaceRoot, 'USER.md'));
    maybeAdd(join(this.workspaceRoot, 'SOUL.md'));
    maybeAdd(join(this.workspaceRoot, 'PERSONA.md'));
    maybeAdd(join(this.workspaceRoot, 'IDENTITY.md'));
    maybeAdd(join(this.workspaceRoot, 'MEMORY.md'));

    const memoryDir = join(this.workspaceRoot, 'memory');
    if (date) {
      maybeAdd(join(memoryDir, `${date}.md`));
    } else if (existsSync(memoryDir)) {
      for (const child of readdirSync(memoryDir)) {
        if (/^\d{4}-\d{2}-\d{2}\.md$/i.test(child)) maybeAdd(join(memoryDir, child));
      }
    }

    for (const sessionPath of options.sessionPaths || []) maybeAdd(sessionPath, true, 'session');
    for (const memoryPath of options.optionalMemoryPaths || []) maybeAdd(memoryPath, true, 'project_memory');

    if ((options.sessionPaths || []).length === 0) {
      for (const sessionDir of SESSION_DIR_CANDIDATES) {
        const dir = join(this.workspaceRoot, sessionDir);
        if (!existsSync(dir)) continue;
        for (const child of readdirSync(dir)) {
          if (!/\.(md|markdown)$/i.test(child)) continue;
          if (date && !child.includes(date)) continue;
          maybeAdd(join(dir, child));
        }
      }
    }

    const sources = Array.from(discoveredPaths)
      .map((path) => diagnostics.get(path) || this.classifyPath(path))
      .filter((item) => item.adapterKind)
      .map((item) => ({
        sourceId: `openclaw-${item.adapterKind}-${computeStableHash([projectId, item.relativePath]).slice(0, 12)}`,
        adapterKind: item.adapterKind!,
        sourcePath: item.path,
        projectId,
        tags: ['openclaw'],
        metadata: {
          openclawWorkspaceRoot: this.workspaceRoot,
          openclawRelativePath: item.relativePath,
          classification: item.classification,
        },
      }));

    return {
      sources,
      diagnostics: Array.from(diagnostics.values()),
    };
  }

  private classifyExplicitPath(
    filePath: string,
    mode: 'session' | 'project_memory',
  ): OpenClawClassifiedPath {
    const absolutePath = resolve(filePath);
    const normalized = relative(this.workspaceRoot, absolutePath).replace(/\\/g, '/');
    const name = basename(absolutePath);

    if (mode === 'session') {
      return this.result(
        absolutePath,
        normalized,
        'memory_source',
        'openclaw_session',
        'Explicit session override accepted for non-standard layout.',
      );
    }

    if (name === 'MEMORY.md') {
      return this.result(
        absolutePath,
        normalized,
        'memory_source',
        'openclaw_memory_index',
        'Explicit project-memory override accepted as imported memory index.',
      );
    }

    return this.result(
      absolutePath,
      normalized,
      'memory_source',
      'openclaw_daily_memory',
      'Explicit project-memory override accepted for non-standard layout.',
    );
  }

  private isSessionPath(relativePathValue: string): boolean {
    return SESSION_DIR_CANDIDATES.some((dir) => relativePathValue.startsWith(`${dir.replace(/\\/g, '/')}/`));
  }

  private result(
    path: string,
    relativePathValue: string,
    classification: OpenClawSourceClassification,
    adapterKind: SourceAdapterKind | undefined,
    reason: string,
  ): OpenClawClassifiedPath {
    return {
      path,
      relativePath: relativePathValue,
      classification,
      adapterKind,
      reason,
    };
  }
}
