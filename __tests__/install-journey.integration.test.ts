import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';

/**
 * The journey the documentation promises, walked end to end through the CLI
 * process boundary: `install → init → doctor → connect → import → recall`.
 *
 * It exists because 1,683 green tests did not notice that the six steps
 * disagreed about which directory they were in. `connect` installed a plugin
 * hashed from the project directory while `doctor` inspected one hashed from
 * `<project>/.cogmem`, so the gate could never see the plugin it was told to
 * repair; the import step named a project the plugin did not use, so the import
 * succeeded and the agent recalled nothing. **Every one of those steps exited
 * 0** — which is why this check asserts behaviour (which Workspace, which plugin
 * identity, which project) and an actual recall, never just an exit code.
 *
 * The seam is the CLI process boundary, the same one #39's slices use: a
 * function-level test cannot see two commands disagree, because it calls one of
 * them.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUN_DIR = dirname(process.execPath);

interface Cli {
  binDir: string;
  run: (args: string[], options?: { cwd?: string; stdin?: string }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/**
 * The layout the one-line installer produces: the package under the install
 * home, its launcher in `<install home>/node_modules/.bin`, and that directory
 * on PATH. `install.sh` only links what `bun add` put in `node_modules/.bin`, so
 * a test that ran `src/bin/*.ts` directly would be testing a layout no user has.
 */
function installInto(scratch: string, home: string): Cli {
  const installHome = join(home, '.cogmem', 'pkg');
  const binDir = join(installHome, 'node_modules', '.bin');
  const pkgDir = join(installHome, 'node_modules', 'cogmem');
  mkdirSync(binDir, { recursive: true });
  symlinkSync(coreRoot, pkgDir, 'dir');

  const launcher = join(binDir, 'cogmem');
  writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(pkgDir, 'dist', 'bin', 'cogmem.js'))} "$@"\n`);
  chmodSync(launcher, 0o755);

  return {
    binDir,
    async run(args, options = {}) {
      const proc = Bun.spawn({
        cmd: [launcher, ...args],
        cwd: options.cwd ?? scratch,
        stdin: options.stdin === undefined ? 'ignore' : 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          NO_COLOR: '1',
          HOME: home,
          COGMEM_BIN_DIR: binDir,
          PATH: [binDir, BUN_DIR, process.env.PATH].filter(Boolean).join(':'),
        },
      });
      if (options.stdin !== undefined && proc.stdin) {
        proc.stdin.write(options.stdin);
        await proc.stdin.end();
      }
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    },
  };
}

function parseJson(context: string, result: { stdout: string; stderr: string; exitCode: number }): Record<string, any> {
  if (result.exitCode !== 0) {
    throw new Error(`${context} exited ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

