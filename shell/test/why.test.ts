/**
 * `/why` (spec §7): the newest recall decision, read back through the kernel's own `TraceStore`. The
 * discriminator is field-for-field — the receipt must show the decision that was actually stored, and
 * when nothing was stored it must say so rather than produce a plausible-looking trace.
 */
import { describe, expect, test } from 'bun:test';
import { RecallDecisionTrace, TraceStore } from 'cogmem/internal';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

const NO_DREAM = { windowStartHour: 0, windowEndHour: 0, runKernelNight: false, maxEpisodes: 5 };

describe('/why reads the last recall decision trace (spec §7)', () => {
  test('a seeded decision is shown field for field', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'unused', toolCalls: [] }]), { dream: NO_DREAM });
    await shell.start();
    try {
      const store = new TraceStore(shell.kernel.factStore.getDatabase());
      store.initSchema();
      new RecallDecisionTrace(store).record({
        projectId: shell.config.projectId,
        agentId: shell.config.agentId,
        query: '蓝色遮阳篷的面包店',
        lane: 'graph',
        reason: 'topic_match',
        selectedIds: ['raw-e1', 'raw-e2'],
        suppressed: [{ reason: 'redacted_content', count: 1 }],
      });

      const text = (await shell.runCommand('why')).text;
      expect(text).toContain('蓝色遮阳篷的面包店');
      expect(text).toContain('车道：graph');
      expect(text).toContain('理由：topic_match');
      expect(text).toContain('选中 2 条：raw-e1, raw-e2');
      expect(text).toContain('redacted_content×1');
      expect(text).toContain('来源链');
    } finally {
      await shell.stop();
    }
  });

  test('no trace is answered plainly, and another project\'s decision is not borrowed', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'unused', toolCalls: [] }]), { dream: NO_DREAM });
    await shell.start();
    try {
      const empty = (await shell.runCommand('why')).text;
      expect(empty).toContain('尚无召回决策痕迹');
      expect(empty).toContain('不编造');

      const store = new TraceStore(shell.kernel.factStore.getDatabase());
      store.initSchema();
      new RecallDecisionTrace(store).record({
        projectId: 'someone-elses-project',
        query: '别人的查询',
        lane: 'graph',
        reason: 'topic_match',
        selectedIds: ['other-1'],
      });
      const stillEmpty = (await shell.runCommand('why')).text;
      expect(stillEmpty).toContain('尚无召回决策痕迹');
      expect(stillEmpty).not.toContain('别人的查询');
    } finally {
      await shell.stop();
    }
  });
});
