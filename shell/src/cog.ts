#!/usr/bin/env bun
/**
 * `cog`: the terminal interface. Attach to a running resident, or bring one up and attach to it.
 *
 * The process boundary is the point of this file. The resident is spawned detached with the control
 * socket on and its own line channel off; this process owns only the terminal. Killing this process
 * therefore kills a view, never the companion — and `--headless` skips the view entirely, which is
 * the spike's original headless wall.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { defaultShellConfig, type ShellConfig } from './config.ts';
import { defaultSocketPath } from './attach/server.ts';
import { AttachClient } from './attach/client.ts';

interface Parsed {
  flags: Map<string, string | true>;
  positionals: string[];
}

function parse(argv: string[]): Parsed {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split('=');
    if (inline !== undefined) flags.set(name, inline);
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      flags.set(name, argv[index + 1]);
      index += 1;
    } else flags.set(name, true);
  }
  return { flags, positionals };
}

function stringFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function shellOverrides(parsed: Parsed): Partial<ShellConfig> {
  const overrides: Partial<ShellConfig> = { attach: { enabled: true } };
  for (const [flag, field] of [['workspace', 'workspaceRoot'], ['data', 'dataDir'], ['db', 'dbPath'], ['project', 'projectId'], ['agent', 'agentId']] as const) {
    const value = stringFlag(parsed, flag);
    if (value !== undefined) (overrides as Record<string, unknown>)[field] = value;
  }
  const httpPort = stringFlag(parsed, 'http-port');
  const base = defaultShellConfig();
  if (httpPort !== undefined) overrides.http = { ...base.http, enabled: true, port: Number(httpPort) };
  if (parsed.flags.get('no-http')) overrides.http = { ...base.http, enabled: false };
  return overrides;
}

/** The resident flags `cog` passes through so the two processes agree on dirs and identity. */
function residentArgs(parsed: Parsed): string[] {
  const args = ['--attach', '--no-terminal'];
  for (const flag of ['workspace', 'data', 'db', 'project', 'agent', 'http-port']) {
    const value = stringFlag(parsed, flag);
    if (value !== undefined) args.push(`--${flag}`, value);
  }
  if (parsed.flags.get('no-http')) args.push('--no-http');
  return args;
}

async function tryConnect(socketPath: string, timeoutMs = 1_500): Promise<AttachClient | undefined> {
  if (!existsSync(socketPath)) return undefined;
  const client = new AttachClient();
  try {
    await client.connect(socketPath, timeoutMs);
    return client;
  } catch {
    return undefined;
  }
}

async function waitForSocket(socketPath: string, timeoutMs = 20_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const client = await tryConnect(socketPath);
    if (client) {
      client.close();
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  return false;
}

function spawnResident(parsed: Parsed, config: ShellConfig): void {
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const child = spawn(process.execPath, ['run', cli, 'start', ...residentArgs(parsed)], {
    cwd: config.workspaceRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, COGMEM_SHELL_ATTACH: 'on' },
  });
  child.unref();
}

async function main(): Promise<number> {
  const parsed = parse(process.argv.slice(2));
  const config = defaultShellConfig(shellOverrides(parsed));
  const socketPath = config.attach.socketPath ?? defaultSocketPath(config.dataDir);

  if (parsed.flags.get('help')) {
    process.stdout.write('cog [--headless] [--workspace d] [--data d] [--db f] [--project id] [--agent id] [--http-port n] [--no-http]\n');
    return 0;
  }

  let client = await tryConnect(socketPath);
  if (!client) {
    spawnResident(parsed, config);
    if (!(await waitForSocket(socketPath))) {
      process.stderr.write(`cog: resident did not come up; expected its socket at ${socketPath}\n`);
      return 1;
    }
    if (parsed.flags.get('headless')) {
      process.stdout.write(`cog: resident started (socket ${socketPath})\n`);
      return 0;
    }
    client = await tryConnect(socketPath);
    if (!client) {
      process.stderr.write(`cog: could not attach to ${socketPath}\n`);
      return 1;
    }
  } else if (parsed.flags.get('headless')) {
    client.close();
    process.stdout.write(`cog: resident already running (socket ${socketPath})\n`);
    return 0;
  }

  if (!process.stdout.isTTY) return runLineMode(client, socketPath);

  client.close();
  const { TuiApp } = await import('./tui/app.ts');
  const app = new TuiApp({
    socketPath,
    historyPath: `${config.dataDir}/input-history.json`,
    onExit: () => process.exit(0),
  });
  const onFatal = (error: unknown) => {
    app.stop('fatal');
    process.stderr.write(`cog: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  };
  process.on('uncaughtException', onFatal);
  process.on('unhandledRejection', onFatal);
  try {
    await app.start();
  } catch (error) {
    onFatal(error);
  }
  await new Promise(() => {});
  return 0;
}

/** Non-TTY degradation (§0): a line in, a line out, no界面. */
function runLineMode(client: AttachClient, socketPath: string): Promise<number> {
  const reader = createInterface({ input: process.stdin, terminal: false });
  client.onEvent = (message) => {
    if (message.t !== 'event') return;
    if (message.name === 'message_end' && message.payload?.message?.role === 'assistant' && message.payload.message.content) {
      process.stdout.write(`${message.payload.message.content}\n`);
    }
    if (message.name === 'companion_command_result') process.stdout.write(`${message.payload?.text ?? ''}\n`);
    if (message.name === 'companion_transition') process.stdout.write(`[${message.payload?.state ?? ''}]\n`);
  };
  client.onClose = () => process.exit(0);
  reader.on('line', (line: string) => {
    const text = line.trim();
    if (text === '') return;
    if (text.startsWith('/')) {
      const [rawName, ...rest] = text.slice(1).split(/\s+/u);
      client.send({ t: 'command', name: rawName, args: rest.join(' ') });
      return;
    }
    client.send({ t: 'submit', text });
  });
  process.on('SIGINT', () => {
    client.send({ t: 'detach' });
    client.close();
    process.exit(0);
  });
  process.stderr.write(`cog: 非 TTY，行模式附着到 ${socketPath}\n`);
  // Hold the process open for the life of the pipe: returning here exits `cog` after one prompt.
  return new Promise((resolvePromise) => {
    reader.on('close', () => {
      client.close();
      resolvePromise(0);
    });
  });
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`cog: fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
