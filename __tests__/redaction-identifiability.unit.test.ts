import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryUsageReceipt, formatMemoryUsageBridge } from '../src/agent/MemoryUsageReceipt.js';
import { createMemoryKernel } from '../src/factory.js';
import { PiiRedactor, readRedactionMarks } from '../src/governance/PiiRedactor.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #115. Recall hands the caller a text that has been through redaction, and until now
 * the caller could not tell. A model reading `BEACON-[REDACTED_PHONE]` has to decide
 * whether that is the value that was written, and the honest answer is "no, and here is
 * how much was taken out" — an empty answer about an altered text is what turns a
 * redaction into a wrong quotation.
 */

const PHONE_IN_TEXT = '+86 138 0013 8000';

test('a redaction marker carries how much was removed (#115)', () => {
  const { text, findings } = new PiiRedactor().redact(`reach me at ${PHONE_IN_TEXT} tomorrow`);
  expect(findings).toHaveLength(1);
  // The value itself is still reported to the callers that record what kind of data was
  // found; the text only carries its length.
  const removed = findings[0]!.value;
  expect(text).toContain(`[REDACTED_PHONE:${removed.length}]`);
  expect(text).not.toContain(removed);
  expect(readRedactionMarks(text)).toEqual({ count: 1, chars: removed.length });
});

test('marks written before the length was recorded still count (#115)', () => {
  // An existing ledger holds `[REDACTED_PHONE]` with no length. Counting it is what
  // makes those rows identifiable too; the character total is honestly smaller rather
  // than invented.
  expect(readRedactionMarks('a [REDACTED_PHONE] b [REDACTED_EMAIL:21] c'))
    .toEqual({ count: 2, chars: 21 });
  expect(readRedactionMarks('nothing here')).toEqual({ count: 0, chars: 0 });
  // The deep-write redactor writes the bare form beside its own kinds.
  expect(readRedactionMarks('Authorization: Bearer [REDACTED] and [REDACTED_PRIVATE_KEY]'))
    .toEqual({ count: 2, chars: 0 });
});

test('a recall item whose text was redacted says so (#115)', async () => {
  const dir = makeTempDir('cogmem-redaction-recall-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  const turn = {
    agentId: 'openclaw', projectId: 'p', sessionId: 's', turnId: 'redaction-turn-1',
    userText: `the zanzibar handover contact is ${PHONE_IN_TEXT} — call before Friday`,
  };
  try {
    await backend.rememberTurnWithResult(turn);
    const recalled = backend.recall({ query: 'zanzibar handover contact', projectId: 'p', agentId: 'openclaw', limit: 5, now: Date.now() });
    const item = (recalled.items ?? []).find((candidate) => candidate.redaction);
    expect(item).toBeDefined();
    expect(item!.text).toContain('[REDACTED_PHONE:');
    expect(item!.redaction!.count).toBeGreaterThan(0);
    expect(item!.redaction!.chars).toBeGreaterThan(0);

    // Redaction is deterministic, which is what keeps it out of identity: the same turn
    // written twice under the same id is still one turn (#113) even though its text
    // contains a value that gets removed.
    const events = () => (kernel.episodeStore.db.prepare('select count(*) c from memory_events').get() as { c: number }).c;
    const before = events();
    const replay = await backend.rememberTurnWithResult(turn);
    expect(events()).toBe(before);
    expect(replay.duplicate).toBe(true);
  } finally {
    kernel.close();
  }
});

test('a truncated block says how much it dropped (#115)', () => {
  const long = 'x'.repeat(900);
  const receipt = createMemoryUsageReceipt({
    sessionId: 's',
    turnId: 't',
    userText: 'what did we decide about the storage layer',
    assistantText: long,
    recallItems: [{ id: 'm1', text: long, tags: [] }],
    ttlTurns: 3,
  });
  const bridge = formatMemoryUsageBridge(receipt, 400);
  const marker = /\.\.\. \[truncated: (\d+) chars omitted\]/.exec(bridge);
  expect(marker).not.toBeNull();
  // The count has to be the amount actually missing, or a reader cannot tell whether the
  // rest of the answer was dropped.
  expect(Number(marker![1])).toBeGreaterThan(0);
  // A block that fits says nothing about truncation.
  expect(formatMemoryUsageBridge(receipt, 100000)).not.toContain('truncated');
});
