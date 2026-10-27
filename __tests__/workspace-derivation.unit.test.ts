import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  enableHostIntegration,
  hostWorkspaceFor,
  loadCogmemConfig,
  resolveWorkspaceRoot,
} from '../src/config/CogmemConfig.js';
import { installOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';
import { integrationScope } from '../src/host/IntegrationScope.js';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The Workspace derivation, and the two commands that must agree about it.
 *
 * ADR-0010's whole point is that this is derived once. These are the checks that
 * fail if a second derivation appears: the derivation itself, the per-Host
 * override that resolves relative to it, and the config write that `connect`
 * makes so `doctor` and `update` can see the integration it wired.
 */

function configIn(dir: string, body: string): { root: string; home: string; configPath: string } {
  const home = join(dir, '.cogmem');
  const configPath = join(home, 'config.toml');
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath, body);
  return { root: dir, home, configPath };
}

describe('the Workspace is derived, not declared', () => {
  test('a project config names the directory that contains .cogmem/', () => {
    const scratch = makeTempDir('cogmem-ws-project-');
    const env = { HOME: join(scratch, 'home') };
    const workspace = join(scratch, 'ws');
    configIn(workspace, '[core]\ndb_path = "memory.db"\n');

    expect(resolveWorkspaceRoot({ cwd: workspace, env })).toBe(workspace);
    // Found by walking up, so a subdirectory answers the same as the root.
    const deeper = join(workspace, 'src', 'nested');
    mkdirSync(deeper, { recursive: true });
    expect(resolveWorkspaceRoot({ cwd: deeper, env })).toBe(workspace);
    // And an explicit --config answers the same as the walk did.
    expect(resolveWorkspaceRoot({ configPath: join(workspace, '.cogmem', 'config.toml'), cwd: scratch, env })).toBe(workspace);
  });

  test('a global config makes the home directory the Workspace', () => {
    const scratch = makeTempDir('cogmem-ws-global-');
    const home = join(scratch, 'home');
    configIn(home, '[core]\ndb_path = "memory.db"\n');

    // `<home>/.cogmem/` is what makes `<home>` the Workspace. Reading this as "no
    // Workspace" is what made doctor and connect compute two plugin identities.
    expect(resolveWorkspaceRoot({ cwd: scratch, env: { HOME: home } })).toBe(home);
  });

  test('with no config anywhere the answer is where init would create one', () => {
    const scratch = makeTempDir('cogmem-ws-none-');
    const cwd = join(scratch, 'empty');
    mkdirSync(cwd, { recursive: true });

    expect(resolveWorkspaceRoot({ cwd, env: { HOME: join(scratch, 'home') } })).toBe(cwd);
  });

  test('workspace_dir resolves relative to the Workspace, so the old "." keeps working', () => {
    const scratch = makeTempDir('cogmem-ws-override-');
    const home = join(scratch, 'home');
    const workspace = join(scratch, 'ws');
    const { configPath } = configIn(workspace, [
      '[integrations.openclaw]',
      'enabled = true',
      'workspace_dir = "."',
      '',
      '[integrations.hermes]',
      'enabled = true',
      'workspace_dir = "~/.hermes"',
    ].join('\n'));
    const loaded = loadCogmemConfig({ configPath, env: { HOME: home } });

    // `"."` means the Workspace, not `<ws>/.cogmem` — a config written before
    // ADR-0010 carries exactly this and must resolve to the same place the
    // derived Workspace does, or the two identities come back.
    expect(loaded.workspaceRoot).toBe(workspace);
    expect(loaded.integrations.openclaw.workspaceDir).toBe(workspace);
    expect(hostWorkspaceFor(loaded, 'openclaw')).toBe(workspace);
    // A host whose own files are elsewhere still gets its override, resolved from
    // the Workspace rather than from the config directory.
    expect(loaded.integrations.hermes.workspaceDir).toBe(join(home, '.hermes'));
    expect(hostWorkspaceFor(loaded, 'hermes')).toBe(join(home, '.hermes'));
    // A relative override hangs off the Workspace, not off `.cogmem`.
    const relative = configIn(join(scratch, 'ws2'), '[integrations.openclaw]\nworkspace_dir = "plugins/openclaw"\n');
    const relativeLoaded = loadCogmemConfig({ configPath: relative.configPath, env: { HOME: home } });
    expect(hostWorkspaceFor(relativeLoaded, 'openclaw')).toBe(join(scratch, 'ws2', 'plugins', 'openclaw'));
  });
});

