import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMcpInstructions, type McpToolProfile } from '../src/mcp/profiles.js';

// ADR 0002 reserves emergence for a host that exposes a pre-prompt hook *and*
// has a Cogmem adapter using it; ADR 0004 names the adapters and the order they
// land in. The docs are where that distinction is promised or lost: a Hermes
// user who reads OpenClaw's behaviour into their own setup looks for a memory
// that never surfaced and concludes Cogmem does not work.
//
// The tables in docs/mcp-hosts.md and README.md are therefore product surface.
// Every hook name in them is checked against the document that recorded it from
// the vendor, every "shipped" claim against the source that ships the adapter,
// and every pull row against the contract that carries explicit recall. A claim
// may not be rounded up anywhere: "has a hook" is not "adapter shipped", and
// "adapter planned" is not emergence.

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Collapse whitespace so a prose assertion does not depend on line wrapping. */
const flat = (doc: string) => doc.replace(/\s+/g, ' ');

const hosts = read(join('docs', 'mcp-hosts.md'));
const recordHooks = read(join('docs', 'host-plugin-record-hooks.md'));
const adr = (name: string) => read(join('docs', 'adr', name));
const adr0002 = adr('0002-automatic-only-where-a-hook-exists.md');
const adr0004 = adr('0004-one-bridge-thin-host-adapters.md');


/**
 * Rows of the recall-mode table, which is the one table headed by a cell naming
 * the host's push hook. Each row comes back as its trimmed cells, so a column can
 * be asserted by position instead of by matching prose.
 */
