import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

/**
 * `cogmem-init` was renamed to `cogmem init` when the package went from about twenty bins to two, and
 * a stale copy of the old name survived in the message a user sees first: a missing configuration told
 * them to run a command that does not exist. This guard reads the bin table — the single source — and
 * refuses any other `cogmem-*` name that reads like a command.
 *
 * Tokens below are ids, not commands: plugin and skill directory names, hook names, header names,
 * generated field keys and file suffixes. Exact tokens only, never prefixes: `cogmem-import-*` were
 * real bins once, and a prefix rule would silently re-admit them.
 */
const NOT_COMMANDS: Record<string, string> = {
  'cogmem-memory': 'installed skill directory name',
  'cogmem-auto-memory': 'OpenClaw plugin id and its generated key prefix',
  'cogmem-bridge': 'generated bridge field key and host hook name',
  'cogmem-bridge-input-family': 'generated frontmatter key',
  'cogmem-bridge-event-selector': 'generated frontmatter key',
  'cogmem-bridge-role-source': 'generated frontmatter key',
  'cogmem-bridge-text-source': 'generated frontmatter key',
  'cogmem-bridge-timestamp-source': 'generated frontmatter key',
  'cogmem-recall': 'Hermes hook directory name',
  'cogmem-identity': 'HTTP header name',
  'cogmem-update': 'HTTP User-Agent',
  'cogmem-import': 'log line prefix',
  'cogmem-checkpoint': 'episode checkpoint file suffix',
  'cogmem-temp-probe': 'temporary directory prefix',
  'cogmem-normalized': 'generated frontmatter key',
  'cogmem-normalized-source-family': 'generated frontmatter key',
  'cogmem-normalized-from': 'generated frontmatter key',
  'cogmem-normalized-title': 'generated frontmatter key',
  'cogmem-normalization-contract': 'generated metadata key',
  'cogmem-original-input-family': 'generated frontmatter key',
  'cogmem-source-ref': 'generated frontmatter key',
  'cogmem-onboarding-path': 'generated frontmatter key',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Quoted strings only: comments are prose for maintainers, and they keep the historical names. */
function visibleStrings(file: string): string[] {
  const stripped = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [...stripped.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

test('no user-visible string names a cogmem command that is not a shipped bin', () => {
  const bins = Object.keys((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { bin: Record<string, string> }).bin);
  const offenders: string[] = [];
  for (const file of sourceFiles(join(root, 'src'))) {
    for (const text of visibleStrings(file)) {
      for (const raw of text.match(/cogmem-[a-z][a-z-]*/g) ?? []) {
        // `cogmem-auto-memory-${hash}` is a template, so a trailing dash means "this is a prefix":
        // match it by the name before the dash instead of adding a second allowlist entry.
        const token = raw.endsWith('-') ? raw.slice(0, -1) : raw;
        if (bins.includes(raw) || token in NOT_COMMANDS) continue;
        // The offending string is named, not just counted.
        offenders.push(`${token} in ${file.slice(root.length + 1)}: "${text.slice(0, 70)}"`);
      }
    }
  }
  expect(offenders).toEqual([]);
  // An allowlist entry that no longer matches anything is stale permission.
  expect(Object.keys(NOT_COMMANDS).every((token) => token.length > 3)).toBe(true);
});
