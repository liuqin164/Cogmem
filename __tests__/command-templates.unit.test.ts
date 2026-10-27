import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { KernelAgentMemoryBackend, createMemoryKernel } from '../src/public.js';
import { makeTempDir } from './helpers/tmp.js';

// Cogmem hands command lines to agents in more than one place. `memory_map.v1`
// is the static one and has its own guard. This file covers the other kind:
// command lines the code *builds at runtime* out of template literals, then
// prints into a tool response or a plan suggestion. They drift silently,
// because the parameter is interpolated: rename an enum value or a flag and the
// string still looks fine in TypeScript, and the failure shows up only when an
// agent runs it and gets a usage error. Every template below is therefore
// rendered to a real command line (with real values) and resolved against the
// CLI's own dispatch tables, its argument validators, and a real process.

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Balanced scan for template literals, nesting aware (an interpolation can contain a literal). */
function templateLiterals(code: string): Array<{ start: number; text: string }> {
  const found: Array<{ start: number; text: string }> = [];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] !== '`') continue;
    if (code[index - 1] === '\\') continue;
    let depth = 0;
    let cursor = index + 1;
    for (; cursor < code.length; cursor += 1) {
      const char = code[cursor];
      if (char === '\\') { cursor += 1; continue; }
      if (char === '$' && code[cursor + 1] === '{') { depth += 1; cursor += 1; continue; }
      if (char === '}' && depth > 0) { depth -= 1; continue; }
      if (char === '`' && depth === 0) break;
    }
    found.push({ start: index, text: code.slice(index + 1, cursor) });
    index = cursor;
  }
  return found;
}

/**
 * A command template is a `cogmem …` line built to be *run*, not printed. The
 * carriers are the response fields an agent copies a command out of, plus the
 * `base` a locator composes from. Status and log lines (`cogmem compact
 * applied`) mention the binary without ever being a command line, so they are
 * not in scope and must not match.
 */
const CARRIERS = /(command|contextCommand|reviewCommand|drilldown|nextCommands|base)\s*[:=]/;
const CARRIER_WINDOW = 220;

function isCommandTemplate(text: string, code: string, start: number): boolean {
  if (!text.startsWith('cogmem ') && !text.startsWith('${base} ')) return false;
  return CARRIERS.test(code.slice(Math.max(0, start - CARRIER_WINDOW), start));
}

type Site = { file: string; text: string };

function commandTemplates(): Site[] {
  const sites: Site[] = [];
  for (const file of sourceFiles(join(root, 'src'))) {
    const code = readFileSync(file, 'utf8');
    for (const literal of templateLiterals(code)) {
      if (!isCommandTemplate(literal.text, code, literal.start)) continue;
      sites.push({ file: relative(root, file), text: literal.text });
    }
  }
  return sites.sort((a, b) => `${a.file}${a.text}`.localeCompare(`${b.file}${b.text}`));
}