describe('recording that a host is wired', () => {
  test('flips an existing switch without rewriting the rest of the file', () => {
    const scratch = makeTempDir('cogmem-enable-flip-');
    const workspace = join(scratch, 'ws');
    const body = [
      '# a comment an operator wrote',
      '[core]',
      'db_path = "memory.db"',
      '',
      '[integrations.openclaw]',
      'enabled = false',
      'workspace_dir = "."',
      '',
      '[integrations.hermes]',
      'enabled = false',
    ].join('\n');
    const { configPath } = configIn(workspace, body);

    expect(enableHostIntegration(configPath, 'openclaw')).toEqual({ configPath, changed: true });
    const after = readFileSync(configPath, 'utf8');
    expect(after).toContain('[integrations.openclaw]\nenabled = true\nworkspace_dir = "."');
    expect(after).toContain('[integrations.hermes]\nenabled = false');
    expect(after).toContain('# a comment an operator wrote');
    // The hermes section is untouched, and the file still parses.
    expect(Bun.TOML.parse(after)).toMatchObject({ integrations: { openclaw: { enabled: true }, hermes: { enabled: false } } });

    // Repeating it writes nothing at all.
    expect(enableHostIntegration(configPath, 'openclaw')).toEqual({ configPath, changed: false });
    expect(readFileSync(configPath, 'utf8')).toBe(after);
  });

  test('adds the section when the file has none, and inserts a missing key', () => {
    const scratch = makeTempDir('cogmem-enable-add-');
    const { configPath } = configIn(join(scratch, 'ws'), '[core]\ndb_path = "memory.db"\n');

    expect(enableHostIntegration(configPath, 'openclaw').changed).toBe(true);
    expect(Bun.TOML.parse(readFileSync(configPath, 'utf8'))).toMatchObject({
      core: { db_path: 'memory.db' },
      integrations: { openclaw: { enabled: true } },
    });

    // A section that exists without the key gets the key, not a second section.
    const second = configIn(join(scratch, 'ws2'), '[integrations.openclaw]\n# no switch yet\n').configPath;
    expect(enableHostIntegration(second, 'openclaw').changed).toBe(true);
    const text = readFileSync(second, 'utf8');
    expect(text.match(/\[integrations\.openclaw\]/g)).toHaveLength(1);
    expect(Bun.TOML.parse(text)).toMatchObject({ integrations: { openclaw: { enabled: true } } });
  });

  test('a padded or commented header is the same section, not a second one', () => {
    const scratch = makeTempDir('cogmem-enable-header-');
    for (const [index, header] of ['[ integrations.openclaw ]', '[integrations.openclaw] # wired by hand'].entries()) {
      const configPath = configIn(join(scratch, `ws${index}`), `${header}\nenabled = false\n`).configPath;
      expect(enableHostIntegration(configPath, 'openclaw').changed).toBe(true);
      const text = readFileSync(configPath, 'utf8');
      expect(text.match(/enabled\s*=/g)).toHaveLength(1);
      // The duplicate-table failure is only visible by parsing: `enabled` is
      // defined twice and the file that every later command reads is unusable.
      expect(Bun.TOML.parse(text)).toMatchObject({ integrations: { openclaw: { enabled: true } } });
    }
  });
});

