#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  defaultOpenClawAutoMemoryPluginDir,
  inspectOpenClawAutoMemoryPlugin,
} from '../host/openclaw/AutoMemoryPluginInstaller.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function usage(): string {
  return [
    'Usage: cogmem openclaw diagnose --workspace <workspace> [--plugin-dir <dir>] [--json]',
    '',
    'Diagnoses the generated OpenClaw Cogmem plugin without opening the Cogmem database.',
  ].join('\n');
}

function readAudit(workspaceRoot: string): { logPath: string; lastBeforePromptBuild?: Record<string, unknown>; recentErrors: Record<string, unknown>[] } {
  const logPath = join(workspaceRoot, '.cogmem', 'logs', 'openclaw-auto-memory.jsonl');
  if (!existsSync(logPath)) return { logPath, recentErrors: [] };
  const records = readFileSync(logPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-500)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((record): record is Record<string, unknown> => Boolean(record));
  return {
    logPath,
    lastBeforePromptBuild: records.slice().reverse().find((record) => record.hook === 'before_prompt_build'),
    recentErrors: records.filter((record) => record.action === 'error').slice(-20),
  };
}

function main(): void {
  const [command] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (command !== 'diagnose' || hasFlag('--help') || hasFlag('-h')) {
    console.log(usage());
    process.exit(command === 'diagnose' ? 0 : 1);
  }
  const workspace = readArg('--workspace');
  if (!workspace) throw new Error(`Missing --workspace.\n${usage()}`);
  const workspaceRoot = resolve(workspace);
  const pluginDir = readArg('--plugin-dir') || defaultOpenClawAutoMemoryPluginDir(workspaceRoot);
  const plugin = inspectOpenClawAutoMemoryPlugin({ workspaceRoot, pluginDir });
  const audit = readAudit(workspaceRoot);
  const payload = {
    schemaVersion: 'cogmem.cli.v1',
    command: 'openclaw diagnose',
    workspaceRoot,
    plugin,
    audit,
  };
  if (hasFlag('--json')) {
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(`OpenClaw workspace: ${workspaceRoot}`);
  console.log(`plugin: ${plugin.current ? 'current' : plugin.installed ? 'stale' : 'missing'} ${plugin.pluginDir}`);
  if (audit.lastBeforePromptBuild) {
    console.log(`last before_prompt_build: action=${audit.lastBeforePromptBuild.action || 'unknown'} reason=${audit.lastBeforePromptBuild.reason || ''}`);
  } else {
    console.log('last before_prompt_build: none');
  }
}

main();
