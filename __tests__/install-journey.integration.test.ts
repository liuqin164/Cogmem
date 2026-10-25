import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expectRunnableCommands } from './helpers/cli-invocation.js';
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
  runShell: (command: string, options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
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

  const env = () => ({
    ...process.env,
    NO_COLOR: '1',
    HOME: home,
    COGMEM_BIN_DIR: binDir,
    PATH: [binDir, BUN_DIR, process.env.PATH].filter(Boolean).join(':'),
  });

  return {
    binDir,
    async runShell(command, options = {}) {
      // Exactly what a reader does with a printed step: paste it into a shell.
      const proc = Bun.spawn({ cmd: ['sh', '-c', command], cwd: options.cwd ?? scratch, stdout: 'pipe', stderr: 'pipe', env: env() });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    },
    async run(args, options = {}) {
      const proc = Bun.spawn({
        cmd: [launcher, ...args],
        cwd: options.cwd ?? scratch,
        stdin: options.stdin === undefined ? 'ignore' : 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: env(),
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
      expect(before.nextConnectHost).toBe('openclaw');
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

      // 4b. Every step `connect` prints runs as printed: its first word resolves
      //     here, and the steps that take a directory carry the workspace this
      //     command was given rather than a `.` of their own (#78).
      expectRunnableCommands(connect.nextCommands as string[]);
      const printed = (id: string): string => (connect.nextSteps as Array<{ id: string; command: string }>)
        .find((step) => step.id === id)!.command;
      expect(printed('import_apply')).toContain(`--workspace ${workspace} `);
      expect(printed('openclaw_diagnose')).toContain(`--workspace ${workspace} `);

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
      expect(after.installGate.level).toBe('warn');
      expect(after.installGate.diagnostics.map((entry: { code: string }) => entry.code)).toEqual(['rule_only']);
      expect(after.openclaw.plugin.pluginId).toBe(connect.autoMemory.pluginId);
      expect(after.openclaw.plugin.pluginDir).toBe(connect.autoMemory.pluginDir);
      expect(after.openclaw.plugin.installed).toBe(true);
      expect(after.openclaw.plugin.current).toBe(true);
      // And the gate converges: the step it recommended is the step that was just
      // taken, so it is not recommended again (#81).
      expect(after.nextConnectHost).toBeUndefined();
      expect(after.nextSteps.some((step: { id: string }) => step.id === 'connect_host')).toBe(false);

      // 6. and it reports `stale` when the files no longer match, rather than
      //    claiming a healthy integration it did not check.
      writeFileSync(join(connect.autoMemory.pluginDir, 'index.js'), '// tampered\n');
      const stale = parseJson('doctor after tampering', await cli.run(['doctor', '--json'], { cwd: workspace }));
      expect(stale.openclaw.plugin.installed).toBe(true);
      expect(stale.openclaw.plugin.current).toBe(false);
      // The exact set, not "contains": a gate that also reports something else has
      // changed state, and an exit-code or substring check would not notice.
      expect(stale.installGate.level).toBe('warn');
      expect(stale.installGate.diagnostics.map((entry: { code: string }) => entry.code)).toEqual(['openclaw_plugin_stale', 'rule_only']);

      // 7. a repeated connect repairs in place: still exactly one entry, one
      //    load path, and the recorded config is unchanged.
      const second = parseJson('connect again', await cli.run(connectArgs, { cwd: workspace }));
      expect(second.integrationEnabled.changed).toBe(false);
      const hostAgain = JSON.parse(readFileSync(openclawConfig, 'utf8'));
      expect(Object.keys(hostAgain.plugins.entries)).toEqual([connect.autoMemory.pluginId]);
      expect(hostAgain.plugins.load.paths).toEqual([connect.autoMemory.pluginDir]);
      const repaired = parseJson('doctor after repair', await cli.run(['doctor', '--json'], { cwd: workspace }));
      expect(repaired.openclaw.plugin.current).toBe(true);
      expect(repaired.installGate.level).toBe('warn');
      expect(repaired.installGate.diagnostics.map((entry: { code: string }) => entry.code)).toEqual(['rule_only']);

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
      expect(update.nextSteps).toEqual([]);

      // 7d. Run the repair `update` would run, as printed, and end with exactly one
      //     integration: one entry, one load path, one identity.
      const ranRepair = await cli.runShell(update.openclawRepairCommand as string, { cwd: workspace });
      expect(`${ranRepair.exitCode} ${ranRepair.stderr}`).toContain('0 ');
      const afterUpdate = JSON.parse(readFileSync(openclawConfig, 'utf8'));
      expect(Object.keys(afterUpdate.plugins.entries)).toEqual([connect.autoMemory.pluginId]);
      expect(afterUpdate.plugins.load.paths).toEqual([connect.autoMemory.pluginDir]);

      // 7e. A second pass repeats nothing: the gate has converged, so two runs of the
      //     same command produce the same steps.
      const secondPass = parseJson('doctor, second pass', await cli.run(['doctor', '--json'], { cwd: workspace }));
      const thirdPass = parseJson('doctor, third pass', await cli.run(['doctor', '--json'], { cwd: workspace }));
      expect(secondPass.nextSteps).toEqual(thirdPass.nextSteps);
      expect(secondPass.nextSteps).toEqual([]);
      expect(secondPass.installGate.diagnostics).toEqual(thirdPass.installGate.diagnostics);

      // 8. import — into the project the Host integration itself uses, which is
      //    the only project its automatic recall will ask about.
      const marker = 'zebraquay';
      mkdirSync(join(workspace, 'memory'), { recursive: true });
      writeFileSync(join(workspace, 'memory', '2026-10-01.md'), `# 2026-10-01\n\nThe ${marker} rollout ships on Fridays.\n`);
      writeFileSync(join(workspace, 'USER.md'), '# user\n');
      writeFileSync(join(workspace, 'SOUL.md'), '# soul\n');

      // 8b. Every command `connect` printed for an agent, run as printed. The
      //     import step is deliberately left to the assertion below, which pins
      //     what it ingested; running it twice would make that count zero.
      for (const command of connect.nextCommands as string[]) {
        if (/import-(openclaw|hermes)/.test(command) && !command.includes('--dry-run')) continue;
        const ran = await cli.runShell(command, { cwd: workspace });
        expect(`${command} => ${ran.exitCode} ${ran.stderr}`).toContain('=> 0 ');
      }
      // The project `connect` writes into the plugin entry and the project its
      // printed step names have to be one value (#79).
      // Asserted on the printed command first, so the failure a reader sees is the
      // behaviour (a step that names another scope) rather than a missing field.
      expect(printed('import_apply')).toContain(`--project ${pluginProject}`);
      expect(connect.integrationProject).toBe(pluginProject);

      // Run the printed step itself, through a shell: pasting it is the claim.
      const imported = parseJson('printed import step', await cli.runShell(printed('import_apply'), { cwd: workspace }));
      expect(imported.workspaceRoot).toBe(workspace);
      expect(imported.projectId).toBe(pluginProject);
      expect(imported.sourcesScanned).toBeGreaterThan(0);
      expect(imported.recordsIngested).toBeGreaterThan(0);

      // With no `--project` at all the default is the same scope, so the
      // documented one-liner cannot land somewhere the agent never looks.
      const byDefault = parseJson(
        'import with no --project',
        await cli.run(['import-openclaw', '--workspace', workspace, '--json'], { cwd: workspace }),
      );
      expect(byDefault.projectId).toBe(pluginProject);
      expect(byDefault.recordsIngested).toBe(0);
      expect(byDefault.skippedRecords).toBeGreaterThan(0);

      // Memory a user already imported under the old literal scope: importing
      // under the corrected project fills the scope the agent reads, and
      // re-running the corrected step still does not duplicate.
      const stranded = parseJson(
        'import under the old literal scope',
        await cli.runShell(printed('import_apply').replace(` --project ${pluginProject}`, ' --project openclaw'), { cwd: workspace }),
      );
      expect(stranded.projectId).toBe('openclaw');
      expect(stranded.recordsIngested).toBeGreaterThan(0);
      const again = parseJson('printed import step, again', await cli.runShell(printed('import_apply'), { cwd: workspace }));
      expect(again.recordsIngested).toBe(0);
      expect(again.skippedRecords).toBeGreaterThan(0);

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

      // Two scopes in *one* database stay two scopes: the copy the stranded import
      // put under the literal name is visible there and is still not what the
      // integration's own project returns.
      const strandedScope = parseJson(
        'memory recall under the old literal scope',
        await cli.run(['memory', 'recall', '--query', marker, '--project', 'openclaw', '--json'], { cwd: workspace }),
      );
      expect(strandedScope.decisionTrace.selectedCount).toBeGreaterThan(0);
      expect(JSON.stringify(strandedScope.items)).toContain(marker);
    },
    120_000,
  );
});
