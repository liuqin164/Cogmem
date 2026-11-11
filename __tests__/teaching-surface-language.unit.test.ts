import { expect, test } from 'bun:test';

import { buildMcpInstructions } from '../src/mcp/profiles.js';

const CJK = /[\u3400-\u9fff]/;

/**
 * #135, checked rather than assumed.
 *
 * The runtime teaching surface is what an agent actually reads: the MCP
 * instructions and the tool descriptions. It is English already, so this guard
 * holds the property the ticket asks for instead of producing a translation of
 * the Chinese SKILL documentation that nothing in `src/` installs.
 */
test('the MCP instructions are English, for every profile', () => {
  for (const profile of ['core', 'admin', 'full'] as const) {
    const text = buildMcpInstructions(profile);
    expect({ profile, hasText: text.trim().length > 0, cjk: CJK.test(text) }).toEqual({ profile, hasText: true, cjk: false });
  }
});
