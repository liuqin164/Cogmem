import { describe, expect, test } from 'bun:test';
import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';
import { listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { filterToolsByProfile } from '../src/mcp/profiles.js';
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
    // 4.0 ships no ordered migration list (ADR-0007): one schema, created
    // directly. What is worth pinning is that the schema is 0032 and that the
    // number the identity check writes agrees with it.
    expect(LATEST_SCHEMA_VERSION).toBe(32);
    expect(readdirSync(join(coreRoot, 'src', 'migrations')).some((file) => file.startsWith('0033_'))).toBe(false);
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
    // `cogmem` is the single entry point and `cogmem-mcp` stays because host configurations
    // name it as a server command and are not rewritten on upgrade. The `cogmem-*` aliases for
    // the other commands are gone (#112): the dispatcher is the only way in, so a name that is
    // not a command cannot be invoked at all.
    expect(Object.keys(manifest.bin).sort()).toEqual(['cogmem', 'cogmem-mcp']);

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

describe('documented tool profile counts match the shipped registry', () => {
  test('mcp-hosts.md, README, and CHANGELOG state the real core / admin / full counts', () => {
    const all = listCogmemMcpTools();
    const core = filterToolsByProfile('core', all).length;
    const admin = filterToolsByProfile('admin', all).length;
    const full = filterToolsByProfile('full', all).length;

    const hosts = readText(join(coreRoot, 'docs', 'mcp-hosts.md'));
    const readme = readText(join(coreRoot, 'README.md'));
    const changelog = readText(join(coreRoot, 'CHANGELOG.md'));

    expect(core).toBe(6);
    expect(admin).toBe(22);
    expect(full).toBe(36);

    expect(hosts).toContain(`The server exposes ${full} tools.`);
    expect(hosts).toContain('| `core` | ' + core + ' |');
    expect(hosts).toContain('| `admin` | ' + admin + ' |');
    expect(hosts).toContain('| `full` | ' + full + ' |');
    expect(hosts).toContain(`sees ${core} tools`);
    expect(hosts).toContain(`${core} means the\n\`core\` profile, ${full} means \`full\``);
    expect(readme).toContain(`bounds the tool surface to ${core}, ${admin}, or ${full} tools`);
    expect(changelog).toContain('`core` (' + core + '), `admin` (' + admin + '), `full` (' + full + ')');
  });

  test('no shipped document promises a shared-memory tool in 4.0', () => {
    // #68: 4.0 does not expose shared memory; it is planned for 4.1. A document
    // that still names one of the four removed tools is a promise a 4.0 host
    // would follow into `tool_not_found`.
    for (const file of ['docs/mcp-hosts.md', 'README.md', 'CHANGELOG.md']) {
      const text = readText(join(coreRoot, file));
      const named = [
        'cogmem_shared_publish',
        'cogmem_shared_retract',
        'cogmem_shared_subscribe',
        'cogmem_shared_explain',
      ].filter((tool) => text.includes(tool));
      expect({ file, named }).toEqual({ file, named: [] });
    }
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
    // `dist/` is not tracked (#53), so this reads whatever the checkout last
    // built — `prepublishOnly` builds before the suite for exactly that reason.
    // A stale dist/bin/mcp.js once
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
    // `dist/` is not tracked (#53), so a failed compile can no longer delete
    // tracked files. The staging-then-swap is kept anyway: it keeps a failing
    // build from leaving a half-written dist/ behind, and prepublishOnly builds
    // before the tests, so a broken build must not destroy the last good output.
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

  test('the test gate builds before it tests, because dist/ is not tracked', () => {
    // A fresh clone has no dist/. Anything that reads build output during the
    // suite (the OpenClaw plugin entry, the built mcp.js assertions) needs the
    // build to have run first, so the order is part of the contract, not a taste.
    const manifest = packageJson();
    const gate = manifest.scripts.prepublishOnly as string;
    const build = gate.indexOf('bun run build');
    const test = gate.indexOf('bun test __tests__');
    expect(build).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(build);
  });
});

test('shipped docs only show invocations the CLI accepts', () => {
  // The readers of these docs are agents that run what they read. Three classes of drift have
  // shipped: a deleted command (`memory dream`, `openclaw diagnose`, `re-embed`), an invented
  // command family (`cogmem atlas overview …`), and flags that no command takes
  // (`memory recall --exclude-session`). Only fenced code blocks count, with comments removed:
  // prose says "cogmem can", and mcp-hosts.md discusses `--db` in a comment.
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
    ...globSync('examples/**/*.md', { cwd: coreRoot }),
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

test("the release checklist's MCP claims hold against the registry", () => {
  // The checklist is a release gate, so its sentences about the MCP surface are assertions.
  // They were verified by hand once (#155); this keeps them true without another hand pass.
  const paragraph = readFileSync(join(coreRoot, 'RELEASE_CHECKLIST.md'), 'utf8')
    .split('\n').find((line) => line.includes('MCP `tools/list` includes')) ?? '';
  expect(paragraph).not.toBe('');

  const all = listCogmemMcpTools();
  const byName = new Map(all.map((tool) => [tool.name, tool]));
  const hints = (name: string) => (byName.get(name)?.annotations ?? {}) as { readOnlyHint?: boolean; idempotentHint?: boolean };

  // "all seven read-only Memory Atlas queries ... declare read-only/idempotent semantics"
  const atlasReads = all.filter((tool) => tool.name.startsWith('cogmem_graph_') && tool.name !== 'cogmem_graph_touch').map((tool) => tool.name);
  expect({ claim: paragraph.includes('seven read-only Memory Atlas queries'), count: atlasReads.length }).toEqual({ claim: true, count: 7 });
  for (const name of atlasReads) {
    // toMatchObject: the annotation object also carries a title and destructiveHint.
    expect({ name, hints: hints(name) }).toMatchObject({ name, hints: { readOnlyHint: true, idempotentHint: true } });
  }
  // "only touch records selected-node use"
  expect(hints('cogmem_graph_touch').readOnlyHint).toBe(false);
  expect(all.filter((tool) => tool.name.startsWith('cogmem_graph_') && hints(tool.name).readOnlyHint !== true).map((tool) => tool.name)).toEqual(['cogmem_graph_touch']);

  // "Episode audit-boundaries and split-plan are read-only"
  for (const name of ['cogmem_episode_audit_boundaries', 'cogmem_episode_split_plan']) {
    expect({ name, hints: hints(name) }).toMatchObject({ name, hints: { readOnlyHint: true, idempotentHint: true } });
  }

  // Every family the paragraph names still has a tool whose name carries those words. The list
  // mixes separators — `episode append/import/status/audit-boundaries/...`, `topic
  // list/operate/rollback`, `Dream tick/status` — so a slash extends the family named before it.
  // The slice stops before "all seven read-only Memory Atlas queries": that count is asserted
  // above against the registry rather than parsed out of prose.
  const named = paragraph.slice(paragraph.indexOf('includes') + 'includes'.length, paragraph.indexOf(', all seven'));
  const pairs: Array<{ item: string; family: string; sub: string }> = [];
  for (const piece of named.split(',').map((part) => part.trim().replace(/ tools$/, '')).filter((part) => part.length > 2)) {
    const tokens = piece.split('/').map((token) => token.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) continue;
    const head = tokens[0]!.split(/[^a-z]+/).filter(Boolean);
    const family = head.slice(0, -1).join(' ');
    for (const sub of [head[head.length - 1]!, ...tokens.slice(1)]) {
      pairs.push({ item: piece, family, sub: sub.split(/[^a-z]+/).filter(Boolean).join(' ') });
    }
  }
  expect(pairs.length).toBeGreaterThan(10);
  for (const { item, family, sub } of pairs) {
    const words = [...family.split(' '), ...sub.split(' ')].filter(Boolean);
    // A leading adjective is prose ("conditional Dream tick", "explicit graph_touch"), so a
    // suffix of the words may be the pair; two words stay required when there are two.
    const found = all.some((tool) => words.some((_, start) => {
      const tail = words.slice(start);
      return tail.length >= Math.min(2, words.length) && tail.every((word) => tool.name.includes(word));
    }));
    expect({ item, found }).toEqual({ item, found: true });
  }
});

test('the skill bundles state the profile each tool actually needs', () => {
  // `connect` writes an entry with no `--profile`, so the server runs `core` (six tools) and a
  // documented call for anything above it answers `tool_not_in_profile`. The bundles now say
  // which row each tool needs; this keeps that table equal to the registry rather than to what
  // the profiles were when it was written.
  const all = listCogmemMcpTools();
  const core = new Set(filterToolsByProfile('core', all).map((tool) => tool.name));
  const admin = new Set(filterToolsByProfile('admin', all).map((tool) => tool.name));
  const minimumFor = (name: string) => (core.has(name) ? 'core' : admin.has(name) ? 'admin' : 'full');

  let rows = 0;
  for (const file of ['examples/hermes-backend/references/operations.md', 'examples/openclaw-backend/references/operations.md']) {
    const text = readFileSync(join(coreRoot, file), 'utf8');
    const table = text.slice(text.indexOf('Which profile serves these tools'));
    expect({ file, hasTable: table.length > 0 }).toEqual({ file, hasTable: true });
    for (const row of table.matchAll(/^\|\s*([^|]+?)\s*\|\s*`(core|admin|full)`/gm)) {
      const tools = [...row[1]!.matchAll(/`(cogmem_[a-z_]+)`/g)].map((m) => m[1]!);
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect({ file, tool, stated: row[2]!, actual: minimumFor(tool) }).toEqual({ file, tool, stated: row[2]!, actual: row[2]! });
        rows += 1;
      }
    }
  }
  expect(rows).toBeGreaterThanOrEqual(14);
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
