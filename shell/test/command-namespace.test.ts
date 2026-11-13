/**
 * The core command namespace (spec §7): a plugin command may not take a core name, and the refusal
 * has to be visible. The two authoring layers differ on the blast radius by design — a native plugin
 * conflict is a loud load failure (the host's rule for tool names too), while a Pi extension drops
 * the one command and keeps loading (its loader's rule for what it cannot register) — so both are
 * checked here, against both the live registry and the trace it leaves behind.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandNameConflictError, PluginHost, RESERVED_CORE_COMMANDS } from '../src/plugins/host.ts';
import { PiCompatAdapter, resolvePiExtensionEntry } from '../src/pi/adapter.ts';
import { TraceLog } from '../src/trace.ts';
import { CORE_COMMANDS } from '../src/commands.ts';
import { makeTempDir } from './helpers.ts';

describe('the core command namespace (spec §7)', () => {
  test('every name the table offers is reserved, so the two lists cannot drift apart', () => {
    // `model` is in the table with a conditional palette surface (paletteCommands), so it is included.
    for (const command of CORE_COMMANDS) {
      expect(RESERVED_CORE_COMMANDS).toContain(command.name);
    }
  });

  test('a native plugin command that takes a core name is refused and traced', async () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    const host = new PluginHost({ trace });
    host.register({
      name: 'squatter',
      apply(ctx) {
        ctx.registerCommand({ name: 'status', handler: () => 'stolen' });
      },
    });
    await expect(host.start()).rejects.toThrow(CommandNameConflictError);
    // Refused means absent: the registry never held it, so nothing can dispatch it.
    expect(host.commands.has('status')).toBe(false);
    expect(trace.read().some((record) => record.kind === 'plugin_command_refused' && record.command === 'status' && record.reservedCore === true)).toBe(true);
  });

  test('a native plugin command that does not collide registers and runs', async () => {
    const dir = makeTempDir();
    const host = new PluginHost({ trace: new TraceLog(dir) });
    host.register({
      name: 'weather',
      apply(ctx) {
        ctx.registerCommand({ name: 'sunny', handler: () => '晴' });
      },
    });
    await host.start();
    try {
      expect(host.commands.has('sunny')).toBe(true);
      expect(await host.commands.run('sunny', '', {})).toBe('晴');
    } finally {
      await host.stop();
    }
  });

  test('a Pi extension command that takes a core name is dropped and traced, and the plugin keeps loading', async () => {
    const dir = makeTempDir();
    const pluginDir = join(dir, 'squatting-extension');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'index.ts'),
      'export default function (pi: any) { pi.registerCommand("why", { handler() {} }); pi.registerTool({ name: "still-there", description: "d", parameters: { type: "object", properties: {} }, execute: async () => "ok" }); }\n',
      'utf8',
    );
    const trace = new TraceLog(dir);
    const host = new PluginHost();
    host.seedService('eventBus', host.bus);
    const adapter = new PiCompatAdapter({ host, pluginName: 'squatting-extension', cwd: dir, sessionId: 's', trace });
    const result = await adapter.load(resolvePiExtensionEntry(pluginDir, dir));
    expect(result.status).toBe('loaded');
    expect(result.commands).not.toContain('why');
    expect(result.dropped).toContain('command:why');
    expect(host.commands.has('why')).toBe(false);
    // The refusal is scoped to the command; the extension's other registrations survive it.
    expect(host.tools.has('still-there')).toBe(true);
    expect(trace.read().some((record) => record.kind === 'pi_command_refused' && record.command === 'why' && record.reservedCore === true)).toBe(true);
  });
});
