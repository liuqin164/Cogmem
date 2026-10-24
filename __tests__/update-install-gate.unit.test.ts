import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const updateBin = join(coreRoot, 'src/bin/update.ts');
const BUN_DIR = dirname(process.execPath);

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const env = { ...process.env, NO_COLOR: '1', ...options.env };
  env.PATH = [BUN_DIR, env.PATH].filter(Boolean).join(':');
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd ?? coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

describe('update post-install gate', () => {
  test('reports the real doctor result after update, not a config-derived OK', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-update-gate-'));
    const home = join(dir, 'home');
    const installHome = join(dir, 'install');
    const binDir = join(dir, 'bin');
    const cliBin = join(installHome, 'node_modules', '.bin', 'cogmem');
    const configPath = join(home, '.cogmem', 'config.toml');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(dirname(cliBin), { recursive: true });
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(join(binDir, 'npm'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(binDir, 'npm'), 0o755);
    writeFileSync(configPath, [
      '[core]',
      'db_path = "memory.db"',
      'vector_backend = "sqlite-vec"',
      '[memory_model]',
      'provider = "rule_only"',
      'model = "rule_only"',
    ].join('\n'));
    writeFileSync(cliBin, [
      '#!/bin/sh',
      'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
      '  printf \'%s\\n\' \'{"installGate":{"level":"warn","exitCode":0,"summary":"installed but degraded","diagnostics":[{"code":"rule_only","message":"semantic recall off"}],"nextSteps":[]},"nextSteps":[{"id":"actual-gate-step","actor":"agent","safeForAutomation":true,"command":"cogmem doctor","when":"now","purpose":"verify updated install"}]}\'',
      '  exit 0',
      'fi',
      'exit 0',
    ].join('\n'));
    chmodSync(cliBin, 0o755);

    const result = await run([
      'bun', updateBin, '--yes', '--json', '--install-home', installHome, '--manager', 'npm', '--from', '4.0.0',
    ], { cwd: dir, env: { HOME: home, PATH: `${binDir}:/usr/bin:/bin` } });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.installGate.level).toBe('warn');
    expect(parsed.installGate.diagnostics[0].code).toBe('rule_only');
    expect(parsed.nextSteps[0].id).toBe('actual-gate-step');

    const dryRun = await run([
      'bun', updateBin, '--json', '--install-home', installHome, '--manager', 'npm', '--from', '4.0.0',
    ], { cwd: dir, env: { HOME: home, PATH: `${binDir}:/usr/bin:/bin` } });
    expect(dryRun.exitCode).toBe(0);
    const dryParsed = JSON.parse(dryRun.stdout);
    expect(dryParsed.installGate).toBeUndefined();
    // #62: the gate names the config it will check, so the command can be run by
    // hand and checks the same install this update touched.
    expect(dryParsed.postUpdateGateCommand).toBe(`${cliBin} doctor --json --config ${configPath}`);
  });
});
