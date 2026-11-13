/**
 * The command面 closure (20-165): one table behind the palette, the resident and the TUI; one
 * unknown-command receipt on all three faces (`/foo` never becomes a model turn by accident); a
 * plugin command's argument hint in the palette; and a throwing handler attributed to its command
 * name in both the receipt and the trace.
 *
 * The discriminator for the table is deletion and rename: drop a row or change a name and the spec
 * list, the per-surface dispatch or the palette check below goes red.
 */
import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { CORE_COMMANDS, coreCommandFor, unknownCommandReply } from '../src/commands.ts';
import { PluginHost, RESERVED_CORE_COMMANDS } from '../src/plugins/host.ts';
import { TraceLog } from '../src/trace.ts';
import { dispatchTuiCommand, paletteCommands, paletteRows } from '../src/tui/commands.ts';
import { defaultRenderEnv } from '../src/tui/frame.ts';
import { TuiView } from '../src/tui/view.ts';
import { TerminalChannel } from '../src/channels/terminal.ts';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

const NO_DREAM = { windowStartHour: 0, windowEndHour: 0, runKernelNight: false, maxEpisodes: 5 };
const SPEC_COMMANDS = ['soul', 'memory', 'commitments', 'status', 'context', 'sleep', 'dream', 'pause', 'resume', 'why', 'model', 'help', 'exit'];

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for terminal output');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

function outputCollector() {
  let text = '';
  return {
    stream: {
      write(chunk: string | Uint8Array) {
        text += chunk.toString();
        return true;
      },
    } as NodeJS.WritableStream,
    text: () => text,
  };
}

describe('the core command table is the single source of truth (spec §7)', () => {
  test('the spec set is in the table and every name is reserved', () => {
    for (const name of SPEC_COMMANDS) expect(CORE_COMMANDS.some((command) => command.name === name)).toBe(true);
    for (const command of CORE_COMMANDS) expect(RESERVED_CORE_COMMANDS).toContain(command.name);
  });

  test('every command is dispatchable on each surface it declares, through the same table entry', () => {
    const view = new TuiView();
    view.modelRoutes = ['mg/a', 'mg/b']; // `/model`'s palette surface needs a second route
    const palette = paletteCommands(view).map((command) => command.name);
    for (const command of CORE_COMMANDS) {
      expect(command.surfaces.length).toBeGreaterThan(0);
      for (const surface of command.surfaces) {
        // All three faces resolve a name with this function, so the entry — and its handler — is one.
        expect(coreCommandFor(command.name, surface)).toBe(command);
        if (surface === 'palette') expect(palette).toContain(command.name);
        if (surface === 'tui') expect(dispatchTuiCommand(command.name, '', view).unknown).toBeUndefined();
      }
    }
    // A face never dispatches a name the table did not grant it: `/exit` is the TUI's, not the resident's.
    expect(coreCommandFor('exit', 'resident')).toBeUndefined();
  });
});

describe('unknown /foo is one receipt on every face and never reaches the model', () => {
  test('terminal, resident and TUI answer the same receipt, with a closest-command hint', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: 'unused', toolCalls: [] }]);
    const input = new PassThrough();
    const output = outputCollector();
    const shell = makeShell(dir, provider, { terminalEnabled: true, dream: NO_DREAM }, { terminalInput: input, terminalOutput: output.stream });
    await shell.start();
    try {
      const expected = unknownCommandReply('definitely-not-a-command').text;

      // Surface 1 — the terminal channel: a receipt is printed and nothing is submitted.
      input.write('/definitely-not-a-command\n');
      await waitFor(() => output.text().includes(expected));
      expect(provider.calls).toHaveLength(0);

      // Surface 2 — the resident: the same text, flagged so the view renders the receipt style.
      const resident = await shell.runCommand('definitely-not-a-command');
      expect(resident.text).toBe(expected);
      expect(resident.receipt).toBe(true);

      // Surface 3 — the TUI: the same text, answered locally instead of forwarded.
      const dispatch = dispatchTuiCommand('definitely-not-a-command', '', new TuiView());
      expect(dispatch.unknown).toBe(expected);
      expect(dispatch.forward).toBe(false);
      expect(dispatch.overlay).toBeUndefined();

      // The hint points at a real command, so a typo is recoverable.
      const hinted = /最接近的核心命令：\/(\w+)/u.exec(expected)?.[1];
      expect(hinted).toBeDefined();
      expect(CORE_COMMANDS.some((command) => command.name === hinted)).toBe(true);
    } finally {
      await shell.stop();
    }
  });

  test('the terminal channel never routes an unknown slash line into submit', async () => {
    const submitted: string[] = [];
    const input = new PassThrough();
    const output = outputCollector();
    const channel = new TerminalChannel({
      shell: {
        state: 'IDLE',
        async submit(text: string) {
          submitted.push(text);
          return undefined;
        },
        async runCommand(name: string) {
          return unknownCommandReply(name);
        },
      },
      input,
      output: output.stream,
    });
    channel.start();
    try {
      input.write('/nope\n');
      await waitFor(() => output.text().includes('unknown command'));
      expect(submitted).toEqual([]);
    } finally {
      channel.stop();
    }
  });
});

describe('plugin commands: the hint reaches the palette, a failure names the command (spec §7)', () => {
  test('a plugin command is dispatched by the resident and its argument hint reaches the palette', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'unused', toolCalls: [] }]), { dream: NO_DREAM });
    shell.host.register({
      name: 'weather',
      apply(ctx) {
        ctx.registerCommand({ name: 'sunny', description: '今天的天气', argumentHint: '<城市>', handler: (args: string) => `晴：${args}` });
      },
    });
    await shell.start();
    try {
      const snapshot = shell.pluginCommands();
      expect(snapshot).toContainEqual({ name: 'sunny', description: '今天的天气', argumentHint: '<城市>' });

      const result = await shell.runCommand('sunny', '上海');
      expect(result.text).toBe('晴：上海');
      expect(result.receipt).toBe(true);

      const view = new TuiView();
      view.pluginCommands = snapshot;
      expect(paletteCommands(view).find((command) => command.name === 'sunny')?.argumentHint).toBe('<城市>');
      const rendered = paletteRows(view, '/sunny', 80, defaultRenderEnv({}), 0)
        .map((row) => row.map((segment) => segment.text).join(''))
        .join('\n');
      expect(rendered).toContain('sunny <城市>');
      expect(dispatchTuiCommand('sunny', '上海', view).forward).toBe(true);
    } finally {
      await shell.stop();
    }
  });

  test('a throwing handler is attributed to its command in the receipt and the trace', async () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    const host = new PluginHost({ trace });
    host.register({
      name: 'broken',
      apply(ctx) {
        ctx.registerCommand({
          name: 'boom',
          handler: () => {
            throw new Error('kaboom');
          },
        });
      },
    });
    await host.start();
    try {
      expect(await host.commands.run('boom', '', {})).toBe('命令 /boom 失败：kaboom');
      const recorded = trace.read().find((record) => record.kind === 'command_failed');
      expect(recorded?.command).toBe('boom');
      expect(String(recorded?.message)).toContain('kaboom');
      expect(String(recorded?.source)).toContain('broken');
    } finally {
      await host.stop();
    }
  });
});
