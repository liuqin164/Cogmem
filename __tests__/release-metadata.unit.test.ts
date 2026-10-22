import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';
import { listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { filterToolsByProfile } from '../src/mcp/profiles.js';
import { ALL_MIGRATIONS } from '../src/migrations/index.js';
import { MIGRATION_DIGESTS } from '../src/migrations/MigrationDigestManifest.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = join(coreRoot, 'package.json');

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function packageJson(): {
  name: string;
  version: string;
  scripts: Record<string, string>;
  exports: Record<string, { import: string; types: string }>;
  bin: Record<string, string>;
  files: string[];
  packageManager?: string;
  repository?: { type: string; url: string };
} {
  return JSON.parse(readText(packageJsonPath));
}

describe('core release metadata', () => {
  test('4.0.0 release metadata keeps schema 32 and OpenClaw plugin 0.7.2', () => {
    const manifest = packageJson();
    const readme = readText(join(coreRoot, 'README.md'));
    const contributing = readText(join(coreRoot, 'CONTRIBUTING.md'));
    const changelog = readText(join(coreRoot, 'CHANGELOG.md'));
    const checklist = readText(join(coreRoot, 'RELEASE_CHECKLIST.md'));

    expect(manifest.name).toBe('cogmem');
    expect(manifest.version).toBe('4.0.0');
    expect(manifest.description).toContain('agent-native memory kernel');
    expect(manifest.repository?.url).toBe('git+https://github.com/liuqin164/cogmem.git');
    expect(readme).toContain('curl -fsSL https://raw.githubusercontent.com/liuqin164/cogmem/main/install.sh | bash');
    expect(readme).toContain('npm registry');
    expect(readme).toContain('npm install cogmem@latest');
    expect(readme).not.toContain('CognitiveOS-core');
    expect(readme).not.toContain('@CognitiveOS/core');
    expect(contributing).toContain('npm pack --dry-run --json');
    expect(contributing).toContain('npm publish --provenance --access public');
    expect(readme).toContain('Current version: `4.0.0`');
    expect(changelog).toContain('## 4.0.0');
    expect(checklist).toContain('# cogmem 4.0.0 Release Checklist');
    expect(ALL_MIGRATIONS.at(-1)?.version).toBe('0032');
    expect(Number.parseInt(ALL_MIGRATIONS.at(-1)!.version, 10)).toBe(32);
    expect(ALL_MIGRATIONS.some((migration) => migration.version === '0033')).toBe(false);
    expect(readdirSync(join(coreRoot, 'src', 'migrations')).some((file) => file.startsWith('0033_'))).toBe(false);
    expect(Object.keys(MIGRATION_DIGESTS).sort().at(-1)).toBe('0032');
    expect(MIGRATION_DIGESTS['0032']).toBe('a49bc9069fdd9270eb9108fce707076d3daf83a31a4ced583469a7f8ece8c5f1');
    expect(inspectOpenClawAutoMemoryPlugin({ workspaceRoot: coreRoot }).expectedVersion).toBe('0.7.2');
    expect(checklist).toContain('npm publish --provenance --access public');
  });

  test('GitHub release workflow publishes through npm trusted publishing only on release publication', () => {
    const manifest = packageJson();
    const workflow = readText(join(coreRoot, '.github', 'workflows', 'publish.yml'));

    expect(workflow).toContain('release:');
    expect(workflow).toContain('types: [published]');
    expect(workflow).not.toContain('push:');
    expect(workflow).not.toContain('tags:');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('environment: npm publish');
    expect(workflow).toContain('node-version: 24.12.0');
    expect(workflow).toContain('npm@11.6.2');
    expect(workflow).toContain('bun-version: 1.3.11');
    expect(workflow).toContain('bun install --frozen-lockfile');
    expect(workflow).toContain('sha256sum bun.lock');
    expect(manifest.packageManager).toBe('bun@1.3.11');
    expect(workflow).toContain('bun test __tests__');
    expect(workflow).toContain('npm pack --dry-run --json');
    expect(workflow).toContain('npm publish --provenance --access public');
    expect(workflow).toContain('github.event.release.tag_name');
  });

  test('one-line installer is tracked and installs the npm package', () => {
    const installer = readText(join(coreRoot, 'install.sh'));

    expect(installer).toContain('PACKAGE_SPEC');
    expect(installer).toContain('cogmem@$PACKAGE_SPEC');
    expect(installer).toContain('bun add');
    expect(installer).toContain('"$BIN_DIR/cogmem" init');
    expect(installer).toContain('/dev/tty');
    expect(installer).not.toContain('/releases/latest');
    expect(installer).not.toContain('CognitiveOS-core');
    expect(installer).not.toContain('@CognitiveOS/core');
  });

  test('local databases and desktop metadata are not tracked as release files', async () => {
    const proc = Bun.spawn({
      cmd: ['git', 'ls-files'],
      cwd: coreRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    const errorOutput = await new Response(proc.stderr).text();
    expect(errorOutput).toBe('');
    expect(await proc.exited).toBe(0);

    const files = output.trim().split(/\n+/).filter(Boolean);
    expect(files).not.toContain('.DS_Store');
    expect(files).not.toContain('cogmem.db');
    expect(files).not.toContain('brain.db');
    expect(files).not.toContain('brain.db-shm');
    expect(files).not.toContain('brain.db-wal');
    expect(files).not.toContain('cogmem.db');
    expect(files).not.toContain('cogmem.db-shm');
    expect(files).not.toContain('cogmem.db-wal');
    expect(files).not.toContain('dist/.tsbuildinfo');
  });

  test('package exposes stable public exports and keeps internal on explicit subpath only', () => {
    const manifest = packageJson();

    expect(manifest.main).toBe('./dist/public.js');
    expect(manifest.types).toBe('./dist/public.d.ts');
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './internal']);
    expect(manifest.exports['.']).toEqual({
      import: './dist/public.js',
      types: './dist/public.d.ts',
    });
    expect(manifest.exports['./internal']).toEqual({
      import: './dist/internal.js',
      types: './dist/internal.d.ts',
    });
  });

  test('type command aliases the existing typecheck gate for Bun workspace filters', () => {
    const manifest = packageJson();

    expect(manifest.scripts.type).toBe(manifest.scripts.typecheck);
    expect(manifest.scripts.type).toContain('--noEmit');
  });

  test('every package CLI bin has a source entrypoint', () => {
    const manifest = packageJson();
    const expectedBins = [
      'cogmem',
      'cogmem-brain-eval',
      'cogmem-compact',
      'cogmem-connect',
      'cogmem-doctor',
      'cogmem-dream',
      'cogmem-episode',
      'cogmem-explain-recall',
      'cogmem-import-hermes',
      'cogmem-import-openclaw',
      'cogmem-init',
      'cogmem-mcp',
      'cogmem-memory',
      'cogmem-migrate',
      'cogmem-migrate-vectors',
      'cogmem-normalize-transcript',
      'cogmem-openclaw',
      'cogmem-prospective',
      'cogmem-re-embed',
      'cogmem-repair',
      'cogmem-snapshot',
      'cogmem-strategy',
      'cogmem-update',
    ];

    expect(Object.keys(manifest.bin).sort()).toEqual(expectedBins);
    for (const target of Object.values(manifest.bin)) {
      const source = target.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      expect(existsSync(join(coreRoot, source))).toBe(true);
    }
  });

  test('release docs included in pack file whitelist', () => {
    const manifest = packageJson();

    expect(manifest.files).toContain('README.md');
    expect(manifest.files).toContain('MEMORY_ATLAS.md');
    expect(manifest.files).toContain('examples/**/*.md');
    expect(manifest.files).toContain('install.sh');
    expect(manifest.files).toContain('MEMORY_MODEL.md');
    expect(manifest.files).toContain('RECALL_EXPLAINABILITY.md');
    expect(manifest.files).toContain('BENCHMARKS.md');
    expect(manifest.files).toContain('SECURITY.md');
    expect(manifest.files).toContain('CONTRIBUTING.md');
    expect(manifest.files).toContain('CHANGELOG.md');
    expect(manifest.files).toContain('RELEASE_CHECKLIST.md');
  });

  test('agent-facing docs describe chronological ledger, source anchors, and natural emergence metrics', () => {
    const memoryModel = readText(join(coreRoot, 'MEMORY_MODEL.md'));
    const explainability = readText(join(coreRoot, 'RECALL_EXPLAINABILITY.md'));
    const benchmarks = readText(join(coreRoot, 'BENCHMARKS.md'));

    expect(memoryModel).toContain('Chronological Memory Ledger');
    expect(memoryModel).toContain('Raw Archive');
    expect(memoryModel).toContain('Compiled Memory');
    expect(memoryModel).toContain('chronological order is not recall ranking');
    expect(memoryModel).toContain('sourceRefs');
    expect(memoryModel).toContain('not a vector RAG store');
    expect(memoryModel).toContain('Memory Atlas projection');
    expect(memoryModel).toContain('rawEventType');
    expect(memoryModel).toContain('tool_result');
    expect(memoryModel).toContain('Normalized JSON array, JSONL, CSV, and TSV transcript imports');
    expect(explainability).toContain('sourceAnchor');
    expect(explainability).toContain('filteredEvidence');
    expect(explainability).toContain('same-project');
    expect(explainability).toContain('tool_call');
    expect(explainability).toContain('normalized JSON/CSV imports');
    expect(explainability).toContain('Memory Atlas versus direct recall');
    expect(benchmarks).toContain('memory_natural_emergence');
    expect(benchmarks).toContain('critical_memory_recall_rate');
    expect(benchmarks).toContain('inhibition_correctness_rate');
  });
});

describe('documented tool profile counts match the shipped registry', () => {
  test('mcp-hosts.md, README, and CHANGELOG state the real core / admin / full counts', () => {
    const all = listCogmemMcpTools();
    const core = filterToolsByProfile('core', all).length;
    const admin = filterToolsByProfile('admin', all).length;
    const full = filterToolsByProfile('full', all).length;

    const hosts = readText(join(coreRoot, 'docs', 'mcp-hosts.md'));
    const readme = readText(join(coreRoot, 'README.md'));
    const changelog = readText(join(coreRoot, 'CHANGELOG.md'));

    expect(core).toBe(8);
    expect(admin).toBe(23);
    expect(full).toBe(37);

    expect(hosts).toContain(`The server exposes ${full} tools.`);
    expect(hosts).toContain('| `core` | ' + core + ' |');
    expect(hosts).toContain('| `admin` | ' + admin + ' |');
    expect(hosts).toContain('| `full` | ' + full + ' |');
    expect(hosts).toContain(`sees ${core} tools`);
    expect(hosts).toContain(`8 means the\n\`core\` profile, 37 means \`full\``);
    expect(readme).toContain(`bounds the tool surface to ${core}, ${admin}, or ${full} tools`);
    expect(changelog).toContain('`core` (' + core + '), `admin` (' + admin + '), `full` (' + full + ')');
  });

  test('every host section cites a vendor reference, and the unverified ones say so', () => {
    const hosts = readText(join(coreRoot, 'docs', 'mcp-hosts.md'));

    for (const url of [
      'https://code.claude.com/docs/en/mcp',
      'https://cursor.com/docs/mcp',
      'https://developers.openai.com/codex/mcp',
      'https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference',
      'https://docs.openclaw.ai/tools/mcp',
    ]) {
      expect(hosts).toContain(url);
    }

    // Claude Code skips a remote entry that has a url but no type. The doc has
    // to show the field, not just the CLI form.
    expect(hosts).toContain('"type": "http"');
    expect(hosts).toContain('has a "url" but no "type"');
  });

  test('mcp-hosts.md names the commands that actually exist in each host CLI', () => {
    const hosts = readText(join(coreRoot, 'docs', 'mcp-hosts.md'));

    // OpenClaw 2026.10.5: there is `mcp unset`, not `mcp remove`, and a bare
    // `mcp probe` spanning all servers. `openclaw mcp remove` exits with
    // `OpenClaw mcp has no command "remove"`.
    expect(hosts).toContain('openclaw mcp unset <name>');
    expect(hosts).toContain('openclaw mcp probe');
    expect(hosts).not.toMatch(/openclaw mcp remove(?!\s*` does not exist)/);

    // Hermes v0.22.2: stdin only works when both answers are given.
    expect(hosts).toContain('hermes mcp test cogmem');
    expect(hosts).toContain('hermes mcp remove <name>');
    expect(hosts).not.toContain('piping the answers in does not work');

    // The bare initialize curl gets a 400 without a session header on the
    // follow-up call, so the doc has to teach the session id.
    expect(hosts).toContain("mcp-session-id: $SID");
    expect(hosts).toContain('notifications/initialized');
  });

  test('mcp-hosts.md documents the stdio and systemd paths that actually run', () => {
    const hosts = readText(join(coreRoot, 'docs', 'mcp-hosts.md'));

    // `cogmem-mcp` is a bin entry, so it only exists after a global install.
    // A source checkout has to point at the entrypoint instead.
    expect(hosts).toContain('npm install -g cogmem');
    expect(hosts).toContain('dist/bin/mcp.js');

    // A missing --db parent used to fail the server outright. It now creates
    // the directory, so the error string is only the post-3.7.5 fallback.
    expect(hosts).toContain('unable to open database file');

    // `%h/.local/bin/cogmem` is not where npm installs, and a bare `cogmem`
    // is not on the systemd user manager's PATH. Both exit 203/EXEC.
    expect(hosts).not.toContain('ExecStart=%h/.local/bin/cogmem');
    expect(hosts).toContain('203/EXEC');
    expect(hosts).toContain('npm config get prefix');
    expect(hosts).toContain('systemctl --user show-environment');
  });

  test('the dist entrypoint agrees with its source', () => {
    // dist is checked in, so a stale build ships. A stale dist/bin/mcp.js once
    // opened a bare Database before the kernel existed, which created
    // shared_items first and made a fresh DB fail schema detection with
    // `unsupported_database_identity`. Each entrypoint must resolve shared
    // memory from the kernel, never from a second Database handle.
    const source = readText(join(coreRoot, 'src', 'bin', 'mcp.ts'));
    const built = readText(join(coreRoot, 'dist', 'bin', 'mcp.js'));

    expect(source).not.toContain('new SqliteSharedMemory(new Database');
    expect(built).not.toContain('new SqliteSharedMemory(new Database');
  });

  test('the build swaps dist in only after tsc succeeds', () => {
    // dist is tracked in git. The old build ran `rmSync('dist')` before `tsc`,
    // so an interrupted or failing compile left the working tree with every
    // built file deleted: a killed `npm publish --dry-run` (which runs
    // prepublishOnly -> build) wiped all 1314 tracked dist files mid-release.
    const manifest = packageJson();
    expect(manifest.scripts.build).toBe('node scripts/build.mjs');
    expect(manifest.scripts.prepare).toBe('node scripts/build.mjs');

    const build = readText(join(coreRoot, 'scripts', 'build.mjs'));
    expect(build).toContain("const staging = 'dist.next'");
    expect(build).toContain('--outDir');

    // The failure branch must exit before anything is renamed into place.
    const failureExit = build.indexOf('tsc.status !== 0');
    const swap = build.indexOf("renameSync(staging, 'dist')");
    expect(failureExit).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(failureExit);

    expect(readText(join(coreRoot, '.gitignore'))).toContain('dist.next/');
  });
});
