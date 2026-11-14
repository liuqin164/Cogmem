import { describe, expect, test } from 'bun:test';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

/**
 * The system prompt is assembled from two sections: a pinned zone (soul, identity, rules) whose bytes
 * must hold still from request to request, and a variable tail that is the only place per-turn
 * content may live. F14's lane order starts with the pinned zone (#191), and a byte-stable leading
 * section is the half of it a provider-side prefix cache can actually hit.
 *
 * These are the discriminating tests for that split: the first fails if the variable content leaks
 * into the pinned bytes, the second fails if the pinned section is frozen so hard that real content
 * changes stop moving the prefix.
 */

describe('system prompt sections: a stable pinned zone and a variable tail', () => {
  test('the clock moves between two turns, the pinned bytes do not, and the diff is only the tail', async () => {
    const dir = makeTempDir();
    const clock = { at: Date.UTC(2026, 0, 5, 9, 0, 0) };
    const provider = new ScriptedProvider([{ text: '一', toolCalls: [] }, { text: '二', toolCalls: [] }]);
    const shell = makeShell(dir, provider, {}, { now: () => clock.at });
    await shell.start();
    try {
      const first = shell.systemPromptSections();
      await shell.submit('第一回合');
      const firstRequest = provider.calls[0].systemPrompt;

      clock.at += 3 * 60 * 60 * 1000; // same session, the clock has moved three hours
      const second = shell.systemPromptSections();
      await shell.submit('第二回合');
      const secondRequest = provider.calls[1].systemPrompt;

      // The clock lives in the tail and nowhere else: three hours later the tail differs, the pinned
      // zone is byte-identical, and both requests carry that same pinned zone as their prefix.
      expect(first.pinned).not.toContain('<time-context>');
      expect(first.tail).toContain('<time-context>');
      expect(second.tail).not.toBe(first.tail);
      expect(second.pinned).toBe(first.pinned);
      expect(firstRequest.startsWith(`${first.pinned}\n\n`)).toBe(true);
      expect(secondRequest.startsWith(`${second.pinned}\n\n`)).toBe(true);
      expect(secondRequest).not.toBe(firstRequest);
    } finally {
      await shell.stop();
    }
  }, 30_000);

  test('a new soul row moves the prefix: the pinned zone is not a frozen string', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: '一', toolCalls: [] }, { text: '二', toolCalls: [] }]);
    const shell = makeShell(dir, provider);
    await shell.start();
    try {
      const firstSoul = 'soul v0：你先是我认识的人，再是助手。\n';
      shell.kernel.soul.ensureDefault(shell.config.agentId, firstSoul);
      const first = shell.systemPromptSections();
      await shell.submit('第一回合');
      const firstRequest = provider.calls[0].systemPrompt;

      const secondSoul = 'soul v1：把话说短些。\n';
      shell.kernel.soul.save({ agentId: shell.config.agentId, content: secondSoul, actor: 'user' });
      const second = shell.systemPromptSections();
      await shell.submit('第二回合');
      const secondRequest = provider.calls[1].systemPrompt;

      // The soul is the head of the pinned zone, verbatim, and a change to it must reach the request:
      // a frozen prefix would look stable while the model kept the persona that was edited away.
      expect(first.pinned.startsWith(firstSoul)).toBe(true);
      expect(second.pinned.startsWith(secondSoul)).toBe(true);
      expect(second.pinned).not.toBe(first.pinned);
      expect(firstRequest.startsWith(firstSoul)).toBe(true);
      expect(secondRequest.startsWith(secondSoul)).toBe(true);
      expect(secondRequest.startsWith(firstSoul)).toBe(false);
    } finally {
      await shell.stop();
    }
  }, 30_000);

  test('a request with no soul table written is still a stable pinned zone', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: 'ok', toolCalls: [] }]);
    const shell = makeShell(dir, provider);
    await shell.start();
    try {
      // The installer writes version 0; a shell on a database with no row must not fail the turn,
      // and the pinned zone is simply shorter. An absent soul is not a read failure.
      const sections = shell.systemPromptSections();
      expect(sections.pinned.length).toBeGreaterThan(0);
      expect(sections.pinned).not.toContain('\uFFFD');
      await shell.submit('hello');
      expect(provider.calls).toHaveLength(1);
      expect(shell.trace.read().some((record) => record.kind === 'soul_read_failed')).toBe(false);
    } finally {
      await shell.stop();
    }
  }, 30_000);

  test('the agent may propose but cannot save its own soul', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: 'ok', toolCalls: [] }]);
    const shell = makeShell(dir, provider);
    await shell.start();
    try {
      const original = 'soul v0：先做自己。\n';
      shell.kernel.soul.ensureDefault(shell.config.agentId, original);
      const proposal = shell.backend.proposeSoulEdit({ content: 'soul v1：更短。\n', reason: 'tighten' });
      expect(proposal.content).toBe('soul v1：更短。\n');
      expect(shell.systemPromptSections().pinned.startsWith(original)).toBe(true);
      expect(() => shell.kernel.soul.save({
        agentId: shell.config.agentId,
        content: 'soul v1：更短。\n',
        actor: 'agent',
      })).toThrow('soul_agent_write_forbidden');
      expect(shell.backend.soul().proposal?.content).toBe('soul v1：更短。\n');
    } finally {
      await shell.stop();
    }
  }, 30_000);
});