// Frozen inventory. A new runtime-built command line, or an edit to an existing
// one, has to be looked at again: render, resolve, and run it before adding it
// here. Duplicates are meaningful, so this is compared with multiplicity.
const EXPECTED_TEMPLATES = [
  ['src/agent/AgentMemoryBackend.ts', "cogmem memory show --event ${cliArg(event.eventId)}${event.projectId ? ` --project ${cliArg(event.projectId)}` : ''} --before 2 --after 2 --json"],
  ['src/agent/AgentMemoryBackend.ts', "cogmem memory show --event ${cliArg(event.eventId)}${event.projectId ? ` --project ${cliArg(event.projectId)}` : ''} --before 3 --after 3 --json"],
  ['src/atlas/MemoryAtlasService.ts', 'cogmem memory show --event ${cliArg(event.eventId)}${projectArg}'],
  ['src/atlas/MemoryAtlasService.ts', '${base} --before 2 --after 2 --json'],
  ['src/atlas/MemoryAtlasService.ts', '${base} --before 3 --after 3 --json'],
  ['src/bin/memory.ts', 'cogmem memory show --event ${cliArg(event.eventId)}${projectArg}'],
  ['src/bin/memory.ts', '${base} --before ${before} --after ${after} --json'],
  ['src/bin/memory.ts', '${base} --before 3 --after 3 --json'],
  ['src/bin/memory.ts', 'cogmem dream tick${projectArg} --mode auto --max-episodes 20 --json'],
  ['src/bin/memory.ts', 'cogmem memory list${projectArg} --order asc --limit 20 --json'],
  ['src/bin/memory.ts', 'cogmem memory candidates${projectArg} --status needs_confirmation --json'],
  ['src/bin/memory.ts', 'cogmem memory candidates${projectArg} --json'],
  ['src/bin/init.ts', "cogmem init --agent ${unwired.join(',')}"],
  ['src/bin/memory.ts', 'cogmem memory govern${projectArg} --limit 100 --json'],
  ['src/bin/memory.ts', 'cogmem memory candidates${projectArg} --status needs_confirmation --json'],
  ['src/bin/memory.ts', 'cogmem memory review${projectArg} --id <candidate-id> --action approve --actor <operator> --reason <reason> --confirmation-event <user-event-id> --json'],
  ['src/bin/memory.ts', 'cogmem memory review${projectArg} --id <candidate-id> --action defer --actor <operator> --reason <reason> --review-after <epoch-ms> --json'],
  ['src/bin/memory.ts', 'cogmem memory review${projectArg} --id <candidate-id> --action reject --actor <operator> --reason <reason> --json'],
  ['src/bin/memory.ts', 'cogmem memory review${projectArg} --id <candidate-id> --action relink --actor <operator> --reason <reason> --confirmation-event <user-event-id> --target-belief <belief-id> --json'],
  ['src/bin/memory.ts', 'cogmem memory review${projectArg} --id <candidate-id> --action supersede --actor <operator> --reason <reason> --replacement <replacement-candidate-id> --json'],
  ['src/factory.ts', 'cogmem memory graph-reindex --project ${shellQuote(input.projectId)} --episode ${shellQuote(episodeId)} --json'],
  ['src/factory.ts', "cogmem memory graph-explore --project ${shellQuote(input.projectId)} --query '<query>' --json"],
].map(([file, text]) => ({ file, text })).sort((a, b) => `${a.file}${a.text}`.localeCompare(`${b.file}${b.text}`));

/** Interpolation bodies the tests know how to give a value to. */
const INTERPOLATIONS: Record<string, string> = {
  'cliArg(event.eventId)': 'evt-probe',
  "event.projectId ? ` --project ${cliArg(event.projectId)}` : ''": ' --project probe-project',
  projectArg: ' --project probe-project',
  before: '2',
  after: '2',
  'shellQuote(input.projectId)': 'probe-project',
  'shellQuote(episodeId)': 'ep-1',
  "unwired.join(',')": 'openclaw',
  base: '', // filled per template below
};

/** Render one production template with representative values, or fail loudly. */
function render(text: string, extras: Record<string, string> = {}): string {
  const values = { ...INTERPOLATIONS, ...extras };
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '$' && text[index + 1] === '{') {
      let depth = 1;
      let cursor = index + 2;
      for (; cursor < text.length; cursor += 1) {
        if (text[cursor] === '$' && text[cursor + 1] === '{') { depth += 1; cursor += 1; continue; }
        if (text[cursor] === '}' && depth === 1) break;
        if (text[cursor] === '}') { depth -= 1; continue; }
      }
      const expression = text.slice(index + 2, cursor).trim();
      const value = values[expression];
      if (value === undefined) throw new Error(`unknown template interpolation: \${${expression}}`);
      out += value;
      index = cursor;
      continue;
    }
    out += text[index];
  }
  return out;
}

const SHOW_BASE = render('cogmem memory show --event ${cliArg(event.eventId)}${projectArg}');

/** Placeholder values a template expects the reader to fill in. */
function expandPlaceholders(command: string): string[] {
  let variants = [command];
  const values: Array<[string, string[]]> = [
    ['<candidate-id>', ['cand-1']],
    ['<replacement-candidate-id>', ['cand-2']],
    ['<approve|reject|defer|supersede|relink>', ['approve', 'reject', 'defer', 'supersede', 'relink']],
    ['<user-event-id>', ['evt-confirm-1']],
    ['<belief-id>', ['belief-1']],
    ['<epoch-ms>', ['1792809999999']],
    ['<operator>', ['operator']],
    ['<reason>', ['why']],
    ['<query>', ['probe query']],
  ];
  for (const [placeholder, replacements] of values) {
    variants = variants.flatMap((variant) => (variant.includes(placeholder)
      ? replacements.map((replacement) => variant.split(placeholder).join(replacement))
      : [variant]));
  }
  return variants;
}

