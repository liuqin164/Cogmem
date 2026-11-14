/**
 * CLI entry: `start` (resident), `once` (one turn then exit), `probe` (F1/F2/F6 gap list), `gate`
 * (the upgrade's pre-switch health gate).
 *
 * `probe` is what the #165 comment is generated from; `start` is what the survival run would use;
 * `gate` is run by the upgrade supervisor *inside the staged tree*, which is what makes the gate
 * evidence about the new version rather than about the one already serving.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryKernel, KernelAgentMemoryBackend } from 'cogmem';
import { CompanionShell } from './app.ts';
import { defaultShellConfig, type ShellConfig } from './config.ts';
import { runGapProbes, renderGapsMarkdown } from './probes/gaps.ts';
import { runUpgradeGate } from './upgrade/gate.ts';

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean | string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'start', ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split('=');
      if (inline !== undefined) {
        if (name === 'pi-plugin') pushFlag(flags, name, inline);
        else flags.set(name, inline);
      } else if (rest[index + 1] && !rest[index + 1].startsWith('--')) {
        if (name === 'pi-plugin') pushFlag(flags, name, rest[index + 1]);
        else flags.set(name, rest[index + 1]);
        index += 1;
      } else flags.set(name, true);
    } else positionals.push(token);
  }
  return { command, positionals, flags };
}

function overridesFrom(parsed: ParsedArgs): Partial<ShellConfig> {
  const flags = parsed.flags;
  const stringFlag = (name: string): string | undefined => (typeof flags.get(name) === 'string' ? (flags.get(name) as string) : undefined);
  const csv = (name: string): string[] | undefined => stringFlag(name)?.split(',').map((item) => item.trim()).filter(Boolean);
  const base = defaultShellConfig();
  const overrides: Partial<ShellConfig> = {};
  if (stringFlag('workspace')) overrides.workspaceRoot = stringFlag('workspace');
  if (stringFlag('data')) overrides.dataDir = stringFlag('data');
  if (stringFlag('db')) overrides.dbPath = stringFlag('db');
  if (stringFlag('project')) overrides.projectId = stringFlag('project');
  if (stringFlag('agent')) overrides.agentId = stringFlag('agent');
  if (flags.get('no-terminal')) overrides.terminalEnabled = false;
  if (flags.get('attach')) overrides.attach = { ...base.attach, enabled: true };
  if (flags.get('no-http')) overrides.http = { ...base.http, enabled: false };
  if (stringFlag('http-port')) overrides.http = { ...base.http, enabled: true, port: Number(stringFlag('http-port')) };
  const piPlugins = piPluginSpecs(parsed);
  if (piPlugins.length > 0) overrides.pi = { adapterEnabled: true, plugins: piPlugins };
  if (flags.get('no-pi')) overrides.pi = { adapterEnabled: false, plugins: [] };
  if (csv('tools')) overrides.budgets = { ...base.budgets, toolWhitelist: csv('tools')! };
  if (stringFlag('turns')) overrides.budgets = { ...(overrides.budgets ?? base.budgets), maxTurnsPerRun: Number(stringFlag('turns')) };
  if (stringFlag('tokens')) overrides.budgets = { ...(overrides.budgets ?? base.budgets), maxTokensPerRun: Number(stringFlag('tokens')) };
  return overrides;
}

function pushFlag(flags: ParsedArgs['flags'], name: string, value: string): void {
  const current = flags.get(name);
  if (Array.isArray(current)) current.push(value);
  else flags.set(name, [value]);
}

function piPluginSpecs(parsed: ParsedArgs): string[] {
  const value = parsed.flags.get('pi-plugin');
  return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  const overrides = overridesFrom(parsed);
  if (parsed.command === 'probe') {
    // The probe drives the public API with real writes (an event, a prospective memory) to show what
    // fires and what does not. That belongs in a throwaway kernel: without an explicit --db the
    // command writes nothing durable, so running it twice has nothing to do the second time.
    const config = defaultShellConfig({ ...overrides, dbPath: overrides.dbPath ?? ':memory:' });
    const kernel = createMemoryKernel({ dbPath: config.dbPath, projectTimeZone: config.timeZone });
    const backend = new KernelAgentMemoryBackend(kernel);
    try {
      const result = await runGapProbes({ kernel, backend, projectId: config.projectId, agentId: config.agentId, sessionId: config.sessionId });
      mkdirSync(config.dataDir, { recursive: true });
      writeFileSync(join(config.dataDir, 'gaps.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      const markdown = renderGapsMarkdown(result);
      writeFileSync(join(config.dataDir, 'gaps.md'), `${markdown}\n`, 'utf8');
      process.stdout.write(`${markdown}\n`);
      return 0;
    } finally {
      kernel.close();
    }
  }
  if (parsed.command === 'gate') {
    // One JSON line on stdout and an exit code, because the caller is the supervisor, not a person.
    const config = defaultShellConfig(overrides);
    const result = await runUpgradeGate({
      dataDir: config.dataDir,
      dbPath: config.dbPath,
      agentId: config.agentId,
      projectId: config.projectId,
    });
    process.stdout.write(`${JSON.stringify({ command: 'upgrade.gate', ok: result.ok, treeVersion: result.treeVersion, checks: result.checks })}\n`);
    return result.ok ? 0 : 1;
  }
  const config = defaultShellConfig({ ...overrides, terminalEnabled: parsed.command === 'once' ? false : overrides.terminalEnabled });
  const shell = new CompanionShell({ config, onAlarm: () => process.exit(3) });
  await shell.start();
  if (parsed.command === 'once') {
    const text = parsed.positionals[0] ?? 'ping';
    const summary = await shell.submit(text);
    process.stdout.write(`${summary?.assistantText ?? '(no reply)'}\n`);
    await shell.stop();
    return 0;
  }
  process.stdout.write(`companion shell started: state=${shell.state} data=${config.dataDir}${shell.httpUrl ? ` http=${shell.httpUrl}` : ''}\n`);
  for (const plugin of shell.piPluginResults) {
    process.stdout.write(`pi plugin ${plugin.pluginName}: ${plugin.status}${plugin.reason ? ` reason=${plugin.reason}` : ''} tools=[${plugin.tools.join(', ')}] commands=[${plugin.commands.join(', ')}]\n`);
  }
  const shutdown = async () => {
    await shell.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  await new Promise(() => {});
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[companion-shell] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
