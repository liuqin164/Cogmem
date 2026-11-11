import { expect } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readResidentSession, type ResidentSession } from '../../src/install/ResidentSession.js';
import { callTool, connect } from './mcp-http.js';
import { makeTempDir } from './tmp.js';

/**
 * The install fixture the #150 cycle tests share.
 *
 * The installed package is this checkout's `src/` wearing a chosen version, and
 * the "package manager" is a shim that copies that tree into `node_modules/cogmem`
 * and rewrites the version. Everything that matters is therefore real — the CLI,
 * the doctor gate, the database migration and recall — while the version numbers
 * and the failure injection stay under the test's control.
 */

export const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUN = process.execPath;
const BUN_DIR = dirname(process.execPath);
export const TEMP_ROOT = join(coreRoot, '.cogmem', 'tmp');

/**
 * The package manager stand-in.
 *
 * `cogmem@<spec>` copies the template and writes `<spec>` into its manifest, so the
 * installed CLI reports the version the update asked for. `*corrupt*` fails the way
 * a truncated tarball does, after leaving a broken tree behind; `*badgate*` installs
 * a package whose doctor cannot answer the gate.
 */
const NPM_SHIM = `#!/bin/sh
echo "npm $*" >> "$COGMEM_TEST_NPM_LOG"
spec=""
for a in "$@"; do
  case "$a" in cogmem@*) spec="\${a#cogmem@}" ;; esac
done
dest="$PWD/node_modules/cogmem"
case "$spec" in
  *corrupt*)
    rm -rf "$dest"; mkdir -p "$dest"
    printf 'not a package\\n' > "$dest/package.json"
    echo "npm ERR! corrupted tarball for cogmem@$spec" >&2
    exit 1 ;;
esac
rm -rf "$dest"
mkdir -p "$dest"
cp -r "$COGMEM_TEST_PKG_TEMPLATE/src" "$dest/src"
sed "s/__VERSION__/$spec/" "$COGMEM_TEST_PKG_TEMPLATE/package.json" > "$dest/package.json"
ln -s "$COGMEM_TEST_REPO_NODE_MODULES" "$dest/node_modules"
case "$spec" in
  *badgate*) cp "$COGMEM_TEST_BADGATE_DOCTOR" "$dest/src/bin/doctor.ts" ;;
esac
exit 0
`;

export interface Fixture {
  root: string;
  install: string;
  home: string;
  binDir: string;
  template: string;
  configPath: string;
  dbPath: string;
  sessionPath: string;
  npmLog: string;
  launcher: string;
  badDoctor: string;
  port: number;
}

export interface RunResult { stdout: string; stderr: string; exitCode: number }

export function fixtureEnv(f: Fixture, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: f.home,
    PATH: `${f.binDir}:${BUN_DIR}:${process.env.PATH}`,
    // The check itself is off in the suite; the tests that want it turn it on.
    COGMEM_UPDATE_CHECK: '0',
    COGMEM_TEST_PKG_TEMPLATE: f.template,
    COGMEM_TEST_REPO_NODE_MODULES: join(coreRoot, 'node_modules'),
    COGMEM_TEST_NPM_LOG: f.npmLog,
    COGMEM_TEST_BADGATE_DOCTOR: f.badDoctor,
    TMPDIR: TEMP_ROOT,
    NO_COLOR: '1',
    ...extra,
  };
}

export function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = server.port;
  server.stop(true);
  return port;
}

export function makeFixture(prefix: string): Fixture {
  const root = makeTempDir(prefix);
  const install = join(root, 'install');
  const home = join(root, 'home');
  const binDir = join(root, 'bin');
  const template = join(root, 'pkg-template');
  const configDir = join(install, '.cogmem');
  const configPath = join(configDir, 'config.toml');
  for (const dir of [home, binDir, configDir, join(install, 'node_modules', '.bin')]) mkdirSync(dir, { recursive: true });

  // The template is the real checkout, so every gate and migration the update runs
  // is the product's own code rather than a stub that would agree with anything.
  mkdirSync(template, { recursive: true });
  cpSync(join(coreRoot, 'src'), join(template, 'src'), { recursive: true });
  writeFileSync(
    join(template, 'package.json'),
    JSON.stringify({ name: 'cogmem', version: '__VERSION__', type: 'module', main: './src/public.ts' }, null, 2),
  );

  writeFileSync(configPath, [
    '[core]',
    'db_path = "memory.db"',
    'vector_backend = "sqlite-vec"',
    '[memory_model]',
    'provider = "rule_only"',
    'model = "rule_only"',
  ].join('\n'));
  // A real install home carries the dependency the update rewrites.
  writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'cogmem-install', private: true, dependencies: { cogmem: '4.1.0' } }, null, 2));

  const npmLog = join(root, 'npm.log');
  writeFileSync(join(binDir, 'npm'), NPM_SHIM);
  chmodSync(join(binDir, 'npm'), 0o755);

  // The installed launcher resolves whatever package is currently in node_modules,
  // which is what makes the swap visible to the gate.
  const launcher = join(install, 'node_modules', '.bin', 'cogmem');
  writeFileSync(launcher, `#!/bin/sh\nDIR=$(cd "$(dirname "$0")/.." && pwd)\nexec ${JSON.stringify(BUN)} "$DIR/cogmem/src/bin/cogmem.ts" "$@"\n`);
  chmodSync(launcher, 0o755);

  const badDoctor = join(root, 'bad-doctor.ts');
  writeFileSync(badDoctor, "console.error('doctor cannot answer in this build');\nprocess.exit(1);\n");

  return { root, install, home, binDir, template, configPath, dbPath: join(configDir, 'memory.db'), sessionPath: join(configDir, 'mcp-http.json'), npmLog, launcher, badDoctor, port: freePort() };
}

