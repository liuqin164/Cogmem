import { describe, expect, test } from 'bun:test';
import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LATEST_SCHEMA_VERSION } from '../src/migrations/v3_7_4/FinalSchema.js';

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
  test('5.0.0 release metadata keeps schema 32', () => {
    const manifest = packageJson();
    const readme = readText(join(coreRoot, 'README.md'));
    const contributing = readText(join(coreRoot, 'CONTRIBUTING.md'));
    const changelog = readText(join(coreRoot, 'CHANGELOG.md'));
    const checklist = readText(join(coreRoot, 'RELEASE_CHECKLIST.md'));

    expect(manifest.name).toBe('cogmem');
    expect(manifest.version).toBe('5.0.0');
    expect(manifest.description).toContain('resident companion agent');
    expect(manifest.repository?.url).toBe('git+https://github.com/liuqin164/Cog.git');
    expect(readme).toContain('curl -fsSL https://raw.githubusercontent.com/liuqin164/Cog/main/install.sh | bash');
    expect(readme).toContain('npm registry');
    expect(readme).toContain('npm install cogmem@latest');
    expect(readme).not.toContain('CognitiveOS-core');
    expect(readme).not.toContain('@CognitiveOS/core');
    expect(contributing).toContain('npm pack --dry-run --json');
    expect(contributing).toContain('npm publish --provenance --access public');
    // The version is a release fact, not a README one: package.json owns it and the changelog has
    // to agree, so the README can stay a landing page.
    expect(changelog).toContain(manifest.version);
    expect(changelog).toContain('## 4.1.0');
    expect(checklist).toContain('# Cog 5.0.0 Release Checklist');
    // 4.0 ships no ordered migration list (ADR-0007): one schema, created
    // directly. What is worth pinning is that the schema is 0032 and that the
    // number the identity check writes agrees with it.
    expect(LATEST_SCHEMA_VERSION).toBe(32);
    expect(readdirSync(join(coreRoot, 'src', 'migrations')).some((file) => file.startsWith('0033_'))).toBe(false);
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
    expect(installer).not.toContain('/releases/latest');
    expect(installer).not.toContain('CognitiveOS-core');
    expect(installer).not.toContain('@CognitiveOS/core');
  });

  test('the installer installs and stops: it never runs the wizard', () => {
    const installer = readText(join(coreRoot, 'install.sh'));

    // The installer installs and links. Setup is a separate, visible step.
    expect(installer).not.toContain('/dev/tty');
    expect(installer).not.toContain('COGMEM_INIT_ARGS');
    expect(installer).not.toMatch(/cogmem"?\s+init\s*[<"]/);
    // Both Install paths are named with their actors — by the gate, which the
    // installer runs and which reads them from the shared step list. The shell
    // must not restate them: that copy is what #40 item 7 forbids, and it had
    // already drifted from the shared version.
    expect(installer).toContain('doctor');
    expect(installer).not.toMatch(/\[operator\] +%s init/);
    expect(installer).not.toMatch(/\[agent\] +%s init/);
    // The old switch still works, and does nothing.
    expect(installer).toContain('COGMEM_SKIP_INIT');
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
    // #53: dist/ is generated and must not be tracked. A fresh clone builds it.
    expect(files.filter((file) => file.startsWith('dist/'))).toEqual([]);
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
    // Two bins since R5 of #200: `cog` is the product's own entry point (the companion
    // shell, #167) and `cogmem` the management CLI. The `cogmem-*` aliases are gone (#112)
    // and the MCP server bin went with its surface (R2), so a name that is not a command
    // cannot be invoked at all.
    expect(Object.keys(manifest.bin).sort()).toEqual(['cog', 'cogmem']);

    for (const target of Object.values(manifest.bin)) {
      const source = target.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      expect(existsSync(join(coreRoot, source))).toBe(true);
    }
  });

  test('the README stays a landing page: no version wording, no Status section, no badge', () => {
    // Ryu 2026-11-03, still in force for 5.0: the version number lives in package.json
    // only. `CHANGELOG.md` and `RELEASE_CHECKLIST.md` are where a release fact belongs.
    const readme = readText(join(coreRoot, 'README.md'));

    expect(readme).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    expect(readme).not.toMatch(/\b(?:version|v)\s*\d/i);
    expect(readme).not.toMatch(/^#{1,3}\s*Status\b/im);
    // A badge is an image in the header, and a version badge is the one that keeps coming
    // back. The licence badge is the only badge the README is allowed to carry.
    const badges = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]!);
    expect(badges.filter((url) => !url.includes('License-MIT'))).toEqual([]);
  });

  test('release docs included in pack file whitelist', () => {
    const manifest = packageJson();

    expect(manifest.files).toContain('README.md');
    expect(manifest.files).toContain('MEMORY_ATLAS.md');
    expect(manifest.files).toContain('install.sh');
    expect(manifest.files).toContain('MEMORY_MODEL.md');
    expect(manifest.files).toContain('RECALL_EXPLAINABILITY.md');
    expect(manifest.files).toContain('BENCHMARKS.md');
    expect(manifest.files).toContain('SECURITY.md');
    expect(manifest.files).toContain('CONTRIBUTING.md');
    expect(manifest.files).toContain('CHANGELOG.md');
    expect(manifest.files).toContain('RELEASE_CHECKLIST.md');
  });

  test('no current document promises an upgrade path from an old database', () => {
    // #59: the upgrade path is gone, so a document that still tells a reader to
    // migrate is a promise this release cannot keep. The check stops at the
    // 4.0.0 section for the CHANGELOG: entries for 3.x releases describe what
    // those releases did, and rewriting them would be a different kind of lie.
    const changelog = readText(join(coreRoot, 'CHANGELOG.md'));
    const released = changelog.slice(changelog.indexOf('## 4.0.0'));
    const current: Array<[string, string]> = [
      ['CHANGELOG.md (4.0.0)', released.slice(0, released.indexOf('\n## ', 1))],
      ['README.md', readText(join(coreRoot, 'README.md'))],
      ['RELEASE_CHECKLIST.md', readText(join(coreRoot, 'RELEASE_CHECKLIST.md'))],
    ];
    for (const [file, text] of current) {
      const promised = ['cogmem migrate', 'migrate-vectors', 'verify:packed-migration'].filter((token) => text.includes(token));
      expect({ file, promised }).toEqual({ file, promised: [] });
    }
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

test('shipped docs only show invocations the CLI accepts', () => {
  // The readers of these docs are agents that run what they read. Three classes of drift have
  // shipped: a deleted command (`memory dream`, `openclaw diagnose`, `re-embed`), an invented
  // command family (`cogmem atlas overview …`), and flags that no command takes
  // (`memory recall --exclude-session`). Only fenced code blocks count, with comments removed:
  // prose says "cogmem can", and the server doc discusses `--db` in a comment.
  const readSource = (file: string) => readFileSync(join(coreRoot, file), 'utf8');
  const dispatcher = readSource('src/bin/cogmem.ts');
  const block = /const COMMANDS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(dispatcher)?.[1] ?? '';
  const entries = new Map([...block.matchAll(/'?([a-z][a-z0-9-]*)'?:\s*'([a-z0-9-]+)'/g)].map((m) => [m[1]!, m[2]!] as const));

  const flagsFor = (entry: string): Set<string> => {
    const source = readSource(join('src', 'bin', `${entry}.ts`));
    const flags = new Set([...source.matchAll(/--([a-z][a-z0-9-]*)/g)].map((m) => m[1]!));
    for (const array of source.matchAll(/extraFlags:\s*\[([^\]]*)\]/g)) {
      for (const name of array[1]!.matchAll(/'([a-z][a-z0-9-]*)'/g)) flags.add(name[1]!);
    }
    return flags;
  };
  const subsFor = (entry: string): Set<string> => {
    const source = readSource(join('src', 'bin', `${entry}.ts`));
    const predicate = /function is\w+Command\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1];
    const subs = new Set(predicate ? [...predicate.matchAll(/===\s*'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]!) : []);
    const usage = /Usage: cogmem \w+ <([^>]+)>/.exec(source)?.[1];
    // A usage line may abbreviate the tail (`…|graph...>`); it only ever adds names.
    for (const name of (usage ?? '').split('|')) if (/^[a-z][a-z0-9-]*$/.test(name)) subs.add(name);
    return subs;
  };

  const docs = [
    ...globSync('docs/*.md', { cwd: coreRoot }),
    ...globSync('*.md', { cwd: coreRoot }),
  ].filter((file) => !file.includes('archive') && !file.includes('4.0-issue-loop') && !file.includes('CHANGELOG'));
  expect(docs.length).toBeGreaterThan(10);

  const offenders: string[] = [];
  for (const file of docs) {
    const parts = readSource(file).split('```');
    const fenced = parts.filter((_, index) => index % 2 === 1).join('\n');
    for (const raw of fenced.split('\n')) {
      const line = raw.replace(/#.*$/, '');
      const head = /^\s*\$?\s*cogmem\s+([a-z][a-z0-9-]*)(?:\s+(\S+))?/.exec(line);
      if (!head) continue;
      const command = head[1]!;
      const entry = entries.get(command);
      if (!entry) { offenders.push(`${file}: cogmem ${command} (no such command)`); continue; }
      const second = head[2];
      if (second && !second.startsWith('-') && /^[a-z][a-z0-9-]*$/.test(second)) {
        const subs = subsFor(entry);
        if (subs.size > 0 && !subs.has(second)) offenders.push(`${file}: cogmem ${command} ${second} (no such subcommand)`);
      }
      const allowed = flagsFor(entry);
      for (const flag of line.matchAll(/--([a-z][a-z0-9-]*)/g)) {
        if (!allowed.has(flag[1]!)) offenders.push(`${file}: cogmem ${command} --${flag[1]!} (no such flag)`);
      }
    }
  }
  expect([...new Set(offenders)]).toEqual([]);
});

test('the deprecated aliases are gone, and the checklist says so', () => {
  // #112 removed them. The owner chose to do it before 4.0 ships rather than in a later
  // breaking release, so the shape to hold is "no alias directory, no alias bin", not a count.
  const manifest = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as { bin: Record<string, string> };
  expect(Object.entries(manifest.bin).filter(([, target]) => target.includes('alias/'))).toEqual([]);
  expect(existsSync(join(coreRoot, 'src', 'bin', 'alias'))).toBe(false);
  expect(readFileSync(join(coreRoot, 'src', 'bin', 'CliArgs.ts'), 'utf8')).not.toContain('warnDeprecatedAlias');

  const checklist = readFileSync(join(coreRoot, 'RELEASE_CHECKLIST.md'), 'utf8');
  expect(checklist).toContain('Removed in 4.0 (#112)');
});
