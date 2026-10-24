import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMcpInstructions, type McpToolProfile } from '../src/mcp/profiles.js';

// ADR 0002 reserves "automatic / emergent" for hosts that expose a pre-prompt
// hook. A host that speaks only MCP has to pull explicitly, and the docs are the
// place that distinction is promised or lost: a Cursor user who reads OpenClaw's
// behaviour into their own setup looks for a memory that never surfaced and
// concludes Cogmem does not work. The table in docs/mcp-hosts.md is therefore
// product surface, and every row in it is checked against something real below
// rather than against the prose next to it.

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const hosts = read(join('docs', 'mcp-hosts.md'));
const readme = read('README.md');

/** Body of a `## Heading` section, up to the next level-2 heading. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`missing section: ${heading}`);
  const end = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, end < 0 ? doc.length : end);
}

/** Rows of the recall-mode table: `| Host | Path | What happens ... |`. */
function recallRows(doc: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of doc.split('\n')) {
    const match = line.match(/^\|\s*(.+?)\s*\|\s*(push|pull)\s*\|/);
    if (match) rows.set(match[1], match[2]);
  }
  return rows;
}

const PROFILES: McpToolProfile[] = ['core', 'admin', 'full'];

describe('docs/mcp-hosts.md states the recall mode per host', () => {
  test('the mode table covers every shipping host, with exactly one push path', () => {
    const rows = recallRows(hosts);

    expect([...rows.keys()]).toEqual([
      'OpenClaw + the Cogmem plugin',
      'OpenClaw via `openclaw mcp add`',
      'Hermes',
      'Claude Code',
      'Cursor',
      'Codex',
    ]);
    expect(rows.get('OpenClaw + the Cogmem plugin')).toBe('push');
    // The same product on the MCP-only path loses the hook, so it is a pull
    // host. Documenting it as push is the conflation ADR 0002 forbids.
    expect(rows.get('OpenClaw via `openclaw mcp add`')).toBe('pull');
    for (const host of ['Hermes', 'Claude Code', 'Cursor', 'Codex']) {
      expect(rows.get(host)).toBe('pull');
    }
    expect([...rows.values()].filter((mode) => mode === 'push')).toHaveLength(1);
  });

  test('the section forbids calling a pull-only host automatic', () => {
    expect(hosts).toContain('## How memory reaches the model');
    expect(hosts).toContain('Do not describe a pull-only host as automatic.');
    // The stated failure mode, so the rule is not just an adjective.
    expect(hosts).toContain('Emergence\nis the property only the push path can claim.');
  });

  test('the push row is backed by a real pre-prompt hook', () => {
    // The plugin template is the only thing that injects recall before the
    // model answers. If the hook registration goes away, the push claim in the
    // table becomes false, so it is checked against the source that ships it.
    const plugin = read(join('src', 'host', 'openclaw', 'AutoMemoryPluginInstaller.ts'));
    expect(plugin).toContain("api.on('before_prompt_build'");
    expect(plugin).toContain("hookNames: ['before_prompt_build', 'agent_end']");
    expect(hosts).toContain('`before_prompt_build` injects the\nrecall block');
    // Recording a turn is not emergence, and the doc says so.
    expect(hosts).toContain('`agent_end` records the finished turn; it does not make memory\nemerge.');
  });

  test('every pull row points at a contract that exists', () => {
    // Pull hosts have no hook, so the instruction to recall before answering
    // has to travel in the MCP `instructions` string. All three profiles must
    // carry it or a host on that profile is documented as pull with no channel.
    for (const profile of PROFILES) {
      expect(buildMcpInstructions(profile)).toContain('call cogmem_recall before answering');
      expect(buildMcpInstructions(profile)).toContain('hookless');
    }

    // Hermes is pull because the installed skill routes questions to recall,
    // not because the plugin injects. Check the shipped skill and the install
    // path the doc names.
    const skill = read(join('examples', 'hermes-backend', 'SKILL.md'));
    expect(skill).toContain('Direct factual question: `cogmem_recall`.');
    expect(skill).toContain('When the prompt does not contain enough injected Cogmem context');
    const connect = read(join('src', 'bin', 'connect.ts'));
    expect(connect).toContain("'cogmem-memory', 'SKILL.md'");
  });

  test('the instructions-scope caveat matches how the server builds the string', () => {
    // The doc promises the string tracks the launch profile, not a per-call
    // identity header. buildMcpInstructions takes one profile and has no
    // per-call input, which is what makes that sentence true.
    expect(hosts).toContain('It only names tools the profile the server started with exposes');
    expect(hosts).toContain('a per-call identity that narrows the profile does not rewrite it');
    expect(buildMcpInstructions.length).toBe(1);
  });

  test('ADR 0002 is the requirement this table satisfies', () => {
    const adr = read(join('docs', 'adr', '0002-automatic-only-where-a-hook-exists.md'));
    expect(adr).toContain('Documentation must state the mode per host.');
    expect(adr).toContain('"emergent / automatic" is reserved for hook-capable hosts');
  });
});

// The README makes the same promise in prose, in three places that no test
// watched: the OpenClaw section, the Hermes section, and the stdio transport
// note. Prose is the copy a user reads before installing, so a sentence drifting
// from pull to automatic costs more than the table doing it.

