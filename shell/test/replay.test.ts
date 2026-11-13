import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { PluginHost, type NativePlugin } from '../src/plugins/host.ts';
import { builtinToolsPlugin } from '../src/plugins/builtin-tools.ts';
import { CheckpointStore, emptyCheckpoint } from '../src/state/checkpoint.ts';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

const twoTools: NativePlugin = {
  name: 'extra-tools',
  apply(ctx) {
    ctx.registerTool({ name: 'idempotent', description: '', parameters: {}, replay: 'safe', execute: () => 'ok' });
    ctx.registerTool({ name: 'effectful', description: '', parameters: {}, execute: () => 'ok' });
  },
};

describe('the replay policy', () => {
  test('a read is safe, an effect is not, and an undeclared tool defaults to never', async () => {
    const host = new PluginHost();
    host.register(builtinToolsPlugin(), { workspaceRoot: join(makeTempDir(), 'ws') });
    host.register(twoTools);
    await host.start();
    try {
      expect(host.tools.get('read')!.replay).toBe('safe');
      expect(host.tools.get('bash')!.replay).toBe('never');
      expect(host.tools.get('write')!.replay).toBe('never');
      expect(host.tools.get('edit')!.replay).toBe('never');
      expect(host.tools.get('idempotent')!.replay).toBe('safe');
      // Undeclared means "outcome unknown", which is a refusal, not a guess.
      expect(host.tools.get('effectful')!.replay).toBe('never');
    } finally {
      await host.stop();
    }
  });
});

describe('crash recovery and replay', () => {
  test('an effect left in flight by a killed run is refused replay by name', async () => {
    const dir = makeTempDir();
    new CheckpointStore(join(dir, 'data')).save({
      ...emptyCheckpoint(),
      state: 'RUNNING',
      activeRunId: 'run-crash',
      runtime: {
        declaredTools: ['read', 'write', 'edit', 'bash', 'propose_command'],
        inFlightToolCalls: [
          { toolCallId: 'c1', toolName: 'read' },
          { toolCallId: 'c2', toolName: 'bash' },
        ],
      },
    });
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'x', toolCalls: [] }]));
    await shell.start();
    try {
      expect(shell.state).toBe('IDLE');
      const record = shell.trace.read().find((entry) => entry.kind === 'recovery_no_replay');
      expect(record?.refused).toEqual(['bash']);
      // The list is consumed, so the next recovery does not replay a stale judgement.
      expect(shell.machine.runtime.inFlightToolCalls).toEqual([]);
    } finally {
      await shell.stop();
    }
  });

  test('a finished run leaves nothing in flight', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, new ScriptedProvider([
      { text: 'run', toolCalls: [{ toolCallId: 'c1', toolName: 'bash', input: { command: 'echo in-flight-check' } }] },
      { text: 'done', toolCalls: [] },
    ]));
    await shell.start();
    try {
      let sawInFlight: string[] = [];
      shell.host.bus.on('tool_execution_start', () => {
        sawInFlight = (shell.machine.runtime.inFlightToolCalls ?? []).map((call) => call.toolName);
      });
      await shell.submit('go');
      // The call was recorded while it ran, and cleared when it finished.
      expect(sawInFlight).toEqual(['bash']);
      expect(shell.machine.runtime.inFlightToolCalls ?? []).toEqual([]);
    } finally {
      await shell.stop();
    }
  }, 30_000);
});
