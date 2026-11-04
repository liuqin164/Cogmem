import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMcpInstructions, type McpToolProfile } from '../src/mcp/profiles.js';

const PROFILES: McpToolProfile[] = ['core', 'admin', 'full'];
const RULE = 'Recall is scoped to an agent identity';

test('every profile tells a new session that recall is scoped to an agent identity', () => {
  // A host-written database answers 0 to a session that recalls without its identity, and a session
  // that does not know the rule reads that as "nothing was remembered" (#128's root).
  for (const profile of PROFILES) {
    const instructions = buildMcpInstructions(profile);
    expect({ profile, says: instructions.includes(RULE) }).toEqual({ profile, says: true });
    expect(instructions).toContain("0 results can mean the scope is wrong rather than that nothing was stored");
  }
});

test('the recall tool description carries the same scope semantics', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'src', 'mcp', 'CoreMcpTools.ts'), 'utf8');
  const at = source.indexOf("name: 'cogmem_recall'");
  expect(at).toBeGreaterThan(0);
  const description = source.slice(at, source.indexOf("name: 'cogmem_explain_recall'", at));
  expect(description).toContain(RULE);
  expect(description).toContain('agentId');
});

test('the host bundles that talk about identity carry the same rule', () => {
  for (const host of ['openclaw', 'hermes', 'pi']) {
    const text = readFileSync(join(import.meta.dir, '..', 'examples', `${host}-backend`, 'SKILL.md'), 'utf8');
    // pi documents the identity rule under its own heading; the other two carry it in Ground Rules.
    expect({ host, documented: text.includes(RULE) || text.includes('the project is the identity') })
      .toEqual({ host, documented: true });
  }
});