describe('README promises the same recall modes as the host table', () => {
  test('the "only place memory can emerge on its own" claim matches the single push row', () => {
    const push = [...recallRows(hosts)].filter(([, mode]) => mode === 'push');
    expect(push).toHaveLength(1);
    expect(push[0][0]).toContain('OpenClaw');

    // The table states the mode; the README states the exclusivity. Whichever
    // changes first leaves the other one wrong, so both are checked together.
    expect(readme).toContain('the only place where memory can emerge on its own');
    expect(readme).toContain('the plugin hooks `before_prompt_build`');
    expect(hosts).toContain('`before_prompt_build` injects the');
  });

  test('plain MCP under OpenClaw is documented as pull, not automatic', () => {
    const openclaw = section(readme, 'OpenClaw');
    expect(openclaw).toContain('Attaching over plain MCP (`openclaw mcp add`) gives the pull path only');
    expect(openclaw).toContain('the model has to call `cogmem_recall`');

    // The push sentence and the `openclaw mcp add` sentence share a paragraph,
    // so this is checked per sentence: the MCP-only path may not borrow the hook.
    const mcpSentences = openclaw
      .split(/(?<=\.)\s+/)
      .filter((sentence) => sentence.includes('openclaw mcp add'));
    expect(mcpSentences).toHaveLength(1);
    expect(mcpSentences[0]).not.toMatch(/automatic|emerge/i);
    expect(mcpSentences[0]).toContain('pull path only');
  });

  test('the Hermes section states the pull path and never claims injection', () => {
    const hermes = section(readme, 'Hermes');
    expect(hermes).toContain('There is no pre-prompt hook here, so this is the pull path');
    expect(hermes).toContain('the agent calls `cogmem_recall` when the installed skill tells it to');

    // This release ships no Hermes plugin. One "automatically" in this section
    // turns the pull row above into a false promise the user only finds at use.
    expect(hermes).not.toMatch(/automatic|emerge|inject/i);

    // The skill the section points at is the one the installer writes.
    expect(hermes).toContain('~/.hermes/skills/cogmem-memory/SKILL.md');
    expect(read(join('src', 'bin', 'connect.ts'))).toContain("'cogmem-memory', 'SKILL.md'");
  });

  test('the stdio transport caveat keeps memory explicit rather than injected', () => {
    expect(readme).toContain('A host attached this way has no pre-prompt hook:');
    expect(readme).toContain(
      "memory is recalled explicitly, guided by the server's `instructions` string, not injected.",
    );
    // That instructions string is real on every profile, not a documentation
    // promise: this is the channel the pull rows depend on.
    for (const profile of PROFILES) {
      expect(buildMcpInstructions(profile)).toContain('call cogmem_recall before answering');
    }
  });

  test('no README sentence sells a hookless host as automatic', () => {
    for (const phrase of [
      'Hermes automatically',
      'Hermes injects',
      'injected automatically',
      'automatically injects recall',
      'Hermes pre-prompt',
      'Hermes auto-inject',
    ]) {
      expect(readme).not.toContain(phrase);
    }
  });
});

// `examples/**/*.md` ships inside the npm package, so both runbooks reach a
// user: SKILL.md plus references/operations.md is the bundle `connect hermes`
// writes into ~/.hermes/skills/cogmem-memory/, and AGENTS.md is the runbook the
// agent is pointed at. They are agent-facing, so ADR 0002's rule applies to
// them exactly as it does to the host table and the README, and neither had a
// guard. An agent that reads "memory arrives on its own" stops calling recall
// and then reports memory as missing when it is only unasked.

describe('the shipped Hermes runbooks state the pull contract too', () => {
  const agents = read(join('examples', 'hermes-backend', 'AGENTS.md'));
  const skill = read(join('examples', 'hermes-backend', 'SKILL.md'));

  /** The single paragraph carrying a sentence, so a claim is read with its neighbours. */
  function paragraphWith(doc: string, sentence: string): string {
    const matches = doc.split('\n\n').filter((paragraph) => paragraph.includes(sentence));
    expect(matches).toHaveLength(1);
    return matches[0];
  }

  test('AGENTS.md says there is no automatic observation path and names both manual calls', () => {
    // The absence claim is only actionable next to the commands that replace
    // it: write the conversation, then ask before answering. Both directions
    // have to survive in the same paragraph or the sentence above is a dead end.
    const paragraph = paragraphWith(
      agents,
      'Hermes has no automatic observation path in this integration.',
    );
    expect(paragraph).toContain('`cogmem_episode_append`');
    expect(paragraph).toContain('`cogmem_episode_import`');
    expect(paragraph).toContain('call `cogmem_recall` before memory-dependent answers');
  });

  test('the installed SKILL.md says Cogmem cannot observe Hermes without a hook or an explicit call', () => {
    const paragraph = paragraphWith(
      skill,
      'Cogmem cannot observe Hermes conversations without a host hook or explicit MCP/import call.',
    );
    expect(paragraph).toContain('call `cogmem_episode_append`');
    expect(paragraph).toContain('Before answering memory questions, call `cogmem_recall`');
  });

  test('neither runbook sells the Hermes path as injection', () => {
    for (const doc of [agents, skill]) {
      for (const phrase of [
        'Hermes injects',
        'injected automatically',
        'automatically injects',
        'memory emerges',
        'Hermes automatically',
      ]) {
        expect(doc).not.toContain(phrase);
      }
    }
    // "no automatic observation path" is the only correct place for those two
    // words together; a rewrite that drops the negation must not slip through.
    expect(agents).toContain('no automatic observation path');
    expect(agents).not.toMatch(/(?<!no )automatic observation path/);
  });

  test('AGENTS.md ships in the package but is not part of the bundle connect hermes installs', () => {
    // Worth pinning because it changes what an operator should edit: connect
    // writes SKILL.md and references/operations.md only, so an edit to
    // AGENTS.md expecting an install to pick it up goes nowhere.
    const connect = read(join('src', 'bin', 'connect.ts'));
    expect(connect).toContain("'examples', `${agent}-backend`, 'SKILL.md'");
    expect(connect).toContain("'references', 'operations.md'");
    expect(connect).not.toContain('AGENTS.md');
    expect(read('package.json')).toContain('"examples/**/*.md"');
  });
});