describe('the install journey', () => {
  test(
    'install → init → doctor → connect → import → recall keeps one Workspace, one plugin identity, one project',
    async () => {
      const scratch = makeTempDir('cogmem-journey-');
      const home = join(scratch, 'home');
      const workspace = join(scratch, 'ws');
      mkdirSync(workspace, { recursive: true });
      const cli = installInto(scratch, home);

      // 1. install — a launcher exists and resolves as `cogmem` without an
      //    absolute path, which is what every printed step assumes.
      const installed = await cli.run(['--help']);
      expect(installed.stdout).toContain('Usage: cogmem <command>');

      // 2. init — the Agent path. Project scope by default, so the config lands
      //    in the Workspace rather than in HOME.
      const init = parseJson('init', await cli.run(['init', '--yes', '--json', '--no-probe'], { cwd: workspace }));
      expect(init.configPath).toBe(join(workspace, '.cogmem', 'config.toml'));

      // 3. doctor — the gate, and the Workspace it says it is in.
      const before = parseJson('doctor', await cli.run(['doctor', '--json'], { cwd: workspace }));
      expect(before.workspaceRoot).toBe(workspace);
      expect(before.installGate.level).toBe('warn');
      expect(before.installGate.diagnostics.map((entry: { code: string }) => entry.code)).toEqual(['rule_only']);

      // 4. connect — installs the host integration and records that it did.
      const openclawConfig = join(scratch, 'openclaw.json');
      writeFileSync(openclawConfig, '{}\n');
      const connectArgs = [
        'connect', 'openclaw', '--auto', '--force', '--json',
        '--openclaw-config', openclawConfig,
        '--bun', process.execPath,
      ];
      const connect = parseJson('connect', await cli.run(connectArgs, { cwd: workspace }));
      expect(connect.workspaceRoot).toBe(workspace);
      const cogmemConfigPath = join(workspace, '.cogmem', 'config.toml');
      expect(connect.integrationEnabled.configPath).toBe(cogmemConfigPath);
      expect(connect.integrationEnabled.changed).toBe(true);
      expect(readFileSync(cogmemConfigPath, 'utf8')).toContain('[integrations.openclaw]\nenabled = true');

      // One plugin entry and one load path, under a workspace-derived identity.
      const host = JSON.parse(readFileSync(openclawConfig, 'utf8'));
      expect(Object.keys(host.plugins.entries)).toEqual([connect.autoMemory.pluginId]);
      expect(host.plugins.load.paths).toEqual([connect.autoMemory.pluginDir]);
      const pluginProject = host.plugins.entries[connect.autoMemory.pluginId].config.projectId;
      expect(host.plugins.entries[connect.autoMemory.pluginId].config.cwd).toBe(workspace);

      // 5. doctor sees what connect installed — the plugin identity `connect`
      //    wrote is the one `doctor` inspects, for the same Workspace.
      const after = parseJson('doctor after connect', await cli.run(['doctor', '--json'], { cwd: workspace }));
      expect(after.workspaceRoot).toBe(workspace);
      expect(after.openclaw.plugin.pluginId).toBe(connect.autoMemory.pluginId);
      expect(after.openclaw.plugin.pluginDir).toBe(connect.autoMemory.pluginDir);
      expect(after.openclaw.plugin.installed).toBe(true);
      expect(after.openclaw.plugin.current).toBe(true);

      // 6. and it reports `stale` when the files no longer match, rather than
      //    claiming a healthy integration it did not check.
      writeFileSync(join(connect.autoMemory.pluginDir, 'index.js'), '// tampered\n');
      const stale = parseJson('doctor after tampering', await cli.run(['doctor', '--json'], { cwd: workspace }));
      expect(stale.openclaw.plugin.installed).toBe(true);
      expect(stale.openclaw.plugin.current).toBe(false);
      expect(stale.installGate.diagnostics.map((entry: { code: string }) => entry.code)).toContain('openclaw_plugin_stale');

      // 7. a repeated connect repairs in place: still exactly one entry, one
      //    load path, and the recorded config is unchanged.
      const second = parseJson('connect again', await cli.run(connectArgs, { cwd: workspace }));
      expect(second.integrationEnabled.changed).toBe(false);
      const hostAgain = JSON.parse(readFileSync(openclawConfig, 'utf8'));
      expect(Object.keys(hostAgain.plugins.entries)).toEqual([connect.autoMemory.pluginId]);
      expect(hostAgain.plugins.load.paths).toEqual([connect.autoMemory.pluginDir]);
      const repaired = parseJson('doctor after repair', await cli.run(['doctor', '--json'], { cwd: workspace }));
      expect(repaired.openclaw.plugin.current).toBe(true);

      // 7b. One config, one entry — including the entry an *earlier* update left
      //     behind. Before ADR-0010 `update` passed `<ws>/.cogmem` as the
      //     workspace, so it wrote a second entry hashing that directory while
      //     naming the same configPath. The repair must converge on one, not add
      //     a third; the entry for another Workspace must survive.
      const staleRoot = join(workspace, '.cogmem');
      const staleId = `cogmem-auto-memory-${createHash('sha256').update(staleRoot).digest('hex').slice(0, 16)}`;
      const staleDir = join(staleRoot, 'extensions', staleId);
      const withStale = JSON.parse(readFileSync(openclawConfig, 'utf8'));
      withStale.plugins.entries[staleId] = {
        enabled: true,
        config: { configPath: cogmemConfigPath, cwd: staleRoot, projectId: 'openclaw' },
      };
      withStale.plugins.load.paths.push(staleDir);
      writeFileSync(openclawConfig, `${JSON.stringify(withStale, null, 2)}\n`);

      await cli.run(connectArgs, { cwd: workspace });
      const converged = JSON.parse(readFileSync(openclawConfig, 'utf8'));
      expect(Object.keys(converged.plugins.entries)).toEqual([connect.autoMemory.pluginId]);
      expect(converged.plugins.load.paths).toEqual([connect.autoMemory.pluginDir]);

      // 7c. `update` maintains what `connect` wired. Before the fix `connect` left
      //     `enabled = false`, so the repair path declined with
      //     `openclaw_not_configured` and nothing refreshed the integration.
      const update = parseJson(
        'update --dry-run',
        await cli.run(['update', '--dry-run', '--json', '--config', cogmemConfigPath], { cwd: workspace }),
      );
      expect(update.openclawRepairSkippedReason).toBeUndefined();
      expect(update.openclawRepairCommand).toContain(`--workspace ${workspace}`);

      // 8. import — into the project the Host integration itself uses, which is
      //    the only project its automatic recall will ask about.
      const marker = 'zebraquay';
      mkdirSync(join(workspace, 'memory'), { recursive: true });
      writeFileSync(join(workspace, 'memory', '2026-10-01.md'), `# 2026-10-01\n\nThe ${marker} rollout ships on Fridays.\n`);
      writeFileSync(join(workspace, 'USER.md'), '# user\n');
      writeFileSync(join(workspace, 'SOUL.md'), '# soul\n');
      const imported = parseJson(
        'import-openclaw',
        await cli.run(['import-openclaw', '--workspace', workspace, '--project', pluginProject, '--json'], { cwd: workspace }),
      );
      expect(imported.workspaceRoot).toBe(workspace);
      expect(imported.projectId).toBe(pluginProject);
      expect(imported.sourcesScanned).toBeGreaterThan(0);
      expect(imported.recordsIngested).toBeGreaterThan(0);

      // 9. recall — the memory the import put in comes back under that project,
      //    through the same CLI a host step would call.
      const recalled = parseJson(
        'memory recall',
        await cli.run(['memory', 'recall', '--query', marker, '--project', pluginProject, '--json'], { cwd: workspace }),
      );
      // Asserted on `items`, not on the document: the response echoes the query,
      // so a whole-document substring check would pass on a recall that found
      // nothing.
      expect(recalled.decisionTrace.selectedCount).toBeGreaterThan(0);
      expect(JSON.stringify(recalled.items)).toContain(marker);

      // The scope is private: another project's recall does not see it. An import
      // that "succeeded" into the wrong scope is the defect this journey exists
      // to catch, so the negative half is asserted too.
      const elsewhere = parseJson(
        'memory recall under another project',
        await cli.run(['memory', 'recall', '--query', marker, '--project', 'some-other-project', '--json'], { cwd: workspace }),
      );
      expect(elsewhere.decisionTrace.selectedCount).toBe(0);
      expect(elsewhere.items).toEqual([]);
    },
    120_000,
  );
});
