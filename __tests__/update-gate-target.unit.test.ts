import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installPathSteps } from '../src/install/InstallSteps.js';

/**
 * #62: the post-update gate must check the install this update touched.
 *
 * The stub gate here *records the arguments and working directory it was given*
 * and then answers. That is the point: the existing update test stubs doctor with
 * a script that ignores its arguments, which is why this defect survived a green
 * suite — the gate could be asked about any config on the machine and the test
 * would not notice.
 *
 * The config lives inside the install home and `HOME` is a scratch directory, so
 * nothing here depends on the developer machine's `~/.cogmem/config.toml`.
 */

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const updateBin = join(coreRoot, 'src/bin/update.ts');
const BUN_DIR = dirname(process.execPath);

function run(cmd: string[], options: { cwd: string; env?: Record<string, string> }) {
  const env = { ...process.env, NO_COLOR: '1', ...options.env };
  env.PATH = [BUN_DIR, env.PATH].filter(Boolean).join(':');
  const proc = Bun.spawn({ cmd, cwd: options.cwd, stdout: 'pipe', stderr: 'pipe', env });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

interface Fixture {
  root: string;
  installHome: string;
  elsewhere: string;
  scratchHome: string;
  cliBin: string;
  configPath: string;
  invocation: string;
}

function makeFixture(options: { withConfig: boolean }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-update-gate-'));
  const installHome = join(root, 'install');
  const elsewhere = join(root, 'elsewhere');
  const scratchHome = join(root, 'home');
  const binDir = join(root, 'bin');
  const cliBin = join(installHome, 'node_modules', '.bin', 'cogmem');
  const configPath = join(installHome, '.cogmem', 'config.toml');
  const invocation = join(root, 'doctor-invocation.txt');
  for (const dir of [binDir, elsewhere, dirname(cliBin), scratchHome]) mkdirSync(dir, { recursive: true });

  writeFileSync(join(binDir, 'npm'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(binDir, 'npm'), 0o755);

  if (options.withConfig) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, [
      '[core]',
      'db_path = "memory.db"',
      'vector_backend = "sqlite-vec"',
      '[memory_model]',
      'provider = "rule_only"',
      'model = "rule_only"',
    ].join('\n'));
  }

  // Records what it was actually asked, then answers with a valid gate payload.
  writeFileSync(cliBin, [
    '#!/bin/sh',
    `printf 'cwd=%s\\nargs=%s\\n' "$PWD" "$*" >> ${invocation}`,
    'if [ "$1" = "doctor" ]; then',
    '  case "$*" in *--json*)',
    '    printf \'%s\\n\' \'{"installGate":{"level":"ok","exitCode":0,"summary":"installed","diagnostics":[],"nextSteps":[]},"nextSteps":[]}\'',
    '    exit 0 ;;',
    '  esac',
    'fi',
    'exit 0',
  ].join('\n'));
  chmodSync(cliBin, 0o755);

  return { root, installHome, elsewhere, scratchHome, cliBin, configPath, invocation };
}

/** The stub appends one `cwd=`/`args=` pair per invocation. */
function invocations(file: string): Array<{ cwd: string; args: string }> {
  return readFileSync(file, 'utf8').trim().split(/\n(?=cwd=)/).map((entry) => {
    const [cwdLine, argsLine] = entry.split('\n');
    return { cwd: cwdLine.slice('cwd='.length), args: argsLine.slice('args='.length) };
  });
}

function baseArgs(f: Fixture): string[] {
  return ['bun', updateBin, '--yes', '--json', '--install-home', f.installHome, '--manager', 'npm', '--from', '4.0.0'];
}

describe('#62 the update gate checks the target install', () => {
  test('doctor is asked about the target config, from the target directory', async () => {
    const f = makeFixture({ withConfig: true });

    // Run from somewhere that is not the install home, with a HOME that has no
    // config: resolving from the caller's directory would find neither.
    const result = await run(baseArgs(f), {
      cwd: f.elsewhere,
      env: { HOME: f.scratchHome, PATH: [join(f.root, 'bin'), process.env.PATH].join(':') },
    });

    expect(result.exitCode).toBe(0);
    const calls = invocations(f.invocation);

    // The gate: the target's config, from the target's directory.
    expect(calls.find((call) => call.args.startsWith('doctor '))).toEqual({
      cwd: f.installHome,
      args: `doctor --json --config ${f.configPath}`,
    });

    // Recorded rather than hidden: the migration step still runs from the
    // caller's directory, which is the same defect class for the same reason.
    // #59 deletes that step, so it is deliberately not fixed here.
    expect(calls.filter((call) => call.cwd === f.elsewhere).map((call) => call.args.split(' ')[0]))
      .toEqual(['migrate']);
  });

  test('the named gate command carries the same config it will check', async () => {
    const f = makeFixture({ withConfig: true });

    const result = await run([...baseArgs(f), '--dry-run'], {
      cwd: f.elsewhere,
      env: { HOME: f.scratchHome, PATH: [join(f.root, 'bin'), process.env.PATH].join(':') },
    });

    expect(result.exitCode).toBe(0);
    const doc = JSON.parse(result.stdout);
    expect(doc.postUpdateGateCommand).toBe(`${f.cliBin} doctor --json --config ${f.configPath}`);
  });

  test('with no config anywhere, the next steps are the shared install steps', async () => {
    const f = makeFixture({ withConfig: false });

    const result = await run([...baseArgs(f), '--dry-run'], {
      cwd: f.elsewhere,
      env: { HOME: f.scratchHome, PATH: [join(f.root, 'bin'), process.env.PATH].join(':') },
    });

    expect(result.exitCode).toBe(0);
    const doc = JSON.parse(result.stdout);
    // The list is defined once (ADR-0003): the same two setup steps a fresh
    // install names, without this flow's own gate step, and with the ids the
    // shared definition uses.
    expect(doc.nextSteps).toEqual(installPathSteps(f.cliBin).filter((step) => step.id !== 'install_gate'));
    expect(doc.nextSteps.map((step: { id: string }) => step.id)).toEqual(['operator_init', 'agent_init']);
  });
});