function recallTable(doc: string): string[][] {
  const lines = doc.split('\n');
  const headerIndex = lines.findIndex((line) => line.startsWith('|') && line.includes('Push hook'));
  if (headerIndex < 0) throw new Error('missing the recall-mode table header');
  const rows: string[][] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

/** One row by its first cell, so a missing host fails by name. */
function rowFor(rows: string[][], host: string): string[] {
  const row = rows.find((cells) => cells[0] === host);
  if (!row) throw new Error(`missing recall row: ${host}`);
  return row;
}

const PROFILES: McpToolProfile[] = ['core', 'admin', 'full'];

describe('docs/mcp-hosts.md states the recall mode and the adapter status per host', () => {
  const rows = recallTable(hosts);

  test('the table covers every host this release talks about, in a fixed order', () => {
    expect(rows.map((cells) => cells[0])).toEqual([
      'OpenClaw + the Cogmem plugin',
      'OpenClaw via `openclaw mcp add`',
      'Hermes',
      'pi',
      'DSH',
      'Claude Code',
      'Cursor',
      'Codex',
    ]);
  });

  test('every push row is an adapter that shipped and was verified', () => {
    // Two rows are push as of 2026-10-30, and they are push for the same reason: an
    // adapter cogmem ships and ran against a real client. The rule the count used to
    // express is the one that matters, so it is asserted directly rather than as "there
    // is exactly one": a push row without a shipped, verified adapter is emergence
    // claimed for a hook nobody wired.
    const push = rows.filter((cells) => cells[1] === 'push');
    expect(push.map((cells) => cells[0])).toEqual(['OpenClaw + the Cogmem plugin', 'Hermes', 'pi']);
    for (const row of push) expect(row[3]).toContain('shipped and verified');
    // Every other row is explicit recall, including the hosts that do expose a
    // hook: a hook without a shipped adapter is not emergence.
    for (const row of rows.filter((cells) => cells[1] !== 'push')) {
      expect(row[1]).toBe('pull');
    }
  });

  test('a host with a hook and no adapter is pull, and says so', () => {
    // The corrected ADR 0002: these hosts expose a pre-prompt hook and none of them
    // has a Cogmem adapter yet. Documenting them as push is the conflation the ADR
    // forbids. pi used to be the hardest case here and is now the counter-example:
    // its extension ships, so it reads `push` and says `shipped and verified`.
    // pi and Hermes left this list on 2026-10-30: `connect pi --auto` writes an extension
    // that hooks `before_agent_start`, and `connect hermes --auto` writes a
    // `pre_llm_call` shell hook — both verified on a box. DSH and Claude Code still
    // expose a hook with no Cogmem adapter, which is the case the ADR is about.
    const planned: Array<[string, string, string]> = [
      ['DSH', 'prompt section', 'planned'],
      ['Claude Code', '`UserPromptSubmit`', 'planned'],
    ];
    for (const [host, hook, adapter] of planned) {
      const row = rowFor(rows, host);
      expect(row[1]).toBe('pull');
      expect(row[2]).toBe(hook);
      expect(row[3]).toContain(adapter);
    }
    // ADR 0004 requires the unverified label wherever that adapter is described.
    expect(rowFor(rows, 'Claude Code')[3]).toContain('unverified against a real client');
  });

  test('a host attached only over MCP has no adapter even when it has the hook', () => {
    const plugin = rowFor(rows, 'OpenClaw + the Cogmem plugin');
    const mcp = rowFor(rows, 'OpenClaw via `openclaw mcp add`');
    // Same product, same hook name in the host — but the adapter is what makes
    // it push, so the MCP attachment is documented as pull.
    expect(mcp[2]).toBe(plugin[2]);
    expect(mcp[1]).toBe('pull');
    expect(mcp[3]).toContain('not installed on this path');

    for (const host of ['Cursor', 'Codex']) {
      const row = rowFor(rows, host);
      expect(row[2]).toContain('none');
      expect(row[3]).toContain('none');
    }
  });

  test('every hook name in the table was recorded from a vendor source, not invented', () => {
    // The push-hook names are the ones ADR 0002 records from vendor docs; the
    // adapter order is the one ADR 0004 fixes, and OpenClaw's own hook is the
    // one the shipped plugin registers. A new hook name cannot appear in the
    // table without appearing in one of those records.
    const hookFacts = flat(adr0002);
    const roadmap = flat(adr0004);
    for (const hook of ['Hermes fires `pre_llm_call`', 'pi fires `before_agent_start`', 'Claude Code exposes `UserPromptSubmit`']) {
      expect(hookFacts, 'ADR 0002 is the vendor-sourced record of the push hooks').toContain(hook);
    }
    for (const [host, hook] of [
      ['Hermes', 'pre_llm_call'],
      ['pi', 'before_agent_start'],
      ['Claude Code', 'UserPromptSubmit'],
    ] as Array<[string, string]>) {
      expect(roadmap, `ADR 0004 must name ${host}'s hook`).toContain(hook);
    }
    expect(hookFacts).toContain('DSH contributes a prompt section');
    expect(roadmap).toContain('DSH** next, through its prompt section');

    // OpenClaw is not in ADR 0004's ordering: it is the adapter that already
    // ships, and its hooks are the ones the plugin registers.
    const plugin = read(join('src', 'host', 'openclaw', 'AutoMemoryPluginInstaller.ts'));
    expect(plugin).toContain("hookNames: ['before_prompt_build', 'agent_end']");
    expect(read(join('docs', 'openclaw-runtime.md'))).toContain('before_prompt_build (30s budget)');

    // The record-side hook names the README carries come from the vendor record.
    for (const hook of ['`post_llm_call`', '`turn_end`', '`Stop`']) {
      expect(recordHooks).toContain(hook);
    }
  });

  test('the section states the capability/delivery split instead of one adjective', () => {
    const prose = flat(hosts);
    expect(prose).toContain('Having a hook makes emergence possible; only a shipped adapter makes it true.');
    expect(prose).toContain('ADR-0002 requires capability and delivery to be stated separately');
    expect(prose).toContain('Do not describe a pull-only host as automatic.');
    // The stated failure mode, so the rule is not just an adjective.
    expect(prose).toContain('Emergence is the property only the push path can claim');
  });

  test('the push row is backed by a real pre-prompt hook in the shipped plugin', () => {
    // If the hook registration goes away, the push claim in the table becomes
    // false, so it is checked against the source that ships it.
    const plugin = read(join('src', 'host', 'openclaw', 'AutoMemoryPluginInstaller.ts'));
    expect(plugin).toContain("api.on('before_prompt_build'");
    expect(plugin).toContain("hookNames: ['before_prompt_build', 'agent_end']");
    expect(flat(hosts)).toContain('`before_prompt_build` injects the recall block');
    // Recording a turn is not emergence, and the doc says so.
    expect(flat(hosts)).toContain('`agent_end` records the finished turn; it does not make memory emerge.');
  });

  test('every pull row points at a contract that exists', () => {
    // A pull host has no adapter, so the instruction to recall before answering
    // has to travel in the MCP `instructions` string. All three profiles must
    // carry it or a host on that profile is documented as pull with no channel.
    for (const profile of PROFILES) {
      expect(buildMcpInstructions(profile)).toContain('call cogmem_recall before answering');
      expect(buildMcpInstructions(profile)).toContain('hookless');
    }

    // Hermes is pull because the installed skill routes questions to recall,
    // not because an adapter injects. Check the shipped skill and the install
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
    expect(flat(hosts)).toContain('It only names tools the profile the server started with exposes');
    expect(flat(hosts)).toContain('a per-call identity that narrows the profile does not rewrite it');
    expect(buildMcpInstructions.length).toBe(1);
  });

  test('ADR 0002 and ADR 0004 are the requirements this table satisfies', () => {
    expect(adr0002).toContain('Documentation must state the mode per host.');
    expect(adr0002).toContain('"emergent / automatic" is reserved for hook-capable hosts');
    expect(flat(adr0002)).toContain('State capability and delivery separately, per host.');
    expect(flat(adr0002)).toContain('That was wrong.');
    expect(flat(hosts)).toContain('ADR-0004 fixes the order the adapters land in');
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