describe('one config, one plugin entry', () => {
  test('installing over an entry the old repair left behind converges instead of adding a third', () => {
    const workspace = makeTempDir('cogmem-plugin-converge-');
    const configPath = configIn(workspace, '[core]\ndb_path = "memory.db"\n').configPath;
    const openclawConfigPath = join(workspace, 'openclaw.json');

    const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
    // What the pre-ADR-0010 `update` wrote: the same configPath, a workspace one
    // level down, and a plugin id hashing that directory.
    const staleRoot = join(workspace, '.cogmem');
    const staleId = `cogmem-auto-memory-${hash(staleRoot).slice(0, 16)}`;
    const staleDir = join(staleRoot, 'extensions', staleId);
    const otherConfigPath = join(workspace, 'other', '.cogmem', 'config.toml');
    const otherId = 'cogmem-auto-memory-0000000000000000';
    // The other Workspace's directory is really there, so its path can be loaded and
    // is kept. A path to a directory that is gone is dropped whatever it belongs to:
    // OpenClaw rejects the entire config over one missing `plugins.load.paths` entry,
    // which is the state the box was left in — the host unusable, not just memoryless.
    const otherDir = join(workspace, 'other', 'extensions', otherId);
    mkdirSync(otherDir, { recursive: true });
    const absentDir = join(workspace, 'gone', 'extensions', 'cogmem-auto-memory-deadbeefdeadbeef');
    writeFileSync(openclawConfigPath, `${JSON.stringify({
      plugins: {
        enabled: true,
        load: { paths: [staleDir, otherDir, absentDir] },
        allow: ['cogmem-auto-memory', staleId],
        entries: {
          [staleId]: { enabled: true, config: { configPath, cwd: staleRoot, projectId: 'openclaw' } },
          [otherId]: { enabled: true, config: { configPath: otherConfigPath, cwd: join(workspace, 'other'), projectId: 'other' } },
        },
      },
    }, null, 2)}\n`);

    const result = installOpenClawAutoMemoryPlugin({
      workspaceRoot: workspace,
      configPath,
      openclawConfigPath,
      bunPath: process.execPath,
      force: true,
    });
    const patched = JSON.parse(readFileSync(openclawConfigPath, 'utf8')) as any;

    expect(Object.keys(patched.plugins.entries).sort()).toEqual([otherId, result.pluginId].sort());
    expect(patched.plugins.load.paths).toContain(result.pluginDir);
    expect(patched.plugins.load.paths).not.toContain(staleDir);
    // Another Workspace's entry is another integration: untouched. Its load path is
    // kept because it resolves — and dropped when it does not, because OpenClaw
    // rejects the whole config over one missing entry.
    expect(patched.plugins.entries[otherId]).toBeDefined();
    expect(patched.plugins.load.paths).toContain(otherDir);
    expect(patched.plugins.load.paths).not.toContain(absentDir);
    expect(patched.plugins.allow).not.toContain(staleId);
  });
});

describe('one Workspace is one private scope', () => {
  test('two Workspaces are two scopes, and one Workspace is one', () => {
    const scratch = makeTempDir('cogmem-scope-');
    const first = join(scratch, 'ws-one');
    const second = join(scratch, 'ws-two');

    expect(integrationScope('openclaw', first)).toMatch(/^openclaw-[0-9a-f]{8}$/);
    // Two Workspaces on one machine stay two scopes: importing into one cannot
    // surface in the other (ADR-0009).
    expect(integrationScope('openclaw', first)).not.toBe(integrationScope('openclaw', second));
    expect(integrationScope('hermes', first)).not.toBe(integrationScope('openclaw', first));
  });
});

describe('the documented project is the one the integration uses', () => {
  test('no runbook tells a reader to import into the literal project', () => {
    const docs = [
      'README.md',
      ...(readdirSync(join(coreRoot, 'examples'), { recursive: true }) as string[])
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => join('examples', entry)),
      // The decision records and the round ledger quote the defect on purpose
      // (the literal and the recall that returned nothing), so they are evidence
      // rather than instructions; the runbooks are what a reader follows.
      ...(readdirSync(join(coreRoot, 'docs'), { recursive: true }) as string[])
        .filter((entry) => entry.endsWith('.md'))
        .filter((entry) => !entry.startsWith('engineering/') && !entry.startsWith('adr/'))
        .map((entry) => join('docs', entry)),
    ];
    const offenders: string[] = [];
    for (const doc of docs) {
      for (const [index, line] of readFileSync(join(coreRoot, doc), 'utf8').split('\n').entries()) {
        if (/^\s*#/.test(line)) continue;
        // `--to` is the same statement: the scope-repair target is a project.
        if (!/--(?:project|to)\s+(openclaw|hermes)(?![\w-])/.test(line)) continue;
        offenders.push(`${doc}:${index + 1}: ${line.trim()}`);
      }
    }
    // A literal here is the defect #79 fixes: the import reports success into a
    // scope the installed integration never reads. The runbooks name the derived
    // value as a quoted placeholder instead.
    expect(offenders).toEqual([]);
  });
});
