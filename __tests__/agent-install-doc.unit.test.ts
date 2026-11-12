import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

/**
 * The install guide is written for an agent that cannot check it. Every `cogmem <subcommand>` in it
 * must exist, and the list of commands comes from the CLI's own help — the single source — rather than
 * from a table copied into this file, which would drift the day a command is renamed.
 */
test('every cogmem subcommand the agent install guide names really exists', () => {
  const doc = readFileSync(join(root, 'docs', 'agent-install.md'), 'utf8');
  const help = spawnSync('bun', [join(root, 'src', 'bin', 'cogmem.ts'), '--help'], { encoding: 'utf8' }).stdout;
  const commands = new Set([...help.matchAll(/^ {2}([a-z][a-z-]+)/gm)].map((match) => match[1]));
  expect(commands.size).toBeGreaterThan(10);
  // Commands live in code: fenced blocks and inline spans. Prose is allowed to say "cogmem with …
  // another host", so scanning the whole file would report English as a missing subcommand.
  const code = [...doc.matchAll(/```[\s\S]*?```/g), ...doc.matchAll(/`[^`\n]+`/g)].map((match) => match[0]).join('\n');
  const offenders: string[] = [];
  for (const match of code.matchAll(/cogmem ([a-z][a-z-]+)/g)) {
    if (!commands.has(match[1])) offenders.push(`${match[1]} in "${match[0]}"`);
  }
  expect(offenders).toEqual([]);
});

test('the README points an agent at this document, and the package ships it', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  expect(readme).toContain('https://github.com/liuqin164/Cog/blob/main/docs/agent-install.md');
  expect(readme).toContain('docs/agent-install.md');
  expect(existsSync(join(root, 'docs', 'agent-install.md'))).toBe(true);
  const files = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] }).files;
  expect(files).toContain('docs/agent-install.md');
  // The README stayed a landing page: no version wording crept in with the pointer.
  expect(readme).not.toMatch(/\b4\.0\.0\b|\bversion 4\b/i);
});
