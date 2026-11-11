import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXPLICIT_EXCLUSION_INLINE_CLOSE as CLOSE,
  EXPLICIT_EXCLUSION_INLINE_OPEN as OPEN,
  EXPLICIT_EXCLUSION_TEACHING,
  EXPLICIT_EXCLUSION_WHOLE_TURN as WHOLE,
} from '../src/context/ExplicitExclusion.js';
import { buildMcpInstructions } from '../src/mcp/profiles.js';

const root = join(import.meta.dir, '..');

/** #133: a convention nobody is told about cannot be used. One source, asserted on every surface. */
test('the MCP instructions teach the exclusion convention', () => {
  for (const profile of ['core', 'admin', 'full'] as const) {
    expect({ profile, teaches: buildMcpInstructions(profile).includes(EXPLICIT_EXCLUSION_TEACHING) })
      .toEqual({ profile, teaches: true });
  }
});

/**
 * The marker shares the `COGMEM_` namespace with the injected blocks, and both block strippers remove
 * generated blocks from stored text. If either list ever gained this marker, it would delete the user's
 * declaration before anything read it — the feature would stop working with no visible failure.
 */
test('neither block stripper literal list contains the exclusion marker', () => {
  const hygene = readFileSync(join(root, 'src/agent/ContextHygiene.ts'), 'utf8');
  const stripper = readFileSync(join(root, 'src/episode/CogmemBlockStripper.ts'), 'utf8');
  for (const [file, text] of [['ContextHygiene.ts', hygene], ['CogmemBlockStripper.ts', stripper]] as const) {
    for (const literal of [OPEN, CLOSE, WHOLE]) {
      const bare = literal.replace(/[<>/]/g, '');
      expect({ file, literal: bare, present: text.includes(bare) }).toEqual({ file, literal: bare, present: false });
    }
  }
});
