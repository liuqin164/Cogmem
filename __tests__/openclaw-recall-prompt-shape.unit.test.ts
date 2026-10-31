import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The recall hook must read the prompt OpenClaw actually sends.
 *
 * `before_prompt_build` hands `event.prompt` as the prompt *string*. Reading it as
 * an object with a `messages` key yielded nothing, so the user turn read as empty,
 * every recall returned early with `empty_user_query`, and the write half kept
 * working — the host looked wired and never remembered anything.
 *
 * Object.keys on that string returns its character indices, which is what made it
 * look like a message list and produced a wrong fix first time round. typeof says
 * string. This pins the string branch against a future edit that might drop it
 * while every other test stays green, which is exactly how it went unnoticed.
 */
const installer = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'host', 'openclaw', 'AutoMemoryPluginInstaller.ts');

test('a string prompt is read as the turn, not as an object with messages', () => {
  const source = readFileSync(installer, 'utf8');
  const start = source.indexOf('function asMessages(event) {');
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf('function roleOf(', start));

  expect(body).toContain("typeof event.prompt === 'string'");
  // The object shapes it used to rely on are still tried, so a host that sends
  // either shape still works.
  expect(body).toContain('event.messages');
  expect(body).toContain('event.request');
});
