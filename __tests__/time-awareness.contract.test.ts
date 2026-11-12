import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  ANCHOR_KINDS,
  DAY_PHASES,
  DENSITY_LABELS,
  RHYTHM_PHASES,
  TEMPORAL_CONTEXT_FIELDS,
  TIME_AWARENESS_CONTRACT_VERSION,
  WAKE_INTENTION_EVENT_TYPES,
  WAKE_INTENTION_STATUSES,
} from '../src/temporal/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F2 time-awareness contract (#156), asserted against the document it claims to implement.
 *
 * Same shape as the F1 contract test: the document's frozen tables are read back and compared with
 * the code's lists, so a name added in one place and not the other is red. The last test pins the
 * context block's field set by computing one and comparing its keys, which catches a field the
 * table forgot.
 */

const scratch = makeTempDir('cogmem-time-awareness-contract-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/time-awareness.md', import.meta.url)), 'utf8');

/** The text of one heading's section, stopping at the next H2 or H3. */
function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

/** The backticked first column of every table row in a section, in order. */
function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_-]*)`/gmu)].map((match) => match[1]!);
}

describe('the contract document and the frozen lists agree', () => {
  test('the context-field table is exactly TEMPORAL_CONTEXT_FIELDS, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('### Fields (frozen)'));
    expect(documented.length).toBeGreaterThan(0);
    expect(documented).toEqual([...TEMPORAL_CONTEXT_FIELDS]);
  });

  test('the day-phase table is exactly DAY_PHASES, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('### Day phases (frozen)'));
    expect(documented).toEqual([...DAY_PHASES]);
  });

  test('the density-label table is exactly DENSITY_LABELS, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('### Density labels (frozen)'));
    expect(documented).toEqual([...DENSITY_LABELS]);
  });

  test('the rhythm-phase table is exactly RHYTHM_PHASES, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('### Rhythm phases (frozen)'));
    expect(documented).toEqual([...RHYTHM_PHASES]);
  });

  test('the anchor-kind table is exactly ANCHOR_KINDS, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('### Anchor kinds (frozen)'));
    expect(documented).toEqual([...ANCHOR_KINDS]);
  });

  test('the wake-intention status table is exactly WAKE_INTENTION_STATUSES, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('### Wake intention statuses (frozen)'));
    expect(documented).toEqual([...WAKE_INTENTION_STATUSES]);
  });

  test('the intention ledger-event table is exactly WAKE_INTENTION_EVENT_TYPES, in order', () => {
    const documented = backtickedFirstColumn(sectionAfter('### Ledger event types (frozen)'));
    expect(documented).toEqual([...WAKE_INTENTION_EVENT_TYPES]);
  });

  test('the version constant is 1', () => {
    expect(TIME_AWARENESS_CONTRACT_VERSION).toBe(1);
  });
});

describe('the computed block has exactly the frozen fields', () => {
  test('Object.keys(temporalContext(...)) equals TEMPORAL_CONTEXT_FIELDS', () => {
    const now = Date.UTC(2026, 10, 10, 9, 0, 0);
    const block = kernel.temporalContext({ projectId: 'contract', now });
    expect(Object.keys(block)).toEqual([...TEMPORAL_CONTEXT_FIELDS]);
  });
});
