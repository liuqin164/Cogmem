import { describe, expect, test } from 'bun:test';
import { openSoulDb } from '../src/install/soul.ts';
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

/** Write one soul row the way the installer would; `readSoul` takes the newest version. */
function writeSoulRow(dbPath: string, agentId: string, version: number, content: string): void {
  const db = openSoulDb(dbPath);
  try {
    db.prepare('INSERT INTO companion_soul (agent_id, version, content, supersedes, created_at) VALUES (?, ?, ?, NULL, ?)').run(
      agentId,
      version,
      content,
      Date.now(),
    );
  } finally {
    db.close();
  }
}

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
      writeSoulRow(shell.config.dbPath, shell.config.agentId, 0, firstSoul);
      const first = shell.systemPromptSections();
      await shell.submit('第一回合');
      const firstRequest = provider.calls[0].systemPrompt;

      const secondSoul = 'soul v1：把话说短些。\n';
      writeSoulRow(shell.config.dbPath, shell.config.agentId, 1, secondSoul);
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
      // The installer writes the soul table; a shell on a database that never saw it must not fail the
      // turn, and the pinned zone is simply shorter. It is recorded once, not silently dropped.
      const sections = shell.systemPromptSections();
      expect(sections.pinned.length).toBeGreaterThan(0);
      expect(sections.pinned).not.toContain('\uFFFD');
      await shell.submit('hello');
      expect(provider.calls).toHaveLength(1);
      expect(shell.trace.read().some((record) => record.kind === 'soul_read_failed')).toBe(true);
    } finally {
      await shell.stop();
    }
  }, 30_000);
});