type Parsed = { group: string; sub?: string; pairs: Array<{ flag: string; value?: string }> };

/** Quote-aware tokenizer: `--query '<query>'` is one flag with one value. */
function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  const flush = () => { if (current) { tokens.push(current); current = ''; } };
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (/\s/.test(char)) { flush(); continue; }
    current += char;
  }
  flush();
  return tokens;
}

function parse(raw: string): Parsed {
  const tokens = tokenize(raw);
  expect(tokens[0]).toBe('cogmem');
  // `cogmem memory review …` names a group and a subcommand, so its flags start
  // at index 3. `cogmem init --agent …` is a single-word command whose flags
  // start at index 2. Reading the second word as a subcommand only when it is
  // not already a flag covers both.
  const hasSub = tokens[2] !== undefined && !tokens[2].startsWith('--');
  const pairs: Array<{ flag: string; value?: string }> = [];
  for (let index = hasSub ? 3 : 2; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) continue;
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith('--')) pairs.push({ flag: token.slice(2) });
    else { pairs.push({ flag: token.slice(2), value: next }); index += 1; }
  }
  return { group: tokens[1], sub: hasSub ? tokens[2] : undefined, pairs };
}

const cliSource = read(join('src', 'bin', 'cogmem.ts'));

function cliGroups(): Map<string, string> {
  const start = cliSource.indexOf('const COMMANDS');
  if (start < 0) throw new Error('src/bin/cogmem.ts no longer declares COMMANDS');
  const body = cliSource.slice(start, cliSource.indexOf('};', start));
  const groups = new Map<string, string>();
  for (const match of body.matchAll(/'?([a-z][a-z-]*)'?\s*:\s*'([a-z][a-z-]*)'/g)) groups.set(match[1], match[2]);
  return groups;
}

const groups = cliGroups();
const binSource = (entry: string) => read(join('src', 'bin', `${entry}.ts`));

function moduleCommands(entry: string): Set<string> {
  const code = binSource(entry);
  const commands = new Set<string>();
  for (const match of code.matchAll(/command === '([a-z][a-z-]*)'/g)) commands.add(match[1]);
  const guardStart = code.indexOf('function isMemoryCommand');
  if (guardStart >= 0) {
    const guardBody = code.slice(guardStart, balancedBody(code, guardStart));
    for (const match of guardBody.matchAll(/value === '([a-z][a-z-]*)'/g)) commands.add(match[1]);
  }
  return commands;
}

/** Index just past the `}` that closes the block opened at or after `from`. */
function balancedBody(code: string, from: number): number {
  const open = code.indexOf('{', from);
  if (open < 0) return code.length;
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1;
    else if (code[index] === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return code.length;
}

/** Literal values a validator function accepts, read from the validator itself. */
function acceptedLiterals(entry: string, functionName: string): Set<string> {
  const code = binSource(entry);
  const start = code.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`src/bin/${entry}.ts no longer declares ${functionName}()`);
  const body = code.slice(start, balancedBody(code, start));
  const accepted = new Set<string>();
  for (const match of body.matchAll(/===\s*'([a-z_-]+)'/g)) accepted.add(match[1]);
  if (accepted.size === 0) throw new Error(`${functionName}() in src/bin/${entry}.ts accepts no literal values`);
  return accepted;
}

// Which validator owns which flag, per bin.
const ENUM_VALIDATORS: Record<string, Record<string, string>> = {
  memory: { order: 'orderArg', status: 'candidateStatusArg', action: 'reviewActionArg', mode: 'modeArg' },
  dream: { mode: 'modeArg' },
};

