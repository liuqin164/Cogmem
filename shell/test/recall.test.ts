import { describe, expect, test } from 'bun:test';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

describe('recall inside the loop', () => {
  test('the run context carries memory, and a steering message gets its own recall', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([
      { text: 'let me check', toolCalls: [{ toolCallId: 'c1', toolName: 'read', input: { path: 'missing.txt' } }] },
      { text: 'done', toolCalls: [] },
    ]);
    const shell = makeShell(dir, provider);
    await shell.start();
    try {
      await shell.backend.rememberTurnWithResult({
        agentId: shell.config.agentId,
        projectId: shell.config.projectId,
        sessionId: shell.config.sessionId,
        turnId: 'seed-recall',
        userText: 'zebraplan8811 是下周的计划代号',
        assistantText: '记下了：zebraplan8811。',
        ingestMode: 'immediate_compile',
      });
      shell.host.bus.on('tool_execution_end', () => shell.runtimeInstance?.steer('再查下 zebraplan8811 的细节'));
      await shell.submit('zebraplan8811 是什么');
      expect(provider.calls.length).toBe(2);
      const first = provider.calls[0].messages.map((message) => message.content).join('\n');
      expect(first).toContain('<recall-context>');
      expect(first).toContain('zebraplan8811');
      const second = provider.calls[1].messages.map((message) => message.content).join('\n');
      expect(second).toContain('<recall-context>');
      expect(second).toContain('再查下 zebraplan8811 的细节');
      expect(shell.state).toBe('IDLE');
    } finally {
      await shell.stop();
    }
  });

  test('a line typed while prepareNextTurn runs gets its own recall at that boundary', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([
      { text: 'checking', toolCalls: [{ toolCallId: 'c1', toolName: 'read', input: { path: 'missing.txt' } }] },
      { text: 'done', toolCalls: [] },
    ]);
    const shell = makeShell(dir, provider);
    await shell.start();
    try {
      await shell.backend.rememberTurnWithResult({
        agentId: shell.config.agentId,
        projectId: shell.config.projectId,
        sessionId: shell.config.sessionId,
        turnId: 'seed-prepare-recall',
        userText: 'quartzbeacon4417 是今晚的口令',
        assistantText: '记下了：quartzbeacon4417。',
        ingestMode: 'immediate_compile',
      });
      let steered = false;
      shell.host.bus.on('prepareNextTurn', async () => {
        if (steered) return undefined;
        steered = true;
        // The user types inside the long prepare window; the boundary must still deliver it.
        await new Promise<void>((resolve) => setTimeout(() => { shell.runtimeInstance!.steer('再确认下 quartzbeacon4417'); resolve(); }, 20));
        return undefined;
      });
      await shell.submit('quartzbeacon4417 是什么');
      expect(provider.calls.length).toBe(2);
      const second = provider.calls[1].messages.map((message) => message.content).join('\n');
      expect(second).toContain('再确认下 quartzbeacon4417');
      expect(second).toContain('<recall-context>');
      expect(second).toContain('quartzbeacon4417');
      expect(shell.state).toBe('IDLE');
    } finally {
      await shell.stop();
    }
  });
});
