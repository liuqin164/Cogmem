import { describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveWorkspaceRoot } from '../src/config/CogmemConfig.js';
import { integrationScope } from '../src/host/IntegrationScope.js';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The Workspace derivation.
 *
 * ADR-0010's whole point is that this is derived once. These are the checks that
 * fail if a second derivation appears.
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
    // Workspace" is what made two commands compute two identities.
    expect(resolveWorkspaceRoot({ cwd: scratch, env: { HOME: home } })).toBe(home);
  });

  test('with no config anywhere the answer is where init would create one', () => {
    const scratch = makeTempDir('cogmem-ws-none-');
    const cwd = join(scratch, 'empty');
    mkdirSync(cwd, { recursive: true });

    expect(resolveWorkspaceRoot({ cwd, env: { HOME: join(scratch, 'home') } })).toBe(cwd);
  });
});

describe('one Workspace is one private scope', () => {
  test('two Workspaces are two scopes, and one Workspace is one', () => {
    const scratch = makeTempDir('cogmem-scope-');
    const first = join(scratch, 'ws-one');
    const second = join(scratch, 'ws-two');

    expect(integrationScope('openclaw', first)).toMatch(/^openclaw-[0-9a-f]{8}$/);
    // Two Workspaces on one machine stay two scopes: importing into one cannot
    // surface in the other (ADR-0009). The host name is the scope's prefix, not a
    // wiring feature: `import` derives it the same way.
    expect(integrationScope('openclaw', first)).not.toBe(integrationScope('openclaw', second));
    expect(integrationScope('hermes', first)).not.toBe(integrationScope('openclaw', first));
  });
});

describe('the documented project is the one the integration uses', () => {
  test('no runbook tells a reader to import into the literal project', () => {
    const docs = [
      'README.md',
      ...(readdirSync(join(coreRoot, 'docs'), { recursive: true }) as string[])
        .filter((entry) => entry.endsWith('.md'))
        // The decision records and the round ledger quote the defect on purpose
        // (the literal and the recall that returned nothing), so they are evidence
        // rather than instructions; the runbooks are what a reader follows.
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