function commandProblems(raw: string): string[] {
  const problems: string[] = [];
  const { group, sub, pairs } = parse(raw);
  const entry = groups.get(group);
  if (!entry) return [`${raw}: unknown cogmem group '${group}'`];
  const code = binSource(entry);
  // A single-word command (`cogmem init`) has no subcommand to dispatch, so the
  // check applies only when the command line actually names one.
  if (sub !== undefined && !moduleCommands(entry).has(sub)) problems.push(`${raw}: src/bin/${entry}.ts does not dispatch '${sub}'`);
  for (const { flag, value } of pairs) {
    const read_ = code.includes(`'${flag}'`) || code.includes(`"${flag}"`);
    if (!read_ && !code.includes(`--${flag}`)) problems.push(`${raw}: src/bin/${entry}.ts never reads or documents --${flag}`);
    const validator = ENUM_VALIDATORS[entry]?.[flag];
    if (validator && value !== undefined && !acceptedLiterals(entry, validator).has(value)) {
      problems.push(`${raw}: ${validator}() rejects --${flag} ${value}`);
    }
    if (value !== undefined && code.includes(`numberArg(values, '${flag}')`)) {
      if (!/^-?\d+$/.test(value)) problems.push(`${raw}: --${flag} must be numeric, got '${value}'`);
    }
  }
  return problems;
}

/** Every rendered command line this file knows about, placeholders expanded. */
function renderedCommands(): Array<{ site: string; command: string }> {
  return commandTemplates().flatMap((site) => {
    const extras: Record<string, string> = site.text.startsWith('${base} ') ? { base: SHOW_BASE } : {};
    return expandPlaceholders(render(site.text, extras))
      .map((command) => ({ site: `${site.file}: ${site.text}`, command }));
  });
}