export async function run(cmd: string[], options: { cwd: string; env: Record<string, string | undefined> }): Promise<RunResult> {
  const proc = Bun.spawn({ cmd, cwd: options.cwd, stdout: 'pipe', stderr: 'pipe', env: options.env });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

export function installedBin(f: Fixture, name: string): string {
  return join(f.install, 'node_modules', 'cogmem', 'src', 'bin', name);
}

/** `cogmem <args>`, resolved through the install's own launcher. */
export function cogmem(f: Fixture, args: string[], extraEnv: Record<string, string | undefined> = {}): Promise<RunResult> {
  return run([BUN, installedBin(f, 'cogmem.ts'), ...args], { cwd: f.install, env: fixtureEnv(f, extraEnv) });
}

export function installedVersion(f: Fixture): string | undefined {
  const manifest = join(f.install, 'node_modules', 'cogmem', 'package.json');
  if (!existsSync(manifest)) return undefined;
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** Install a version the way the shim would, without going through an update. */
export async function pretestInstall(f: Fixture, version: string): Promise<void> {
  const result = await run(['npm', 'install', `cogmem@${version}`], { cwd: f.install, env: fixtureEnv(f) });
  expect(result.exitCode, result.stderr).toBe(0);
}

export interface ServerHandle { proc: ReturnType<typeof Bun.spawn>; url: string; pid: number }

export function startServer(f: Fixture, extraEnv: Record<string, string | undefined> = {}): ServerHandle {
  const proc = Bun.spawn({
    cmd: [BUN, installedBin(f, 'mcp.ts'), '--transport', 'http', '--port', String(f.port), '--config', f.configPath],
    cwd: f.install,
    stdout: 'ignore',
    stderr: 'ignore',
    env: fixtureEnv(f, extraEnv),
  });
  return { proc, url: `http://127.0.0.1:${f.port}/mcp`, pid: proc.pid };
}

const tracked = new Set<() => void>();

/** Remember a service so the file's `afterAll` can kill whatever is still up. */
export function track(handle: ServerHandle): ServerHandle {
  tracked.add(() => { try { handle.proc.kill(); } catch { /* already gone */ } });
  return handle;
}

export function killTrackedServers(): void {
  for (const stop of tracked) stop();
  tracked.clear();
}

export async function waitForSession(f: Fixture, predicate: (session: ResidentSession) => boolean, timeoutMs = 30_000): Promise<ResidentSession> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = readResidentSession(f.sessionPath);
    if (session && predicate(session)) return session;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the resident session record never appeared');
}

/** Write one turn through the running service, the way a host would. */
export async function rememberThroughServer(url: string, text: string): Promise<void> {
  const sessionId = await connect(url);
  const result = await callTool(url, sessionId, 'cogmem_remember_turn', {
    userText: text,
    projectId: 'p',
    agentId: 'a',
    sessionId: 's1',
    timeZone: 'UTC',
  });
  expect(result.isError, result.raw).toBe(false);
}

export async function recallThroughServer(url: string, query: string): Promise<string> {
  const sessionId = await connect(url);
  const result = await callTool(url, sessionId, 'cogmem_recall', { query, projectId: 'p', agentId: 'a', timeZone: 'UTC' });
  expect(result.isError, result.raw).toBe(false);
  return result.raw;
}

export function updateTrace(f: Fixture): Array<{ status?: string; step?: string; mode?: string; from?: string; to?: string; restartRequired?: boolean }> {
  const path = join(f.install, '.cogmem', 'logs', 'update.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
