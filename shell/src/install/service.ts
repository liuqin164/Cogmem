/**
 * Registering the resident as a *user-level* service — systemd user on Linux, launchd agent on
 * macOS. No sudo, no root unit, no system-wide state: the companion belongs to the person, and an
 * installer that needed root to keep it alive would be the wrong shape.
 *
 * Every command goes through an injected `Runner`, so the unit rendering and the enable/restart
 * sequence are testable without a live service manager.
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Platform = 'linux' | 'darwin';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type Runner = (command: string, args: string[], options?: RunOptions) => Promise<CommandResult>;

export interface ServiceSpec {
  /** Unit basename on Linux, label on macOS. One name, two conventions. */
  serviceName: string;
  bunPath: string;
  shellDir: string;
  dataDir: string;
  workspaceRoot: string;
  projectId: string;
  agentId: string;
  httpPort: number;
  envFile: string;
  logFile: string;
  /** The HOME the service files go under; overridable so a sandbox does not touch the real one. */
  homeDir: string;
  /** Launchd embeds the environment; the map includes the model key, hence the 0600 plist. */
  env: Record<string, string>;
}

export function launchdLabel(serviceName: string): string {
  return `com.cogmem.${serviceName.replace(/^cogmem-?/, '') || 'companion'}`;
}

function quote(value: string): string {
  return /[^A-Za-z0-9_@%+=:,./-]/u.test(value) ? `"${value.replace(/(["\\$])/gu, '\\$1')}"` : value;
}

/** The argv the service runs: the resident, attachable, line channel off. */
export function residentArgs(spec: ServiceSpec): string[] {
  return [
    spec.bunPath,
    'run',
    join(spec.shellDir, 'src', 'cli.ts'),
    'start',
    '--attach',
    '--no-terminal',
    '--data', spec.dataDir,
    '--workspace', spec.workspaceRoot,
    '--project', spec.projectId,
    '--agent', spec.agentId,
    '--http-port', String(spec.httpPort),
  ];
}

export function systemdUnitPath(spec: ServiceSpec): string {
  return join(spec.homeDir, '.config', 'systemd', 'user', `${spec.serviceName}.service`);
}

export function launchdPlistPath(spec: ServiceSpec): string {
  return join(spec.homeDir, 'Library', 'LaunchAgents', `${launchdLabel(spec.serviceName)}.plist`);
}

export function servicePath(spec: ServiceSpec, platform: Platform): string {
  return platform === 'linux' ? systemdUnitPath(spec) : launchdPlistPath(spec);
}

/**
 * The user unit.
 *
 * `WantedBy=default.target` is what makes `enable` mean "start with the user session"; a machine
 * that must run the companion with nobody logged in also needs `loginctl enable-linger` (the
 * installer prints that, it does not silently change a machine-wide setting).
 */
export function renderSystemdUnit(spec: ServiceSpec): string {
  return [
    '[Unit]',
    'Description=Cogmem companion (resident, user service)',
    'Documentation=https://github.com/liuqin164/cogmem',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${residentArgs(spec).map(quote).join(' ')}`,
    `EnvironmentFile=${quote(spec.envFile)}`,
    `WorkingDirectory=${quote(spec.workspaceRoot)}`,
    'Restart=always',
    'RestartSec=3',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'StandardOutput=append:' + spec.logFile,
    'StandardError=append:' + spec.logFile,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function xmlEscape(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

export function renderLaunchdPlist(spec: ServiceSpec): string {
  const args = residentArgs(spec).map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n');
  const env = Object.entries(spec.env)
    .flatMap(([key, value]) => [`    <key>${xmlEscape(key)}</key>`, `    <string>${xmlEscape(value)}</string>`])
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${xmlEscape(launchdLabel(spec.serviceName))}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    args,
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    env,
    '  </dict>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xmlEscape(spec.workspaceRoot)}</string>`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${xmlEscape(spec.logFile)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xmlEscape(spec.logFile)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export interface ServiceHandle {
  platform: Platform;
  spec: ServiceSpec;
}

async function must(run: Runner, command: string, args: string[]): Promise<CommandResult> {
  const result = await run(command, args);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result;
}

/** Write the unit/plist and hand it to the service manager. Idempotent: re-running replaces it. */
export async function installService(run: Runner, spec: ServiceSpec, platform: Platform): Promise<{ path: string; autostart: string }> {
  const path = servicePath(spec, platform);
  mkdirSync(dirname(path), { recursive: true });
  if (platform === 'linux') {
    writeFileSync(path, renderSystemdUnit(spec), { mode: 0o644 });
    await must(run, 'systemctl', ['--user', 'daemon-reload']);
    await must(run, 'systemctl', ['--user', 'enable', '--now', `${spec.serviceName}.service`]);
    return { path, autostart: 'WantedBy=default.target（用户登录即起；无人登录也在跑需要 loginctl enable-linger）' };
  }
  writeFileSync(path, renderLaunchdPlist(spec), { mode: 0o600 });
  chmodSync(path, 0o600);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  await run('launchctl', ['bootout', `gui/${uid}/${launchdLabel(spec.serviceName)}`]);
  await must(run, 'launchctl', ['bootstrap', `gui/${uid}`, path]);
  return { path, autostart: 'RunAtLoad=true + KeepAlive=true（登录即起，退出自动拉起）' };
}

export async function restartService(run: Runner, spec: ServiceSpec, platform: Platform): Promise<void> {
  if (platform === 'linux') {
    await must(run, 'systemctl', ['--user', 'restart', `${spec.serviceName}.service`]);
    return;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  await must(run, 'launchctl', ['kickstart', '-k', `gui/${uid}/${launchdLabel(spec.serviceName)}`]);
}

/** `active` or `inactive` on Linux; `loaded`/`missing` on macOS (launchd has no single active word). */
export async function serviceStatus(run: Runner, spec: ServiceSpec, platform: Platform): Promise<string> {
  if (platform === 'linux') {
    const result = await run('systemctl', ['--user', 'is-active', `${spec.serviceName}.service`]);
    return result.stdout.trim() || (result.code === 0 ? 'active' : 'inactive');
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  const result = await run('launchctl', ['print', `gui/${uid}/${launchdLabel(spec.serviceName)}`]);
  return result.code === 0 ? 'loaded' : 'missing';
}

/** Stop, unload and remove. Used by `--uninstall` and by tests that must not leave a unit behind. */
export async function uninstallService(run: Runner, spec: ServiceSpec, platform: Platform): Promise<void> {
  const path = servicePath(spec, platform);
  if (platform === 'linux') {
    await run('systemctl', ['--user', 'disable', '--now', `${spec.serviceName}.service`]);
    rmSync(path, { force: true });
    await run('systemctl', ['--user', 'daemon-reload']);
    return;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  await run('launchctl', ['bootout', `gui/${uid}/${launchdLabel(spec.serviceName)}`]);
  rmSync(path, { force: true });
}
