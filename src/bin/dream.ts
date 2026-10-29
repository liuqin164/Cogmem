#!/usr/bin/env bun
import { createMemoryKernel, createMemoryKernelFromConfig, type MemoryKernel } from '../factory.js';
import { parseCliArgs, type CliArgs as Args } from './CliArgs.js';
import { printCliJson } from './CliJson.js';

const DREAM_COMMANDS = ['tick', 'night', 'status', 'retry'] as const;

function parseArgs(argv: string[]): Args {
  if (argv.includes('--promote')) {
    throw new Error('dream tick does not promote; run `cogmem memory govern --project <id>` after the tick');
  }
  return parseCliArgs(argv, { usage: usage(), commands: DREAM_COMMANDS });
}

function usage(): string {
  return [
    'Usage: cogmem dream <tick|night|status|retry> [args]',
    '  tick [--project <id>] [--mode auto|micro|normal|deep] [--max-episodes <n>] [--json] [--db <memory.db>|--config <config.toml>]',
    '  night [--project <id>] [--max-episodes <n>] [--json] [--db <memory.db>|--config <config.toml>]',
    '         one Night: seal idle episodes, Dream up to N of them (default 50,',
    '         oldest first), then project those episodes into the atlas. Safe to re-run.',
    '  status [--project <id>] [--json]',
    '  retry [--project <id>] [--json]',
    'A tick is explicit and conditional. It processes sealed episodes only and never executes tools.',
    '--json emits cogmem.cli.v1 with command payload fields at the top level.',
  ].join('\n');
}

function openKernel(args: Args): MemoryKernel {
  const dbPath = stringArg(args, 'db');
  return dbPath ? createMemoryKernel({ dbPath }) : createMemoryKernelFromConfig({ configPath: stringArg(args, 'config'), cwd: process.cwd() });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.help === true || args.h === true) { console.log(usage()); return; }
  const kernel = openKernel(args);
  try {
    const projectId = stringArg(args, 'project');
    const result = args.command === 'night'
      ? await kernel.runNight({ projectId, maxEpisodes: numberArg(args, 'max-episodes') })
      : args.command === 'tick'
      ? await kernel.runDreamTick({ projectId, mode: modeArg(stringArg(args, 'mode')), maxEpisodes: numberArg(args, 'max-episodes') })
      : args.command === 'status'
        ? kernel.getEpisodeDreamStatus(projectId)
        : args.command === 'retry'
          ? { retried: kernel.retryFailedEpisodeDreams(projectId), status: kernel.getEpisodeDreamStatus(projectId) }
          : (() => { throw new Error(usage()); })();
    printCliJson(`dream.${args.command}`, result);
  } finally { kernel.close(); }
}

function stringArg(args: Args, key: string): string | undefined { return typeof args[key] === 'string' && args[key] ? args[key] as string : undefined; }
function numberArg(args: Args, key: string): number | undefined { const value = stringArg(args, key); if (!value) return undefined; const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error(`--${key} must be numeric`); return parsed; }
function modeArg(value?: string): 'auto' | 'micro' | 'normal' | 'deep' | undefined { if (!value) return undefined; if (value === 'auto' || value === 'micro' || value === 'normal' || value === 'deep') return value; throw new Error('mode must be auto, micro, normal, or deep'); }

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
