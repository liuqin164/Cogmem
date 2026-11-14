/**
 * The three Pi-compat lifecycle deviations #208 names, each pinned by a discriminator that fails
 * without its fix: load-failure isolation, `session_start` timing, and hook-exception containment.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

/** A local Pi extension: a directory whose `index.ts` is what `resolvePiExtensionEntry` loads. */
function writePlugin(dir: string, name: string, source: string): string {
  const pluginDir = join(dir, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'index.ts'), source, 'utf8');
  return pluginDir;
}

/** One tool call then a final text turn, so every run exercises the tool hooks as well as the plain ones. */
function toolThenDone(): ScriptedProvider {
  return new ScriptedProvider([
    (_input, call) =>
      call % 2 === 0
        ? { text: 'tool', toolCalls: [{ toolCallId: `c${call}`, toolName: 'read', input: { path: 'missing.txt' } }], usage: { input: 1, output: 1 } }
        : { text: 'done', toolCalls: [], usage: { input: 1, output: 1 } },
  ]);
}

const MID_RUN_HOOKS = [
  'before_agent_start',
  'agent_start',
  'message_start',
  'message_update',
  'message_end',
  'turn_start',
  'tool_execution_start',
  'tool_execution_end',
  'beforeToolCall',
  'afterToolCall',
  'turn_end',
  'finishTurn',
  'prepareNextTurn',
  'turn_usage',
  'transformContext',
  'prepareRequest',
];

describe('#208-1 a plugin that fails to load does not drag down the resident', () => {
  test('the failure is named in the trace and shown, and the other plugins still load', async () => {
    const dir = makeTempDir('pi-load-');
    const good = writePlugin(
      dir,
      'good',
      'export default function (pi: any) { pi.registerTool({ name: "good-tool", description: "g", parameters: { type: "object", properties: {} }, execute: async () => "ok" }); }\n',
    );
    const broken = writePlugin(dir, 'broken', 'throw new Error("boom at import");\n');
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'ok', toolCalls: [] }]), {
      pi: { adapterEnabled: true, plugins: [broken, good] },
    });
    const notices: string[] = [];
    shell.host.bus.on('terminal_print', (event: { text?: string }) => notices.push(event.text ?? ''));
    await shell.start();
    try {
      expect(shell.state).toBe('IDLE');
      expect(shell.host.tools.has('good-tool')).toBe(true);
      const failed = shell.trace.read().find((record) => record.kind === 'pi_plugin_failed');
      expect(String(failed?.plugin)).toBe(broken);
      expect(String(failed?.message)).toContain('boom at import');
      const result = shell.piPluginResults.find((entry) => entry.pluginName === broken);
      expect(result?.status).toBe('failed');
      expect(String(result?.reason)).toContain('boom at import');
      expect(notices.some((text) => text.includes('boom at import'))).toBe(true);
    } finally {
      await shell.stop();
    }
  }, 30_000);
});

describe('#208-2 session_start fires once, after every plugin is registered', () => {
  test("every plugin sees every other plugin's registration at session_start", async () => {
    const dir = makeTempDir('pi-session-start-');
    const names = ['alpha', 'beta', 'gamma'];
    const plugins = names.map((name) =>
      writePlugin(
        dir,
        name,
        `export default function (pi: any) {
  pi.registerTool({ name: "${name}-tool", description: "${name}", parameters: { type: "object", properties: {} }, execute: async () => "ok" });
  pi.on("session_start", (_event: unknown, ctx: any) => { ctx.ui.notify("SNAPSHOT:" + JSON.stringify(pi.getActiveTools())); });
}
`,
      ),
    );
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'ok', toolCalls: [] }]), {
      pi: { adapterEnabled: true, plugins },
    });
    await shell.start();
    try {
      const snapshots = shell.trace
        .read()
        .filter((record) => record.kind === 'pi_ui_notify' && String(record.message).startsWith('SNAPSHOT:'))
        .map((record) => JSON.parse(String(record.message).slice('SNAPSHOT:'.length)) as string[]);
      expect(snapshots.length).toBe(names.length);
      for (const snapshot of snapshots) {
        for (const name of names) expect(snapshot).toContain(`${name}-tool`);
      }
    } finally {
      await shell.stop();
    }
  }, 30_000);
});

describe('#208-3 a throwing hook cannot drag down the run', () => {
  test('the run finishes normally, the machine returns to IDLE, and the trace names the hook', async () => {
    const dir = makeTempDir('pi-hook-');
    const shell = makeShell(dir, toolThenDone());
    let throwOn: string | undefined;
    for (const event of MID_RUN_HOOKS) {
      shell.host.bus.on(event, () => {
        if (event === throwOn) throw new Error(`boom:${event}`);
      });
    }
    await shell.start();
    try {
      for (const event of MID_RUN_HOOKS) {
        throwOn = event;
        const summary = await shell.submit(`trigger ${event}`);
        expect(summary!.stopReason, `${event} does not abort the run`).toBe('run_complete');
        expect(shell.state, `${event} leaves the machine in IDLE`).toBe('IDLE');
      }
      throwOn = undefined;
      const failures = shell.trace.read().filter((record) => record.kind === 'bus_handler_failed');
      for (const event of MID_RUN_HOOKS) {
        expect(
          failures.some((record) => record.event === event && String(record.message) === `boom:${event}`),
          `${event} is attributed in the trace`,
        ).toBe(true);
      }
    } finally {
      await shell.stop();
    }
  }, 60_000);
});
