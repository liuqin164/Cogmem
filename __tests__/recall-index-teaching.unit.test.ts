import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMcpInstructions, RECALL_INDEX_TEACHING } from '../src/mcp/profiles.js';

const root = join(import.meta.dir, '..');

/**
 * #131: an agent that does not know what an index entry is will answer from the title. The teaching has one
 * source — `RECALL_INDEX_TEACHING` — and this guard makes the shipped skills carry it, so the four surfaces
 * cannot drift apart silently.
 */
test('the MCP instructions teach what an index answer is', () => {
  for (const profile of ['core', 'admin', 'full'] as const) {
    expect({ profile, teaches: buildMcpInstructions(profile).includes(RECALL_INDEX_TEACHING) }).toEqual({ profile, teaches: true });
  }
});

test('every shipped host skill carries the same sentence', () => {
  for (const file of ['examples/openclaw-backend/SKILL.md', 'examples/hermes-backend/SKILL.md', 'examples/pi-backend/SKILL.md']) {
    const text = readFileSync(join(root, file), 'utf8');
    expect({ file, teaches: text.includes(RECALL_INDEX_TEACHING) }).toEqual({ file, teaches: true });
  }
});
