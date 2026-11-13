import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompanionShell } from '../src/app.ts';
import type { CageConfig } from '../src/plugins/cage.ts';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

/** The cage axis is the whole point of these tests, so it stays a named argument. */
function cageShell(dir: string, provider: ScriptedProvider, budgets: CageConfig) {
  return makeShell(dir, provider, { budgets });
}

function cageViolations(shell: CompanionShell): Array<Record<string, unknown>> {
  return shell.trace.read().filter((record) => record.kind === 'cage_violation');
}

describe('the cage (budgets and whitelist at hook points)', () => {
  test('a tool outside the whitelist is blocked before execution and the run returns to IDLE', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([
      { text: 'trying bash', toolCalls: [{ toolCallId: 'c1', toolName: 'bash', input: { command: 'echo should-not-run' } }] },
      { text: 'understood', toolCalls: [] },
    ]);
    const shell = cageShell(dir, provider, { maxTurnsPerRun: 5, maxTokensPerRun: 10_000, toolWhitelist: ['read'] });
    await shell.start();
    try {
      const summary = await shell.submit('run bash');
      expect(summary!.toolResults[0].isError).toBe(true);
      expect(summary!.toolResults[0].output).toContain('tool_not_in_whitelist');
      expect(shell.state).toBe('IDLE');
      expect(shell.trace.read().some((record) => record.reason && String(record.reason).includes('tool_not_in_whitelist'))).toBe(true);
    } finally {
      await shell.stop();
    }
  });

  test('the turn budget forces the run out of RUNNING with budget_exceeded', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: 'looping', toolCalls: [{ toolCallId: 'c', toolName: 'read', input: { path: 'missing.txt' } }] }]);
    const shell = cageShell(dir, provider, { maxTurnsPerRun: 2, maxTokensPerRun: 10_000, toolWhitelist: ['read'] });
    await shell.start();
    try {
      const summary = await shell.submit('loop');
      expect(summary!.stopReason).toBe('budget_exceeded');
      expect(summary!.turns).toBe(2);
      expect(shell.state).toBe('IDLE');
      expect(shell.trace.read().some((record) => record.kind === 'cage_violation')).toBe(true);
    } finally {
      await shell.stop();
    }
  });

  test('the token budget forces the run out of RUNNING', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: 'expensive', toolCalls: [], usage: { input: 500_000, output: 1 } }]);
    const shell = cageShell(dir, provider, { maxTurnsPerRun: 5, maxTokensPerRun: 1_000, toolWhitelist: null });
    await shell.start();
    try {
      const summary = await shell.submit('spend');
      expect(summary!.stopReason).toBe('budget_exceeded');
      expect(summary!.error).toContain('token_budget_exceeded');
      expect(shell.state).toBe('IDLE');
    } finally {
      await shell.stop();
    }
  });

  test('a budget exactly equal to the limit is allowed, on both axes', async () => {
    const turnsDir = makeTempDir();
    const turnsProvider = new ScriptedProvider([
      { text: 'reading', toolCalls: [{ toolCallId: 'c1', toolName: 'read', input: { path: 'missing.txt' } }] },
      { text: 'done at the limit', toolCalls: [] },
    ]);
    const turnsShell = cageShell(turnsDir, turnsProvider, { maxTurnsPerRun: 2, maxTokensPerRun: 10_000, toolWhitelist: ['read'] });
    await turnsShell.start();
    try {
      const summary = await turnsShell.submit('two turns exactly');
      expect(summary!.turns).toBe(2);
      expect(summary!.stopReason).toBe('run_complete');
      expect(cageViolations(turnsShell)).toHaveLength(0);
    } finally {
      await turnsShell.stop();
    }

    const tokensDir = makeTempDir();
    const tokensProvider = new ScriptedProvider([{ text: 'at the limit', toolCalls: [], usage: { input: 600, output: 400 } }]);
    const tokensShell = cageShell(tokensDir, tokensProvider, { maxTurnsPerRun: 5, maxTokensPerRun: 1_000, toolWhitelist: null });
    await tokensShell.start();
    try {
      const summary = await tokensShell.submit('spend exactly the limit');
      expect(summary!.tokens).toBe(1_000);
      expect(summary!.stopReason).toBe('run_complete');
      expect(cageViolations(tokensShell)).toHaveLength(0);
    } finally {
      await tokensShell.stop();
    }
  });

  test('a tool call that pushes the run over budget still runs to completion, then the run leaves RUNNING', async () => {
    const dir = makeTempDir();
    const workspace = join(dir, 'ws');
    const provider = new ScriptedProvider([
      {
        text: 'working',
        toolCalls: [{ toolCallId: 'c1', toolName: 'bash', input: { command: 'printf overrun-marker-8811 > out.txt' } }],
        usage: { input: 900, output: 200 },
      },
      { text: 'must never be asked for', toolCalls: [] },
    ]);
    const shell = cageShell(dir, provider, { maxTurnsPerRun: 5, maxTokensPerRun: 1_000, toolWhitelist: null });
    await shell.start();
    try {
      const summary = await shell.submit('spend while a tool is in flight');
      // The overrun is decided at the turn boundary: the tool batch already in flight is not killed
      // half-way, and its side effect is real.
      expect(readFileSync(join(workspace, 'out.txt'), 'utf8')).toBe('overrun-marker-8811');
      expect(summary!.toolResults).toHaveLength(1);
      expect(summary!.toolResults[0].isError).toBe(false);
      expect(summary!.stopReason).toBe('budget_exceeded');
      expect(provider.calls, 'the cage does not ask the model for another turn').toHaveLength(1);
      expect(shell.state).toBe('IDLE');
      const violation = cageViolations(shell).find((record) => record.violation === 'token_budget')!;
      expect(Number(violation.tokens)).toBeGreaterThan(1_000);
      // The turn that overspent is still accounted for: the run ended normally through agent_end.
      const clock = shell.host.getService<{ localDate(at?: number): string }>('clock');
      const ledger = shell.kernel.getThreadEvents(`companion-day:${clock.localDate()}`, { projectId: shell.config.projectId, limit: 200 });
      expect(ledger.some((event) => JSON.stringify(event.payload).includes('overrun-marker-8811'))).toBe(true);
    } finally {
      await shell.stop();
    }
  });

  test('the whitelist vetoes a tool on a steering-injected turn, not only the first one', async () => {
    const dir = makeTempDir();
    const workspace = join(dir, 'ws');
    const provider = new ScriptedProvider([
      { text: 'checking', toolCalls: [{ toolCallId: 'c1', toolName: 'read', input: { path: 'missing.txt' } }] },
      { text: 'now bash', toolCalls: [{ toolCallId: 'c2', toolName: 'bash', input: { command: 'printf nope > escaped.txt' } }] },
      { text: 'understood', toolCalls: [] },
    ]);
    const shell = cageShell(dir, provider, { maxTurnsPerRun: 6, maxTokensPerRun: 10_000, toolWhitelist: ['read'] });
    await shell.start();
    try {
      let steered = false;
      shell.host.bus.on('tool_execution_end', () => {
        if (steered) return;
        steered = true;
        shell.runtimeInstance!.steer('also try the shell now');
      });
      const summary = await shell.submit('start the long one');
      const bash = summary!.toolResults.find((result) => result.toolName === 'bash')!;
      expect(bash.isError).toBe(true);
      expect(bash.output).toContain('tool_not_in_whitelist');
      expect(existsSync(join(workspace, 'escaped.txt')), 'the veto is before execution').toBe(false);
      expect(summary!.stopReason).toBe('run_complete');
      // Where the line landed, exactly: the request that asked for the tool call did not carry it,
      // the turn right after the tool batch did, and from there it stays in the conversation. (Once
      // appended, steering text is present in every later request, so "call 3 contains it" would say
      // nothing about the timing.)
      const userTexts = (index: number) => provider.calls[index].messages.filter((message) => message.role === 'user').map((message) => message.content);
      expect(userTexts(0)).toEqual(['start the long one']);
      expect(userTexts(1)).toEqual(['start the long one', 'also try the shell now']);
      expect(userTexts(2)).toEqual(['start the long one', 'also try the shell now']);
    } finally {
      await shell.stop();
    }
  });

  test('all three overruns leave the same cage_violation fields', async () => {
    const whitelistDir = makeTempDir();
    const whitelistShell = cageShell(
      whitelistDir,
      new ScriptedProvider([
        { text: 'bash', toolCalls: [{ toolCallId: 'c', toolName: 'bash', input: { command: 'echo x' } }] },
        { text: 'ok', toolCalls: [] },
      ]),
      { maxTurnsPerRun: 5, maxTokensPerRun: 10_000, toolWhitelist: ['read'] },
    );
    const turnDir = makeTempDir();
    const turnShell = cageShell(
      turnDir,
      new ScriptedProvider([{ text: 'looping', toolCalls: [{ toolCallId: 'c', toolName: 'read', input: { path: 'missing.txt' } }] }]),
      { maxTurnsPerRun: 1, maxTokensPerRun: 10_000, toolWhitelist: ['read'] },
    );
    const tokenDir = makeTempDir();
    const tokenShell = cageShell(
      tokenDir,
      new ScriptedProvider([{ text: 'expensive', toolCalls: [], usage: { input: 500_000, output: 1 } }]),
      { maxTurnsPerRun: 5, maxTokensPerRun: 1_000, toolWhitelist: null },
    );
    await whitelistShell.start();
    await turnShell.start();
    await tokenShell.start();
    try {
      await whitelistShell.submit('run bash');
      await turnShell.submit('loop');
      await tokenShell.submit('spend');
      const records = [whitelistShell, turnShell, tokenShell].flatMap(cageViolations);
      expect(new Set(records.map((record) => record.violation))).toEqual(new Set(['tool_whitelist', 'turn_budget', 'token_budget']));
      for (const record of records) {
        expect(typeof record.runId, JSON.stringify(record)).toBe('string');
        expect(String(record.runId)).toStartWith('run-');
        expect(typeof record.reason, JSON.stringify(record)).toBe('string');
        expect(String(record.reason).length).toBeGreaterThan(0);
        // The same four keys on every record, plus exactly one detail field: toolName, turnIndex or
        // tokens. The violation's name lives in `violation` because `kind` is the trace's own field.
        const keys = new Set(Object.keys(record));
        for (const common of ['at', 'kind', 'reason', 'runId', 'violation']) expect(keys.has(common), `${common}: ${JSON.stringify(record)}`).toBe(true);
        expect(['toolName', 'turnIndex', 'tokens'].filter((key) => keys.has(key)), JSON.stringify(record)).toHaveLength(1);
        expect(keys.size, JSON.stringify(record)).toBe(6);
      }
    } finally {
      await whitelistShell.stop();
      await turnShell.stop();
      await tokenShell.stop();
    }
  });
});
