import { describe, expect, test } from 'bun:test';
import { EmergenceService } from '../src/plugins/emergence.ts';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

/** The dream window is wide open here so a test can call `runDream` at any wall-clock hour. */
const DREAM_ALL_DAY = { runKernelNight: false, maxEpisodes: 5, windowStartHour: 0, windowEndHour: 24 };

function makeDreamShell(dir: string, provider: ScriptedProvider) {
  return makeShell(dir, provider, { dream: DREAM_ALL_DAY });
}

describe('night integration (DREAMING)', () => {
  test('the product is written as the companion agent with full sourceRefs, once per day', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: 'unused', toolCalls: [] }]);
    const shell = makeDreamShell(dir, provider);
    await shell.start();
    try {
      const clock = shell.host.getService<{ localDate(at?: number): string }>('clock');
      const date = clock.localDate();
      const dayThread = `companion-day:${date}`;
      const seed = await shell.backend.rememberTurnWithResult({
        agentId: shell.config.agentId,
        projectId: shell.config.projectId,
        sessionId: shell.config.sessionId,
        threadId: dayThread,
        turnId: 'seed-turn-1',
        userText: '今天修好了花园的栅栏',
        assistantText: '记下了：花园的栅栏今天修好了。',
        ingestMode: 'immediate_compile',
      });
      await shell.runDream(Date.now());
      const dreamEvents = shell.kernel
        .getThreadEvents(`companion-dream:${date}`, { projectId: shell.config.projectId, limit: 50 })
        .filter((event) => (event.payload as { metadata?: { kind?: string } }).metadata?.kind === 'dream-integration');
      expect(dreamEvents).toHaveLength(1);
      const metadata = (dreamEvents[0].payload as { metadata?: Record<string, unknown> }).metadata!;
      expect(metadata.sourceAgent).toBe(shell.config.agentId);
      expect(Array.isArray(metadata.sourceRefs)).toBe(true);
      expect((metadata.sourceRefs as unknown[]).length).toBeGreaterThanOrEqual(2);
      expect(metadata.sourceEventIds).toContain(seed.rawEventIds[0]);
      expect(shell.state).toBe('IDLE');
      expect(shell.machine.runtime.lastDreamDate).toBe(date);
      expect(shell.machine.wakeIntents.some((intent) => intent.reason === 'morning_after_dream' && !intent.consumedAt)).toBe(true);

      // Idempotence at the tick level: a second tick on the same day dreams nothing.
      await shell.tick(Date.now());
      const afterSecond = shell.kernel
        .getThreadEvents(`companion-dream:${date}`, { projectId: shell.config.projectId, limit: 50 })
        .filter((event) => (event.payload as { metadata?: { kind?: string } }).metadata?.kind === 'dream-integration');
      expect(afterSecond).toHaveLength(1);
    } finally {
      await shell.stop();
    }
  });
});

describe('dream and run do not collide', () => {
  test('a message arriving during the night integration wakes the shell without an illegal transition', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: '我醒着，先回你。', toolCalls: [] }]);
    const shell = makeDreamShell(dir, provider);
    await shell.start();
    try {
      // The integration is replaced with one that takes a message mid-flight: the state machine must
      // survive the DREAMING -> WAKING -> IDLE -> RUNNING -> IDLE move and the dream must not then
      // dispatch dream_complete from IDLE.
      (shell as unknown as { dream: { integrate: (...args: unknown[]) => Promise<unknown> } }).dream = {
        integrate: async (localDate: unknown) => {
          await shell.submit('做梦时来消息了');
          return { localDate, eventCount: 0, sourceRefs: [], summary: 'partial', kernelNightRan: false };
        },
      };
      await shell.runDream(Date.now());
      expect(shell.state).toBe('IDLE');
      expect(shell.trace.read().some((record) => record.kind === 'illegal_transition')).toBe(false);
      expect(shell.trace.read().some((record) => record.kind === 'dream_finished_after_wake')).toBe(true);
    } finally {
      await shell.stop();
    }
  });
});

describe('emergence decision point (conservative mode)', () => {
  test('only a low-sensitivity item can surface; high-sensitivity items are suppressed; no model is asked', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: 'unused', toolCalls: [] }]);
    const shell = makeDreamShell(dir, provider);
    await shell.start();
    try {
      await shell.backend.rememberTurnWithResult({
        agentId: shell.config.agentId,
        projectId: shell.config.projectId,
        sessionId: shell.config.sessionId,
        turnId: 'low-1',
        userText: '我常去街角那家蓝色遮阳篷的面包店买可颂',
        assistantText: '记下了：蓝色遮阳篷的面包店。',
        ingestMode: 'immediate_compile',
      });
      await shell.backend.rememberTurnWithResult({
        agentId: shell.config.agentId,
        projectId: shell.config.projectId,
        sessionId: shell.config.sessionId,
        turnId: 'high-1',
        userText: '我的病历显示需要长期服用某种药物',
        assistantText: '记下了治疗安排。',
        ingestMode: 'immediate_compile',
      });
      const emergence = new EmergenceService(shell.backend, { agentId: shell.config.agentId, projectId: shell.config.projectId, trace: shell.trace });
      const low = emergence.decide('蓝色遮阳篷 面包店');
      expect(low.candidates.length).toBeGreaterThan(0);
      expect(low.candidates[0].text).toContain('面包店');
      expect(low.candidates[0].reason.length).toBeGreaterThan(0);

      const high = emergence.decide('病历 药物');
      // The sensitive item never becomes a candidate; a low-sensitivity item that the same recall
      // happened to return may still surface, which is the conservative rule working as specified.
      expect(high.candidates.some((candidate) => candidate.text.includes('病历') || candidate.text.includes('药物'))).toBe(false);
      expect(high.suppressed.some((item) => item.reason.startsWith('high_sensitivity_term'))).toBe(true);

      const none = emergence.decide(undefined);
      expect(none.candidates).toHaveLength(0);
      expect(shell.trace.read().some((record) => record.kind === 'emergence_decision' && record.reason === 'no_user_query')).toBe(true);

      // The decision is deterministic; the model was never called to manufacture a candidate.
      expect(provider.calls).toHaveLength(0);
    } finally {
      await shell.stop();
    }
  });
});