function withKernel<T>(run: (kernel: ReturnType<typeof createMemoryKernel>) => T): T {
  const dir = makeTempDir('cogmem-command-templates-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  try {
    return run(kernel);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('runtime-built command lines are executable, not aspirational', () => {
  const sites = commandTemplates();

  test('the inventory of runtime-built command templates is unchanged', () => {
    expect(sites).toEqual(EXPECTED_TEMPLATES);
    expect(sites).toHaveLength(22);
  });

  test('every rendered command line resolves through the real CLI dispatch tables', () => {
    const rendered = renderedCommands();
    // Guard the guard: a renderer that produced nothing would pass silently.
    expect(rendered.length).toBeGreaterThanOrEqual(17);
    const problems = rendered.flatMap(({ command }) => commandProblems(command));
    expect(problems).toEqual([]);
  });

  test('every enum value a template hardcodes is still accepted by its validator', () => {
    const checks: string[] = [];
    for (const { command } of renderedCommands()) {
      const { group, pairs } = parse(command);
      const entry = groups.get(group);
      if (!entry) continue;
      for (const { flag, value } of pairs) {
        const validator = ENUM_VALIDATORS[entry]?.[flag];
        if (!validator || value === undefined) continue;
        checks.push(`${validator}:--${flag}=${value}`);
        expect(acceptedLiterals(entry, validator).has(value)).toBe(true);
      }
    }
    // The real enums, not a subset that happens to be empty.
    expect(checks.length).toBeGreaterThanOrEqual(9);
    expect(checks).toContain('orderArg:--order=asc');
    expect(checks).toContain('candidateStatusArg:--status=needs_confirmation');
    expect(checks).toContain('modeArg:--mode=auto');
    for (const action of ['approve', 'reject', 'defer', 'supersede', 'relink']) {
      expect(checks).toContain(`reviewActionArg:--action=${action}`);
    }
  });

  test('the plan suggestions an operator is told to run really run', async () => {
    const dir = makeTempDir('cogmem-command-run-');
    const db = join(dir, 'memory.db');
    try {
      const run = async (args: string[]) => {
        const proc = Bun.spawn({
          cmd: ['bun', join(root, 'src', 'bin', 'cogmem.ts'), ...args, '--db', db, '--json'],
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
      };

      // The five read/automate suggestions exit 0 on a live database.
      const reads: Array<[string, string[]]> = [
        ['dream tick', ['dream', 'tick', '--project', 'probe-project', '--mode', 'auto', '--max-episodes', '20']],
        ['memory list', ['memory', 'list', '--project', 'probe-project', '--order', 'asc', '--limit', '20']],
        ['memory candidates --status', ['memory', 'candidates', '--project', 'probe-project', '--status', 'needs_confirmation']],
        ['memory candidates', ['memory', 'candidates', '--project', 'probe-project']],
        ['memory govern', ['memory', 'govern', '--project', 'probe-project', '--limit', '100']],
      ];
      for (const [label, args] of reads) {
        const result = await run(args);
        expect(`${label}: ${result.exitCode} ${result.stderr}`).toBe(`${label}: 0 `);
      }

      // The review suggestion is a template, so the id is fake: it must fail on
      // data (`candidate_not_found`), not on dispatch or an unknown flag.
      const review = await run([
        'memory', 'review', '--project', 'probe-project', '--id', 'cand-1',
        '--action', 'approve', '--actor', 'operator', '--reason', 'why',
      ]);
      expect(review.exitCode).toBe(1);
      expect(review.stderr).toBe('candidate_not_found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the memory show locator the CLI prints is itself an executable command', async () => {
    const dir = makeTempDir('cogmem-command-locator-');
    const db = join(dir, 'memory.db');
    try {
      const kernel = createMemoryKernel({ dbPath: db, vectorBackend: 'sqlite-vec' });
      const recorded = kernel.recordRawEvent({
        projectId: 'probe-project',
        sessionId: 'session-1',
        threadId: 'thread-1',
        role: 'user',
        rawEventType: 'message',
        content: 'locator probe event',
      } as never) as unknown as { eventId: string };
      kernel.close();

      const run = async (args: string[]) => {
        const proc = Bun.spawn({
          cmd: ['bun', join(root, 'src', 'bin', 'cogmem.ts'), ...args, '--db', db, '--json'],
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
      };

      const shown = await run(['memory', 'show', '--event', recorded.eventId, '--project', 'probe-project', '--before', '2', '--after', '2']);
      expect(shown.exitCode).toBe(0);
      expect(shown.stderr).toBe('');
      const body = JSON.parse(shown.stdout) as {
        event: { sourceLocator: { command: string; contextCommand: string } };
      };
      const { command, contextCommand } = body.event.sourceLocator;

      // What the CLI prints is the template with real values in it.
      expect(command).toBe(`cogmem memory show --event ${recorded.eventId} --project probe-project --before 2 --after 2 --json`);
      expect(contextCommand).toBe(`cogmem memory show --event ${recorded.eventId} --project probe-project --before 3 --after 3 --json`);

      // ...and it runs. The locator exists to be pasted into a shell.
      for (const locator of [command, contextCommand]) {
        expect(commandProblems(locator)).toEqual([]);
        const pasted = await run(tokenize(locator).slice(1));
        expect(`${locator}: ${pasted.exitCode} ${pasted.stderr}`).toBe(`${locator}: 0 `);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the agent recall locator is an executable command too', () => {
    withKernel((kernel) => {
      kernel.recordRawEvent({
        projectId: 'probe-project', workspaceId: 'probe-workspace', threadId: 'thread-r',
        sessionId: 'session-r', role: 'assistant', rawEventType: 'message',
        content: 'Before context for the locator probe.',
        occurredAt: 1_700_000_000_000,
      } as never);
      const anchor = kernel.recordRawEvent({
        projectId: 'probe-project', workspaceId: 'probe-workspace', threadId: 'thread-r',
        sessionId: 'session-r', role: 'user', rawEventType: 'message',
        content: 'Needle locator probe: the agent command must resolve.',
        occurredAt: 1_700_000_001_000,
      } as never) as unknown as { eventId: string };

      const backend = new KernelAgentMemoryBackend(kernel);
      const recalled = backend.recall({ agentId: 'openclaw', projectId: 'probe-project', query: 'Needle locator probe agent command resolve', limit: 5 });
      const locator = recalled.items.find((item) => item.sourceAnchor?.eventId === anchor.eventId)?.sourceContext?.locator;
      expect(locator).toBeDefined();
      expect(locator?.command).toContain(`--event ${anchor.eventId}`);
      expect(commandProblems(String(locator?.command))).toEqual([]);
      expect(commandProblems(String(locator?.contextCommand))).toEqual([]);
    });
  });
});
