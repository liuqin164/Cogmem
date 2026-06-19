#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_RELEASE_REPO, resolveLatestReleaseSpec } from './update-release.js';

interface UpdateArgs {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  from: string;
  installHome?: string;
  manager?: 'bun' | 'npm' | 'pnpm';
}

function readArgs(argv: string[]): UpdateArgs {
  const values: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const next = argv[index + 1];
    const key = item.slice(2);
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }
    values[key] = next;
    index += 1;
  }
  const manager = values.manager === 'npm' || values.manager === 'pnpm' || values.manager === 'bun'
    ? values.manager
    : undefined;
  return {
    dryRun: values['dry-run'] === true || values.yes !== true,
    yes: values.yes === true,
    json: values.json === true,
    from: typeof values.from === 'string' ? values.from : 'latest',
    installHome: typeof values['install-home'] === 'string' ? values['install-home'] : undefined,
    manager,
  };
}

function detectManager(cwd: string): 'bun' | 'npm' | 'pnpm' {
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  return 'npm';
}

function buildCommand(manager: 'bun' | 'npm' | 'pnpm', spec: string): string[] {
  if (manager === 'bun') return ['bun', 'add', `cogmem@${spec}`];
  if (manager === 'pnpm') return ['pnpm', 'add', `cogmem@${spec}`];
  return ['npm', 'install', `cogmem@${spec}`];
}

function buildMigrationExec(manager: 'bun' | 'npm' | 'pnpm'): string[] {
  if (manager === 'bun') return ['bun', 'x', 'cogmem', 'migrate', '--yes', '--backup'];
  if (manager === 'pnpm') return ['pnpm', 'exec', 'cogmem', 'migrate', '--yes', '--backup'];
  return ['npm', 'exec', '--', 'cogmem', 'migrate', '--yes', '--backup'];
}

function installedSpec(cwd: string): string | undefined {
  const manifest = readPackageManifest(cwd);
  if (!manifest) return undefined;
  return manifest.dependencies?.['cogmem']
    || manifest.devDependencies?.['cogmem']
    || manifest.optionalDependencies?.['cogmem']
    || manifest.dependencies?.['@CognitiveOS/core']
    || manifest.devDependencies?.['@CognitiveOS/core']
    || manifest.optionalDependencies?.['@CognitiveOS/core'];
}

function readPackageManifest(cwd: string): {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
} | undefined {
  const packagePath = join(cwd, 'package.json');
  if (!existsSync(packagePath)) return undefined;
  return JSON.parse(readFileSync(packagePath, 'utf8'));
}

function defaultInstallHome(env: Record<string, string | undefined>): string {
  return env.COGMEM_INSTALL_HOME || join(env.HOME || homedir(), '.cogmem', 'pkg');
}

function shouldUpdateCwd(cwd: string): boolean {
  const manifest = readPackageManifest(cwd);
  return manifest?.name === 'cogmem' || installedSpec(cwd) !== undefined;
}

function resolveUpdateCwd(args: UpdateArgs, env: Record<string, string | undefined>): string {
  const cwd = process.cwd();
  if (args.installHome) return args.installHome;
  if (shouldUpdateCwd(cwd)) return cwd;

  const installHome = defaultInstallHome(env);
  if (existsSync(join(installHome, 'package.json'))) return installHome;
  return cwd;
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const releaseRepo = process.env.COGMEM_REPO || DEFAULT_RELEASE_REPO;
  const resolvedSpec = args.from === 'latest'
    ? await resolveLatestReleaseSpec({ repo: releaseRepo, env: process.env })
    : args.from;
  const targetCwd = resolveUpdateCwd(args, process.env);
  const manager = args.manager || detectManager(targetCwd);
  const command = buildCommand(manager, resolvedSpec);
  const result = {
    command: 'update',
    dryRun: args.dryRun,
    manager,
    from: args.from,
    releaseRepo,
    releaseAsset: resolvedSpec,
    targetCwd,
    currentSpec: installedSpec(targetCwd),
    nextCommand: command.join(' '),
    migrationCommand: 'cogmem migrate --yes --backup',
    followUp: 'Run cogmem doctor --fix --agent openclaw --workspace <openclaw-workspace> after updating if OpenClaw auto memory is configured. For Hermes, rerun cogmem connect hermes and reload MCP.',
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`cogmem update ${args.dryRun ? 'dry-run' : 'running'}`);
    console.log(`target: ${result.targetCwd}`);
    console.log(`current: ${result.currentSpec || 'not listed in package.json'}`);
    console.log(`command: ${result.nextCommand}`);
    console.log(result.followUp);
  }

  if (!args.dryRun) {
    const proc = Bun.spawn({
      cmd: command,
      cwd: targetCwd,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const updateExitCode = await proc.exited;
    if (updateExitCode !== 0) process.exit(updateExitCode);
    const migration = Bun.spawn({
      cmd: buildMigrationExec(manager),
      cwd: targetCwd,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    process.exit(await migration.exited);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
