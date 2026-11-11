import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const help = (args: string[]) => spawnSync('bun', [join(root, 'src', 'bin', 'cogmem.ts'), ...args, '--help'], { encoding: 'utf8' }).stdout;

/**
 * The install page is read by someone who has no way to check it. Same shape as the agent-install guard:
 * every `cogmem <subcommand>` must exist and every flag must be one that command's own `--help` lists, with
 * the lists taken from the CLI rather than copied into this file — a copy would drift the day a flag is
 * renamed, which is exactly how `--provider` would have got into a document that never had it.
 */
function codeOf(document: string): string {
  return [...document.matchAll(/```[\s\S]*?```/g), ...document.matchAll(/`[^`\n]+`/g)].map((match) => match[0]).join('\n');
}

test('every cogmem subcommand the install page names really exists', () => {
  const doc = readFileSync(join(root, 'docs', 'install.md'), 'utf8');
  const top = spawnSync('bun', [join(root, 'src', 'bin', 'cogmem.ts'), '--help'], { encoding: 'utf8' }).stdout;
  const commands = new Set([...top.matchAll(/^ {2}([a-z][a-z-]+)/gm)].map((match) => match[1]));
  expect(commands.size).toBeGreaterThan(10);
  const offenders: string[] = [];
  for (const match of codeOf(doc).matchAll(/cogmem ([a-z][a-z-]+)/g)) {
    if (!commands.has(match[1])) offenders.push(`${match[1]} in "${match[0]}"`);
  }
  expect(offenders).toEqual([]);
});

test('every flag the install page shows in a command really belongs to that command', () => {
  const doc = readFileSync(join(root, 'docs', 'install.md'), 'utf8');
  // Fenced blocks only: those are the commands a reader will copy. `--help` is universal and not listed per
  // command, and the page deliberately *says* that `--provider` does not exist — scanning prose would report
  // that sentence as the offence it is warning about, which is how a guard ends up demanding a worse document.
  const fences = [...doc.matchAll(/```[\s\S]*?```/g)].map((match) => match[0]).join('\n');
  const flags = new Set([...fences.matchAll(/(--[a-z][a-z-]+)/g)].map((match) => match[1]!));
  // The allowlist is the CLI's own, for every command the page asks a reader to run.
  // A hardcoded `init`/`doctor` list is how `--stage-only`, on the `update`
  // command this page now documents, would have been reported as an offence against
  // init's help — the guard demanding a worse document.
  const shown = new Set<string>(['init', 'doctor']);
  for (const match of fences.matchAll(/cogmem ([a-z][a-z-]+)/g)) shown.add(match[1]!);
  expect(shown.size).toBeGreaterThan(2);
  const known = new Set<string>(['--help']);
  for (const command of shown) {
    for (const match of help([command]).matchAll(/(--[a-z][a-z-]+)/g)) known.add(match[1]!);
  }
  expect([...flags].filter((flag) => !known.has(flag))).toEqual([]);
  // And the flag the ticket singles out is called out as absent rather than shown.
  expect(doc).toContain('no `--provider` flag');
  expect(fences).not.toContain('--provider');
  const initFlags = new Set([...help(['init']).matchAll(/(--[a-z][a-z-]+)/g)].map((match) => match[1]!));
  expect(initFlags.has('--yes')).toBe(true);
});

test('the install page ships with the package and carries no release wording', () => {
  const files = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] }).files;
  expect(existsSync(join(root, 'docs', 'install.md'))).toBe(true);
  expect(files).toContain('docs/install.md');
  const doc = readFileSync(join(root, 'docs', 'install.md'), 'utf8');
  // No version wording, the same iron rule the README follows.
  expect(doc).not.toMatch(/\b4\.\d+\.\d+\b/);
  expect(doc).not.toMatch(/\bversion 4\b/i);
});

test('the agent install guide points an operator at this page', () => {
  const agentDoc = readFileSync(join(root, 'docs', 'agent-install.md'), 'utf8');
  expect(agentDoc).toContain('docs/install.md');
});
