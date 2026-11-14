/**
 * Where the pieces of an upgrade live: which tree this process is serving from, what the installer
 * recorded about the service, and the argv/env a restarted resident needs.
 *
 * The *tree* is the whole Cog checkout (`<tree>/shell` is this package, `<tree>/src` is the kernel it
 * resolves `cogmem` to), because that is what a version of Cog actually is. A staged upgrade puts the
 * new tree under `<dataDir>/app/versions/`, and the switch points the service at it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { residentArgs, servicePath, type Platform, type ServiceSpec } from '../install/service.ts';
import type { UpgradeRequest } from './records.ts';

/** The tree this module is being served from: `.../shell/src/upgrade/paths.ts` → the checkout root. */
export function treeOfThisProcess(): string {
  return resolve(fileURLToPath(new URL('../../..', import.meta.url)));
}

/** The `shell/` directory of the tree this module is being served from. */
export function shellDirOfThisProcess(): string {
  return resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

export function shellDirOfTree(tree: string): string {
  return join(tree, 'shell');
}

/** A tree this upgrade can hand the service to: the shell entry and the kernel source beside it. */
export function looksLikeCogTree(tree: string): boolean {
  return existsSync(join(tree, 'shell', 'src', 'cli.ts')) && existsSync(join(tree, 'src', 'public.ts'));
}

/**
 * The version a tree advertises. The product version (`<tree>/package.json`) is what "5.0.0 → 5.0.1"
 * names; the shell's own package version is the fallback for a tree laid out differently.
 */
export function readTreeVersion(tree: string): string {
  for (const path of [join(tree, 'package.json'), join(tree, 'shell', 'package.json')]) {
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
      if (typeof manifest.version === 'string' && manifest.version !== '') return manifest.version;
    } catch {
      // Try the next manifest; an unreadable one is answered by the caller's refusal.
    }
  }
  return 'unknown';
}

/** What the installer recorded. Read-only here: the installer owns this file, not the upgrade. */
export interface InstallStateRecord {
  done?: string[];
  failedAt?: string;
  pid?: number;
  choices?: {
    dataDir?: string;
    workspaceRoot?: string;
    projectId?: string;
    agentId?: string;
    httpPort?: number;
    serviceName?: string;
    platform?: string;
    timeZone?: string;
  };
}

export function readInstallState(dataDir: string): InstallStateRecord | undefined {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'install.json'), 'utf8')) as InstallStateRecord;
  } catch {
    return undefined;
  }
}

/**
 * The `KEY=value` file the installer writes (0600, the one place the model key lives). Only the
 * service and the restarted resident read it; nothing here prints it.
 */
export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line);
    if (match) result[match[1]!] = match[2]!;
  }
  return result;
}

/** The `ServiceSpec` a restarted resident is described by, rebuilt from the request. */
export function serviceSpecFromRequest(request: UpgradeRequest, shellDir: string): ServiceSpec {
  return {
    serviceName: request.serviceName,
    bunPath: request.bunPath,
    shellDir,
    dataDir: request.dataDir,
    workspaceRoot: request.workspaceRoot,
    projectId: request.projectId,
    agentId: request.agentId,
    httpPort: request.httpPort,
    envFile: request.envFile,
    logFile: request.logFile,
    homeDir: request.homeDir,
    env: parseEnvFile(request.envFile),
  };
}

/**
 * Where this install's unit/plist would be, for the tree being served. `undefined` on a platform with
 * no service story in this shell (Windows is refused at install time).
 */
export function serviceUnitPathFor(request: UpgradeRequest, tree: string): string | undefined {
  if (request.serviceName === '') return undefined;
  if (request.platform !== 'linux' && request.platform !== 'darwin') return undefined;
  return servicePath(serviceSpecFromRequest(request, tree), request.platform as Platform);
}

/** `true` when a unit/plist file this install would have written is actually there. */
export function serviceFileExists(request: UpgradeRequest): boolean {
  if (!request.serviceMode) return false;
  const path = serviceUnitPathFor(request, request.fromTree);
  return path !== undefined && existsSync(path);
}

/** The argv a resident of `shellDir` starts with; the same list the installer's unit embeds. */
export function residentArgsFor(request: UpgradeRequest, shellDir: string): string[] {
  return residentArgs(serviceSpecFromRequest(request, shellDir));
}
