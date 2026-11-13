/**
 * `/pause` and `/resume` (spec §7): the gate is at the shell's own ingest call point, and the state
 * lives in the checkpoint. The discriminator is the kernel ledger, read back — a paused turn must
 * leave the day thread exactly as it was, a restart must not quietly resume capture, and `/resume`
 * must let the next turn through.
 */
import { describe, expect, test } from 'bun:test';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

const NO_DREAM = { windowStartHour: 0, windowEndHour: 0, runKernelNight: false, maxEpisodes: 5 };

function ledgerCount(shell: ReturnType<typeof makeShell>, threadId: string): number {
  return shell.kernel.getThreadEvents(threadId, { projectId: shell.config.projectId, limit: 500 }).length;
}

function dayThread(shell: ReturnType<typeof makeShell>): string {
  const clock = shell.host.getService<{ localDate(at?: number): string }>('clock');
  return `companion-day:${clock.localDate()}`;
}

describe('/pause and /resume stop and restart ingest (spec §7)', () => {
  test('a turn while paused adds nothing to the ledger; /resume lets the next turn through', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([
      { text: '记录中', toolCalls: [] },
      { text: '暂停中的回答', toolCalls: [] },
      { text: '恢复后的回答', toolCalls: [] },
    ]);
    const shell = makeShell(dir, provider, { dream: NO_DREAM });
    await shell.start();
    try {
      const threadId = dayThread(shell);
      await shell.submit('先写一条，建立基线');
      const before = ledgerCount(shell, threadId);
      expect(before).toBeGreaterThan(0);

      expect((await shell.runCommand('pause')).text).toContain('已暂停捕获');
      expect(shell.capturePaused).toBe(true);
      expect(shell.currentStatus().capturePaused).toBe(true);

      await shell.submit('这条不该进账本');
      expect(ledgerCount(shell, threadId)).toBe(before);
      // The silence is on record, with counts and no text.
      const skipped = shell.trace.read().filter((record) => record.kind === 'capture_paused');
      expect(skipped.length).toBeGreaterThan(0);
      expect(JSON.stringify(skipped)).not.toContain('这条不该进账本');

      expect((await shell.runCommand('resume')).text).toContain('已恢复捕获');
      await shell.submit('这条该进账本');
      expect(ledgerCount(shell, threadId)).toBeGreaterThan(before);
    } finally {
      await shell.stop();
    }
  });

  test('a pause survives a restart: the checkpoint is the authority, not the running UI', async () => {
    const dir = makeTempDir();
    const first = makeShell(dir, new ScriptedProvider([{ text: 'unused', toolCalls: [] }]), { dream: NO_DREAM });
    await first.start();
    try {
      await first.runCommand('pause');
      expect(first.capturePaused).toBe(true);
    } finally {
      await first.stop();
    }

    const second = makeShell(dir, new ScriptedProvider([{ text: '重启后的回答', toolCalls: [] }]), { dream: NO_DREAM });
    await second.start();
    try {
      expect(second.capturePaused).toBe(true);
      expect(second.currentStatus().capturePaused).toBe(true);
      const threadId = dayThread(second);
      const before = ledgerCount(second, threadId);
      await second.submit('重启后仍然暂停');
      expect(ledgerCount(second, threadId)).toBe(before);
    } finally {
      await second.stop();
    }
  });

  test('/resume with no pause is a receipt, not a state change', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'unused', toolCalls: [] }]), { dream: NO_DREAM });
    await shell.start();
    try {
      expect(shell.capturePaused).toBe(false);
      expect((await shell.runCommand('resume')).text).toContain('没有需要恢复的暂停');
      expect(shell.capturePaused).toBe(false);
    } finally {
      await shell.stop();
    }
  });
});
